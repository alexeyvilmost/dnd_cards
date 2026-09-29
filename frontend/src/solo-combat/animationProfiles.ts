import seed from '../../../backend/animationpresentation/catalog.json';
import type { RuleActionDefinition } from '../rules-core/domain';
import type { SoloCombatState } from './types';

export type CombatAnimationPrimitive = 'melee_slash' | 'melee_pierce' | 'melee_bash' | 'ranged_arrow' | 'bite'
  | 'projectile' | 'beam' | 'burst' | 'aura' | 'heal' | 'ward' | 'illusion' | 'spectral_hand' | 'vines' | 'thunder'
  | 'dash' | 'hide' | 'disengage' | 'dodge' | 'help' | 'interact' | 'move' | 'death' | 'search' | 'recover';
export type CombatAnimationMotif = 'fire' | 'frost' | 'lightning' | 'acid' | 'poison' | 'radiant' | 'necrotic'
  | 'psychic' | 'force' | 'thunder' | 'nature' | 'water' | 'earth' | 'wind' | 'illusion' | 'healing' | 'weapon';
export interface CombatAnimationProfile {
  key: string;
  primitive: CombatAnimationPrimitive;
  palette: { primary: string; secondary: string };
  motion: { durationMs: number; scale: number };
  casterCircle: boolean;
  motif?: CombatAnimationMotif;
}
export interface EntityAnimationBinding { entity_type: string; entity_id: string; profile_key: string }
export interface CombatAnimationCatalog {
  version: number;
  profiles: CombatAnimationProfile[];
  bindings: EntityAnimationBinding[];
  defaults: Record<'visual' | 'event' | 'activation' | 'school' | 'damage', Record<string, string>> & {spellEvent?: Record<string, string>};
  can_manage?: boolean;
}
export const builtInAnimationCatalog = seed as CombatAnimationCatalog;
let currentCatalog: CombatAnimationCatalog = builtInAnimationCatalog;
export function getCombatAnimationCatalog(): CombatAnimationCatalog { return currentCatalog; }
export function setCombatAnimationCatalog(catalog: CombatAnimationCatalog): void { currentCatalog = catalog; }
export function getAnimationProfile(key: string, catalog = currentCatalog): CombatAnimationProfile | undefined {
  return catalog.profiles.find(profile => profile.key === key) ?? builtInAnimationCatalog.profiles.find(profile => profile.key === key);
}
export interface CombatAnimationContext { visual?: string; event?: string; damageType?: string }

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
  for (const key of ['effects', 'result', 'on_hit', 'on_fail', 'on_success', 'payload', 'damage']) {
    const type = damageTypeFromEffects(row[key]); if (type) return type;
  }
  return undefined;
}

/** Entity assignments take precedence. Generic fallback only reads mechanics
 * and confirmed presentation facts; names, descriptions and UUID branches are
 * deliberately absent. This function cannot execute or modify game rules. */
export function resolveCombatAnimation(
  action?: RuleActionDefinition,
  context: CombatAnimationContext = {},
  catalog = currentCatalog,
): CombatAnimationProfile {
  if (action) {
    const kind = action.kind === 'spell' ? 'spell' : 'action';
    const ids = [action.kind === 'spell' ? action.spell?.entityId : undefined, action.id, ...(action.sourceEntityIds ?? [])].filter((id): id is string => Boolean(id));
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
  return select('visual', context.visual) ?? select('visual', context.damageType)
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
