import { useEffect, useRef } from 'react';
import { activeActor, runMonsterTurn } from '../solo-combat/engine';
import type { SoloCombatState } from '../solo-combat/types';

/** React lifecycle adapter for the pure monster controller in monsterAi.ts. */
export default function MonsterTurnController({
  state, disabled, onTransition, onError,
}: {
  state: SoloCombatState;
  disabled: boolean;
  onTransition: (next: SoloCombatState) => void;
  onError: (message: string) => void;
}) {
  const handled = useRef('');
  useEffect(() => {
    if (disabled || state.outcome !== 'active' || state.world.pendingResolution) return undefined;
    const actor = activeActor(state);
    if (actor.kind !== 'monster') return undefined;
    const key = `${state.world.revision}:${actor.id}`;
    if (handled.current === key) return undefined;
    handled.current = key;
    const timer = window.setTimeout(() => {
      try { onTransition(runMonsterTurn(state)); }
      catch (reason) { onError(reason instanceof Error ? reason.message : 'Ошибка хода монстра'); }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [disabled, onError, onTransition, state]);
  return null;
}
