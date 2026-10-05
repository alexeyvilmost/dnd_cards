import type {CombatFacing} from '../solo-combat/facing';
import {projectTacticalMapState} from '../solo-combat/tacticalMapProjection';
import {resolveMediaVariant} from '../utils/mediaVariants';
import './TacticalIllumination.css';
import { combatActorDisplayName } from '../character/familiarLabels';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {useSiteSettings} from '../settings';
import BattleSceneBoundary from '../battle3d/BattleSceneBoundary';

const BattleScene = lazy(() => import('../battle3d/BattleScene'));
import type { GridPosition, SoloCombatState } from '../solo-combat/types';
import { combatRelation } from '../solo-combat/types';
import {boardDimensions} from '../solo-combat/boardGeometry';
import BattleMapScenery from './BattleMapScenery';
import BattleMapCellPreview, {coverLine} from './BattleMapCellPreview';
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
import {combatAnimationTiming} from '../solo-combat/animationTiming';
import CombatMapFeedback from './CombatMapFeedback';
import {useAnimationCatalog} from '../solo-combat/useAnimationCatalog';
import {createPortal} from 'react-dom';
import {useViewportPopoverPosition} from '../hooks/useViewportPopoverPosition';
import {projectileTrajectory} from '../solo-combat/projectilePreview';
import {creatureCoverObstacles} from '../solo-combat/creatureCover';
import {previewAttackCover,attackCoverLabel} from '../solo-combat/attackCoverPreview';
import {lostHealthFraction} from '../battle3d/tokenHealth';
import {useBattleMovement} from '../battle3d/useBattleMovement';
import {useReducedMotion} from '../hooks/useReducedMotion';
import BattleTokenMotion from './BattleTokenMotion';
import './TacticalBattleMap.css';
import CombatActorHoverPreview from './CombatActorHoverPreview';
import {combatAreaHazardLines,movementHazardAreas,previewMovementHazards} from '../solo-combat/movementHazardPreview';
import {captureMapZoomAnchor, mapZoomScrollDelta, type MapZoomAnchor} from './mapZoom';

