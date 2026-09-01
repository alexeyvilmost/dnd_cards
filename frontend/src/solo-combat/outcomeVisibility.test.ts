import { describe, expect, it } from 'vitest';
import { shouldShowSoloCombatOutcome } from './outcomeVisibility';

const completedState = {
  outcome: 'victory' as const,
  world: { pendingResolution: null },
  pendingTriggeredAction: undefined,
  pendingTurnStartGrappleDamage: undefined,
  pendingAlertSwapActorIds: [],
  pendingInterception: undefined,
};

describe('shouldShowSoloCombatOutcome', () => {
  it('waits for a post-hit spell choice after the final enemy is defeated', () => {
    expect(shouldShowSoloCombatOutcome({
      ...completedState,
      pendingTriggeredAction: {
        event: 'hit' as const,
        sourceActorId: 'ranger',
        sourceActionId: 'longbow',
        targetIds: ['wolf'],
        optionActionIds: ['ensnaring-strike'],
      },
    })).toBe(false);
  });

  it('shows the result after every combat decision is resolved', () => {
    expect(shouldShowSoloCombatOutcome(completedState)).toBe(true);
  });
});
