import seed from '../../../backend/animationpresentation/catalog.json';
import type { ActorState, RuleActionDefinition } from '../rules-core/domain';
import type { CombatAttackPresentation, CombatLogEventRecord, SoloCombatState } from './types';
import { attackRangeFromEffect, bindEquippedWeaponActionContext, weaponAttackKind, weaponContext } from '../engine/weapon';
import { getSystemActionDefinition } from '../rules-core/systemActions';
import { unarmedDamageActionFor, weaponAttackAction } from '../rules-core/attackDefinitions';
import { parseWeaponProfile } from '../engine/weaponProfile';
import type {RollLog} from '../mvp/contracts';

export type CombatAnimationPrimitive = 'melee_slash' | 'melee_pierce' | 'melee_bash' | 'ranged_arrow' | 'bite'
  | 'charged_beam' | 'area_cone' | 'area_wave' | 'area_burst' | 'area_line' | 'claws' | 'tail' | 'tentacle' | 'sting'
  | 'natural_slam' | 'weapon_throw' | 'firearm'
  | 'projectile' | 'beam' | 'burst' | 'aura' | 'heal' | 'ward' | 'illusion' | 'spectral_hand' | 'vines' | 'thunder'
  | 'dash' | 'hide' | 'disengage' | 'dodge' | 'help' | 'interact' | 'move' | 'death' | 'search' | 'recover';
export type CombatAnimationMotif = 'fire' | 'frost' | 'lightning' | 'acid' | 'poison' | 'radiant' | 'necrotic'
  | 'psychic' | 'force' | 'thunder' | 'nature' | 'water' | 'earth' | 'wind' | 'illusion' | 'healing' | 'weapon';
export interface CombatAnimationProfile {
  key: string;
  primitive: CombatAnimationPrimitive;
  palette: { primary: string; secondary: string };
  motion: { durationMs: number; scale: number; launchRatio?: number; contactRatio?: number };
  casterCircle: boolean;
  motif?: CombatAnimationMotif;
  weaponShape?: 'blade' | 'axe' | 'hammer' | 'spear' | 'stone';
  strikeStyle?: 'critical';
  /** Magic delivery may share a physical primitive, e.g. a thrown ice shard. */
  criticalEffect?: 'magic';
  /** Presentation inheritance for phase audio of an authored variant. */
  baseProfileKey?: string;
}
export interface EntityAnimationBinding { entity_type: string; entity_id: string; profile_key: string }
export interface CombatAnimationCatalog {
  version: number;
  profiles: CombatAnimationProfile[];
  bindings: EntityAnimationBinding[];
  defaults: Record<'visual' | 'event' | 'activation' | 'school' | 'damage', Record<string, string>> & {
    spellEvent?: Record<string, string>; attackKind?: Record<string, string>; rangedDamage?: Record<string, string>;
    rangedWeapon?: Record<string, string>; weaponProperty?: Record<string, string>;
    damagePalette?: Record<string, string>;
    criticalProfile?: Record<string, string>;
  };
  can_manage?: boolean;
}
export const builtInAnimationCatalog = seed as CombatAnimationCatalog;
let currentCatalog: CombatAnimationCatalog = builtInAnimationCatalog;
export function getCombatAnimationCatalog(): CombatAnimationCatalog { return currentCatalog; }
export function setCombatAnimationCatalog(catalog: CombatAnimationCatalog): void { currentCatalog = catalog; }
export function getAnimationProfile(key: string, catalog = currentCatalog): CombatAnimationProfile | undefined {
  return catalog.profiles.find(profile => profile.key === key) ?? builtInAnimationCatalog.profiles.find(profile => profile.key === key);
}
export interface CombatAnimationContext {
  visual?: string; event?: string; damageType?: string; weaponCardId?: string; attackKind?: string; sourceEntityIds?: string[];
  weaponType?: string; weaponProperties?: string[]; weaponDamageType?: string;
  outcome?: RollLog['outcome'];
  rollPhase?: 'before-reaction' | 'after-reaction';
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function damageTypeFromEffects(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (const item of value) { const type = damageTypeFromEffects(item); if (type) return type; }
    return undefined;
  }
  const row = object(value);
  if (row.kind === 'damage' && typeof row.type === 'string') return row.type;
  for (const key of ['effects', 'result', 'on_hit', 'on_fail', 'on_success', 'payload', 'damage', 'options', 'items', 'grants', 'apply', 'grant']) {
    const type = damageTypeFromEffects(row[key]); if (type) return type;
  }
  return undefined;
}

/** Canonical Attack entries can refer to a system operation while their source
 * retains the concrete sheet action. Never recover such an entry from its name. */
