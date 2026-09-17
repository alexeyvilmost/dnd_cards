import {
  combatRelation,
  TACTICAL_CELL_FT,
  TACTICAL_HEIGHT,
  TACTICAL_WIDTH,
  type GridPosition,
  type CombatMovementMode,
  type SoloCombatState,
} from './types';
import { breakdownValue } from '../engine/breakdown';
import type { ActorState } from '../rules-core/domain';
import { activeConditionWorldFactValues } from '../engine/conditions';
import {actorFootprint, footprintCells, footprintFits, footprintDistanceFt} from './footprint';
import {boardCells, boardDimensions, boardObstacles, terrainSight, terrainStepFits, type BoardState} from './boardGeometry';
import {creatureCoverObstacles} from './creatureCover';

export function actorMustCrawl(actor: ActorState): boolean {
  if (!actor.runtime.activeEffects?.length) return false;
  return activeConditionWorldFactValues(actor.runtime, 'stand_cost').includes('half_speed');
}

export function standMovementCost(state: Pick<SoloCombatState, 'world'>, actorId: string): number {
  return Math.floor(effectiveCombatActorSpeedFt(state, actorId) / 2);
}

export function gridDistanceFt(left: GridPosition, right: GridPosition): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y)) * TACTICAL_CELL_FT;
}
export function samePosition(left: GridPosition, right: GridPosition): boolean {
  return left.x === right.x && left.y === right.y;
}

export function actorDistanceFt(state: Pick<SoloCombatState, 'tokens' | 'world'>, leftId: string, rightId: string,
  left = state.tokens[leftId].position, right = state.tokens[rightId].position): number {
  return footprintDistanceFt(left, right, actorFootprint(state.world.actors[leftId], state), actorFootprint(state.world.actors[rightId], state));
}

