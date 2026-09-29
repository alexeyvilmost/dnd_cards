import type { CharacterContext, EngineEvent, RuntimeState } from '../mvp/contracts';
import { payloadsOf } from './mechanicsView';
import { matchesWhen } from './circumstances';
import { rollFormula } from './formula';

type Dict = Record<string, unknown>;
export type RestKind = 'short' | 'long';
export type RestPolicyContext = CharacterContext & { passives?: Dict[]; rng?: () => number; skipRestPolicies?: boolean };

/** Called only by a confirmed rest; previews never draw the outcome. */
export function resolveRestPolicies(state: RuntimeState, ctx: RestPolicyContext, rest: RestKind): { denied: boolean; events: EngineEvent[] } {
  const events: EngineEvent[] = [];
  if (ctx.skipRestPolicies) return { denied: false, events };
  let denied = false;
  const sources = [...(ctx.passives ?? []), ...state.activeEffects.filter(e => e.roundsLeft == null || e.roundsLeft > 0).map(e => ({ ...e.mechanics, name: e.name }))];
  for (const source of sources) for (const payload of payloadsOf(source)) {
    if (payload.kind !== 'rest_policy' || !matchesWhen(payload.when as Dict[] | undefined, { state, character: ctx })) continue;
    const chance = payload.failure_chance as Dict | undefined;
    if (!Array.isArray(payload.rests) || !payload.rests.length || payload.rests.some(r => r !== 'short' && r !== 'long')
      || !chance || !Number.isSafeInteger(chance.die) || Number(chance.die) < 2 || Number(chance.die) > 100
      || !Array.isArray(chance.equals) || !chance.equals.length || chance.equals.some(n => !Number.isSafeInteger(n) || Number(n) < 1 || Number(n) > Number(chance.die))) {
      throw Error('Invalid rest_policy declaration');
    }
    if (!payload.rests.includes(rest)) continue;
    const roll = rollFormula(`1d${chance.die}`, {}, { rng: ctx.rng });
    const failed = chance.equals.includes(roll.total);
    denied ||= failed;
    events.push({ type: 'roll', label: String(source.name ?? 'Условия отдыха'), roll: { ...roll, kind: 'other', advantage: 'none' } });
  }
  if (denied) events.push({ type: 'narrative', text: 'Время отдыха прошло, но этот отдых не дал преимуществ.' });
  return { denied, events };
}
