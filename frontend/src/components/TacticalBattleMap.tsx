import { combatActorDisplayName } from '../character/familiarLabels';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CombatAreaState, GridPosition, SoloCombatState } from '../solo-combat/types';
import { TACTICAL_HEIGHT, TACTICAL_WIDTH } from '../solo-combat/types';
import { areaPositionsForAction, reachablePositions } from '../solo-combat/tacticalGrid';

export default function TacticalBattleMap({
  state,
  actorId,
  selectedActionId,
  eligibleTargetIds,
  movementMode,
  worldObjectMoveMode,
  inspectedActorId,
  onCell,
  onInspectActor,
  onDeclineAdditionalMovement,
}: {
  state: SoloCombatState;
  actorId: string;
  selectedActionId: string | null;
  eligibleTargetIds?: string[];
  movementMode: boolean;
  worldObjectMoveMode?: boolean;
  inspectedActorId?: string | null;
  onCell: (position: GridPosition, actorId?: string) => void;
  onInspectActor?: (actorId: string) => void;
  onDeclineAdditionalMovement?: () => void;
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
  const initialFitDone = useRef(false);
  const activeId = state.world.scene.mode === 'encounter'
    ? state.world.scene.initiative[state.world.scene.activeIndex]
    : '';
  // A fallen creature does not block a cell; a living occupant must remain selectable.
  const tokenByCell = new Map(Object.values(state.tokens).sort((a, b) =>
    Number((state.world.actors[a.actorId]?.runtime.hp.current ?? 0) > 0)
    - Number((state.world.actors[b.actorId]?.runtime.hp.current ?? 0) > 0),
  ).map((token) => [
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
  const groundItemsByCell = new Map<string, {id:string;name:string;imageUrl?:string}[]>();
  for(const object of Object.values(state.world.objects)){
    const position=state.worldObjectPositions?.[object.id];
    if(object.kind!=='item'||!object.itemCardId||object.carriedByActorId||object.heldByActorId||!position)continue;
    const card=Object.values(state.world.actors).flatMap(actor=>actor.character.knownCards??actor.character.equippedCards??[]).find(card=>card.id===object.itemCardId);
    const key=`${position.x}:${position.y}`;
    groundItemsByCell.set(key,[...(groundItemsByCell.get(key)??[]),{id:object.id,name:object.name,imageUrl:card?.image_url??undefined}]);
  }
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
        (state.pendingAdditionalMovement?.actorId === actorId ? state.pendingAdditionalMovement.remainingFt : state.movementRemainingFt[actorId]) ?? 0,
      ).map((position) => `${position.x}:${position.y}`)
      : [],
  ), [actorId, movementMode, state]);

  const centerOn = useCallback((positions: GridPosition[], nextZoom = zoom) => {
    const viewport = viewportRef.current;
    if (!viewport || !positions.length) return;
    setZoom(nextZoom);
    window.requestAnimationFrame(() => {
      const cellSize = 80 * nextZoom;
      const centerX = positions.reduce((sum, position) => sum + position.x + 0.5, 0) / positions.length;
      const centerY = positions.reduce((sum, position) => sum + position.y + 0.5, 0) / positions.length;
      const left = Math.max(0, centerX * cellSize - viewport.clientWidth / 2);
      const top = Math.max(0, centerY * cellSize - viewport.clientHeight / 2);
      if (typeof viewport.scrollTo === 'function') {
        viewport.scrollTo({ left, top, behavior: 'smooth' });
      } else {
        viewport.scrollLeft = left;
        viewport.scrollTop = top;
      }
    });
  }, [zoom]);

  useEffect(() => {
    if (initialFitDone.current) return;
    const positions = Object.values(state.tokens).map((token) => token.position);
    if (!positions.length) return;
    initialFitDone.current = true;
    window.requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const minX = Math.min(...positions.map((position) => position.x));
      const maxX = Math.max(...positions.map((position) => position.x));
      const minY = Math.min(...positions.map((position) => position.y));
      const maxY = Math.max(...positions.map((position) => position.y));
      const widthCells = maxX - minX + 3;
      const heightCells = maxY - minY + 3;
      const fitZoom = Math.min(1, Math.max(0.35, Math.min(
        viewport.clientWidth / (widthCells * 80),
        viewport.clientHeight / (heightCells * 80),
      )));
      centerOn(positions, Number(fitZoom.toFixed(2)));
    });
  }, [centerOn, state.tokens]);

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
        setZoom((current) => Math.min(1.8, Math.max(0.35, Number((current + (event.deltaY < 0 ? 0.1 : -0.1)).toFixed(2)))));
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
    <div className="tactical-map-controls" role="group" aria-label="Навигация по полю">
      <button type="button" onClick={() => setZoom((current) => Math.max(0.35, Number((current - 0.1).toFixed(2))))} aria-label="Уменьшить масштаб">−</button>
      <span>{Math.round(zoom * 100)}%</span>
      <button type="button" onClick={() => setZoom((current) => Math.min(1.8, Number((current + 0.1).toFixed(2))))} aria-label="Увеличить масштаб">+</button>
      <button type="button" onClick={() => {
        const position = state.tokens[actorId]?.position;
        if (position) centerOn([position]);
      }}>К персонажу</button>
      {state.pendingAdditionalMovement && !state.playerMovement && <>
        <span role="status">Выберите клетку · до {state.pendingAdditionalMovement.remainingFt} фт.{state.pendingAdditionalMovement.requiresReaction ? " · реакция" : ""}</span>
        <button type="button" disabled={!onDeclineAdditionalMovement} onClick={onDeclineAdditionalMovement}>Остаться на месте</button>
      </>}
    </div>
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
        const actorLabel = token ? `${actor ? combatActorDisplayName(actor) : ''}, ${actor?.runtime.hp.current}/${actor?.runtime.hp.max} HP` : '';
        const areaLabel = persistentAreas.map((area) => {
          const duration = area.duration.type === 'permanent' ? 'постоянная'
            : area.duration.type === 'concentration' ? 'концентрация'
              : `${area.duration.roundsLeft} раундов`;
          const triggerLabels = area.triggers.map((trigger) => (
            trigger === 'end_turn' && area.sourceTurnAffectsAllInside
              ? 'в конце хода источника — всем внутри'
              : ({
                created: 'при создании', enter: 'при входе', exit: 'при выходе',
                move: 'за каждые 5 фт. движения', start_turn: 'в начале хода', end_turn: 'в конце хода',
              })[trigger]
          )).join(', ');
          const hazard = area.hazard?.resolution === 'save'
            ? ` · спасбросок ${area.hazard.save.ability.toUpperCase()} СЛ ${area.hazard.save.dc}`
            : area.hazard?.resolution === 'automatic' ? ' · без спасброска' : '';
          const immunities = area.damageImmunities?.length
            ? ` · иммунитеты в области: ${area.damageImmunities.join(', ')}` : '';
          return `${area.name}: ${duration}${area.sourceAnchored ? ' · следует за источником' : ''}${area.difficultTerrain ? ' · труднопроходимая местность' : ''}${area.lightlyObscured ? ' · слабо заслонённая область' : ''}${area.heavilyObscured ? ' · сильно заслонённая область' : ''}${area.blocksVerbalComponents ? ' · блокирует Вербальные компоненты' : ''}${immunities}${hazard}${triggerLabels ? ` · ${triggerLabels}` : ''}`;
        }).join(' · ');
        return (
          <button
            type="button"
            key={`${position.x}:${position.y}`}
            className={`tactical-cell${token ? ' has-token' : ''}${dancingLight || illusion ? ' has-world-object' : ''}${persistentAreas.length ? ' has-combat-area' : ''}${persistentAreas.some((area) => area.lightlyObscured) ? ' is-lightly-obscured' : ''}${persistentAreas.some((area) => area.heavilyObscured) ? ' is-heavily-obscured' : ''}${persistentAreas.some((area) => area.difficultTerrain) ? ' is-difficult-terrain' : ''}${token?.actorId === activeId ? ' is-active' : ''}${token?.actorId === inspectedActorId ? ' is-inspected' : ''}${dead ? ' is-dead' : ''}${areaCells.has(`${position.x}:${position.y}`) || (token && eligibleTargetIds?.includes(token.actorId)) ? ' is-area-preview' : ''}${reachableCells.has(`${position.x}:${position.y}`) ? ' is-move-reachable' : ''}`}
            aria-label={[actorLabel, areaLabel, lightLabel, illusionLabel, (groundItemsByCell.get(`${position.x}:${position.y}`)??[]).map(item=>`На земле: ${item.name}`).join(", "), `Клетка ${position.x + 1}, ${position.y + 1}`].filter(Boolean).join(' · ')}
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
            {(groundItemsByCell.get(`${position.x}:${position.y}`)??[]).map(item=>(
              <span key={item.id} className="ground-item-token" title={item.name} data-world-object-id={item.id}>
                {item.imageUrl?<img src={item.imageUrl} alt={item.name}/>:<span aria-label={item.name}>◇</span>}
              </span>
            ))}
            {token && actor && (
              <span className="battle-token" style={{ '--token-color': token.color } as React.CSSProperties}>
                {token.tokenUrl ? <img src={token.tokenUrl} alt="" /> : <b>{combatActorDisplayName(actor).slice(0, 1)}</b>}
                <span className="battle-token__name">{combatActorDisplayName(actor)}</span>
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
