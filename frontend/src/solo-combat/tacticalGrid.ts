import {
  combatRelation,
  TACTICAL_CELL_FT,
  TACTICAL_HEIGHT,
  TACTICAL_WIDTH,
  type GridPosition,
  type SoloCombatState,
} from './types';
import { breakdownValue } from '../engine/breakdown';
import type { ActorState } from '../rules-core/domain';

export function gridDistanceFt(left: GridPosition, right: GridPosition): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y)) * TACTICAL_CELL_FT;
}
export function samePosition(left: GridPosition, right: GridPosition): boolean {
  return left.x === right.x && left.y === right.y;
}

/** Effective tactical speed, including generic active/passive speed modifiers. */
export function effectiveActorSpeedFt(actor: ActorState): number {
  const value = breakdownValue(
    'speed', actor.character, actor.runtime, actor.passives ?? [],
  ).value;
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Tactical speed also includes encounter relations such as being grappled. */
export function effectiveCombatActorSpeedFt(
  state: Pick<SoloCombatState, 'world'>,
  actorId: string,
): number {
  const actor = state.world.actors[actorId];
  if (!actor) return 0;
  const grappled = Object.values(state.world.grapples ?? {}).some((grapple) => (
    grapple.targetActorId === actorId
  ));
  return grappled ? 0 : effectiveActorSpeedFt(actor);
}

export function occupiedPositions(state: Pick<SoloCombatState, 'tokens' | 'world'>, exceptActorId?: string): Set<string> {
  return new Set(Object.values(state.tokens).flatMap((token) => {
    const actor = state.world.actors[token.actorId];
    if (token.actorId === exceptActorId || !actor || actor.runtime.hp.current <= 0) return [];
    return [`${token.position.x}:${token.position.y}`];
  }));
}

/** Exact destination set accepted by the current five-foot tactical movement rule. */
export function reachablePositions(
  state: Pick<SoloCombatState, 'tokens' | 'world' | 'combatAreas'>,
  actorId: string,
  maximumFeet: number,
): GridPosition[] {
  const origin = state.tokens[actorId]?.position;
  if (!origin || maximumFeet < TACTICAL_CELL_FT) return [];
  const occupied = occupiedPositions(state, actorId);
  return Array.from({ length: TACTICAL_WIDTH * TACTICAL_HEIGHT }, (_, index) => ({
    x: index % TACTICAL_WIDTH,
    y: Math.floor(index / TACTICAL_WIDTH),
  })).filter((position) => {
    if (samePosition(position, origin) || occupied.has(`${position.x}:${position.y}`)) return false;
    const distance = gridDistanceFt(origin, position);
    const steps = Math.max(Math.abs(position.x - origin.x), Math.abs(position.y - origin.y));
    const path = Array.from({ length: steps + 1 }, (_, index) => {
      const ratio = steps === 0 ? 0 : index / steps;
      return {
        x: Math.round(origin.x + (position.x - origin.x) * ratio),
        y: Math.round(origin.y + (position.y - origin.y) * ratio),
      };
    });
    const difficult = Object.values(state.combatAreas ?? {}).some((area) => (
      area.difficultTerrain && area.cells.some((cell) => path.some((step) => samePosition(cell, step)))
    ));
    return distance * (difficult ? 2 : 1) <= maximumFeet;
  });
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
function tacticalAreaGeometry(action: TacticalAreaAction): TacticalAreaGeometry | null {
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

function boardPositions(): GridPosition[] {
  return Array.from({ length: TACTICAL_WIDTH * TACTICAL_HEIGHT }, (_, index) => ({
    x: index % TACTICAL_WIDTH,
    y: Math.floor(index / TACTICAL_WIDTH),
  }));
}

/**
 * Single tactical geometry authority shared by hover preview and target resolution.
 * Geometry comes only from mechanics.targeting.area; names and spell identities are irrelevant.
 */
export function areaPositionsForAction(input: TacticalAreaProjectionInput): GridPosition[] {
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
    return boardPositions().filter((position) => (
      position.x >= input.aimPosition.x - before
      && position.x <= input.aimPosition.x + after
      && position.y >= input.aimPosition.y - before
      && position.y <= input.aimPosition.y + after
    ));
  }

  if (geometry.kind === 'emanation') {
    return boardPositions().filter((position) => (
      gridDistanceFt(input.sourcePosition, position) <= geometry.radiusFt
    ));
  }

  if (geometry.kind === 'sphere' || geometry.kind === 'cylinder') {
    return boardPositions().filter((position) => (
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
  return boardPositions().filter((position) => {
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
  source: GridPosition;
  target: GridPosition;
  distanceFt: number;
  occupied?: ReadonlySet<string>;
}): GridPosition {
  const occupied = input.occupied ?? new Set<string>();
  const direction = {
    x: Math.sign(input.target.x - input.source.x),
    y: Math.sign(input.target.y - input.source.y),
  };
  if (direction.x === 0 && direction.y === 0) return { ...input.target };
  let current = { ...input.target };
  for (let index = 0; index < Math.floor(input.distanceFt / TACTICAL_CELL_FT); index += 1) {
    const next = { x: current.x + direction.x, y: current.y + direction.y };
    if (!inside(next) || occupied.has(`${next.x}:${next.y}`)) break;
    current = next;
  }
  return current;
}

/** Resolve forced movement toward its source without entering an occupied cell. */
export function pullToward(input: {
  source: GridPosition;
  target: GridPosition;
  distanceFt: number;
  occupied?: ReadonlySet<string>;
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
    if (!inside(next) || occupied.has(`${next.x}:${next.y}`)) break;
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
    return area.has(`${token.position.x}:${token.position.y}`) ? [token.actorId] : [];
  });
}
