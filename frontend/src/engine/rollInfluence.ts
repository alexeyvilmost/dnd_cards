import type {RollLog, RuntimeState, CharacterContext, RollD20Options} from '../mvp/contracts';
import {canPay, pay, bindSelfItemCost} from './cost';
import {payloadsOf} from './mechanicsView';
import definitions from './data/rollInfluences.json';
import type {DieAwareRandomSource} from './random';
import {activeEffectRequirementIssue} from './actionRequirements';
import {deniedCapabilities,foldAdvantage} from './modifiers';

type Dict = Record<string, unknown>;
export type InfluenceRollKind = 'attack' | 'save' | 'check' | 'damage' | 'healing' | 'other';
export type InfluenceTiming = 'before_roll' | 'after_roll_before_outcome';
export type InfluenceOperation = 'reroll_kept_d20' | 'reroll_roll' | 'advantage' | 'disadvantage' | 'force_success' | 'critical_on_hit' | 'add_modifier' | 'set_die_result';
export interface InfluenceContext { timing?: InfluenceTiming; character?: CharacterContext; ability?: string; skill?: string; weaponId?: string; otherActorRoll?: boolean; allowOtherActors?: boolean; turnKey?: string; inEncounter?: boolean }
export interface RollInfluence {
  id: string; name: string; description: string; imageUrl?: string;
  cost: Dict[];
  operation: InfluenceOperation;
  payload?: Dict;
  ownerId?: string;
  oncePerTurnKey?: string;
  mechanics: Dict;
}
export function rollInfluenceSelfDamage(influence:Pick<RollInfluence,'payload'>):{amount:number;type:string}|null{
  const value=influence.payload?.self_damage;
  if(value===undefined)return null;
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid self-damage influence cost');
  const cost=value as Dict;
  if(!Number.isSafeInteger(cost.amount)||Number(cost.amount)<=0||typeof cost.type!=='string'||!cost.type)throw new Error('Invalid self-damage influence cost');
  return {amount:Number(cost.amount),type:cost.type};
}

/** Core rule actions and entity-contributed actions use the same vocabulary.
 * No source identity, resource name, or die threshold is interpreted by UI. */
export function availableRollInfluences(
  state: RuntimeState, sources: readonly Dict[], kind: InfluenceRollKind, roll?: RollLog, context: InfluenceContext = {},
): RollInfluence[] {
  const timing = context.timing ?? 'after_roll_before_outcome';
  const natural = roll?.dice.find(die => die.sides === 20 && !die.discarded)?.result;
  if (timing !== 'before_roll' && !roll?.dice.some(die=>!die.discarded)) return [];
  const entities: Dict[] = [...definitions, ...sources,
    ...state.activeEffects.map(effect => ({id: effect.id, name: effect.name, ...effect.mechanics}))];
  const result = new Map<string, RollInfluence>();
  for (const source of entities) {
    const entity = typeof source.requires_item_source === 'string' ? bindSelfItemCost(source,source.requires_item_source) : source;
    const activation = entity.activation as Dict | undefined;
    if (activation?.mode !== 'triggered' || !entity.id || !entity.name) continue;
    if (activeEffectRequirementIssue(entity,state,context.character)) continue;
    if (!Array.isArray(activation.cost)) continue;
    const cost = activation.cost as Dict[];
    if (cost.some(row => !row || typeof row.resource !== 'string' || !row.resource.trim() || !Number.isInteger(Number(row.amount ?? 1)) || Number(row.amount ?? 1) < 0)) continue;
    if (!canPay(state, cost).ok) continue;
    if (cost.some(row=>row.resource==='reaction') && deniedCapabilities(state,[...sources]).has('reaction')) continue;
    for (const payload of payloadsOf(entity)) {
      if (payload.kind !== 'roll_influence' || !['reroll_kept_d20','reroll_roll','advantage','disadvantage','force_success','critical_on_hit','add_modifier','set_die_result'].includes(String(payload.operation))
        || payload.timing !== timing || !Array.isArray(payload.eligible_rolls)
        || !payload.eligible_rolls.includes(kind)) continue;
      if (payload.operation === 'reroll_kept_d20' && timing !== 'after_roll_before_outcome') continue;
      if (payload.operation === 'reroll_roll' && (timing !== 'after_roll_before_outcome'
        || !roll?.dice.some(die=>!die.discarded)
        || !roll.dice.every(die=>die.discarded||Number.isSafeInteger(die.drawOrdinal)))) continue;
      if (timing !== 'before_roll' && payload.operation !== 'reroll_roll' && natural === undefined) continue;
      if(payload.self_damage!==undefined){
        // Damage costs require the persisted combat attack continuation.
        if(kind!=='attack'||timing!=='after_roll_before_outcome'||state.hp.current<=0)continue;
        try{rollInfluenceSelfDamage({payload});}catch{continue;}
      }
      if (['advantage','disadvantage'].includes(String(payload.operation)) && timing !== 'before_roll') continue;
      if (payload.ability && payload.ability !== context.ability) continue;
      if (payload.skill && payload.skill !== context.skill) continue;
      if (payload.operation === 'add_modifier' && (!Number.isFinite(payload.value)
        || (payload.bonus_dice !== undefined && !/^[1-9]\d*d[1-9]\d*$/i.test(String(payload.bonus_dice))))) continue;
      if (payload.bonus_dice !== undefined && timing !== 'before_roll') continue;
      if (payload.operation === 'set_die_result' && (!Number.isInteger(payload.value) || Number(payload.value) < 1 || Number(payload.value) > 20)) continue;
      if (payload.combat_only === true && !context.inEncounter) continue;
      if (context.otherActorRoll && payload.affects !== 'any') continue;
      if (payload.weapon_id && payload.weapon_id !== context.weaponId) continue;
      const oncePerTurnKey = typeof payload.once_per_turn === 'string' ? `roll-influence:${payload.once_per_turn}${context.turnKey ? `:${context.turnKey}` : ''}` : undefined;
      if (oncePerTurnKey && state.firedThisTurn?.includes(oncePerTurnKey)) continue;
      if (Array.isArray(payload.eligible_outcomes) && !payload.eligible_outcomes.includes(roll?.outcome)) continue;
      if (payload.die_min != null && (!Number.isInteger(payload.die_min) || natural === undefined || natural < Number(payload.die_min))) continue;
      if (payload.die_max != null && (!Number.isInteger(payload.die_max) || natural === undefined || natural > Number(payload.die_max))) continue;
      const id = String(entity.id);
      result.set(id, {id, name: String(entity.name), description: String(entity.description ?? ''),
        imageUrl: typeof entity.image_url === 'string' ? entity.image_url : undefined,
        cost, operation: payload.operation as InfluenceOperation, payload, oncePerTurnKey, mechanics: entity});
    }
  }
  return [...result.values()];
}

