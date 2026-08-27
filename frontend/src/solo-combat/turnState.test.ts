import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../mvp/contracts';
import type { SoloCombatState } from './types';
import { writeDedicatedCombatTurnState } from './turnState';

const runtime: RuntimeState = {
  hp: { current: 7, max: 10, temp: 0 },
  resources: { action: 1 },
  maxResources: { action: 1 },
  equipment: {},
  inventory: [],
  activeEffects: [],
  firedThisTurn: [],
  firedThisRest: [],
};

describe('dedicated combat turn-state ownership', () => {
  it('removes an incompatible sheet continuation when dedicated combat starts', () => {
    const combat = { schemaVersion: 1, marker: 'dedicated' } as unknown as SoloCombatState;
    const next = writeDedicatedCombatTurnState({
      canonical_pending_combat_v1: { pending: true },
      unrelated: 'preserved',
    }, runtime, combat);

    expect(next).not.toHaveProperty('canonical_pending_combat_v1');
    expect(next.solo_combat_v1).toMatchObject({ marker: 'dedicated' });
    expect(next.unrelated).toBe('preserved');
  });

  it('clears both combat envelopes when dedicated combat finishes', () => {
    const next = writeDedicatedCombatTurnState({
      canonical_pending_combat_v1: { pending: true },
      solo_combat_v1: { marker: 'old' },
      unrelated: 'preserved',
    }, runtime, null);

    expect(next).not.toHaveProperty('canonical_pending_combat_v1');
    expect(next).not.toHaveProperty('solo_combat_v1');
    expect(next.unrelated).toBe('preserved');
  });
});
