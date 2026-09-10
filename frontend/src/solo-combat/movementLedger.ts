import type {SoloCombatState} from './types';

/** A temporary speed reduction can leave distance spent above the current
 * allowance. Keep that deficit until speed recovers or a new turn starts. */
export function signedMovementBudget(state: SoloCombatState, actorId: string, fallback: number): number {
  return (state.movementRemainingFt[actorId] ?? fallback) - (state.movementDeficitFt?.[actorId] ?? 0);
}

export function withMovementBudget(state: SoloCombatState, actorId: string, budget: number): SoloCombatState {
  const deficit = Math.max(0, -budget);
  const deficits = {...state.movementDeficitFt};
  if (deficit > 0) deficits[actorId] = deficit;
  else delete deficits[actorId];
  const {movementDeficitFt: _previousDeficit, ...base} = state;
  return {...base,
    movementRemainingFt: {...state.movementRemainingFt, [actorId]: Math.max(0, budget)},
    ...(Object.keys(deficits).length ? {movementDeficitFt: deficits} : {}),
  };
}
