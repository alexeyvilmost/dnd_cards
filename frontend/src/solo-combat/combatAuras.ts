import { boardLightSources, projectCombatIllumination, type BoardLightSource } from './combatIllumination';
import {projectMagicSuppression} from '../rules-core/magicSuppression';
import {isMagicalMechanics,isAntimagicField} from '../engine/magic';
import type { ActorState, RuleAutomaticHazardDefinition } from '../rules-core/domain';
import { actorHasConsciousVitality, actorIsDead } from '../engine/lifePolicies';
import { matchesWhen } from '../engine/circumstances';
import { payloadsOf } from '../engine/mechanicsView';
import { evaluate } from '../engine/formula';
import { applyAbilityScoreGrants } from '../character/rules/abilityScoreGrants';
import { actorFootprint, footprintDistanceFt } from './footprint';
import type { SoloCombatState } from './types';
import {spatialFacts} from './types';

type Dict = Record<string, unknown>;
const marker = 'combat_aura_projection';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const dictionary = (value: unknown): value is Dict => !!value && typeof value === 'object' && !Array.isArray(value);
const cleanPassives = (actor: ActorState): Dict[] => (actor.passives ?? []).filter(row => row[marker] !== true);
const distance = (state: SoloCombatState, a: string, b: string): number => footprintDistanceFt(
  state.tokens[a].position, state.tokens[b].position, actorFootprint(state.world.actors[a], state), actorFootprint(state.world.actors[b], state));
function relation(state: SoloCombatState, a: string, b: string): 'self' | 'ally' | 'enemy' | 'neutral' {
  if (a === b) return 'self';
  const left = state.sideByActorId?.[a], right = state.sideByActorId?.[b];
  return !left || !right ? 'neutral' : left === right ? 'ally' : 'enemy';
}
function formulaValue(raw: unknown, source: ActorState): number {
  const value = evaluate(String(raw), { abilityMods: source.character.abilityMods, profBonus: source.character.profBonus,
    selfLevel: source.character.level, classLevels: source.character.classLevels, spellcastingMod: source.character.spellcastingMod,
    variables: source.character.variables, rng: () => { throw Error('Aura projection cannot roll dice'); } });
  if (typeof value !== 'number' || !Number.isFinite(value)) throw Error('Aura formula must produce a finite number');
  return value;
}

interface AuraEntry { source: ActorState; sourceId: string; name: string; payload: Dict; index: number; magical:boolean; damageSourceKind: 'item' | 'spell' | 'ability' }
function auras(state: SoloCombatState): AuraEntry[] {
  return Object.values(state.world.actors).sort((a, b) => a.id.localeCompare(b.id)).flatMap(source => {
    if (!state.tokens[source.id] || actorIsDead(source)) return [];
    const mechanics: Dict[] = [...cleanPassives(source), ...source.runtime.activeEffects.filter(effect => effect.roundsLeft === undefined || effect.roundsLeft > 0)
      .map(effect => ({ ...effect.mechanics, id: effect.entityRef?.id ?? effect.id, name: effect.name }))];
    return mechanics.flatMap((mechanic, sourceIndex) => payloadsOf(mechanic).flatMap((payload, index) => {
      if (payload.kind !== 'aura' || !matchesWhen(payload.when as Dict[] | undefined, { state: source.runtime, character: source.character })) return [];
      if (payload.requires_conscious === true && !actorHasConsciousVitality(source)) return [];
      if (!Number.isFinite(payload.radius_ft) || Number(payload.radius_ft) < 0
        || !['self', 'others', 'allies', 'enemies', 'all'].includes(String(payload.recipients))
        || !Array.isArray(payload.effects) || payload.effects.length === 0 || !payload.effects.every(dictionary)
        || payload.effects.some(effect => effect.kind === 'aura')) throw Error('Invalid aura declaration');
      if (payload.events !== undefined && (!Array.isArray(payload.events) || payload.events.length === 0
        || payload.events.some(event => !['turn_start', 'turn_end'].includes(String(event))))) throw Error('Invalid aura lifecycle event');
      const damageSourceKind = mechanic.damage_source_kind === 'item' ? 'item' : mechanic.damage_source_kind === 'spell' ? 'spell' : 'ability';
      return [{ source, sourceId: String(mechanic.id ?? `source-${sourceIndex}`), name: String(mechanic.name ?? source.name), payload, index,
        magical:!isAntimagicField(mechanic)&&isMagicalMechanics(mechanic,source.character),damageSourceKind }];
    }));
  });
}

function recipients(state: SoloCombatState, entry: AuraEntry): string[] {
  return Object.values(state.world.actors).filter(target => {
    if (!state.tokens[target.id] || actorIsDead(target) || target.planeId !== entry.source.planeId) return false;
    if(entry.magical&&target.character.magicSuppressed)return false;
    const rel = relation(state, entry.source.id, target.id), filter = entry.payload.recipients;
    if (rel === 'self' && filter !== 'self' && filter !== 'all' && entry.payload.include_self !== true) return false;
    if (rel !== 'self' && filter !== 'others' && filter !== 'all'
      && !(rel === 'ally' && filter === 'allies') && !(rel === 'enemy' && filter === 'enemies')) return false;
    return distance(state, entry.source.id, target.id) <= Number(entry.payload.radius_ft);
  }).map(actor => actor.id).sort();
}

/** Auras are derived from the current board on every authoritative command.
 * Removing previous projections first prevents accumulation after reload and
 * makes moving away, expiry or source revocation effective immediately. */
