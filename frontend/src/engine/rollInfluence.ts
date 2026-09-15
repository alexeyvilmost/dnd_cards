import type {RollLog, RuntimeState} from '../mvp/contracts';
import {canPay, pay} from './cost';
import {payloadsOf} from './mechanicsView';
import definitions from './data/rollInfluences.json';
import type {DieAwareRandomSource} from './random';

type Dict = Record<string, unknown>;
export type InfluenceRollKind = 'attack' | 'save' | 'check';
export interface RollInfluence {
  id: string; name: string; description: string; imageUrl?: string;
  cost: Dict[];
  operation: 'reroll_kept_d20';
  mechanics: Dict;
}

/** Core rule actions and entity-contributed actions use the same vocabulary.
 * No source identity, resource name, or die threshold is interpreted by UI. */
export function availableRollInfluences(
  state: RuntimeState, sources: readonly Dict[], kind: InfluenceRollKind, roll: RollLog,
): RollInfluence[] {
  const natural = roll.dice.find(die => die.sides === 20 && !die.discarded)?.result;
  if (natural === undefined) return [];
  const entities: Dict[] = [...definitions, ...sources,
    ...state.activeEffects.map(effect => ({id: effect.id, name: effect.name, ...effect.mechanics}))];
  const result = new Map<string, RollInfluence>();
  for (const entity of entities) {
    const activation = entity.activation as Dict | undefined;
    if (activation?.mode !== 'triggered' || !entity.id || !entity.name) continue;
    if (!Array.isArray(activation.cost)) continue;
    const cost = activation.cost as Dict[];
    if (cost.some(row => !row || typeof row.resource !== 'string' || !row.resource.trim() || !Number.isInteger(Number(row.amount ?? 1)) || Number(row.amount ?? 1) < 0)) continue;
    if (!canPay(state, cost).ok) continue;
    for (const payload of payloadsOf(entity)) {
      if (payload.kind !== 'roll_influence' || payload.operation !== 'reroll_kept_d20'
        || payload.timing !== 'after_roll_before_outcome' || !Array.isArray(payload.eligible_rolls)
        || !payload.eligible_rolls.includes(kind)) continue;
      if (payload.die_min != null && (!Number.isInteger(payload.die_min) || natural < Number(payload.die_min))) continue;
      if (payload.die_max != null && (!Number.isInteger(payload.die_max) || natural > Number(payload.die_max))) continue;
      const id = String(entity.id);
      result.set(id, {id, name: String(entity.name), description: String(entity.description ?? ''),
        imageUrl: typeof entity.image_url === 'string' ? entity.image_url : undefined,
        cost, operation: 'reroll_kept_d20', mechanics: entity});
    }
  }
  return [...result.values()];
}

export function spendRollInfluence(state: RuntimeState, influence: RollInfluence) {
  if (!canPay(state, influence.cost).ok) throw new Error('Недостаточно ресурсов для влияния на бросок');
  return pay(state, influence.cost);
}

/** One replacement, at the held die; unrelated damage/bonus dice use the replay. */
export function withD20Replacement(rng: () => number, result: number, source: string): DieAwareRandomSource {
  let used = false;
  return Object.assign(() => rng(), {
    rollDie: (rng as DieAwareRandomSource).rollDie,
    inspectD20: (rng as DieAwareRandomSource).inspectD20,
    rerollD20Source: source,
    rerollD20: () => {if (used) return undefined; used = true; return result;},
  });
}
