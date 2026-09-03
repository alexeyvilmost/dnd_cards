import { writeSoloCombatState } from './persistence';

export const INCOMPATIBLE_COMBAT_RULES_ERROR = 'Character uses an incompatible rules version';

/** Drop only the stale encounter snapshot. Character runtime and every other
 * turn-state owner remain intact and a new encounter can compile current rules. */
export function clearIncompatibleCombatSnapshot(turnState: Record<string, unknown> | null | undefined) {
  return writeSoloCombatState(turnState, null);
}

export function isIncompatibleCombatRulesError(reason: unknown): boolean {
  if (!(reason instanceof Error)) return false;
  if (reason.message === INCOMPATIBLE_COMBAT_RULES_ERROR) return true;
  // Persisted encounters are decoded before their freshly compiled participant
  // is available for the content-hash comparison. A stricter world schema can
  // therefore reject an old snapshot first (for example after spell-access
  // normalization). These are stale-snapshot failures too and must expose the
  // same one-click recovery instead of trapping the user on a dead-end page.
  return /^world(?:\.|\[)/.test(reason.message)
    || /^World state /.test(reason.message);
}
