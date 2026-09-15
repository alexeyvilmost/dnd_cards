import {rollD20} from '../engine/roll';
import {drawDie} from '../engine/random';
import {availableRollInfluences, spendRollInfluence, withD20Replacement, type RollInfluence} from '../engine/rollInfluence';
import type {RollD20Options, RollLog, RuntimeState, EngineEvent} from '../mvp/contracts';

export function influencedSheetRoll(kind: 'check' | 'save', options: Omit<RollD20Options,'rng'>,
  runtime: RuntimeState | null | undefined, sources: readonly Record<string, unknown>[] = [], rng = Math.random) {
  const values: number[] = [];
  let selected: RollInfluence | undefined;
  let original: RollLog | undefined;
  let finalized = false;
  const request = {kind,
    roll: () => {
      if (original) return original;
      original = rollD20({...options, rng: () => {const value = rng(); values.push(value); return value;}});
      return original;
    },
    influences: (roll: RollLog) => runtime && !selected ? availableRollInfluences(runtime, sources, kind, roll) : [],
    influence: (id: string) => {
      if (!original || !runtime || selected) throw new Error('Нет доступного решения о броске');
      const action = availableRollInfluences(runtime, sources, kind, original).find(row => row.id === id);
      if (!action) throw new Error('Это влияние недоступно');
      const replacement = drawDie(rng, 20); let cursor = 0;
      const result = rollD20({...options, rng: withD20Replacement(() => cursor < values.length ? values[cursor++] : rng(), replacement, action.name)});
      selected = action;
      return result;
    },
  };
  return {request, spent: () => Boolean(selected), finalize(state: RuntimeState): {state: RuntimeState; events: EngineEvent[]} {
    if (!selected || !original) return {state, events: []};
    if (finalized) throw new Error('Это влияние уже применено');
    const valid = availableRollInfluences(state, sources, kind, original).find(row => row.id === selected?.id);
    if (!valid) throw new Error('Выбранное влияние больше недоступно');
    const paid = spendRollInfluence(state, valid);
    finalized = true;
    return paid;
  }};
}
