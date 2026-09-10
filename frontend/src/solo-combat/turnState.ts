import { writeWeaponBondObjects } from '../character/weaponBondPersistence';
import { clearSheetCombatSession } from '../character/sheetCombatSession';
import { writeRulesEngineRuntimeTurnState } from '../character/runtime';
import type { RuntimeState } from '../mvp/contracts';
import { writeSoloCombatState } from './persistence';
import type { SoloCombatState } from './types';

/** One persisted turn-state owner at a time across sheet and dedicated combat. */
export function writeDedicatedCombatTurnState(
  turnState: Record<string, unknown> | null | undefined,
  runtime: RuntimeState,
  combat: SoloCombatState | null,
): Record<string, unknown> {
  const sheetSafe = clearSheetCombatSession(combat
    ? writeWeaponBondObjects(turnState, combat.characterId, combat.world.objects) : turnState);
  return writeSoloCombatState(
    writeRulesEngineRuntimeTurnState(sheetSafe, runtime),
    combat,
  );
}