/** Effective tactical speed, including generic active/passive speed modifiers. */
export function effectiveActorSpeedFt(actor: ActorState): number {
  const value = breakdownValue(
    'speed', actor.character, actor.runtime, actor.passives ?? [],
  ).value;
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

const MOVEMENT_MODES: CombatMovementMode[] = ['walk', 'climb', 'fly', 'swim', 'burrow'];

/** Every speed declared by the pinned familiar stat block. Ordinary actors
 * currently expose their already projected walking speed. */
export function combatActorMovementSpeeds(actor: ActorState): Record<CombatMovementMode, number> {
  const walk = effectiveActorSpeedFt(actor);
  const declared = actor.familiarMetadata?.speeds;
  return Object.fromEntries(MOVEMENT_MODES.map((mode) => [
    mode,
    mode === 'walk' ? walk : Math.max(0, Number(declared?.[mode] ?? 0)),
  ])) as Record<CombatMovementMode, number>;
}

export function combatActorMovementMode(
  state: Pick<SoloCombatState, 'world' | 'movementModeByActor'>,
  actorId: string,
): CombatMovementMode {
  const selected = state.movementModeByActor?.[actorId] ?? 'walk';
  const actor = state.world.actors[actorId];
  return actor && combatActorMovementSpeeds(actor)[selected] > 0 ? selected : 'walk';
}

/** Tactical speed also includes encounter relations such as being grappled. */
export function effectiveCombatActorSpeedFt(
  state: Pick<SoloCombatState, 'world' | 'movementModeByActor'>,
  actorId: string,
): number {
  const actor = state.world.actors[actorId];
  if (!actor) return 0;
  const grappled = Object.values(state.world.grapples ?? {}).some((grapple) => (
    grapple.targetActorId === actorId
  ));
  return grappled ? 0 : combatActorMovementSpeeds(actor)[combatActorMovementMode(state, actorId)];
}

export function occupiedPositions(state: Pick<SoloCombatState, 'tokens' | 'world'> & BoardState, exceptActorId?: string): Set<string> {
  return new Set([...boardObstacles(state), ...Object.values(state.tokens).flatMap((token) => {
    const actor = state.world.actors[token.actorId];
    if (token.actorId === exceptActorId || !actor || actor.runtime.hp.current <= 0) return [];
    return footprintCells(token.position, actorFootprint(actor, state)).map(p => `${p.x}:${p.y}`);
  })]);
}

export function canOccupyPosition(state: Pick<SoloCombatState, 'tokens' | 'world' | 'tacticalFootprints'> & BoardState, actorId: string, position: GridPosition): boolean {
  const {width,height}=boardDimensions(state);
  return footprintFits(position, actorFootprint(state.world.actors[actorId], state), occupiedPositions(state, actorId), width, height);
}

/** Exact destination set accepted by the current five-foot tactical movement rule. */
export function reachablePositions(
  state: Pick<SoloCombatState, 'tokens' | 'world' | 'combatAreas' | 'movementModeByActor'> & BoardState,
  actorId: string,
  maximumFeet: number,
): GridPosition[] {
  return reachableRoutes(state, actorId, maximumFeet).map(route => route.destination);
}

export interface TacticalRoute {
  destination: GridPosition;
  path: GridPosition[];
  costFt: number;
}

/** Bounded Dijkstra search over the 120-cell board. Every returned step is
 * adjacent and unoccupied; cost matches the common movement executor per step. */
export function reachableRoutes(
  state: Pick<SoloCombatState, 'tokens' | 'world' | 'combatAreas' | 'movementModeByActor'> & BoardState,
  actorId: string,
  maximumFeet: number,
  preferredDestination?: GridPosition,
): TacticalRoute[] {
  const origin = state.tokens[actorId]?.position;
  const actor = state.world.actors[actorId];
  if (!origin || !actor || maximumFeet < 5 || !Number.isFinite(maximumFeet)) return [];
  const occupied = occupiedPositions(state, actorId);
  const size = actorFootprint(actor, state);
  const {width,height}=boardDimensions(state);
  const key = (p: GridPosition) => `${p.x}:${p.y}`;
  const difficult = new Set(Object.values(state.combatAreas ?? {}).flatMap(area =>
    area.difficultTerrain ? area.cells.map(key) : []));
  const flies = combatActorMovementMode(state, actorId) === 'fly';
  const crawl = Number(!flies && actorMustCrawl(actor));
  // Equal-cost routes minimize geometric length BEFORE deviation from the ray.
  // Otherwise rounding a blocker can add a down/up zigzag to hug that ray.
  // Costs remain identical to the executor.
  const linePenalty = (position: GridPosition) => {
    if (!preferredDestination) return 0;
    const dx = preferredDestination.x - origin.x;
    const dy = preferredDestination.y - origin.y;
    return (dx * (position.y - origin.y) - dy * (position.x - origin.x)) ** 2;
  };
  type RankedRoute = TacticalRoute & { deviation: number; distance: number };
  const compare = (a: RankedRoute, b: RankedRoute) => a.costFt - b.costFt
    || (Math.abs(a.distance - b.distance) > 1e-9 ? a.distance - b.distance : 0)
    || a.deviation - b.deviation || a.path.length - b.path.length
    || a.destination.y - b.destination.y || a.destination.x - b.destination.x;
  const routes = new Map<string, RankedRoute>([[key(origin), {
    destination: origin, path: [], costFt: 0, deviation: 0, distance: 0,
  }]]);
  const queue = [routes.get(key(origin))!];
  while (queue.length) {
    queue.sort(compare);
    const current = queue.shift()!;
    if (routes.get(key(current.destination)) !== current) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const destination = {x: current.destination.x + dx, y: current.destination.y + dy};
      if (!footprintFits(destination, size, occupied, width, height)
        || !terrainStepFits(state, current.destination, destination, size)) continue;
      const costFt = current.costFt + 5 * (1 + crawl
        + Number(!flies && [...footprintCells(current.destination, size), ...footprintCells(destination, size)].some(p => difficult.has(key(p)))));
      if (costFt > maximumFeet) continue;
      const route: RankedRoute = {destination, costFt, path: [...current.path, destination],
        deviation: current.deviation + linePenalty(destination),
        distance: current.distance + (preferredDestination ? Math.hypot(dx, dy) : 0)};
      const previous = routes.get(key(destination));
      if (previous && compare(previous, route) <= 0) continue;
      routes.set(key(destination), route); queue.push(route);
    }
  }
  routes.delete(key(origin));
  return [...routes.values()].map(({destination, path, costFt}) => ({destination, path, costFt}));
}

