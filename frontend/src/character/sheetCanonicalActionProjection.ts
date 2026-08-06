import { bindEquippedWeaponActionContext } from '../engine/weapon';
import type { Card } from '../types';
import type { SheetAction } from './actionSheet';
import { sheetActionNeedsCanonicalRuntime } from './sheetPrimitiveUi';

export interface RunnableSheetCanonicalActionProjection {
  actions: SheetAction[];
  issues: ReadonlyMap<string, string>;
}

/**
 * Materialize only actor-runnable canonical actions. Contextual weapon actions
 * whose declared hand is unavailable remain visible in the ordinary sheet UI,
 * but never enter an executable actor capability set with an unbound profile.
 * Spell rows also carry the complete spellbook/preparation provenance needed
 * to certify access, even when that spell still uses the legacy executor.
 */
export function projectRunnableSheetCanonicalActions(input: {
  actions: readonly SheetAction[];
  equipment: Readonly<Record<string, string | null | undefined>>;
  cards: ReadonlyMap<string, Card>;
}): RunnableSheetCanonicalActionProjection {
  const actions: SheetAction[] = [];
  const issues = new Map<string, string>();
  const cards = new Map(input.cards);
  for (const action of input.actions) {
    const carriesSpellAccess = action.group === 'spell' && action.spellRef !== undefined;
    if (!carriesSpellAccess && !sheetActionNeedsCanonicalRuntime(action.mechanics)) continue;
    try {
      actions.push({
        ...action,
        mechanics: bindEquippedWeaponActionContext(
          action.mechanics,
          input.equipment,
          cards,
        ),
      });
    } catch (cause) {
      issues.set(action.id, cause instanceof Error ? cause.message : String(cause));
    }
  }
  return { actions, issues };
}
