import type { SoloCombatState } from './types';

interface OutcomeVisibilityState {
  outcome: SoloCombatState['outcome'];
  pendingTriggeredAction?: SoloCombatState['pendingTriggeredAction'];
  pendingTurnStartGrappleDamage?: SoloCombatState['pendingTurnStartGrappleDamage'];
  pendingAlertSwapActorIds?: SoloCombatState['pendingAlertSwapActorIds'];
  pendingInterception?: SoloCombatState['pendingInterception'];
  world: Pick<SoloCombatState['world'], 'pendingResolution'>;
}

/** Keep the result overlay behind every decision that still belongs to the combat. */
export function shouldShowSoloCombatOutcome(state: OutcomeVisibilityState): boolean {
  return state.outcome !== 'active'
    && !state.world.pendingResolution
    && !state.pendingTriggeredAction
    && !state.pendingTurnStartGrappleDamage
    && !state.pendingAlertSwapActorIds?.length
    && !state.pendingInterception;
}
