import { combatActorDisplayName } from '../character/familiarLabels';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CombatAreaState, GridPosition, SoloCombatState } from '../solo-combat/types';
import { combatRelation, TACTICAL_HEIGHT, TACTICAL_WIDTH } from '../solo-combat/types';
import { areaPositionsForAction, reachablePositions } from '../solo-combat/tacticalGrid';
import { previewCombatAttackRoll, previewMovementThreats } from '../solo-combat/engine';
import {
  combatActionIsAttack,
  combatApproachRoute,
  combatMovementRoute,
} from '../solo-combat/defaultInteraction';
import { combatIdentity } from '../solo-combat/combatIdentity';
import { attackHitProbability } from '../engine/attackProbability';
import type { CombatBeat } from '../solo-combat/presentation';
import CombatMapFeedback from './CombatMapFeedback';
import {createPortal} from 'react-dom';
import {useViewportPopoverPosition} from '../hooks/useViewportPopoverPosition';

export default function TacticalBattleMap({
  state,
  feedback,
  selectedActionChoices,
  actorId,
  targetingActorId,
  selectedActionId,
  defaultActionId,
  implicitActionsEnabled = false,
  eligibleTargetIds,
  movementMode,
  worldObjectMoveMode,
  inspectedActorId,
  highlightedActorId,
  onCell,
  onInspectActor,
  onActorHover,
  onDeclineAdditionalMovement,
}: {
  state: SoloCombatState;
  feedback?: CombatBeat | null;
  selectedActionChoices?: Record<string, string[]>;
  actorId: string;
  targetingActorId?: string;
  selectedActionId: string | null;
  defaultActionId?: string;
  implicitActionsEnabled?: boolean;
  eligibleTargetIds?: string[];
  movementMode: boolean;
  worldObjectMoveMode?: boolean;
  inspectedActorId?: string | null;
  highlightedActorId?: string | null;
  onCell: (position: GridPosition, actorId?: string) => void;
  onInspectActor?: (actorId: string) => void;
  onActorHover?: (actorId: string | null) => void;
  onDeclineAdditionalMovement?: () => void;
}) {
  const [hovered, setHovered] = useState<GridPosition | null>(null);
  const [hoverAnchor, setHoverAnchor] = useState({x: 0, y: 0});
  const {popoverRef, popoverPos} = useViewportPopoverPosition(Boolean(hovered), hoverAnchor);
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
  const contextualActionId = selectedActionId && combatActionIsAttack(state, selectedAction)
    ? selectedActionId
    : !selectedActionId && implicitActionsEnabled
      ? defaultActionId
      : undefined;
  const contextualAction = state.catalogActions.find((action) => action.id === contextualActionId);
  const hoveredTarget = hovered ? tokenByCell.get(`${hovered.x}:${hovered.y}`) : undefined;
  const hoveredActorId = hoveredTarget?.actorId;
  const hoveredEnemyId = hoveredActorId
    && combatRelation(state, actorId, hoveredActorId) === 'enemy'
    && (state.world.actors[hoveredActorId]?.runtime.hp.current ?? 0) > 0
    ? hoveredActorId
    : undefined;
  const approachPreview = useMemo(() => (
    contextualAction && hoveredEnemyId
      ? combatApproachRoute(state, actorId, hoveredEnemyId, contextualAction.targeting?.rangeFt ?? 5)
      : null
  ), [actorId, contextualAction, hoveredEnemyId, state]);
  const freeMovePreview = useMemo(() => {
    if (!hovered || hoveredTarget || (!movementMode && !(implicitActionsEnabled
      && (!selectedActionId || combatActionIsAttack(state, selectedAction))))) return null;
    return combatMovementRoute(state, actorId, hovered);
  }, [actorId, hovered, hoveredTarget, implicitActionsEnabled, movementMode, selectedActionId, state]);
  const previewRoute = approachPreview ?? freeMovePreview;
  const movementThreats = useMemo(() => previewMovementThreats(state, actorId, previewRoute?.path ?? []),
    [state, actorId, previewRoute]);
  const dangerNames = movementThreats.map(threat => combatIdentity(state, threat.actorId).displayName).join(', ');
  const routeOrigin = state.tokens[actorId]?.position;
  const routeCells = useMemo(() => new Set(
    (previewRoute?.path ?? []).map((position) => `${position.x}:${position.y}`),
  ), [previewRoute]);
  const ghostPosition = previewRoute?.destination ?? null;
  const hitPreview = useMemo(() => {
    if (!contextualActionId || !hoveredEnemyId || !approachPreview) return null;
    const projectedState = approachPreview.costFt > 0 ? {
      ...state,
      tokens: {
        ...state.tokens,
        [actorId]: {...state.tokens[actorId], position: approachPreview.destination},
      },
    } : state;
    const profile = previewCombatAttackRoll({state: projectedState, actorId, actionId: contextualActionId,
      targetIds: [hoveredEnemyId], choices: selectedActionId ? selectedActionChoices : undefined});
    return profile ? {probability: attackHitProbability(profile), profile} : null;
  }, [approachPreview, state, actorId, contextualActionId, hoveredEnemyId, selectedActionId, selectedActionChoices]);
  const sourcePosition = state.tokens[targetingActorId ?? actorId]?.position;
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
      onScroll={() => {
        // Scrolling caused by focus/scrollIntoView keeps the pointer over the
        // same cell. Only an active pan invalidates that hover authority.
        if (!panRef.current) return;
        setHovered(null);
        onActorHover?.(null);
      }}
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
      className={`tactical-map${selectedActionId ? ' is-targeting' : ''}${movementMode ? ' is-moving' : ''}${implicitActionsEnabled && !selectedActionId ? ' is-contextual' : ''}${worldObjectMoveMode ? ' is-world-object-moving' : ''}`}
      data-testid="tactical-map"
      data-zoom={zoom}
      style={{ '--tactical-cell-size': `${Math.round(80 * zoom)}px` } as React.CSSProperties}
    >
      <CombatMapFeedback beat={feedback ?? null} state={state} />
      {routeOrigin && previewRoute && previewRoute.path.length > 0 && <svg className="combat-route-line"
        viewBox={`0 0 ${TACTICAL_WIDTH} ${TACTICAL_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        <line className="combat-route-line__intent" x1={routeOrigin.x + .5} y1={routeOrigin.y + .5}
          x2={previewRoute.destination.x + .5} y2={previewRoute.destination.y + .5} />
        <polyline className={`combat-route-line__path${previewRoute.available ? '' : ' is-unavailable'}`}
          points={[routeOrigin, ...previewRoute.path].map(p => `${p.x + .5},${p.y + .5}`).join(' ')} />
        {movementThreats.map(threat => <g key={threat.actorId} className="combat-route-line__danger">
          <line x1={threat.from.x + .5} y1={threat.from.y + .5} x2={threat.to.x + .5} y2={threat.to.y + .5} />
          <circle cx={(threat.from.x + threat.to.x) / 2 + .5} cy={(threat.from.y + threat.to.y) / 2 + .5} r=".13" />
          <text x={(threat.from.x + threat.to.x) / 2 + .5} y={(threat.from.y + threat.to.y) / 2 + .55}>!</text>
        </g>)}
      </svg>}
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
            className={`tactical-cell${token ? ' has-token' : ''}${dancingLight || illusion ? ' has-world-object' : ''}${persistentAreas.length ? ' has-combat-area' : ''}${persistentAreas.some((area) => area.lightlyObscured) ? ' is-lightly-obscured' : ''}${persistentAreas.some((area) => area.heavilyObscured) ? ' is-heavily-obscured' : ''}${persistentAreas.some((area) => area.difficultTerrain) ? ' is-difficult-terrain' : ''}${token?.actorId === activeId ? ' is-active' : ''}${token?.actorId === inspectedActorId ? ' is-inspected' : ''}${token?.actorId === highlightedActorId ? ' is-linked-highlight' : ''}${dead ? ' is-dead' : ''}${areaCells.has(`${position.x}:${position.y}`) || (token && eligibleTargetIds?.includes(token.actorId)) ? ' is-area-preview' : ''}${reachableCells.has(`${position.x}:${position.y}`) ? ' is-move-reachable' : ''}${routeCells.has(`${position.x}:${position.y}`) ? ` is-route-preview${previewRoute && !previewRoute.available ? ' is-unavailable' : ''}` : ''}`}
            aria-label={[actorLabel, areaLabel, lightLabel, illusionLabel, (groundItemsByCell.get(`${position.x}:${position.y}`)??[]).map(item=>`На земле: ${item.name}`).join(", "), `Клетка ${position.x + 1}, ${position.y + 1}`].filter(Boolean).join(' · ')}
            data-actor-id={token?.actorId}
            style={token ? {'--linked-accent': combatIdentity(state, token.actorId).accent} as React.CSSProperties : undefined}
            onMouseEnter={(event) => { setHovered(position); setHoverAnchor({x:event.clientX,y:event.clientY}); onActorHover?.(token?.actorId ?? null); }}
            onMouseLeave={() => { setHovered(null); onActorHover?.(null); }}
            onFocus={(event) => { const rect=event.currentTarget.getBoundingClientRect(); setHoverAnchor({x:rect.right,y:rect.top}); setHovered(position); onActorHover?.(token?.actorId ?? null); }}
            onBlur={() => { setHovered(null); onActorHover?.(null); }}
            onClick={() => {
              if (token && !selectedActionId && !movementMode
                && combatRelation(state, actorId, token.actorId) !== 'enemy') onInspectActor?.(token.actorId);
              onCell(position, token?.actorId);
            }}
          >
            {token && token.actorId === hoveredEnemyId && contextualAction && createPortal(<div ref={popoverRef} style={popoverPos} className={`combat-map-tooltip combat-hit-chance${approachPreview && !approachPreview.available ? ' is-unavailable' : ''}`} role="status">
              {approachPreview && approachPreview.costFt > 0 && <span className="combat-hit-chance__movement">Подойти {approachPreview.costFt} фт. · останется {approachPreview.remainingFt} фт.</span>}
              {!approachPreview && <span className="combat-hit-chance__movement">Нет доступной точки для атаки</span>}
              {approachPreview && !approachPreview.available && <span className="combat-hit-chance__movement">Не хватает {approachPreview.costFt - approachPreview.availableFt} фт. движения</span>}
              {hitPreview && <>
              Попадание <b>{Math.round(hitPreview.probability * 1000) / 10}%</b>
              <small>КД {hitPreview.profile.target?.value} · {hitPreview.profile.modifiers?.map(mod => `${mod.value >= 0 ? '+' : ''}${mod.value} ${mod.source}`).join(' · ')}
                {hitPreview.profile.advantage === 'advantage' ? ' · преимущество' : hitPreview.profile.advantage === 'disadvantage' ? ' · помеха' : ''}</small></>}
              <small>I / Ш — изучить противника</small>
              {dangerNames && <small className="combat-route-warning">Провоцированная атака: {dangerNames}. Выход из досягаемости.</small>}
            </div>, document.body)}
            {!token && hovered?.x === position.x && hovered.y === position.y && freeMovePreview && createPortal(<div ref={popoverRef} style={popoverPos} className={`combat-map-tooltip combat-move-preview${!freeMovePreview.available ? ' is-unavailable' : ''}`} role="status">
              Перемещение <b>{freeMovePreview.costFt} фт.</b><small>Останется {freeMovePreview.remainingFt} фт.{!freeMovePreview.available ? ` · не хватает ${freeMovePreview.costFt - freeMovePreview.availableFt} фт.` : ''}</small>
              {dangerNames && <small className="combat-route-warning">Провоцированная атака: {dangerNames}. Выход из досягаемости; Отход помогает избежать атаки.</small>}
            </div>, document.body)}
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
            {ghostPosition?.x === position.x && ghostPosition.y === position.y && state.tokens[actorId] && state.world.actors[actorId] && (
              <span className={`battle-token battle-token--ghost${approachPreview?.costFt === 0 ? ' is-stationary' : ''}${previewRoute && !previewRoute.available ? ' is-unavailable' : ''}`} aria-hidden="true"
                style={{ '--token-color': combatIdentity(state, actorId).accent } as React.CSSProperties}>
                {state.tokens[actorId].tokenUrl ? <img src={state.tokens[actorId].tokenUrl} alt="" /> : <b>{combatActorDisplayName(state.world.actors[actorId]).slice(0, 1)}</b>}
              </span>
            )}
            {token && actor && (() => {
              const identity = combatIdentity(state, token.actorId);
              return (
              <span className={`battle-token is-${identity.side}`} style={{ '--token-color': identity.accent } as React.CSSProperties}>
                {token.tokenUrl ? <img src={token.tokenUrl} alt="" /> : <b>{combatActorDisplayName(actor).slice(0, 1)}</b>}
                {identity.duplicateIndex && <span className="battle-token__duplicate">{identity.duplicateIndex}</span>}
                <span className="battle-token__name">{identity.displayName}</span>
                <span className="battle-token__hp"><i style={{ width: `${Math.max(0, actor.runtime.hp.current / actor.runtime.hp.max * 100)}%` }} /></span>
              </span>
              );
            })()}
          </button>
        );
      })}
    </div>
    </div>
  );
}