const MAP_CELL_PREVIEW_DELAY_MS = 500;
const ENEMY_PREVIEW_DELAY_MS = 250;

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
  actionsDisabled = false,
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
  onFacing?:(facing:CombatFacing)=>void;
  /** Commands are blocked during delivery; camera gestures stay available. */
  actionsDisabled?: boolean;
}) {
  const {combat3d} = useSiteSettings();
  const reducedMotion = useReducedMotion();
  useAnimationCatalog();
  const committedFeedback=feedback?.rollPhase==='before-reaction'?null:feedback;
  const animationPrimitive=committedFeedback?.animation?.primitive;
  const animationFrom=committedFeedback?.from,animationTo=committedFeedback?.to;
  const animationAngle=animationFrom&&animationTo?Math.atan2(animationTo.y-animationFrom.y,animationTo.x-animationFrom.x):0;
  const tokenTiming=combatAnimationTiming(committedFeedback?.animation);
  const tokenImpactDelay=committedFeedback?.suppressAnimation?0:tokenTiming.contactMs;
  const criticalStrike=committedFeedback?.animation?.strikeStyle==='critical'&&committedFeedback.roll?.outcome==='crit'&&!committedFeedback.suppressAnimation;
  const tokenAnimation=(id:string)=>{
    if(!committedFeedback)return '';
    if(committedFeedback.targetId===id&&animationPrimitive==='death')return ' is-animating-death';
    if(criticalStrike&&committedFeedback.targetId===id)return ' is-critical-target';
    if(committedFeedback.sourceId===id&&!committedFeedback.suppressAnimation){
      if(criticalStrike)return ['melee_slash','melee_pierce','melee_bash'].includes(animationPrimitive??'')?' is-critical-source':' is-critical-shot';
      if(animationPrimitive==='hide')return ' is-animating-hide';
      if(animationPrimitive==='dodge')return ' is-animating-dodge';
      if(['melee_slash','melee_pierce','melee_bash','bite','claws','tail','tentacle','sting','natural_slam'].includes(animationPrimitive??''))return ' is-animating-source';
    }
    return committedFeedback.cues.some(cue=>cue.actorId===id&&cue.kind==='damage')?' is-animating-target':'';
  };
  const [rendererError, setRendererError] = useState<string | null>(null);
  const render2D = !combat3d || Boolean(rendererError);
  const movements = useBattleMovement(state, render2D);
  useEffect(() => { setRendererError(null); }, [combat3d]);
  const [hovered, setHovered] = useState<GridPosition | null>(null);
  const {width:boardWidth,height:boardHeight}=boardDimensions(state);
  const projection=useMemo(()=>projectTacticalMapState(state),[state]);
  const {tokenByCell,groundItemsByCell}=projection;
  const [hoverAnchor, setHoverAnchor] = useState({x: 0, y: 0});
  const [previewCell, setPreviewCell] = useState<GridPosition | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const previewPositionRef = useRef<string | null>(null);
  const clearPreviewTimer = () => {
    if (previewTimerRef.current != null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  };
  useEffect(() => () => clearPreviewTimer(), []);
  const scheduleCellPreview = (position: GridPosition | null) => {
    const key: `${number}:${number}` | null = position ? `${position.x}:${position.y}` : null;
    if (previewPositionRef.current === key) return;
    previewPositionRef.current = key;
    clearPreviewTimer();
    setPreviewCell(null);
    if (!position) return;
    const target = tokenByCell.get(key!);
    const enemy = target && combatRelation(state,actorId,target.actorId) === 'enemy';
    previewTimerRef.current = window.setTimeout(() => setPreviewCell(position), enemy ? ENEMY_PREVIEW_DELAY_MS : MAP_CELL_PREVIEW_DELAY_MS);
  };
  const cellPreviewContentKey = previewCell ? `cell:${previewCell.x}:${previewCell.y}` : null;
  const {popoverRef, popoverPos} = useViewportPopoverPosition(Boolean(hovered), hoverAnchor, cellPreviewContentKey);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  const [panning, setPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const zoomAnchorRef = useRef<{viewport: HTMLDivElement; anchor: MapZoomAnchor} | null>(null);
  const centerFrameRef = useRef<number | null>(null);
  const initialFitDone = useRef(false);
  const [panSpace, setPanSpace] = useState({x: 600, y: 400});
  const panSpaceRef = useRef(panSpace);
  useLayoutEffect(() => {
    zoomRef.current = zoom;
    const pending = zoomAnchorRef.current;
    zoomAnchorRef.current = null;
    if (!pending || !render2D || pending.viewport !== viewportRef.current || !mapRef.current) return;
    const delta = mapZoomScrollDelta(mapRef.current.getBoundingClientRect(), pending.anchor);
    pending.viewport.scrollLeft += delta.x;
    pending.viewport.scrollTop += delta.y;
  }, [zoom, render2D]);
  useEffect(() => {
    initialFitDone.current = false;
    if (centerFrameRef.current !== null) window.cancelAnimationFrame(centerFrameRef.current);
    centerFrameRef.current = null;
    return () => {
      if (centerFrameRef.current !== null) window.cancelAnimationFrame(centerFrameRef.current);
      centerFrameRef.current = null;
    };
  }, [render2D]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const resize = () => {
      const next = {x: Math.max(240, viewport.clientWidth), y: Math.max(240, viewport.clientHeight)};
      const previous = panSpaceRef.current;
      panSpaceRef.current = next;
      setPanSpace(next);
      if (initialFitDone.current) {
        viewport.scrollLeft += next.x - previous.x;
        viewport.scrollTop += next.y - previous.y;
      }
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [combat3d, rendererError]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!render2D || !viewport) return;
    // React's delegated wheel listener is passive. A native non-passive
    // listener cancels browser scrolling before changing only the map scale.
    const zoomWithWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaY || event.deltaX;
      if (!delta) return;
      const next = Math.min(1.8, Math.max(.35, Number((zoomRef.current + (delta < 0 ? .1 : -.1)).toFixed(2))));
      if (next === zoomRef.current) return;
      const anchor = mapRef.current && captureMapZoomAnchor(mapRef.current.getBoundingClientRect(), event.clientX, event.clientY);
      zoomAnchorRef.current = anchor ? {viewport, anchor} : null;
      // A camera gesture takes ownership from an initial fit still awaiting RAF.
      initialFitDone.current = true;
      if (centerFrameRef.current !== null) window.cancelAnimationFrame(centerFrameRef.current);
      centerFrameRef.current = null;
      zoomRef.current = next;
      setZoom(next);
    };
    viewport.addEventListener('wheel', zoomWithWheel, {passive: false});
    return () => viewport.removeEventListener('wheel', zoomWithWheel);
  }, [render2D]);
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
  const hoveredEnemyActorId = hoveredActorId && combatRelation(state,actorId,hoveredActorId) === 'enemy'
    ? hoveredActorId : undefined;
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
  const movementHazards = useMemo(() => previewMovementHazards(state,actorId,previewRoute?.path ?? []),[state,actorId,previewRoute]);
  const hazardousCells = useMemo(() => new Set((movementMode || Boolean(previewRoute?.path.length)
    ? movementHazardAreas(state,actorId) : []).flatMap(area => area.cells.map(position => `${position.x}:${position.y}`))),[state,actorId,movementMode,previewRoute]);
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

  const centerOn = useCallback((positions: GridPosition[], nextZoom = zoom, behavior: ScrollBehavior = 'smooth') => {
    const viewport = viewportRef.current;
    if (!viewport || !positions.length) return;
    setZoom(nextZoom);
    if (centerFrameRef.current !== null) window.cancelAnimationFrame(centerFrameRef.current);
    centerFrameRef.current = window.requestAnimationFrame(() => {
      centerFrameRef.current = null;
      if (viewportRef.current !== viewport) return;
      const cellSize = 80 * nextZoom;
      const centerX = positions.reduce((sum, position) => sum + position.x + 0.5, 0) / positions.length;
      const centerY = positions.reduce((sum, position) => sum + position.y + 0.5, 0) / positions.length;
      const left = Math.max(0, panSpaceRef.current.x + centerX * cellSize - viewport.clientWidth / 2);
      const top = Math.max(0, panSpaceRef.current.y + centerY * cellSize - viewport.clientHeight / 2);
      if (typeof viewport.scrollTo === 'function') {
        viewport.scrollTo({ left, top, behavior });
      } else {
        viewport.scrollLeft = left;
        viewport.scrollTop = top;
      }
    });
  }, [zoom]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!render2D || !viewport || initialFitDone.current) return;
    const positions = Object.values(state.tokens).flatMap((token) => footprintCells(token.position, actorFootprint(state.world.actors[token.actorId], state)));
    if (!positions.length) return;
    const frame = window.requestAnimationFrame(() => {
      if (viewportRef.current !== viewport) return;
      initialFitDone.current = true;
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
      centerOn(positions, Number(fitZoom.toFixed(2)), 'auto');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [centerOn, state.tokens, render2D]);

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

  const cells=useMemo(()=>projection.cells.map(cell=>{
    const key=`${cell.position.x}:${cell.position.y}`,token=cell.token;
    return {...cell,reachable:reachableCells.has(key),
      areaPreview:areaCells.has(key)||Boolean(token&&eligibleTargetIds?.includes(token.actorId)),
      route:routeCells.has(key),unavailable:Boolean(previewRoute&&!previewRoute.available),
      movementHazard:hazardousCells.has(key),active:Boolean(token&&token.actorId===activeId),
      inspected:Boolean(token&&token.actorId===inspectedActorId),highlighted:Boolean(token&&token.actorId===highlightedActorId)};
  }),[projection,reachableCells,areaCells,eligibleTargetIds,routeCells,previewRoute,hazardousCells,activeId,inspectedActorId,highlightedActorId]);
  const sceneCells = useMemo(()=>cells.map(({illusion, illusionView, ...cell}) => ({...cell, illusion: illusionView})),[cells]);
  const activateCell = (position: GridPosition) => {
    if (actionsDisabled) return;
    const cell = cells[position.y * boardWidth + position.x];
    if (!cell || (cell.blocked && !cell.token)) return;
    if (cell.token && !selectedActionId && !movementMode
      && combatRelation(state, actorId, cell.token.actorId) !== 'enemy') onInspectActor?.(cell.token.actorId);
    onCell(position, cell.token?.actorId);
  };
  const hoverCell = (position: GridPosition | null, anchor?: {x: number; y: number}) => {
    setHovered(current => current?.x === position?.x && current?.y === position?.y ? current : position);
    scheduleCellPreview(position);
    if (anchor) setHoverAnchor(anchor);
    onActorHover?.(position ? tokenByCell.get(`${position.x}:${position.y}`)?.actorId ?? null : null);
  };
  const cellPreview = previewCell
    ? cells[previewCell.y * boardWidth + previewCell.x]
    : undefined;
  const cellPreviewCards = useMemo(() => {
    if (!cellPreview) return [];
    const cards: {title: string; subtype?: string; lines: string[]}[] = [];
    for (const feature of cellPreview.features) {
      const lines = [
        coverLine(feature.cover === 'half' || feature.cover === 'three_quarters' ? feature.cover : feature.blocksSight ? 'total' : null),
        feature.blocksMovement ? 'Непроходимо' : null,
        feature.blocksSight && feature.cover !== 'half' && feature.cover !== 'three_quarters' ? 'Закрывает обзор' : null,
      ].filter(Boolean) as string[];
      cards.push({title: feature.name, subtype: 'Объект местности', lines: lines.length ? lines : ['Элемент местности']});
    }
    for (const area of cellPreview.persistentAreas) {
      const duration = area.duration.type === 'permanent' ? 'Постоянная область'
        : area.duration.type === 'concentration' ? 'Длится, пока сохраняется концентрация'
          : `Осталось раундов: ${area.duration.roundsLeft}`;
      const lines = [
        duration,
        area.difficultTerrain ? 'Труднопроходимая местность' : null,
        area.lightlyObscured ? 'Слабо заслонённая область' : null,
        area.heavilyObscured ? 'Сильно заслонённая область' : null,
        area.blocksVerbalComponents ? 'Блокирует вербальные компоненты' : null,
        area.hazard?.resolution === 'save'
          ? `Опасность: спасбросок ${area.hazard.save.ability.toUpperCase()} СЛ ${area.hazard.save.dc}`
          : area.hazard?.resolution === 'automatic' ? 'Опасность без спасброска' : null,
        ...combatAreaHazardLines(area),
        area.triggers.length
          ? `Срабатывает: ${area.triggers.map((trigger) => ({
            created: 'при создании', enter: 'при входе', exit: 'при выходе',
            move: 'за каждые 5 фт. движения', start_turn: 'в начале хода', end_turn: 'в конце хода',
          })[trigger]).join(', ')}`
          : null,
      ].filter(Boolean) as string[];
      cards.push({title: area.name, subtype: 'Область / эффект', lines});
    }
    if (cellPreview.lightLabel) {
      cards.push({title: 'Танцующий огонёк', subtype: 'Мировой объект', lines: [cellPreview.lightLabel]});
    }
    if (cellPreview.illusionLabel) {
      cards.push({title: 'Малая иллюзия', subtype: 'Мировой объект', lines: [cellPreview.illusionLabel]});
    }
    for (const item of cellPreview.groundItems) {
      cards.push({title: item.name, subtype: 'Предмет на земле', lines: ['Лежит на клетке']});
    }
    return cards;
  }, [cellPreview]);
  const showCellPreview = cellPreviewCards.length > 0
    && !hoveredEnemyActorId
    && !(freeMovePreview && !hoveredTarget);
  const hoveredEnemy = cellPreview?.actorId === hoveredEnemyActorId && hoveredEnemyActorId
    ? state.world.actors[hoveredEnemyActorId] : undefined;
  const hazardWarnings = movementHazards.map(({area,lines}) => <small key={area.id} className="combat-route-warning combat-route-warning--hazard"><strong>{area.name}</strong>: {lines.join(' · ')}</small>);
  const hoverTooltip = <>
            {hoveredEnemy && createPortal(<div ref={popoverRef} style={popoverPos} className="combat-map-tooltip combat-enemy-preview forge-effect-popover entity-preview-enter">
              <CombatActorHoverPreview name={combatActorDisplayName(hoveredEnemy)} hp={hoveredEnemy.runtime.hp}>
              {hoveredEnemyActorId === hoveredEnemyId && contextualAction && <div className={`combat-hit-chance__details${approachPreview && !approachPreview.available ? ' is-unavailable' : ''}`}>
              {approachPreview && approachPreview.costFt > 0 && <span className="combat-hit-chance__movement">Подойти {approachPreview.costFt} фт. · останется {approachPreview.remainingFt} фт.</span>}
              {!approachPreview && <span className="combat-hit-chance__movement">Нет доступной точки для атаки</span>}
              {approachPreview && !approachPreview.available && <span className="combat-hit-chance__movement">Не хватает {approachPreview.costFt - approachPreview.availableFt} фт. движения</span>}
              {hitPreview && <>
              Попадание <b>{Math.round(hitPreview.probability * 1000) / 10}%</b>
              <small>КД {hitPreview.profile.target?.value}</small></>}
              {coverPreview && coverPreview.cover !== 'none' && coverPreview.bonus !== 0 && <small className="combat-hit-chance__cover is-covered">{attackCoverLabel(coverPreview)}</small>}
              {dangerNames && <small className="combat-route-warning">Провоцированная атака: {dangerNames}. Выход из досягаемости.</small>}
              {hazardWarnings}
              </div>}
              </CombatActorHoverPreview>
            </div>, document.body)}
            {!hoveredTarget && hovered && freeMovePreview && createPortal(<div ref={popoverRef} style={popoverPos} className={`combat-map-tooltip combat-move-preview${!freeMovePreview.available ? ' is-unavailable' : ''}`} role="status">
              Перемещение <b>{freeMovePreview.costFt} фт.</b><small>Останется {freeMovePreview.remainingFt} фт.{!freeMovePreview.available ? ` · не хватает ${freeMovePreview.costFt - freeMovePreview.availableFt} фт.` : ''}</small>
              {dangerNames && <small className="combat-route-warning">Провоцированная атака: {dangerNames}. Выход из досягаемости; Отход помогает избежать атаки.</small>}
              {hazardWarnings}
            </div>, document.body)}
            {showCellPreview && createPortal(<div ref={popoverRef} style={popoverPos} className="forge-effect-popover battle-map-cell-previews entity-preview-enter">
              {cellPreviewCards.map((card) => (
                <BattleMapCellPreview key={`${card.subtype}:${card.title}`} title={card.title} subtype={card.subtype} lines={card.lines} />
              ))}
            </div>, document.body)}
  </>;

  if (combat3d && !rendererError) return <div className="battle-map-3d" data-testid="battle-map-3d">
    <BattleSceneBoundary onUnavailable={setRendererError}>
      <Suspense fallback={<div className="battle-map-3d-loading" role="status">Подготавливаем поле с монетками…</div>}>
        <BattleScene state={state} actorId={actorId} activeId={activeId} feedback={feedback ?? null}
          cells={sceneCells} hovered={hovered}
          ghost={ghostPosition ? {position: ghostPosition, footprint: movingCenter * 2, available: previewRoute?.available ?? true} : null}
          route={routeOrigin && previewRoute ? {points: [routeOrigin, ...previewRoute.path], footprint: movingCenter * 2, available: previewRoute.available} : null}
          trajectory={trajectory} onHover={hoverCell} onCell={activateCell} onInspectActor={actionsDisabled ? undefined : onInspectActor}
          onUnavailable={setRendererError} onDeclineAdditionalMovement={actionsDisabled ? undefined : onDeclineAdditionalMovement}/>
      </Suspense>
    </BattleSceneBoundary>
    {hoverTooltip}
    {!state.tacticalFootprints && Object.values(state.world.actors).some(actor=>actorFootprint(actor)>1) && <p className="text-sm p-2" role="note">Этот бой сохранён по прежним правилам размещения. Области 2×2 и 3×3 будут использоваться со следующей встречи.</p>}
  </div>;

  return (
    <div
      ref={viewportRef}
      className={`tactical-map-viewport${panning ? ' is-panning' : ''}`}
      data-testid="tactical-map-viewport"
      data-panning={panning || undefined}
      tabIndex={0}
      onScroll={() => {
        // Scrolling caused by focus/scrollIntoView keeps the pointer over the
        // same cell. Only an active pan invalidates that hover authority.
        if (!panRef.current) return;
        setHovered(null);
        scheduleCellPreview(null);
        onActorHover?.(null);
      }}
      aria-label="Поле боя"
      aria-description={`Масштаб ${Math.round(zoom * 100)}% · колесо меняет масштаб · перетаскивание двигает карту · Home возвращает к персонажу`}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Home') {
          event.preventDefault();
          const position = state.tokens[actorId]?.position;
          if (position) centerOn([position]);
        } else if (event.key === '+' || event.key === '=') {
          event.preventDefault();
          setZoom(current => Math.min(1.8, Number((current + .1).toFixed(2))));
        } else if (event.key === '-') {
          event.preventDefault();
          setZoom(current => Math.max(.35, Number((current - .1).toFixed(2))));
        }
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
    {state.pendingAdditionalMovement && !state.playerMovement && <div className="tactical-map-movement-choice" role="group" aria-label="Дополнительное перемещение">
        <span role="status">Выберите клетку · до {state.pendingAdditionalMovement.remainingFt} фт.{state.pendingAdditionalMovement.requiresReaction ? " · реакция" : ""}</span>
        <button type="button" disabled={actionsDisabled || !onDeclineAdditionalMovement} onClick={onDeclineAdditionalMovement}>Остаться на месте</button>
    </div>}
    <div className="tactical-map-pan-space" style={{padding: `${panSpace.y}px ${panSpace.x}px`}}>
    <div
        ref={mapRef}
      className={`tactical-map${selectedActionId ? ' is-targeting' : ''}${movementMode ? ' is-moving' : ''}${implicitActionsEnabled && !selectedActionId ? ' is-contextual' : ''}${worldObjectMoveMode ? ' is-world-object-moving' : ''}`}
      data-testid="tactical-map"
      data-zoom={zoom}
      style={{ '--tactical-cell-size': `${Math.round(80 * zoom)}px`, '--board-width':boardWidth,'--board-height':boardHeight,
        ...(state.battleMap?{backgroundImage:`url("${resolveMediaVariant(state.battleMap.background)}")`,backgroundSize:'100% 100%'}:{}) } as React.CSSProperties}
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
      {cells.map(({position, illumination, surfaces, token, dancingLight, illusion, persistentAreas, actor,
        tokenAnchor, dead, terrainLabel, areaLabel, lightLabel, illusionLabel, label}) => {
        return (
          <button
            type="button"
            key={`${position.x}:${position.y}`}
            className={`tactical-cell${token ? ' has-token' : ''}${dancingLight || illusion ? ' has-world-object' : ''}${persistentAreas.length ? ' has-combat-area' : ''}${persistentAreas.some((area) => area.lightlyObscured) ? ' is-lightly-obscured' : ''}${persistentAreas.some((area) => area.heavilyObscured) ? ' is-heavily-obscured' : ''}${persistentAreas.some((area) => area.difficultTerrain) ? ' is-difficult-terrain' : ''}${token && token.actorId === activeId ? ' is-active' : ''}${token && token.actorId === inspectedActorId ? ' is-inspected' : ''}${token && token.actorId === highlightedActorId ? ' is-linked-highlight' : ''}${dead ? ' is-dead' : ''}${dead && token && combatIdentity(state,token.actorId).side === 'enemy' ? ' is-dead-enemy' : ''}${areaCells.has(`${position.x}:${position.y}`) || (token && eligibleTargetIds?.includes(token.actorId)) ? ' is-area-preview' : ''}${reachableCells.has(`${position.x}:${position.y}`) ? ' is-move-reachable' : ''}${routeCells.has(`${position.x}:${position.y}`) ? ` is-route-preview${previewRoute && !previewRoute.available ? ' is-unavailable' : ''}` : ''}${hazardousCells.has(`${position.x}:${position.y}`) ? ' is-movement-hazard' : ''}`}
            aria-label={`${label}${surfaces.includes('ice')?', лёд':''}`}
            data-illumination={illumination.level}
            data-surface={surfaces.join(' ')}
            data-movement-hazard={hazardousCells.has(`${position.x}:${position.y}`) || undefined}
            aria-description={[terrainLabel, illumination.magicalDarkness ? 'Магическая тьма' : illumination.daylight ? 'Дневной свет' : illumination.level === 'dark' ? 'Тьма' : illumination.level === 'dim' ? 'Тусклый свет' : 'Яркий свет'].filter(Boolean).join('; ')}
            data-actor-id={token?.actorId}
            data-scenery-zone={persistentAreas.length>0&&persistentAreas.every(area=>area.sceneryFeatureId)?'true':undefined}
            style={token ? {'--linked-accent': combatIdentity(state, token.actorId).accent} as React.CSSProperties : undefined}
            onMouseEnter={(event) => { setHovered(position); scheduleCellPreview(position); setHoverAnchor({x:event.clientX,y:event.clientY}); onActorHover?.(token?.actorId ?? null); }}
            onMouseMove={(event) => { setHoverAnchor({x:event.clientX,y:event.clientY}); }}
            onMouseLeave={() => { setHovered(null); scheduleCellPreview(null); onActorHover?.(null); }}
            onFocus={(event) => { const rect=event.currentTarget.getBoundingClientRect(); setHoverAnchor({x:rect.right,y:rect.top}); setHovered(position); scheduleCellPreview(position); onActorHover?.(token?.actorId ?? null); }}
            onBlur={() => { setHovered(null); scheduleCellPreview(null); onActorHover?.(null); }}
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
              <BattleTokenMotion movement={movements[token.actorId]} position={token.position} cellSize={Math.round(80 * zoom)} reducedMotion={reducedMotion}>
              <span key={tokenAnimation(token.actorId)?committedFeedback?.id:token.actorId}
                className={`battle-token is-${identity.side}${tokenAnimation(token.actorId)}`}
                style={{ '--token-color': identity.accent, '--token-size': actorFootprint(actor, state),
                  '--token-impact-delay':`${tokenImpactDelay}ms`,
                  '--token-contact-delay':`${tokenTiming.contactMs}ms`,'--token-launch-delay':`${tokenTiming.launchMs}ms`,
                  '--lunge-x':`${Math.cos(animationAngle)*9}px`,'--lunge-y':`${Math.sin(animationAngle)*9}px` } as React.CSSProperties}>
                {token.tokenUrl ? <img src={token.tokenUrl} alt="" /> : <b>{combatActorDisplayName(actor).slice(0, 1)}</b>}
                <span className="battle-token__health-mask" aria-hidden="true"><span className="battle-token__lost-health" style={{height: `${lostHealthFraction(actor.runtime.hp.current, actor.runtime.hp.max) * 100}%`}} /></span>
                {identity.side !== 'enemy' && identity.duplicateIndex && <span className="battle-token__duplicate">{identity.duplicateIndex}</span>}
                <span className="battle-token__name">{identity.side === 'enemy' ? combatActorDisplayName(actor) : identity.displayName}</span>
              </span>
              </BattleTokenMotion>
              );
            })()}
          </button>
        );
      })}
    </div>
    </div>
    {hoverTooltip}
    {!state.tacticalFootprints && Object.values(state.world.actors).some(actor=>actorFootprint(actor)>1) && <p className="text-sm p-2" role="note">Этот бой сохранён по прежним правилам размещения. Области 2×2 и 3×3 будут использоваться со следующей встречи.</p>}
    </div>
  );
}