export function projectCombatAuras(state: SoloCombatState): SoloCombatState {
  const magicWorld=projectMagicSuppression(state.world,(a,b)=>state.tokens[a]&&state.tokens[b]?distance(state,a,b):undefined);
  if(magicWorld!==state.world)state={...state,world:magicWorld};
  const actors = Object.fromEntries(Object.values(state.world.actors).map(actor => {
    const base = actor.character.combatSpatialBase;
    const character = base ? { ...actor.character, abilityScores: clone(base.abilityScores), abilityMods: clone(base.abilityMods),
      spellcastingMod: base.spellcastingMod } : { ...actor.character };
    return [actor.id, { ...actor, character, passives: cleanPassives(actor) }];
  }));
  let next: SoloCombatState = { ...state, world: { ...state.world, actors } };
  // All pair observations below read exactly this state. Collect light sources
  // lazily once; the later projection still collects from the updated aura world.
  let lights:BoardLightSource[]|undefined;
  const illuminationSources=()=>lights??=(boardLightSources(state));
  for (const actor of Object.values(actors)) {
    actor.character = { ...actor.character, spatialObservations: { boardRevision: state.boardRevision,
      nearby: !state.tokens[actor.id] ? [] : Object.values(actors).filter(target => target.id !== actor.id && state.tokens[target.id]
        && target.planeId === actor.planeId && !actorIsDead(target)).map(target => ({ actorId: target.id,
        ...spatialFacts(state,actor.id,target.id,false,illuminationSources),relation: relation(state, actor.id, target.id), conscious:actorHasConsciousVitality(target),distanceFt: distance(state, actor.id, target.id) })) } };
  }
  for (const entry of auras(next)) {
    if (entry.payload.events !== undefined) continue;
    const effects = (entry.payload.effects as Dict[]).map(payload => {
      const projected = clone(payload);
      // Passive numeric expressions belong to the aura owner, not its receiver.
      if (projected.kind === 'modifier' && projected.value !== undefined) projected.value = formulaValue(projected.value, entry.source);
      if (projected.kind === 'reduce_damage' && projected.amount !== undefined) projected.amount = formulaValue(projected.amount, entry.source);
      return projected;
    });
    for (const id of recipients(next, entry)) actors[id].passives!.push({ id: `aura:${entry.source.id}:${entry.sourceId}:${entry.index}`,
      name: entry.name, [marker]: true, sourceActorId: entry.source.id, sourceEntityIds: [entry.sourceId],
      effects: [{ resolution: 'auto', result: effects }] });
  }
  // Dynamic ability grants reuse the character resolver's cap semantics. Only
  // spatial grants are applied here; permanent grants are already in the base.
  for (const actor of Object.values(actors)) {
    const grants = actor.passives!.flatMap(passive => payloadsOf(passive).filter(payload => payload.kind === 'grant_ability_score'
      && (passive[marker] === true || JSON.stringify(payload.when ?? []).includes('nearby_enemies'))
      && matchesWhen(payload.when as Dict[] | undefined, { state: actor.runtime, character: actor.character })));
    if (!grants.length) continue;
    const character = actor.character;
    character.combatSpatialBase ??= { abilityScores: clone(character.abilityScores ?? {}), abilityMods: clone(character.abilityMods), spellcastingMod: character.spellcastingMod };
    for (const ability of abilities) {
      const relevant = grants.filter(grant => (grant.ability ?? grant.value) === ability);
      if (!relevant.length) continue;
      const base = character.abilityScores?.[ability];
      if (!Number.isFinite(base)) throw Error(`Spatial ability grant requires the actual ${ability} score`);
      const score = applyAbilityScoreGrants(base!, relevant.map(grant => ({ amount: Number(grant.amount ?? grant.value), cap: Number(grant.cap ?? 20) })));
      character.abilityScores = { ...character.abilityScores, [ability]: score };
      character.abilityMods = { ...character.abilityMods, [ability]: Math.floor((score - 10) / 2) };
      if (character.spellcastingAbility === ability) character.spellcastingMod = character.abilityMods[ability];
    }
  }
  if (JSON.stringify(state.world.actors) === JSON.stringify(actors)) next = state;
  return projectCombatIllumination(next);
}

export interface AuraExecution { targetActorId: string; hazard: RuleAutomaticHazardDefinition }
/** The caller passes the actual source whose turn boundary is being committed.
 * Hazards remain catalog declarations; a client never submits their payloads. */
export function collectAuraExecutions(state: SoloCombatState, event: 'turn_start' | 'turn_end', sourceActorId: string): AuraExecution[] {
  return auras(state).filter(entry => entry.source.id === sourceActorId && (entry.payload.events as string[] | undefined)?.includes(event))
    .flatMap(entry => recipients(state, entry).map(targetActorId => ({ targetActorId, hazard: {
      id: `aura:${entry.source.id}:${entry.sourceId}:${entry.index}:${event}`,
      name: entry.name, sourceKind: 'system' as const, sourceActorId: entry.source.id, sourceEntityIds: [entry.sourceId] as [string],
      resolution: 'automatic' as const, effects: clone(entry.payload.effects as Dict[]), grantedEffects: entry.source.grantedEffects, damageSourceKind: entry.damageSourceKind,
    } })));
}

export function isCombatAuraProjection(payload: Dict): boolean { return payload[marker] === true; }