function inside(position: GridPosition): boolean {
  return position.x >= 0 && position.y >= 0
    && position.x < TACTICAL_WIDTH && position.y < TACTICAL_HEIGHT;
}

type TacticalAreaAction = {
  mechanics: Record<string, unknown>;
  targeting?: { rangeFt: number; allowedRelations?: readonly string[] };
};

export interface TacticalAreaProjectionInput {
  board?: BoardState;
  action: TacticalAreaAction;
  /** The action owner's cell. Cones use it as their immutable origin. */
  sourcePosition: GridPosition;
  /** The hovered/clicked cell. It is a direction handle for cones and a center otherwise. */
  aimPosition: GridPosition;
}

type TacticalAreaGeometry =
  | { kind: 'cone'; sizeFt: number }
  | { kind: 'line'; lengthFt: number; widthFt: number }
  | { kind: 'cube'; sizeFt: number }
  | { kind: 'sphere'; radiusFt: number }
  | { kind: 'cylinder'; radiusFt: number }
  | { kind: 'emanation'; radiusFt: number };

function positiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Fail closed when content has no complete, data-owned tactical geometry. */
export function tacticalAreaGeometry(action: TacticalAreaAction): TacticalAreaGeometry | null {
  const targeting = action.mechanics.targeting as Record<string, unknown> | undefined;
  if (targeting?.shape !== 'area') return null;
  const area = targeting.area as Record<string, unknown> | undefined;
  if (area?.kind === 'cone' || area?.kind === 'cube') {
    const sizeFt = positiveNumber(area.size_ft);
    return sizeFt === null ? null : { kind: area.kind, sizeFt };
  }
  if (area?.kind === 'line') {
    const lengthFt = positiveNumber(area.length_ft ?? area.size_ft);
    const widthFt = positiveNumber(area.width_ft) ?? TACTICAL_CELL_FT;
    return lengthFt === null ? null : { kind: 'line', lengthFt, widthFt };
  }
  if (area?.kind === 'sphere' || area?.kind === 'cylinder') {
    const radiusFt = positiveNumber(area.radius_ft ?? area.size_ft);
    return radiusFt === null ? null : { kind: area.kind, radiusFt };
  }
  if (area?.kind === 'emanation') {
    const radiusFt = positiveNumber(area.radius_ft ?? area.size_ft);
    return radiusFt === null ? null : { kind: 'emanation', radiusFt };
  }
  return null;
}

function boardPositions(board?: BoardState): GridPosition[] { return boardCells(board); }

/**
 * Single tactical geometry authority shared by hover preview and target resolution.
 * Geometry comes only from mechanics.targeting.area; names and spell identities are irrelevant.
 */
export function areaPositionsForAction(input: TacticalAreaProjectionInput): GridPosition[] {
  const origin = areaEffectOrigin(input);
  return unclippedAreaPositions(input).filter(p=>!terrainSight(input.board??{},origin,p).blocked);
}

export function areaEffectOrigin(input: TacticalAreaProjectionInput): GridPosition {
  const kind=tacticalAreaGeometry(input.action)?.kind;
  return kind==='cone'||kind==='line'||kind==='emanation' ? input.sourcePosition : input.aimPosition;
}

/** Trace delivery/propagation separately. An occupant of the origin or impact
 * cell is not an obstacle to the effect that originates/hits inside that cell. */
export function areaPointSight(state:SoloCombatState,sourceActorId:string,from:GridPosition,to:GridPosition,targetActorId='') {
  const contains=(f:{x:number;y:number;width:number;height:number},p:GridPosition)=>
    p.x>=f.x&&p.x<f.x+f.width&&p.y>=f.y&&p.y<f.y+f.height;
  const bodies=creatureCoverObstacles(state,sourceActorId,targetActorId)
    .filter(f=>!contains(f,from)&&!contains(f,to));
  return terrainSight(state,from,to,1,targetActorId?actorFootprint(state.world.actors[targetActorId],state):1,bodies);
}

