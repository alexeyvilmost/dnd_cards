import {useLayoutEffect, useRef, type ReactNode} from 'react';
import {positionOnMovementPath} from '../battle3d/movementAnimation';
import type {BattleMovementView} from '../battle3d/useBattleMovement';
import type {GridPosition} from '../solo-combat/types';

export default function BattleTokenMotion({movement, position, cellSize, reducedMotion, children}: {
  movement?: BattleMovementView; position: GridPosition; cellSize: number; reducedMotion: boolean; children: ReactNode;
}) {
  const element = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const token = element.current;
    if (!token) return;
    let frame = 0;
    const render = () => {
      const step = !reducedMotion && movement
        ? positionOnMovementPath(movement.points, (performance.now() - movement.startedAt) / 1000)
        : null;
      token.style.translate = step?.moving
        ? `${(step.position.x - position.x) * cellSize}px ${(step.position.y - position.y) * cellSize}px`
        : '0px 0px';
      if (step?.moving) frame = window.requestAnimationFrame(render);
    };
    render();
    return () => window.cancelAnimationFrame(frame);
  }, [movement, position.x, position.y, cellSize, reducedMotion]);
  return <span ref={element} className="battle-token-motion">{children}</span>;
}
