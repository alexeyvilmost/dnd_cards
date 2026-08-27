import type { PreparedSheetAtomicWorldCommit } from './sheetAtomicWorldCommit';
import type { PreparedSheetCombatCommit } from './sheetCombatSession';
import type { PreparedSheetCompanionInteraction } from './sheetCompanionInteraction';

/** One exact idempotent command retained above every action-panel mount boundary. */
export type SheetAtomicRetryEnvelope =
  | {
    characterId: string;
    kind: 'combat';
    prepared: PreparedSheetCombatCommit;
  }
  | {
    characterId: string;
    kind: 'companion';
    prepared: PreparedSheetCompanionInteraction;
  }
  | {
    characterId: string;
    kind: 'ordinary_spell';
    prepared: PreparedSheetAtomicWorldCommit;
  };

export function sheetAtomicRetryLabel(retry: SheetAtomicRetryEnvelope): string {
  switch (retry.kind) {
    case 'combat': return 'атомарной боевой команды';
    case 'companion': return 'атомарной операции спутника';
    case 'ordinary_spell': return 'атомарного заклинания';
  }
}