function unclippedAreaPositions(input: TacticalAreaProjectionInput): GridPosition[] {
  const geometry = tacticalAreaGeometry(input.action);
  if (!geometry) return [];

  if (geometry.kind !== 'cone' && geometry.kind !== 'line' && geometry.kind !== 'emanation') {
    const rangeFt = positiveNumber(input.action.targeting?.rangeFt);
    if (rangeFt !== null && gridDistanceFt(input.sourcePosition, input.aimPosition) > rangeFt) {
      return [];
    }
  }

  if (geometry.kind === 'cube') {
    const sideCells = Math.max(1, Math.ceil(geometry.sizeFt / TACTICAL_CELL_FT));
    const before = Math.floor((sideCells - 1) / 2);
    const after = sideCells - before - 1;
    return boardPositions(input.board).filter((position) => (
      position.x >= input.aimPosition.x - before
      && position.x <= input.aimPosition.x + after
      && position.y >= input.aimPosition.y - before
      && position.y <= input.aimPosition.y + after
    ));
  }

  if (geometry.kind === 'emanation') {
    return boardPositions(input.board).filter((position) => (
      gridDistanceFt(input.sourcePosition, position) <= geometry.radiusFt
    ));
  }

  if (geometry.kind === 'sphere' || geometry.kind === 'cylinder') {
    return boardPositions(input.board).filter((position) => (
      Math.hypot(
        position.x - input.aimPosition.x,
        position.y - input.aimPosition.y,
      ) * TACTICAL_CELL_FT <= geometry.radiusFt + Number.EPSILON
    ));
  }

  const direction = {
    x: input.aimPosition.x - input.sourcePosition.x,
    y: input.aimPosition.y - input.sourcePosition.y,
  };
  const magnitude = Math.hypot(direction.x, direction.y);
  if (magnitude === 0) return [];
  const unit = { x: direction.x / magnitude, y: direction.y / magnitude };
  return boardPositions(input.board).filter((position) => {
    if (samePosition(position, input.sourcePosition)) return false;
    const delta = {
      x: (position.x - input.sourcePosition.x) * TACTICAL_CELL_FT,
      y: (position.y - input.sourcePosition.y) * TACTICAL_CELL_FT,
    };
    const forward = delta.x * unit.x + delta.y * unit.y;
    const lengthFt = geometry.kind === 'line' ? geometry.lengthFt : geometry.sizeFt;
    if (forward <= 0 || forward > lengthFt + Number.EPSILON) return false;
    const lateral = Math.abs(delta.x * unit.y - delta.y * unit.x);
    // A 5e cone's width at a point equals its distance from the origin.
    const halfWidth = geometry.kind === 'line' ? geometry.widthFt / 2 : forward / 2;
    return lateral <= halfWidth + Number.EPSILON;
  });
}

/** Effective size category, including temporary data-driven transformations. */
export function effectiveActorSize(actor: ActorState): number | undefined {
  const declared = actor.attackProfile?.size;
  if (!Number.isInteger(declared)) return undefined;
  const withoutTransient = { ...actor.runtime, activeEffects: [] };
  const baseline = breakdownValue(
    'size', actor.character, withoutTransient, actor.passives ?? [],
  ).value;
  const projected = breakdownValue(
    'size', actor.character, actor.runtime, actor.passives ?? [],
  ).value;
  return declared! + (projected - baseline);
}

