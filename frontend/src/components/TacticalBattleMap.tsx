import { useMemo, useRef, useState } from 'react';
import type { CombatAreaState, GridPosition, SoloCombatState } from '../solo-combat/types';
import { TACTICAL_HEIGHT, TACTICAL_WIDTH } from '../solo-combat/types';
import { areaPositionsForAction, reachablePositions } from '../solo-combat/tacticalGrid';

export default function TacticalBattleMap({
  state,
  actorId,
  selectedActionId,
  movementMode,
  worldObjectMoveMode,
  inspectedActorId,
  onCell,
  onInspectActor,
}: {
  state: SoloCombatState;
  actorId: string;
  selectedActionId: string | null;
  movementMode: boolean;
  worldObjectMoveMode?: boolean;
  inspectedActorId?: string | null;
  onCell: (position: GridPosition, actorId?: string) => void;
  onInspectActor?: (actorId: string) => void;
}) {
  const [hovered, setHovered] = useState<GridPosition | null>(null);
  const [zoom, setZoom] = useState(1);
  const [panning, setPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const activeId = state.world.scene.mode === 'encounter'
    ? state.world.scene.initiative[state.world.scene.activeIndex]
    : '';
  const tokenByCell = new Map(Object.values(state.tokens).map((token) => [
    `${token.position.x}:${token.position.y}`, token,
  ]));
  const dancingLightByCell = new Map(Object.values(state.world.objects).flatMap((object) => {
    const position = state.worldObjectPositions?.[object.id];
    return object.dancingLight && position ? [[`${position.x}:${position.y}`, object] as const] : [];
  }));
  const illusionByCell = new Map(Object.values(state.world.objects).flatMap((object) => {
    const position = state.worldObjectPositions?.[object.id];
    return object.illusion && position ? [[`${position.x}:${position.y}`, object] as const] : [];
  }));
  const areasByCell = new Map<string, CombatAreaState[]>();
  for (const area of Object.values(state.combatAreas ?? {})) {
    for (const cell of area.cells) {
      const key = `${cell.x}:${cell.y}`;
      areasByCell.set(key, [...(areasByCell.get(key) ?? []), area]);
    }
  }
  const selectedAction = state.catalogActions.find((action) => action.id === selectedActionId);
  const sourcePosition = state.tokens[actorId]?.position;
  const areaCells = useMemo(() => new Set(
    selectedAction && hovered && sourcePosition
      ? areaPositionsForAction({
        action: selectedAction,
        sourcePosition,
        aimPosition: hovered,
      }).map((position) => `${position.x}:${position.y}`)
      : [],
  ), [selectedAction, hovered, sourcePosition]);
  const reachableCells = useMemo(() => new Set(
    movementMode
      ? reachablePositions(
        state,
        actorId,
        state.movementRemainingFt[actorId] ?? 0,
      ).map((position) => `${position.x}:${position.y}`)
      : [],
  ), [actorId, movementMode, state]);

  const finishPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    panRef.current = null;
    setPanning(false);
    suppressClickRef.current = pan.moved && event.type === 'pointerup';
  };

  return (
    <div
      ref={viewportRef}
      className={`tactical-map-viewport site-scrollbar${panning ? ' is-panning' : ''}`}
      data-testid="tactical-map-viewport"
      data-panning={panning || undefined}
      title={`Масштаб ${Math.round(zoom * 100)}% · колесо меняет масштаб · перетаскивание двигает карту`}
      onWheel={(event) => {
        event.preventDefault();
        setZoom((current) => Math.min(1.8, Math.max(0.45, Number((current + (event.deltaY < 0 ? 0.1 : -0.1)).toFixed(2)))));
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        const viewport = viewportRef.current;
        if (!viewport) return;
        panRef.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          scrollLeft: viewport.scrollLeft,
          scrollTop: viewport.scrollTop,
          moved: false,
        };
      }}
      onPointerMove={(event) => {
        const pan = panRef.current;
        const viewport = viewportRef.current;
        if (!pan || !viewport || pan.pointerId !== event.pointerId) return;
        const dx = event.clientX - pan.x;
        const dy = event.clientY - pan.y;
        if (!pan.moved) {
          if (Math.hypot(dx, dy) < 5) return;
          pan.moved = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          setPanning(true);
        }
        viewport.scrollLeft = pan.scrollLeft - dx;
        viewport.scrollTop = pan.scrollTop - dy;
        event.preventDefault();
      }}
      onPointerUp={finishPan}
      onPointerCancel={finishPan}
      onClickCapture={(event) => {
        if (!suppressClickRef.current) return;
        suppressClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
    <div
      className={`tactical-map${selectedActionId ? ' is-targeting' : ''}${movementMode ? ' is-moving' : ''}${worldObjectMoveMode ? ' is-world-object-moving' : ''}`}
      data-testid="tactical-map"
      data-zoom={zoom}
      style={{ '--tactical-cell-size': `${Math.round(80 * zoom)}px` } as React.CSSProperties}
    >
      {Array.from({ length: TACTICAL_WIDTH * TACTICAL_HEIGHT }, (_, index) => {
        const position = { x: index % TACTICAL_WIDTH, y: Math.floor(index / TACTICAL_WIDTH) };
        const token = tokenByCell.get(`${position.x}:${position.y}`);
        const dancingLight = dancingLightByCell.get(`${position.x}:${position.y}`);
        const illusion = illusionByCell.get(`${position.x}:${position.y}`);
        const persistentAreas = areasByCell.get(`${position.x}:${position.y}`) ?? [];
        const actor = token ? state.world.actors[token.actorId] : undefined;
        const dead = actor && actor.runtime.hp.current <= 0;
        const lightLabel = dancingLight
          ? `Танцующий огонёк, тусклый свет ${dancingLight.dancingLight!.dimRadiusFt} фт.`
          : '';
        const illusionLabel = illusion
          ? `Малая иллюзия: ${illusion.illusion!.description} · ${illusion.illusion!.form === 'sound' ? 'звук' : 'изображение'} · ${illusion.roundsLeft ?? 0} раундов · Изучение: Интеллект (Расследование) против СЛ ${illusion.illusion!.spellSaveDc}${illusion.illusion!.form === 'image' ? ' · физическое взаимодействие раскрывает иллюзию' : ''}`
          : '';
        const actorLabel = token ? `${actor?.name}, ${actor?.runtime.hp.current}/${actor?.runtime.hp.max} HP` : '';
        const areaLabel = persistentAreas.map((area) => {
          const duration = area.duration.type === 'permanent' ? 'постоянная'
            : area.duration.type === 'concentration' ? 'концентрация'
              : `${area.duration.roundsLeft} раундов`;
          const triggerLabels = area.triggers.map((trigger) => ({
            created: 'при создании', enter: 'при входе', exit: 'при выходе',
            move: 'за каждые 5 фт. движения', start_turn: 'в начале хода', end_turn: 'в конце хода',
          })[trigger]).join(', ');
          const hazard = area.hazard?.resolution === 'save'
            ? ` · спасбросок ${area.hazard.save.ability.toUpperCase()} СЛ ${area.hazard.save.dc}`
            : area.hazard?.resolution === 'automatic' ? ' · без спасброска' : '';
          const immunities = area.damageImmunities?.length
            ? ` · иммунитеты в области: ${area.damageImmunities.join(', ')}` : '';
          return `${area.name}: ${duration}${area.difficultTerrain ? ' · труднопроходимая местность' : ''}${area.lightlyObscured ? ' · слабо заслонённая область' : ''}${area.heavilyObscured ? ' · сильно заслонённая область' : ''}${area.blocksVerbalComponents ? ' · блокирует Вербальные компоненты' : ''}${immunities}${hazard}${triggerLabels ? ` · ${triggerLabels}` : ''}`;
        }).join(' · ');
        return (
          <button
            type="button"
            key={`${position.x}:${position.y}`}
            className={`tactical-cell${token ? ' has-token' : ''}${dancingLight || illusion ? ' has-world-object' : ''}${persistentAreas.length ? ' has-combat-area' : ''}${persistentAreas.some((area) => area.lightlyObscured) ? ' is-lightly-obscured' : ''}${persistentAreas.some((area) => area.heavilyObscured) ? ' is-heavily-obscured' : ''}${persistentAreas.some((area) => area.difficultTerrain) ? ' is-difficult-terrain' : ''}${token?.actorId === activeId ? ' is-active' : ''}${token?.actorId === inspectedActorId ? ' is-inspected' : ''}${dead ? ' is-dead' : ''}${areaCells.has(`${position.x}:${position.y}`) ? ' is-area-preview' : ''}${reachableCells.has(`${position.x}:${position.y}`) ? ' is-move-reachable' : ''}`}
            aria-label={[actorLabel, areaLabel, lightLabel, illusionLabel, `Клетка ${position.x + 1}, ${position.y + 1}`].filter(Boolean).join(' · ')}
            data-actor-id={token?.actorId}
            onMouseEnter={() => setHovered(position)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => {
              if (token && !selectedActionId && !movementMode) onInspectActor?.(token.actorId);
              onCell(position, token?.actorId);
            }}
          >
            {persistentAreas.map((area) => area.origin.x === position.x && area.origin.y === position.y ? (
              <span key={area.id} className={`combat-area-token is-${area.zoneType}`} title={areaLabel} aria-hidden="true">
                <b>{area.heavilyObscured ? '◉' : area.lightlyObscured ? '◌' : '◇'}</b><small>{area.name}</small>
              </span>
            ) : null)}
            {dancingLight && (
              <span className="dancing-light-token" title={lightLabel} aria-hidden="true">
                <b>✦</b><small>{dancingLight.dancingLight!.dimRadiusFt} фт.</small>
              </span>
            )}
            {illusion && (
              <span
                className={`minor-illusion-token is-${illusion.illusion!.form}`}
                title={illusionLabel}
                data-world-object-id={illusion.id}
                aria-hidden="true"
              >
                <b>{illusion.illusion!.form === 'sound' ? '♪' : '◈'}</b>
                <small>{illusion.illusion!.description}</small>
              </span>
            )}
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
    </div>
  );
}