export function combatAnimationAction(state: Pick<SoloCombatState, 'catalogActions'> & Partial<Pick<SoloCombatState, 'world'>>, record?: CombatLogEventRecord): RuleActionDefinition | undefined {
  if (!record) return undefined;
  const direct = state.catalogActions.find(action => action.id === record.actionId);
  if (direct) return direct;
  const declaredId = record.facts?.declaredActionId;
  const ids = [typeof declaredId === 'string' ? declaredId : undefined, ...(record.sourceEntityIds ?? [])];
  for (const id of ids) {
    const definition = state.catalogActions.find(action => action.id === id);
    if (definition) return definition;
  }
  const system = record.actionId ? getSystemActionDefinition(record.actionId) : undefined;
  const actor = state.world?.actors[record.sourceActorId];
  if (system && actor) {
    if (system.kind === 'attack_entry' && system.entryKind === 'unarmed_strike' && system.unarmedOption === 'damage') {
      return unarmedDamageActionFor(actor);
    }
    if ((system.kind === 'attack_entry' && system.entryKind === 'weapon_attack') || system.kind === 'light_property_extra_attack') {
      const hand = record.facts?.hand === 'off' ? 'off' : 'main';
      const range = object(record.facts?.range).kind ?? weaponContext(actor.character, hand, actor.runtime.equipment)?.defaultAttackMode;
      return {...weaponAttackAction(hand, range === 'ranged' ? 'ranged' : 'melee'), id: system.id,
        sourceEntityIds: [...new Set([...system.sourceEntityIds, ...(record.sourceEntityIds ?? [])])] as [string, ...string[]]};
    }
  }
  return undefined;
}

/** A decorative projection of the very same weapon binding as execution. The
 * selected card comes from committed provenance when available, so old logs do
 * not suddenly use a newly equipped weapon. New logs persist this projection. */
export function combatAttackPresentation(action: RuleActionDefinition | undefined, actor: ActorState | undefined,
  record?: Pick<CombatLogEventRecord, 'facts' | 'sourceEntityIds'>): CombatAttackPresentation {
  let mechanics = action?.mechanics ?? {};
  const originalKind = weaponAttackKind(mechanics);
  const savedWeaponId = typeof record?.facts?.weaponCardId === 'string' ? record.facts.weaponCardId
    : record?.sourceEntityIds?.find(id => id.startsWith('card:'))?.slice(5);
  const hand = record?.facts?.hand === 'off' || originalKind === 'off' ? 'off' : 'main';
  const equipment = actor && savedWeaponId ? {...actor.runtime.equipment, [hand === 'off' ? 'off_hand' : 'main_hand']: savedWeaponId}
    : actor?.runtime.equipment;
  if (actor && originalKind) {
    const cards = new Map([...(actor.character.knownCards ?? []), ...(actor.character.equippedCards ?? [])].map(card => [card.id, card]));
    try { mechanics = bindEquippedWeaponActionContext(mechanics, equipment, cards); }
    catch { /* An old replay can lack a removed card; retain recorded facts below. */ }
  }
  const effects = Array.isArray(mechanics.effects) ? mechanics.effects as Record<string, unknown>[] : [];
  const attack = effects.find(effect => effect.resolution === 'attack_roll');
  // Natural attacks declare their own payload and never inherit held weapons.
  const weapon = actor && (originalKind === 'main' || originalKind === 'off' || savedWeaponId)
    ? weaponContext(actor.character, hand, equipment, actor.runtime, actor.passives) : null;
  const declaredDamage = damageTypeFromEffects(attack);
  const pact = object(record?.facts?.pactBlade);
  const damageType = typeof pact.damageType === 'string' ? pact.damageType
    : declaredDamage === 'weapon' || (!declaredDamage && savedWeaponId) ? weapon?.damageType : declaredDamage;
  const card = weapon && [...(actor?.character.knownCards ?? []), ...(actor?.character.equippedCards ?? [])]
    .find(item => item.id === weapon.cardId);
  const physical = card ? parseWeaponProfile(card) : undefined;
  const visualDamageType = physical?.valid ? physical.profile.damageLines[0]?.type : damageType;
  const range = object(record?.facts?.range).kind
    ?? (actor && attack ? attackRangeFromEffect(attack, hand, actor.character, equipment) : undefined)
    ?? (savedWeaponId ? weapon?.defaultAttackMode : undefined);
  const visual = action?.kind === 'spell' ? 'magic'
    : range === 'ranged' ? 'ranged'
      : ['slashing', 'piercing', 'bludgeoning'].includes(String(visualDamageType)) ? visualDamageType as CombatAttackPresentation['visual']
        : attack ? 'bludgeoning' : undefined;
  return {...(visual ? {visual} : {}), ...(damageType ? {damageType} : {}),
    ...(typeof attack?.attack_kind === 'string' ? {attackKind: attack.attack_kind} : {}),
    ...(weapon?.weaponType ? {weaponType: weapon.weaponType} : {}),
    ...(weapon ? {weaponProperties: [...weapon.properties]} : {}),
    ...(physical?.valid ? {weaponDamageType: physical.profile.damageLines[0].type} : {}),
    ...((savedWeaponId ?? weapon?.cardId) ? {weaponCardId: savedWeaponId ?? weapon?.cardId} : {})};
}

