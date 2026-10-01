import {useLayoutEffect, useRef, useState} from 'react';
import type {GridPosition, SoloCombatState} from '../solo-combat/types';
import {continueMovementPath, movementPathForTransition} from './movementAnimation';

export type BattleMovementView = {id: number; points: GridPosition[]; startedAt: number};

/** Both renderers animate the same read-only, committed movement route. */
export function useBattleMovement(state: SoloCombatState, enabled=true) {
  const [movements, setMovements] = useState<Record<string, BattleMovementView>>({});
  const previousState = useRef<SoloCombatState | null>(null);
  const sequence = useRef(0);
  useLayoutEffect(() => {
    const before = previousState.current;
    previousState.current = state;
    if (!before || !enabled) return;
    const routes = Object.entries(state.tokens).flatMap(([actorId]) => {
      const points = movementPathForTransition(before, state, actorId);
      return points ? [{actorId, points, id: ++sequence.current}] : [];
    });
    if (!routes.length) return;
    const startedAt = performance.now();
    setMovements(previous => {
      const next = {...previous};
      for (const {actorId, points, id} of routes) {
        const active = previous[actorId];
        next[actorId] = {id, startedAt, points: active
          ? continueMovementPath(active.points, (startedAt - active.startedAt) / 1000, points)
          : points};
      }
      return next;
    });
  }, [state, enabled]);
  return movements;
}