const DIRECTIONS: GridPosition[] = [
  { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
  { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
];

export function pathToward(input: {
  start: GridPosition;
  target: GridPosition;
  maxFeet: number;
  occupied?: ReadonlySet<string>;
}): GridPosition[] {
  const occupied = input.occupied ?? new Set<string>();
  const path: GridPosition[] = [];
  let current = { ...input.start };
  const steps = Math.max(0, Math.floor(input.maxFeet / TACTICAL_CELL_FT));
  for (let index = 0; index < steps; index += 1) {
    const candidates = DIRECTIONS
      .map((direction) => ({ x: current.x + direction.x, y: current.y + direction.y }))
      .filter((position) => inside(position) && !occupied.has(`${position.x}:${position.y}`))
      .sort((left, right) => gridDistanceFt(left, input.target) - gridDistanceFt(right, input.target));
    const next = candidates[0];
    if (!next || gridDistanceFt(next, input.target) >= gridDistanceFt(current, input.target)) break;
    current = next;
    path.push(current);
    if (gridDistanceFt(current, input.target) <= TACTICAL_CELL_FT) break;
  }
  return path;
}

export function pushAway(input: {
  board?: BoardState;
  source: GridPosition;
  target: GridPosition;
  distanceFt: number;
  occupied?: ReadonlySet<string>;
  targetSize?: number;
}): GridPosition {
  const occupied = input.occupied ?? new Set<string>();
  const delta = {x: input.target.x - input.source.x, y: input.target.y - input.source.y};
  const span = Math.max(Math.abs(delta.x), Math.abs(delta.y));
  if (span === 0) return { ...input.target };
  // Rasterize the source-to-target ray; a distant off-axis hit must not turn
  // into a 45-degree diagonal just because both coordinate differences are nonzero.
  const offset = (value: number, steps: number) => Math.sign(value) * Math.round(Math.abs(value) * steps / span);
  let current = { ...input.target };
  for (let index = 0; index < Math.floor(input.distanceFt / TACTICAL_CELL_FT); index += 1) {
    const next = {x: input.target.x + offset(delta.x, index + 1), y: input.target.y + offset(delta.y, index + 1)};
    const {width,height}=boardDimensions(input.board);
    if (!footprintFits(next, input.targetSize ?? 1, occupied, width, height)
      || !terrainStepFits(input.board ?? {},current,next,input.targetSize ?? 1)) break;
    current = next;
  }
  return current;
}

/** Resolve forced movement toward its source without entering an occupied cell. */
export function pullToward(input: {
  board?: BoardState;
  source: GridPosition;
  target: GridPosition;
  distanceFt: number;
  occupied?: ReadonlySet<string>;
  targetSize?: number;
}): GridPosition {
  const occupied = input.occupied ?? new Set<string>();
  const direction = {
    x: Math.sign(input.source.x - input.target.x),
    y: Math.sign(input.source.y - input.target.y),
  };
  if (direction.x === 0 && direction.y === 0) return { ...input.target };
  let current = { ...input.target };
  for (let index = 0; index < Math.floor(input.distanceFt / TACTICAL_CELL_FT); index += 1) {
    const next = { x: current.x + direction.x, y: current.y + direction.y };
    const {width,height}=boardDimensions(input.board);
    if (!footprintFits(next, input.targetSize ?? 1, occupied, width, height)
      || !terrainStepFits(input.board ?? {},current,next,input.targetSize ?? 1)) break;
    current = next;
  }
  return current;
}

export function areaActorIds(input: {
  state: SoloCombatState;
  sourceActorId: string;
  aimPosition: GridPosition;
  action: TacticalAreaAction;
}): string[] {
  const sourcePosition = input.state.tokens[input.sourceActorId]?.position;
  if (!sourcePosition) return [];
  const area = new Set(areaPositionsForAction({
    board: input.state,
    action: input.action,
    sourcePosition,
    aimPosition: input.aimPosition,
  })
    .map((position) => `${position.x}:${position.y}`));
  const allowedRelations = input.action.targeting?.allowedRelations;
  return Object.values(input.state.tokens).flatMap((token) => {
    const actor = input.state.world.actors[token.actorId];
    if (!actor || actor.runtime.hp.current <= 0) return [];
    const relation = combatRelation(input.state, input.sourceActorId, token.actorId);
    if (allowedRelations?.length && !allowedRelations.includes(relation)) return [];
    const origin=areaEffectOrigin({action:input.action,sourcePosition,aimPosition:input.aimPosition});
    return footprintCells(token.position, actorFootprint(actor, input.state)).some(p => area.has(`${p.x}:${p.y}`))
      && !areaPointSight(input.state,input.sourceActorId,origin,token.position,token.actorId).blocked ? [token.actorId] : [];
  });
}