/** Entity assignments take precedence. Generic fallback only reads mechanics
 * and confirmed presentation facts; names, descriptions and UUID branches are
 * deliberately absent. This function cannot execute or modify game rules. */
export function resolveCombatAnimation(
  action?: RuleActionDefinition,
  context: CombatAnimationContext = {},
  catalog = currentCatalog,
): CombatAnimationProfile {
  const profile = selectCombatAnimation(action, context, catalog);
  const damageType = context.damageType ?? damageTypeFromEffects(action?.mechanics);
  return combatAnimationForOutcome(profile, {...context, damageType}, catalog);
}

/** Critical delivery is selected from the confirmed saved outcome, never a die
 * face or damage amount. This same projection serves live beats and previews. */
export function combatAnimationForOutcome(profile: CombatAnimationProfile,
  context: Pick<CombatAnimationContext, 'outcome' | 'rollPhase' | 'damageType'> = {}, catalog = currentCatalog): CombatAnimationProfile {
  const criticalKey = context.outcome === 'crit' && context.rollPhase !== 'before-reaction'
    ? catalog.defaults.criticalProfile?.[profile.key] ?? builtInAnimationCatalog.defaults.criticalProfile?.[profile.key] : undefined;
  const variant = criticalKey ? getAnimationProfile(criticalKey, catalog) : undefined;
  const selected = variant ? {...variant, palette: profile.palette, motif: profile.motif,
    casterCircle: profile.casterCircle, ...(profile.weaponShape ? {weaponShape: profile.weaponShape} : {})} : profile;
  return combatDamagePalette(selected, context.damageType, catalog);
}

/** Confirmed packets may have a chosen damage type absent from the template. */
export function combatDamagePalette(profile: CombatAnimationProfile, damageType: string | undefined, catalog = currentCatalog): CombatAnimationProfile {
  const paletteKey = damageType ? catalog.defaults.damagePalette?.[damageType] ?? builtInAnimationCatalog.defaults.damagePalette?.[damageType] : undefined;
  const palette = paletteKey ? getAnimationProfile(paletteKey, catalog)?.palette : undefined;
  return palette ? {...profile, palette} : profile;
}

function selectCombatAnimation(
  action?: RuleActionDefinition,
  context: CombatAnimationContext = {},
  catalog = currentCatalog,
): CombatAnimationProfile {
  if (action) {
    const kind = action.kind === 'spell' ? 'spell' : 'action';
    const ids = [action.kind === 'spell' ? action.spell?.entityId : undefined, action.id, ...(action.sourceEntityIds ?? []), ...(context.sourceEntityIds ?? [])].filter((id): id is string => Boolean(id));
    for (const id of ids) {
      const binding = catalog.bindings.find(row => row.entity_type === kind && row.entity_id === id);
      const profile = binding && getAnimationProfile(binding.profile_key, catalog);
      if (profile) return profile;
    }
    // Follow-up capabilities may be nonSpell actions granted by a spell,
    // effect or item. Their authoritative provenance retains the entity ID.
    for (const id of action.sourceEntityIds ?? []) {
      const binding = catalog.bindings.find(row => row.entity_id === id);
      const profile = binding && getAnimationProfile(binding.profile_key, catalog);
      if (profile) return profile;
    }
  }
  // A committed natural attack can outlive its catalog definition; provenance
  // still owns its presentation. Item bindings specialize generic weapon FX.
  for (const id of [...(context.sourceEntityIds ?? []), ...(context.weaponCardId ? [context.weaponCardId] : [])]) {
    const binding = catalog.bindings.find(row => row.entity_id === id);
    const profile = binding && getAnimationProfile(binding.profile_key, catalog);
    if (profile) return profile;
  }
  const select = (group: keyof CombatAnimationCatalog['defaults'], value: unknown) => {
    if (typeof value !== 'string') return undefined;
    const key = catalog.defaults[group]?.[value] ?? builtInAnimationCatalog.defaults[group]?.[value];
    return key ? getAnimationProfile(key, catalog) : undefined;
  };
  const mechanics = object(action?.mechanics);
  const activation = object(mechanics.activation);
  if (action?.kind === 'spell') {
    return select('spellEvent', context.event)
      ?? select('damage', context.damageType ?? damageTypeFromEffects(mechanics))
      ?? select('school', action.spell?.school) ?? getAnimationProfile('spell.force', catalog)!;
  }
  const activationProfile = select('activation', activation.counts_as);
  if (activationProfile) return activationProfile;
  if (context.event && context.event !== 'damage') {
    const eventProfile = select('event', context.event);
    if (eventProfile) return eventProfile;
  }
  return select('attackKind', context.attackKind)
    ?? (context.visual === 'ranged' ? select('rangedWeapon', context.weaponType)
      ?? select('rangedDamage', context.weaponDamageType ?? context.damageType)
      ?? context.weaponProperties?.map(property => select('weaponProperty', property)).find(Boolean) : undefined)
    ?? select('visual', context.visual) ?? select('visual', context.damageType)
    ?? getAnimationProfile(action ? 'action.interact' : 'action.effect', catalog)!;
}

