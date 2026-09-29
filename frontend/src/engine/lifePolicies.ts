import type { CharacterContext, RuntimeState } from '../mvp/contracts';
import { matchesWhen } from './circumstances';
import { payloadsOf } from './mechanicsView';

type Dict = Record<string, unknown>;

/** Content-owned changes to the shared dying/consciousness rules. Callers must
 * supply the same eligible passives they use for rolls and damage reduction. */
export interface LifePolicy {
  failureLimit: number;
  reviveAtNatural: number;
  remainConsciousAtZero: boolean;
  cannotDie: boolean;
  immediateSaveAtZero: boolean;
  resurrectionSpellRefs?: string[];
  damageAtZeroConditions: Array<{ source: string; sourceId?: string; payloads: Dict[] }>;
  turnStartAtZeroConditions: Array<{ source: string; sourceId?: string; payloads: Dict[] }>;
}

const dictionary = (value: unknown): value is Dict => value !== null && typeof value === 'object' && !Array.isArray(value);

export function collectLifePolicies(
  state: RuntimeState,
  passives: readonly Dict[] = [],
  character?: CharacterContext,
): LifePolicy {
  const result: LifePolicy = { failureLimit: 3, reviveAtNatural: 20, remainConsciousAtZero: false,
    cannotDie: false, immediateSaveAtZero: false, damageAtZeroConditions: [], turnStartAtZeroConditions: [] };
  const sources = [...passives, ...state.activeEffects.filter(effect => effect.roundsLeft === undefined || effect.roundsLeft > 0)
    .map(effect => ({ ...effect.mechanics, id: effect.entityRef?.id ?? effect.id, name: effect.name }))];
  let failureDelta=0;
  for (const source of sources) {
    for (const payload of payloadsOf(source)) {
      if (payload.kind !== 'life_policy') continue;
      if (!matchesWhen(payload.when as Dict[] | undefined, { state, character })) continue;
      if(payload.death_failure_limit_delta!==undefined){
        if(!Number.isSafeInteger(payload.death_failure_limit_delta))throw Error('life_policy.death_failure_limit_delta must be an integer');
        failureDelta+=Number(payload.death_failure_limit_delta);
      }
      if(payload.resurrection_spell_refs!==undefined){
        const refs=payload.resurrection_spell_refs;
        if(!Array.isArray(refs)||!refs.length||refs.some(ref=>typeof ref!=='string'||!ref.trim()))throw Error('life_policy.resurrection_spell_refs must contain canonical references');
        result.resurrectionSpellRefs=result.resurrectionSpellRefs?result.resurrectionSpellRefs.filter(ref=>refs.includes(ref)):[...refs];
      }
      const held = payload.requires_held_item;
      if (held !== undefined) {
        if (typeof held !== 'string' || !held.trim()) throw Error('life_policy.requires_held_item must be an exact item reference');
        if (state.equipment.main_hand !== held && state.equipment.off_hand !== held) continue;
      }
      for (const [key, minimum, maximum, target] of [
        ['max_death_failures', 1, 3, 'failureLimit'], ['revive_at_natural', 1, 20, 'reviveAtNatural'],
      ] as const) {
        const value = payload[key];
        if (value === undefined) continue;
        if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) throw Error(`Invalid life_policy.${key}`);
        result[target] = Math.min(result[target], Number(value));
      }
      for (const [key, target] of [
        ['remain_conscious_at_zero', 'remainConsciousAtZero'], ['cannot_die', 'cannotDie'], ['immediate_death_save', 'immediateSaveAtZero'],
      ] as const) {
        if (payload[key] !== undefined && typeof payload[key] !== 'boolean') throw Error(`Invalid life_policy.${key}`);
        result[target] ||= payload[key] === true;
      }
      for (const [key, target] of [
        ['on_damage_at_zero', 'damageAtZeroConditions'], ['on_turn_start_at_zero', 'turnStartAtZeroConditions'],
      ] as const) {
        const values = payload[key];
        if (values === undefined) continue;
        if (!Array.isArray(values) || !values.length || values.some(value => !dictionary(value)
          || value.kind !== 'condition' || value.op !== 'apply' || typeof value.value !== 'string' || !value.value.trim())) {
          throw Error(`life_policy.${key} must declare condition applications`);
        }
        result[target].push({ source: String(source.name ?? 'Правило жизнеспособности'),
          ...(typeof source.id === 'string' ? { sourceId: source.id } : {}), payloads: values.map(value => ({ ...value })) });
      }
    }
  }
  result.failureLimit=Math.max(0,Math.min(3,result.failureLimit+failureDelta));
  return result;
}

export function remainsConsciousAtZero(state: RuntimeState, passives: readonly Dict[] = [], character?: CharacterContext): boolean {
  return state.hp.current === 0 && state.deathSaves?.dead !== true
    && collectLifePolicies(state, passives, character).remainConsciousAtZero;
}

type VitalActor = { runtime: RuntimeState; passives?: readonly Dict[]; character?: CharacterContext; lifecycle?: { status?: string } };

/** A count can reach its ordinary limit while a content-owned prevention is
 * active. Explicit death is never undone merely by equipping an item. */
export function actorIsDead(actor: VitalActor | undefined): boolean {
  if (!actor) return true;
  if (actor.runtime.deathSaves?.dead || actor.lifecycle?.status === 'dead') return true;
  const policy = collectLifePolicies(actor.runtime, actor.passives, actor.character);
  return !policy.cannotDie && (policy.failureLimit>0||actor.runtime.hp.current===0) && (actor.runtime.deathSaves?.failures ?? 0) >= policy.failureLimit;
}

export function resurrectionPermitted(state:RuntimeState,passives:readonly Dict[]=[],character?:CharacterContext,spellRef?:string):boolean {
  const refs=collectLifePolicies(state,passives,character).resurrectionSpellRefs;
  return refs===undefined||(typeof spellRef==='string'&&refs.includes(spellRef));
}

/** Replaces HP-only gates for movement, actions and tactical occupancy. Other
 * conditions (paralysis, stun, incapacitation) retain their separate checks. */
export function actorHasConsciousVitality(actor: VitalActor | undefined): boolean {
  if (!actor || actorIsDead(actor)) return false;
  return actor.runtime.hp.current > 0 || remainsConsciousAtZero(actor.runtime, actor.passives, actor.character);
}

export function immediateDeathSaveRequired(before: RuntimeState, after: RuntimeState, policy: LifePolicy): boolean {
  return before.hp.current > 0 && after.hp.current === 0 && after.deathSaves?.dead !== true
    && !policy.remainConsciousAtZero && policy.immediateSaveAtZero;
}

/** Conditions are returned to the canonical payload executor, preserving its
 * immunity, stacking, source, exhaustion-threshold and audit behavior. */
export function zeroHpLifeConsequences(state: RuntimeState, policy: LifePolicy, boundary: 'damage' | 'turn_start') {
  if (state.hp.current !== 0 || (state.deathSaves?.dead && !policy.cannotDie)) return [];
  return boundary === 'damage' ? policy.damageAtZeroConditions : policy.turnStartAtZeroConditions;
}
