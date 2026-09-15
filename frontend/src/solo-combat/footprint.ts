import type {ActorState} from '../rules-core/domain';
import {breakdownValue} from '../engine/breakdown';
import type {GridPosition} from './types';

/** Position is the north-west occupied cell, never the token's visual centre. */
export function actorFootprint(actor?: ActorState, rules?: {world?: unknown; tacticalFootprints?: 'sized'}): number {
  // Archived workers used one-cell tokens. Preserve their geometry and replay;
  // only a newly initialized encounter opts into footprint-aware execution.
  if (rules && rules.tacticalFootprints !== 'sized') return 1;
  if (!actor?.character) return 1;
  const size = breakdownValue('size', actor.character, actor.runtime, actor.passives ?? []).value;
  return Number.isFinite(size) ? Math.max(1, Math.min(4, Math.floor(size) - 1)) : 1;
}

export function footprintCells(position: GridPosition, size = 1): GridPosition[] {
  return Array.from({length: size * size}, (_, i) => ({x: position.x + i % size, y: position.y + Math.floor(i / size)}));
}

/** Closest occupied squares, using the encounter's five-foot diagonal rule. */
export function footprintDistanceFt(a: GridPosition, b: GridPosition, aSize = 1, bSize = 1): number {
  return 5 * Math.max(0, b.x - (a.x + aSize - 1), a.x - (b.x + bSize - 1),
    b.y - (a.y + aSize - 1), a.y - (b.y + bSize - 1));
}

export function footprintFits(position: GridPosition, size: number, occupied: ReadonlySet<string>, width: number, height: number): boolean {
  return footprintCells(position, size).every(p => Number.isInteger(p.x) && Number.isInteger(p.y)
    && p.x >= 0 && p.y >= 0 && p.x < width && p.y < height && !occupied.has(`${p.x}:${p.y}`));
}