export interface ActiveSpellCircle {
  key: string;
  actorId: string;
  actionId: string;
  spellLevel: number;
  profile: CombatAnimationProfile;
}

/** Read-only projection of currently persisted spell lifetimes. No reconstruction
 * from combat prose, spell names or wall-clock guesses; expired entries vanish
 * on the same authoritative state update that removed their effect. */
export function resolveActiveSpellCircles(state: SoloCombatState, catalog = currentCatalog): ActiveSpellCircle[] {
  const circles = new Map<string, ActiveSpellCircle>();
  const actionFor = (id: string | undefined) => id ? state.catalogActions.find(action => action.kind === 'spell'
    && (action.id === id || action.spell?.entityId === id || action.sourceEntityIds?.includes(id))) : undefined;
  const add = (actorId: string | undefined, spellId: string | undefined, savedLevel?: number) => {
    const action = actionFor(spellId);
    if (!actorId || !action || action.kind !== 'spell' || !state.tokens[actorId]) return;
    const spellLevel = Math.max(0, Math.min(9, savedLevel ?? action.spell?.level ?? 0));
    const canonicalId = action.spell?.entityId ?? action.id;
    const key = `${actorId}:${canonicalId}`;
    const existing = circles.get(key);
    if (existing && existing.spellLevel >= spellLevel) return;
    const profile = resolveCombatAnimation(action, {}, catalog);
    if (!profile.casterCircle) return;
    circles.set(key, {key, actorId, actionId: action.id, spellLevel, profile});
  };
  for (const actor of Object.values(state.world.actors)) {
    for (const effect of actor.runtime.activeEffects ?? []) {
      if (effect.roundsLeft !== undefined && effect.roundsLeft <= 0) continue;
      const spell = effect.actionContext?.spell;
      const id = effect.spellOriginId ?? (effect.magicOrigin?.kind === 'spell' ? effect.magicOrigin.sourceEntityId : undefined) ?? spell?.spellId;
      add(effect.sourceId ?? effect.actionContext?.sourceId, id, spell?.castLevel ?? spell?.baseLevel);
    }
  }
  for (const concentration of Object.values(state.world.concentrations ?? {})) add(concentration.sourceActorId, concentration.actionId);
  for (const area of Object.values(state.combatAreas ?? {})) {
    if ('roundsLeft' in area.duration && area.duration.roundsLeft !== undefined && area.duration.roundsLeft <= 0) continue;
    add(area.sourceActorId, area.sourceActionId);
  }
  for (const object of Object.values(state.world.objects ?? {})) {
    if (object.kind === 'spell_effect' && (object.roundsLeft === undefined || object.roundsLeft > 0)) add(object.sourceActorId, object.sourceActionId);
    // Light/marks may be attached to a mundane item. Their own saved source
    // and lifetime establish spell provenance without treating the item as a spell.
    if (object.illumination && (object.illumination.roundsLeft === null || object.illumination.roundsLeft > 0)) {
      add(object.illumination.sourceActorId, object.illumination.sourceActionId);
    }
    for (const attachment of object.prestidigitation ?? []) {
      if (attachment.roundsLeft > 0) add(attachment.sourceActorId, attachment.sourceActionId);
    }
  }
  const currentRound = state.world.scene?.mode === 'encounter' ? state.world.scene.round : 0;
  for (const actor of Object.values(state.world.actors)) {
    if (!actor.ownedSummon || (actor.ownedSummon.duration.type === 'rounds' && actor.ownedSummon.duration.expiresAfterRound < currentRound)) continue;
    add(actor.ownedSummon.ownerActorId, actor.ownedSummon.sourceActionId);
  }
  return [...circles.values()];
}
