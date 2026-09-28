import {rollD20} from '../engine/roll';
import {drawDie} from '../engine/random';
import {availableRollInfluences, spendRollInfluence, withD20Replacement, influencedD20Options, applyInfluenceConsequences, type RollInfluence, type InfluenceContext} from '../engine/rollInfluence';
import type {RollD20Options, RollLog, RuntimeState, EngineEvent} from '../mvp/contracts';

export function influencedSheetRoll(kind: 'check' | 'save', options: Omit<RollD20Options,'rng'>,
  runtime: RuntimeState | null | undefined, sources: readonly Record<string, unknown>[] = [], rng = Math.random, context: InfluenceContext = {}) {
  const values: number[] = [];
  let selected: RollInfluence | undefined;
  let before: RollInfluence | undefined;
  let original: RollLog | undefined;
  let finalRoll: RollLog | undefined;
  let finalized = false;
  const request = {kind,
    beforeInfluences: () => runtime && !original ? availableRollInfluences(runtime,sources,kind,undefined,{...context,timing:'before_roll'}) : [],
    beforeInfluence: (id: string) => {
      if (!runtime || original || before) throw new Error('Выбор до броска больше недоступен');
      before = availableRollInfluences(runtime,sources,kind,undefined,{...context,timing:'before_roll'}).find(action=>action.id===id);
      if (!before) throw new Error('Это влияние недоступно');
    },
    roll: () => {
      if (original) return original;
      original = rollD20(influencedD20Options({...options, rng: () => {const value = rng(); values.push(value); return value;}},before ? [before] : []));
      return original;
    },
    influences: (roll: RollLog) => runtime && !selected ? availableRollInfluences(before ? spendRollInfluence(runtime,before).state : runtime, sources, kind, roll,context) : [],
    influence: (id: string) => {
      if (!original || !runtime || selected) throw new Error('Нет доступного решения о броске');
      const action = request.influences(original).find(row => row.id === id);
      if (!action) throw new Error('Это влияние недоступно');
      const replacement = action.operation === 'reroll_kept_d20' ? drawDie(rng, 20) : undefined; let cursor = 0;
      const replay = () => cursor < values.length ? values[cursor++] : rng();
      const result = rollD20(influencedD20Options({...options, rng: replacement === undefined ? replay : withD20Replacement(replay, replacement, action.name)},[...(before ? [before] : []),action]));
      selected = action;
      finalRoll = result;
      return result;
    },
  };
  return {request, spent: () => Boolean(selected || before), finalize(state: RuntimeState): {state: RuntimeState; events: EngineEvent[]} {
    if ((!selected && !before) || !original) return {state, events: []};
    if (finalized) throw new Error('Это влияние уже применено');
    let paid = {state,events:[] as EngineEvent[]};
    for (const choice of [before,selected]) {
      if (!choice) continue;
      const valid = availableRollInfluences(paid.state,sources,kind,choice===before ? undefined : original,{...context,timing:choice===before ? 'before_roll' : 'after_roll_before_outcome'}).find(row=>row.id===choice.id);
      if (!valid) throw new Error('Выбранное влияние больше недоступно');
      const spent = spendRollInfluence(paid.state,valid);
      paid = {state:spent.state,events:[...paid.events,...spent.events]};
    }
    finalized = true;
    paid.state = applyInfluenceConsequences(paid.state,[before,selected].filter((choice):choice is RollInfluence=>Boolean(choice)),finalRoll ?? original);
    return paid;
  }};
}
