import { consumeNextRollEffects } from '../engine/execute';
import type { EngineEvent, RuntimeState } from '../mvp/contracts';

export type SheetD20RollKind = 'saving_throw' | 'ability_check' | 'initiative';

/** Finalize an ordinary sheet d20 roll through the same consume:next lifecycle
 * used by executable actions. The caller persists the returned runtime before
 * surfacing the journal events. */
export function finalizeSheetD20Roll(
  state: RuntimeState,
  rollKind: SheetD20RollKind,
  filter?: Record<string, unknown>,
): { state: RuntimeState; events: EngineEvent[] } {
  const events: EngineEvent[] = [];
  return {
    state: consumeNextRollEffects(state, rollKind, events, filter ? { filter } : {}),
    events,
  };
}
