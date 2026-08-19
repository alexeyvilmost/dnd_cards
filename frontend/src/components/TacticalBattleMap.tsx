import { useMemo, useState } from 'react';
import type { GridPosition, SoloCombatState } from '../solo-combat/types';
import { TACTICAL_HEIGHT, TACTICAL_WIDTH } from '../solo-combat/types';
import { areaPositionsForAction } from '../solo-combat/tacticalGrid';

export default function TacticalBattleMap({
  state,
  selectedActionId,
  movementMode,
  onCell,
}: {
  state: SoloCombatState;
  selectedActionId: string | null;
  movementMode: boolean;
  onCell: (position: GridPosition, actorId?: string) => void;
}) {
  const [hovered, setHovered] = useState<GridPosition | null>(null);
  const activeId = state.world.scene.mode === 'encounter'
    ? state.world.scene.initiative[state.world.scene.activeIndex]
    : '';
  const tokenByCell = new Map(Object.values(state.tokens).map((token) => [
    `${token.position.x}:${token.position.y}`, token,
  ]));
  const selectedAction = state.catalogActions.find((action) => action.id === selectedActionId);
  const areaCells = useMemo(() => new Set(
    selectedAction && hovered
      ? areaPositionsForAction(selectedAction, hovered).map((position) => `${position.x}:${position.y}`)
      : [],
  ), [selectedAction, hovered]);
  return (
    <div className={`tactical-map${selectedActionId ? ' is-targeting' : ''}${movementMode ? ' is-moving' : ''}`} data-testid="tactical-map">
      {Array.from({ length: TACTICAL_WIDTH * TACTICAL_HEIGHT }, (_, index) => {
        const position = { x: index % TACTICAL_WIDTH, y: Math.floor(index / TACTICAL_WIDTH) };
        const token = tokenByCell.get(`${position.x}:${position.y}`);
        const actor = token ? state.world.actors[token.actorId] : undefined;
        const dead = actor && actor.runtime.hp.current <= 0;
        return (
          <button
            type="button"
            key={`${position.x}:${position.y}`}
            className={`tactical-cell${token ? ' has-token' : ''}${token?.actorId === activeId ? ' is-active' : ''}${dead ? ' is-dead' : ''}${areaCells.has(`${position.x}:${position.y}`) ? ' is-area-preview' : ''}`}
            aria-label={token ? `${actor?.name}, ${actor?.runtime.hp.current}/${actor?.runtime.hp.max} HP` : `Клетка ${position.x + 1}, ${position.y + 1}`}
            data-actor-id={token?.actorId}
            onMouseEnter={() => setHovered(position)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onCell(position, token?.actorId)}
          >
            {token && actor && (
              <span className="battle-token" style={{ '--token-color': token.color } as React.CSSProperties}>
                {token.tokenUrl ? <img src={token.tokenUrl} alt="" /> : <b>{actor.name.slice(0, 1)}</b>}
                <span className="battle-token__name">{actor.name}</span>
                <span className="battle-token__hp"><i style={{ width: `${Math.max(0, actor.runtime.hp.current / actor.runtime.hp.max * 100)}%` }} /></span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
