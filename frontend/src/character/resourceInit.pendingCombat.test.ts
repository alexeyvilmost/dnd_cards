import { describe, expect, it } from 'vitest';
import { hasPendingSheetCombatSession } from './resourceInit';
import type { ForgeCharacter } from './types';

describe('pending sheet-combat initialization guard', () => {
  it('recognizes a mirrored combat envelope as CAS-owned runtime', () => {
    expect(hasPendingSheetCombatSession({
      turn_state: { canonical_pending_combat_v1: { schemaVersion: 1 } },
    } as ForgeCharacter)).toBe(true);
  });

  it('does not block ordinary detached runtime initialization', () => {
    expect(hasPendingSheetCombatSession({ turn_state: {} } as ForgeCharacter)).toBe(false);
    expect(hasPendingSheetCombatSession({ turn_state: null } as ForgeCharacter)).toBe(false);
  });
});
