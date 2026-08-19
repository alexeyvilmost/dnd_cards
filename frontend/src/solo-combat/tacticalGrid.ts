import {
  TACTICAL_CELL_FT,
  TACTICAL_HEIGHT,
  TACTICAL_WIDTH,
  type GridPosition,
  type SoloCombatState,
} from './types';

export function gridDistanceFt(left: GridPosition, right: GridPosition): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y)) * TACTICAL_CELL_FT;
}
export function samePosition(left: GridPosition, right: GridPosition): boolean {
  return left.x === right.x && left.y === right.y;
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
  state: Pick<SoloCombatState, 'tokens' | 'world'>,
  actorId: string,
  maximumFeet: number,
): GridPosition[] {
  const origin = state.tokens[actorId]?.position;
  if (!origin || maximumFeet < TACTICAL_CELL_FT) return [];
  const occupied = occupiedPositions(state, actorId);
  return Array.from({ length: TACTICAL_WIDTH * TACTICAL_HEIGHT }, (_, index) => ({
    x: index % TACTICAL_WIDTH,
    y: Math.floor(index / TACTICAL_WIDTH),
  })).filter((position) => !samePosition(position, origin)
    && !occupied.has(`${position.x}:${position.y}`)
    && gridDistanceFt(origin, position) <= maximumFeet);
}

function inside(position: GridPosition): boolean {
  return position.x >= 0 && position.y >= 0
    && position.x < TACTICAL_WIDTH && position.y < TACTICAL_HEIGHT;
}

export function areaPositionsForAction(
  action: { mechanics: Record<string, unknown>; targeting?: { rangeFt: number } },
  selectedPosition: GridPosition,
): GridPosition[] {
  const rawTargeting = action.mechanics.targeting as Record<string, unknown> | undefined;
  if (rawTargeting?.shape !== 'area') return [];
  const rawArea = rawTargeting.area as Record<string, unknown> | undefined;
  const sizeFt = Number(rawArea?.size_ft ?? action.targeting?.rangeFt ?? TACTICAL_CELL_FT);
  const radius = Math.max(TACTICAL_CELL_FT, Math.floor(sizeFt / 2));
  return Array.from({ length: TACTICAL_WIDTH * TACTICAL_HEIGHT }, (_, index) => ({
    x: index % TACTICAL_WIDTH,
    y: Math.floor(index / TACTICAL_WIDTH),
  })).filter((position) => gridDistanceFt(position, selectedPosition) <= radius);
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

export function areaActorIds(input: {
  state: SoloCombatState;
  sourceActorId: string;
  selectedPosition: GridPosition;
  action: { mechanics: Record<string, unknown>; targeting?: { rangeFt: number } };
}): string[] {
  const area = new Set(areaPositionsForAction(input.action, input.selectedPosition)
    .map((position) => `${position.x}:${position.y}`));
  return Object.values(input.state.tokens).flatMap((token) => {
    if (token.actorId === input.sourceActorId) return [];
    const actor = input.state.world.actors[token.actorId];
    if (!actor || actor.runtime.hp.current <= 0) return [];
    return area.has(`${token.position.x}:${token.position.y}`) ? [token.actorId] : [];
  });
}
