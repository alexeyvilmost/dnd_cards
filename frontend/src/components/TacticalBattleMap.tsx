import { combatActorDisplayName } from '../character/familiarLabels';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {useSiteSettings} from '../settings';
import BattleSceneBoundary from '../battle3d/BattleSceneBoundary';

const BattleScene = lazy(() => import('../battle3d/BattleScene'));
import type { CombatAreaState, GridPosition, SoloCombatState } from '../solo-combat/types';
import { combatRelation } from '../solo-combat/types';
import {boardDimensions, featureCells} from '../solo-combat/boardGeometry';
import BattleMapScenery from './BattleMapScenery';
import { areaPositionsForAction, reachablePositions } from '../solo-combat/tacticalGrid';
import {actorFootprint, footprintCells} from '../solo-combat/footprint';
import { previewCombatAttackRoll, previewMovementThreats } from '../solo-combat/engine';
import {
  combatActionIsAttack,
  combatActionIsRanged,
  combatActionRangeFt,
  combatApproachRoute,
  combatMovementRoute,
} from '../solo-combat/defaultInteraction';
import { combatIdentity } from '../solo-combat/combatIdentity';
import { attackHitProbability } from '../engine/attackProbability';
import type { CombatBeat } from '../solo-combat/presentation';
import CombatMapFeedback from './CombatMapFeedback';
import {createPortal} from 'react-dom';
import {useViewportPopoverPosition} from '../hooks/useViewportPopoverPosition';
import {projectileTrajectory} from '../solo-combat/projectilePreview';
import {creatureCoverObstacles} from '../solo-combat/creatureCover';
import {previewAttackCover,attackCoverLabel} from '../solo-combat/attackCoverPreview';

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
  const {combat3d} = useSiteSettings();
  const [rendererError, setRendererError] = useState<string | null>(null);
  useEffect(() => { setRendererError(null); }, [combat3d]);
  const [hovered, setHovered] = useState<GridPosition | null>(null);
  const {width:boardWidth,height:boardHeight}=boardDimensions(state);
  const featuresByCell=useMemo(()=>{
    const rows=new Map<string,NonNullable<SoloCombatState['battleMap']>['features']>();
    for(const feature of state.battleMap?.features??[])for(const p of featureCells(feature)){
      const key=`${p.x}:${p.y}`;rows.set(key,[...(rows.get(key)??[]),feature]);
    }
    return rows;
  },[state.battleMap]);
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
  ).flatMap((token) => footprintCells(token.position, actorFootprint(state.world.actors[token.actorId], state))
    .map(p => [`${p.x}:${p.y}`, token] as const)));
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
      ? combatApproachRoute(state, actorId, hoveredEnemyId, combatActionRangeFt(state,actorId,contextualAction))
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
  const movingCenter = actorFootprint(state.world.actors[actorId], state) / 2;
  const routeCells = useMemo(() => new Set(
    (previewRoute?.path ?? []).map((position) => `${position.x}:${position.y}`),
  ), [previewRoute]);
  const ghostPosition = previewRoute?.destination ?? null;
  const attackPreviewState = useMemo(() => approachPreview && approachPreview.costFt > 0 ? {
      ...state,
      tokens: {
        ...state.tokens,
        [actorId]: {...state.tokens[actorId], position: approachPreview.destination},
      },
    } : state, [state,actorId,approachPreview]);
  const hitPreview = useMemo(() => {
    if (!contextualActionId || !hoveredEnemyId || !approachPreview) return null;
    const profile = previewCombatAttackRoll({state: attackPreviewState, actorId, actionId: contextualActionId,
      targetIds: [hoveredEnemyId], choices: selectedActionId ? selectedActionChoices : undefined});
    return profile ? {probability: attackHitProbability(profile), profile} : null;
  }, [approachPreview, attackPreviewState, actorId, contextualActionId, hoveredEnemyId, selectedActionId, selectedActionChoices]);
  const coverPreview=useMemo(()=>contextualActionId&&hoveredEnemyId
    ?previewAttackCover({state:attackPreviewState,actorId,actionId:contextualActionId,targetIds:[hoveredEnemyId],
      choices:selectedActionId?selectedActionChoices:undefined},hitPreview?.profile??null):null,
    [attackPreviewState,actorId,contextualActionId,hoveredEnemyId,selectedActionId,selectedActionChoices,hitPreview]);
  const trajectory=useMemo(()=>{
    if(movementMode||worldObjectMoveMode||!contextualAction||!hoveredEnemyId
      ||!combatActionIsRanged(attackPreviewState,actorId,contextualAction))return null;
    const source=attackPreviewState.tokens[actorId],target=attackPreviewState.tokens[hoveredEnemyId];
    if(!source||!target)return null;
    return projectileTrajectory(attackPreviewState,source.position,target.position,
      actorFootprint(state.world.actors[actorId],state),actorFootprint(state.world.actors[hoveredEnemyId],state),
      creatureCoverObstacles(attackPreviewState,actorId,hoveredEnemyId));
  },[attackPreviewState,actorId,contextualAction,hoveredEnemyId,movementMode,worldObjectMoveMode,state]);
  const sourcePosition = state.tokens[targetingActorId ?? actorId]?.position;
  const areaCells = useMemo(() => new Set(
    selectedAction && hovered && sourcePosition
      ? areaPositionsForAction({
        board: state,
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
    const positions = Object.values(state.tokens).flatMap((token) => footprintCells(token.position, actorFootprint(state.world.actors[token.actorId], state)));
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

  const cells = Array.from({length: boardWidth * boardHeight}, (_, index) => {
    const position = { x: index % boardWidth, y: Math.floor(index / boardWidth) };
    const features=featuresByCell.get(`${position.x}:${position.y}`)??[];
    const terrainLabel=features.map(f=>`${f.name}${f.blocksMovement?' · непроходимо':''}${f.blocksSight?' · закрывает обзор':''}${f.cover==='half'?' · половинное укрытие, +2 КД':f.cover==='three_quarters'?' · укрытие на три четверти, +5 КД':''}`).join('; ');
    const token = tokenByCell.get(`${position.x}:${position.y}`);
    const dancingLight = dancingLightByCell.get(`${position.x}:${position.y}`);
    const illusion = illusionByCell.get(`${position.x}:${position.y}`);
    const persistentAreas = areasByCell.get(`${position.x}:${position.y}`) ?? [];
    const actor = token ? state.world.actors[token.actorId] : undefined;
    const tokenAnchor = token?.position.x === position.x && token.position.y === position.y;
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
    const key = `${position.x}:${position.y}`;
    return {position, features, token, dancingLight, illusion, persistentAreas, actor,
      tokenAnchor: Boolean(tokenAnchor), dead: Boolean(dead), terrainLabel, actorLabel, areaLabel, lightLabel, illusionLabel,
      label: [actorLabel, terrainLabel, areaLabel, lightLabel, illusionLabel,
        (groundItemsByCell.get(key) ?? []).map(item => `На земле: ${item.name}`).join(', '),
        `Клетка ${position.x + 1}, ${position.y + 1}`].filter(Boolean).join(' · '),
      actorId: token?.actorId, footprint: actorFootprint(actor, state),
      blocked: features.some(f => f.blocksMovement), reachable: reachableCells.has(key),
      areaPreview: areaCells.has(key) || Boolean(token && eligibleTargetIds?.includes(token.actorId)),
      route: routeCells.has(key), unavailable: Boolean(previewRoute && !previewRoute.available),
      active: Boolean(token && token.actorId === activeId),
      inspected: Boolean(token && token.actorId === inspectedActorId),
      highlighted: Boolean(token && token.actorId === highlightedActorId),
      light: dancingLight ? {label: lightLabel, radiusFt: dancingLight.dancingLight!.dimRadiusFt} : undefined,
      groundItems: groundItemsByCell.get(key) ?? [], areas: persistentAreas,
      // Keep source objects locally for the legacy renderer; the scene consumes
      // only their descriptive projection below.
      illusionView: illusion ? {id: illusion.id, label: illusionLabel,
        description: illusion.illusion!.description, form: illusion.illusion!.form} : undefined,
    };
  });
  const sceneCells = cells.map(({illusion, illusionView, ...cell}) => ({...cell, illusion: illusionView}));
  const activateCell = (position: GridPosition) => {
    const cell = cells[position.y * boardWidth + position.x];
    if (!cell || (cell.blocked && !cell.token)) return;
    if (cell.token && !selectedActionId && !movementMode
      && combatRelation(state, actorId, cell.token.actorId) !== 'enemy') onInspectActor?.(cell.token.actorId);
    onCell(position, cell.token?.actorId);
  };
  const hoverCell = (position: GridPosition | null, anchor?: {x: number; y: number}) => {
    setHovered(position);
    if (anchor) setHoverAnchor(anchor);
    onActorHover?.(position ? tokenByCell.get(`${position.x}:${position.y}`)?.actorId ?? null : null);
  };
  const hoverTooltip = <>
            {hoveredTarget && hoveredTarget.actorId === hoveredEnemyId && contextualAction && createPortal(<div ref={popoverRef} style={popoverPos} className={`combat-map-tooltip combat-hit-chance${approachPreview && !approachPreview.available ? ' is-unavailable' : ''}`} role="status">
              {approachPreview && approachPreview.costFt > 0 && <span className="combat-hit-chance__movement">Подойти {approachPreview.costFt} фт. · останется {approachPreview.remainingFt} фт.</span>}
              {!approachPreview && <span className="combat-hit-chance__movement">Нет доступной точки для атаки</span>}
              {approachPreview && !approachPreview.available && <span className="combat-hit-chance__movement">Не хватает {approachPreview.costFt - approachPreview.availableFt} фт. движения</span>}
              {hitPreview && <>
              Попадание <b>{Math.round(hitPreview.probability * 1000) / 10}%</b>
              <small>КД {hitPreview.profile.target?.value} · {hitPreview.profile.modifiers?.map(mod => `${mod.value >= 0 ? '+' : ''}${mod.value} ${mod.source}`).join(' · ')}
                {hitPreview.profile.advantage === 'advantage' ? ' · преимущество' : hitPreview.profile.advantage === 'disadvantage' ? ' · помеха' : ''}</small></>}
              {coverPreview&&<small className={`combat-hit-chance__cover${coverPreview.cover!=='none'?' is-covered':''}`}>{attackCoverLabel(coverPreview)}</small>}
              <small>I / Ш — изучить противника</small>
              {dangerNames && <small className="combat-route-warning">Провоцированная атака: {dangerNames}. Выход из досягаемости.</small>}
            </div>, document.body)}
            {!hoveredTarget && hovered && freeMovePreview && createPortal(<div ref={popoverRef} style={popoverPos} className={`combat-map-tooltip combat-move-preview${!freeMovePreview.available ? ' is-unavailable' : ''}`} role="status">
              Перемещение <b>{freeMovePreview.costFt} фт.</b><small>Останется {freeMovePreview.remainingFt} фт.{!freeMovePreview.available ? ` · не хватает ${freeMovePreview.costFt - freeMovePreview.availableFt} фт.` : ''}</small>
              {dangerNames && <small className="combat-route-warning">Провоцированная атака: {dangerNames}. Выход из досягаемости; Отход помогает избежать атаки.</small>}
            </div>, document.body)}
  </>;

  if (combat3d && !rendererError) return <div className="battle-map-3d" data-testid="battle-map-3d">
    <BattleSceneBoundary onUnavailable={setRendererError}>
      <Suspense fallback={<div className="battle-map-3d-loading" role="status">Подготавливаем трёхмерное поле…</div>}>
        <BattleScene state={state} actorId={actorId} activeId={activeId} feedback={feedback ?? null}
          cells={sceneCells} hovered={hovered}
          ghost={ghostPosition ? {position: ghostPosition, footprint: movingCenter * 2, available: previewRoute?.available ?? true} : null}
          route={routeOrigin && previewRoute ? {points: [routeOrigin, ...previewRoute.path], footprint: movingCenter * 2, available: previewRoute.available} : null}
          trajectory={trajectory} onHover={hoverCell} onCell={activateCell} onInspectActor={onInspectActor}
          onUnavailable={setRendererError} onDeclineAdditionalMovement={onDeclineAdditionalMovement}/>
      </Suspense>
    </BattleSceneBoundary>
    {hoverTooltip}
    <details className="battle-map-3d-keyboard">
      <summary>Поле для клавиатуры</summary>
      <div className="battle-map-3d-keyboard-grid" style={{gridTemplateColumns: `repeat(${boardWidth}, minmax(32px, 1fr))`}}>
        {cells.map(cell => <button key={`${cell.position.x}:${cell.position.y}`} type="button"
          aria-label={cell.label} aria-description={cell.terrainLabel || undefined}
          data-actor-id={cell.actorId} disabled={cell.blocked && !cell.token}
          onFocus={event => {const rect = event.currentTarget.getBoundingClientRect(); hoverCell(cell.position, {x:rect.right,y:rect.top});}}
          onBlur={() => hoverCell(null)} onClick={() => activateCell(cell.position)}>
          {cell.actor ? combatActorDisplayName(cell.actor).slice(0, 2) : cell.blocked ? '×' : `${cell.position.x + 1},${cell.position.y + 1}`}
        </button>)}
      </div>
    </details>
    {!state.tacticalFootprints && Object.values(state.world.actors).some(actor=>actorFootprint(actor)>1) && <p className="text-sm p-2" role="note">Этот бой сохранён по прежним правилам размещения. Области 2×2 и 3×3 будут использоваться со следующей встречи.</p>}
  </div>;

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
      aria-description={`Масштаб ${Math.round(zoom * 100)}% · колесо меняет масштаб · перетаскивание двигает карту`}
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
    {rendererError && <p className="battle-map-3d-fallback" role="status">{rendererError} Используется обычная карта.</p>}
    <div className="tactical-map-controls" role="group" aria-label="Навигация по полю">
      {state.battleMap&&<details className="tactical-map-legend"><summary>{state.battleMap.name} · {boardWidth}×{boardHeight}</summary><p>{state.battleMap.description}</p></details>}
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
      style={{ '--tactical-cell-size': `${Math.round(80 * zoom)}px`, '--board-width':boardWidth,'--board-height':boardHeight,
        ...(state.battleMap?{backgroundImage:`url("${state.battleMap.background}")`,backgroundSize:'100% 100%'}:{}) } as React.CSSProperties}
    >
      <BattleMapScenery map={state.battleMap}/>
      <CombatMapFeedback beat={feedback ?? null} state={state} />
      {trajectory&&<svg className="combat-projectile-preview" viewBox={`0 0 ${boardWidth} ${boardHeight}`} preserveAspectRatio="none" aria-hidden="true">
        <line className="combat-projectile-preview__line" x1={trajectory.from.x} y1={trajectory.from.y} x2={trajectory.to.x} y2={trajectory.to.y}/>
        {trajectory.covered.map((segment,index)=><line key={index} className="combat-projectile-preview__cover" x1={segment.from.x} y1={segment.from.y} x2={segment.to.x} y2={segment.to.y}/>)}
        <circle key={`${trajectory.from.x}:${trajectory.from.y}:${trajectory.to.x}:${trajectory.to.y}`} className="combat-projectile-preview__spark" r=".07">
          <animateMotion dur="1.4s" repeatCount="indefinite" path={`M ${trajectory.from.x} ${trajectory.from.y} L ${trajectory.to.x} ${trajectory.to.y}`}/>
        </circle>
        {trajectory.blocked&&<circle className="combat-projectile-preview__blocked" cx={trajectory.to.x} cy={trajectory.to.y} r=".09"/>}
      </svg>}
      {routeOrigin && previewRoute && previewRoute.path.length > 0 && <svg className="combat-route-line"
        viewBox={`0 0 ${boardWidth} ${boardHeight}`} preserveAspectRatio="none" aria-hidden="true">
        <line className="combat-route-line__intent" x1={routeOrigin.x + movingCenter} y1={routeOrigin.y + movingCenter}
          x2={previewRoute.destination.x + movingCenter} y2={previewRoute.destination.y + movingCenter} />
        <polyline className={`combat-route-line__path${previewRoute.available ? '' : ' is-unavailable'}`}
          points={[routeOrigin, ...previewRoute.path].map(p => `${p.x + movingCenter},${p.y + movingCenter}`).join(' ')} />
        {movementThreats.map(threat => <g key={threat.actorId} className="combat-route-line__danger">
          <line x1={threat.from.x + movingCenter} y1={threat.from.y + movingCenter} x2={threat.to.x + movingCenter} y2={threat.to.y + movingCenter} />
          <circle cx={(threat.from.x + threat.to.x) / 2 + movingCenter} cy={(threat.from.y + threat.to.y) / 2 + movingCenter} r=".13" />
          <text x={(threat.from.x + threat.to.x) / 2 + movingCenter} y={(threat.from.y + threat.to.y) / 2 + movingCenter + .05}>!</text>
        </g>)}
      </svg>}
      {cells.map(({position, token, dancingLight, illusion, persistentAreas, actor,
        tokenAnchor, dead, terrainLabel, areaLabel, lightLabel, illusionLabel, label}) => {
        return (
          <button
            type="button"
            key={`${position.x}:${position.y}`}
            className={`tactical-cell${token ? ' has-token' : ''}${dancingLight || illusion ? ' has-world-object' : ''}${persistentAreas.length ? ' has-combat-area' : ''}${persistentAreas.some((area) => area.lightlyObscured) ? ' is-lightly-obscured' : ''}${persistentAreas.some((area) => area.heavilyObscured) ? ' is-heavily-obscured' : ''}${persistentAreas.some((area) => area.difficultTerrain) ? ' is-difficult-terrain' : ''}${token && token.actorId === activeId ? ' is-active' : ''}${token && token.actorId === inspectedActorId ? ' is-inspected' : ''}${token && token.actorId === highlightedActorId ? ' is-linked-highlight' : ''}${dead ? ' is-dead' : ''}${areaCells.has(`${position.x}:${position.y}`) || (token && eligibleTargetIds?.includes(token.actorId)) ? ' is-area-preview' : ''}${reachableCells.has(`${position.x}:${position.y}`) ? ' is-move-reachable' : ''}${routeCells.has(`${position.x}:${position.y}`) ? ` is-route-preview${previewRoute && !previewRoute.available ? ' is-unavailable' : ''}` : ''}`}
            aria-label={label}
            aria-description={terrainLabel||undefined}
            data-actor-id={token?.actorId}
            data-scenery-zone={persistentAreas.length>0&&persistentAreas.every(area=>area.sceneryFeatureId)?'true':undefined}
            style={token ? {'--linked-accent': combatIdentity(state, token.actorId).accent} as React.CSSProperties : undefined}
            onMouseEnter={(event) => { setHovered(position); setHoverAnchor({x:event.clientX,y:event.clientY}); onActorHover?.(token?.actorId ?? null); }}
            onMouseLeave={() => { setHovered(null); onActorHover?.(null); }}
            onFocus={(event) => { const rect=event.currentTarget.getBoundingClientRect(); setHoverAnchor({x:rect.right,y:rect.top}); setHovered(position); onActorHover?.(token?.actorId ?? null); }}
            onBlur={() => { setHovered(null); onActorHover?.(null); }}
            onClick={() => activateCell(position)}
          >
            {persistentAreas.filter(area=>!area.sceneryFeatureId).map((area) => area.origin.x === position.x && area.origin.y === position.y ? (
              <span key={area.id} className={`combat-area-token is-${area.zoneType}`} aria-description={areaLabel} aria-hidden="true">
                <b>{area.heavilyObscured ? '◉' : area.lightlyObscured ? '◌' : '◇'}</b><small>{area.name}</small>
              </span>
            ) : null)}
            {dancingLight && (
              <span className="dancing-light-token" aria-description={lightLabel} aria-hidden="true">
                <b>✦</b><small>{dancingLight.dancingLight!.dimRadiusFt} фт.</small>
              </span>
            )}
            {illusion && (
              <span
                className={`minor-illusion-token is-${illusion.illusion!.form}`}
                aria-description={illusionLabel}
                data-world-object-id={illusion.id}
                aria-hidden="true"
              >
                <b>{illusion.illusion!.form === 'sound' ? '♪' : '◈'}</b>
                <small>{illusion.illusion!.description}</small>
              </span>
            )}
            {(groundItemsByCell.get(`${position.x}:${position.y}`)??[]).map(item=>(
              <span key={item.id} className="ground-item-token" aria-description={item.name} data-world-object-id={item.id}>
                {item.imageUrl?<img src={item.imageUrl} alt={item.name}/>:<span aria-label={item.name}>◇</span>}
              </span>
            ))}
            {ghostPosition?.x === position.x && ghostPosition.y === position.y && state.tokens[actorId] && state.world.actors[actorId] && (
              <span className={`battle-token battle-token--ghost${approachPreview?.costFt === 0 ? ' is-stationary' : ''}${previewRoute && !previewRoute.available ? ' is-unavailable' : ''}`} aria-hidden="true"
                style={{ '--token-color': combatIdentity(state, actorId).accent, '--token-size': actorFootprint(state.world.actors[actorId], state) } as React.CSSProperties}>
                {state.tokens[actorId].tokenUrl ? <img src={state.tokens[actorId].tokenUrl} alt="" /> : <b>{combatActorDisplayName(state.world.actors[actorId]).slice(0, 1)}</b>}
              </span>
            )}
            {token && actor && tokenAnchor && (() => {
              const identity = combatIdentity(state, token.actorId);
              return (
              <span className={`battle-token is-${identity.side}`} style={{ '--token-color': identity.accent, '--token-size': actorFootprint(actor, state) } as React.CSSProperties}>
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
    {hoverTooltip}
    {!state.tacticalFootprints && Object.values(state.world.actors).some(actor=>actorFootprint(actor)>1) && <p className="text-sm p-2" role="note">Этот бой сохранён по прежним правилам размещения. Области 2×2 и 3×3 будут использоваться со следующей встречи.</p>}
    </div>
  );
}