/** Canonical sheet action rows provide presentation and already-bound self_uses
 * costs. Trigger-only actions stay out of proactive execution buttons. */
export function rollInfluenceSources(actions: readonly {id: string; name: string; description?: string; imageUrl?: string | null; mechanics: Dict}[]): Dict[] {
  return actions.filter(action => payloadsOf(action.mechanics).some(payload => payload.kind === 'roll_influence' || payload.kind === 'd20_interrupt'))
    .map(action => ({...action.mechanics,id:action.id,name:action.name,description:action.description,image_url:action.imageUrl}));
}

export function influencedD20Options(options: RollD20Options, influences: readonly RollInfluence[]): RollD20Options {
  let hasAdvantage = options.hasAdvantage === true || options.advantage === 'advantage';
  let hasDisadvantage = options.hasDisadvantage === true || options.advantage === 'disadvantage';
  const rules = [...(options.rules ?? [])];
  const modifiers = [...(options.modifiers ?? [])];
  for (const influence of influences) {
    const op = influence.operation;
    if (op === 'advantage' || op === 'disadvantage') {
      hasAdvantage ||= op === 'advantage';
      hasDisadvantage ||= op === 'disadvantage';
    } else if (op !== 'reroll_kept_d20' && op !== 'add_modifier') rules.push({op,source:influence.name,
      ...(op === 'set_die_result' ? { value: Number(influence.payload?.value) } : {})});
    if (op !== 'reroll_kept_d20') modifiers.push({value:op === 'add_modifier' ? Number(influence.payload?.value) : 0,source:influence.name,reason:op});
    const penalty = /^([1-9]\d*)d([1-9]\d*)$/i.exec(String(influence.payload?.penalty_dice ?? ''));
    if (penalty) rules.push({op:'bonus_die',count:Number(penalty[1]),faces:Number(penalty[2]),sign:-1,source:influence.name});
    const bonus = /^([1-9]\d*)d([1-9]\d*)$/i.exec(String(influence.payload?.bonus_dice ?? ''));
    if (bonus) rules.push({op:'bonus_die',count:Number(bonus[1]),faces:Number(bonus[2]),sign:1,source:influence.name});
  }
  return {...options,advantage:foldAdvantage(hasAdvantage,hasDisadvantage),hasAdvantage,hasDisadvantage,rules,modifiers};
}

/** Only the held first d20 is transformed; damage and subsequent rolls retain
 * the saved transcript and their ordinary rules. */
export function withD20Influences(rng: () => number, influences: readonly RollInfluence[]): DieAwareRandomSource {
  let used = false;
  return Object.assign(() => rng(), {...rng, transformD20: (options: RollD20Options) => {
    if (used) return options;
    used = true;
    return influencedD20Options(options,influences);
  }});
}

export function spendRollInfluence(state: RuntimeState, influence: RollInfluence) {
  if (!canPay(state, influence.cost).ok) throw new Error('Недостаточно ресурсов для влияния на бросок');
  const key = influence.oncePerTurnKey;
  if (key && state.firedThisTurn?.includes(key)) throw new Error('Это влияние уже использовано на этом ходу');
  const paid = pay(state, influence.cost);
  if (key) paid.state = {...paid.state,firedThisTurn:[...(paid.state.firedThisTurn ?? []),key]};
  return paid;
}

export function applyInfluenceConsequences(state: RuntimeState, influences: readonly RollInfluence[], roll: RollLog): RuntimeState {
  if (roll.outcome !== 'fail' && roll.outcome !== 'miss') return state;
  let next = state;
  for (const influence of influences) {
    if (influence.payload?.failure_disadvantage_until_rest !== true) continue;
    const id = `roll-influence-failure:${influence.id}`;
    if (next.activeEffects.some(effect=>effect.id===id)) continue;
    next = {...next,activeEffects:[...next.activeEffects,{id,name:influence.name,source:influence.name,expiry:'long_rest',
      mechanics:{effects:[{resolution:'auto',result:['attack','saving_throw','ability_check'].map(rollKind=>({kind:'modifier',op:'disadvantage',applies_to:{roll:rollKind}}))}]}}]};
  }
  return next;
}

/** One replacement, at the held die; unrelated damage/bonus dice use the replay. */
export function withD20Replacement(rng: () => number, result: number, source: string): DieAwareRandomSource {
  let used = false;
  return Object.assign(() => rng(), {
    rollDie: (rng as DieAwareRandomSource).rollDie,
    inspectD20: (rng as DieAwareRandomSource).inspectD20,
    transformD20: (rng as DieAwareRandomSource).transformD20,
    rerollD20Source: source,
    rerollD20: () => {if (used) return undefined; used = true; return result;},
  });
}
