import { collectModifiers } from './modifiers';
import { activeConditionWorldFactEnabled } from './conditions';
import type {RuntimeState} from '../mvp/contracts';
export {senseRangeFt, perceivesWithoutSight} from '../rules-primitives/sensePerception';
type Mechanics = Record<string, unknown>;

/** Hearing-dependent automatic failure is the existing data-owned Deafened rule. */
export function canHear(runtime: RuntimeState, passives: readonly Mechanics[] = []): boolean {
  return !activeConditionWorldFactEnabled(runtime, 'cannot_hear')
    && !collectModifiers(runtime, [...passives], { roll: 'ability_check', filter: { sense: 'hearing' } }).autoFail;
}
