import { collectModifiers } from './modifiers';
import { activeConditionWorldFactEnabled } from './conditions';
import type {RuntimeState} from '../mvp/contracts';
import {payloadsOf} from './mechanicsView';

type Mechanics = Record<string, unknown>;

/** Active and permanent declarations share one range calculation. Expired and
 * not-yet-activated abilities never grant perception. */
export function senseRangeFt(runtime: RuntimeState, passives: readonly Mechanics[], sense: string): number {
  const declarations = [
    ...passives.filter(row => {
      const mode = (row.activation as Mechanics | undefined)?.mode;
      return mode == null || mode === 'passive';
    }),
    ...(runtime.activeEffects ?? []).filter(effect => effect.roundsLeft == null || effect.roundsLeft > 0)
      .map(effect => effect.mechanics as Mechanics),
  ];
  return declarations.flatMap(payloadsOf).reduce((range, payload) => {
    const feet = Number(payload.range);
    return payload.kind === 'grant_sense' && payload.sense === sense && Number.isFinite(feet) && feet > 0
      ? Math.max(range, feet) : range;
  }, 0);
}

export function perceivesWithoutSight(runtime: RuntimeState, passives: readonly Mechanics[], distanceFt: number | undefined): boolean {
  const range = senseRangeFt(runtime, passives, 'blindsight');
  return typeof distanceFt === 'number' && Number.isFinite(distanceFt) && distanceFt >= 0
    && range > 0 && distanceFt <= range;
}

/** Hearing-dependent automatic failure is the existing data-owned Deafened rule. */
export function canHear(runtime: RuntimeState, passives: readonly Mechanics[] = []): boolean {
  return !activeConditionWorldFactEnabled(runtime, 'cannot_hear')
    && !collectModifiers(runtime, [...passives], { roll: 'ability_check', filter: { sense: 'hearing' } }).autoFail;
}
