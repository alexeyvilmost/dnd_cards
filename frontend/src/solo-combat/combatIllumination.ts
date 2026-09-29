import { payloadsOf } from '../engine/mechanicsView';
import { matchesWhen } from '../engine/circumstances';
import { senseRangeFt } from '../engine/senses';
import type { ActorState } from '../rules-core/domain';
import { illuminationFromObject } from '../rules-core/worldObjects';
import { terrainSight } from './boardGeometry';
import type { GridPosition, SoloCombatState } from './types';

type Dict = Record<string, unknown>;
export type IlluminationBoard = Pick<SoloCombatState, 'tokens' | 'boardRevision' | 'battleMap'> & Partial<Pick<SoloCombatState, 'world' | 'worldObjectPositions'>>;
export interface BoardLightSource { id: string; position: GridPosition; bright: number; dim: number; darkness: number; daylight: boolean; magical: boolean; shape?: 'sphere' | 'cone'; facing?: string }
export interface IlluminationAt { level: 'bright' | 'dim' | 'dark'; daylight: boolean; magicalDarkness: boolean; boardRevision: number }
const nonnegative = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
const directions: Record<string, [number, number]> = { n: [0,-1], ne: [1,-1], e: [1,0], se: [1,1], s: [0,1], sw: [-1,1], w: [-1,0], nw: [-1,-1] };

/** All declarations come from the canonical, already equipment-gated passives
 * or persisted world objects. An expired or covered lamp contributes nothing. */
export function boardLightSources(state: IlluminationBoard): BoardLightSource[] {
  if (!state.world) return [];
  const sources: BoardLightSource[] = [];
  for (const actor of Object.values(state.world.actors)) {
    const position = state.tokens[actor.id]?.position;
    if (!position) continue;
    const mechanics = [...(actor.passives ?? []), ...actor.runtime.activeEffects.filter(effect => effect.roundsLeft == null || effect.roundsLeft > 0).map(effect => effect.mechanics as Dict)];
    for (const [index, mechanic] of mechanics.entries()) {
      const mode = (mechanic.activation as Dict | undefined)?.mode;
      if (mode && mode !== 'passive') continue;
      for (const [payloadIndex, payload] of payloadsOf(mechanic).entries()) {
        if (payload.kind !== 'illumination' || !matchesWhen(payload.when as Dict[] | undefined, { character: actor.character, state: actor.runtime })) continue;
        sources.push({ id: `actor:${actor.id}:${index}:${payloadIndex}`, position, bright: nonnegative(payload.bright_radius_ft), dim: nonnegative(payload.dim_additional_radius_ft),
          darkness: nonnegative(payload.darkness_radius_ft), daylight: payload.daylight === true, magical: payload.magical === true });
      }
    }
  }
  for (const object of Object.values(state.world.objects)) {
    const holder = object.heldByActorId ?? object.carriedByActorId;
    const position = holder ? state.tokens[holder]?.position : state.worldObjectPositions?.[object.id];
    if (!position || object.coveredByOpaqueObject) continue;
    const light = illuminationFromObject(object);
    if (light && (light.roundsLeft === null || light.roundsLeft > 0)) sources.push({ id: object.id, position, bright: light.brightRadiusFt, dim: light.dimAdditionalRadiusFt,
      darkness: 0, daylight: light.daylight === true, magical: false, shape: light.shape, facing: light.facing });
    if (object.dancingLight) sources.push({ id: object.id, position, bright: 0, dim: object.dancingLight.dimRadiusFt, darkness: 0, daylight: false, magical: false });
  }
  return sources;
}
function inCone(source: BoardLightSource, point: GridPosition): boolean {
  if (source.shape !== 'cone') return true;
  const facing = directions[source.facing ?? ''];
  if (!facing) return false;
  const dx = point.x - source.position.x, dy = point.y - source.position.y;
  if (!dx && !dy) return true;
  const dot = dx * facing[0] + dy * facing[1];
  // A standard cone has a width equal to its length: half-angle arctan(1/2).
  return dot > 0 && Math.abs(dx * facing[1] - dy * facing[0]) <= dot / 2;
}
export function illuminationAt(state: IlluminationBoard, point: GridPosition, sources = boardLightSources(state)): IlluminationAt {
  let level = state.battleMap?.ambientLight ?? 'bright', daylight = state.battleMap?.environment?.openSky === true && state.battleMap.environment.timeOfDay === 'day', magicalDarkness = false;
  for (const source of sources) {
    const distance = Math.max(Math.abs(source.position.x - point.x), Math.abs(source.position.y - point.y)) * 5;
    if (!inCone(source, point) || terrainSight(state, source.position, point).blocked) continue;
    if (source.darkness > 0 && distance <= source.darkness) { magicalDarkness ||= source.magical; daylight = false; level = 'dark'; }
  }
  if (!magicalDarkness) for (const source of sources) {
    if (source.darkness || !inCone(source, point) || terrainSight(state, source.position, point).blocked) continue;
    const distance = Math.max(Math.abs(source.position.x - point.x), Math.abs(source.position.y - point.y)) * 5;
    if (source.bright > 0 && distance <= source.bright) { level = 'bright'; daylight ||= source.daylight; }
    else if (source.dim > 0 && distance <= source.bright + source.dim && level === 'dark') level = 'dim';
  }
  return { level, daylight, magicalDarkness, boardRevision: state.boardRevision };
}
export function seesInIllumination(observer: ActorState | undefined, facts: IlluminationAt, distanceFt: number): boolean {
  if (facts.level !== 'dark') return true;
  if (!observer) return false;
  if (senseRangeFt(observer.runtime, observer.passives ?? [], 'truesight') > 0 && senseRangeFt(observer.runtime, observer.passives ?? [], 'truesight') >= distanceFt) return true;
  return !facts.magicalDarkness && senseRangeFt(observer.runtime, observer.passives ?? [], 'darkvision') >= distanceFt
    && senseRangeFt(observer.runtime, observer.passives ?? [], 'darkvision') > 0;
}
export function projectCombatIllumination(state: SoloCombatState): SoloCombatState {
  const sources = boardLightSources(state);
  let changed = false;
  const actors = Object.fromEntries(Object.values(state.world.actors).map(actor => {
    const position = state.tokens[actor.id]?.position;
    if (!position) return [actor.id, actor];
    const illumination = illuminationAt(state, position, sources);
    const environment = state.battleMap?.environment;
    const distances = environment?.seaCells?.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)).map(point => Math.max(Math.abs(point.x-position.x),Math.abs(point.y-position.y))*5) ?? [];
    const environmentObservations = { openNightSky: environment?.openSky === true && environment?.timeOfDay === 'night',
      ...(distances.length ? {nearestSeaFt:Math.min(...distances)} : {}), boardRevision:state.boardRevision };
    if (JSON.stringify(actor.character.illumination) === JSON.stringify(illumination) && JSON.stringify(actor.character.environmentObservations) === JSON.stringify(environmentObservations)) return [actor.id, actor];
    changed = true;
    return [actor.id, { ...actor, character: { ...actor.character, illumination, environmentObservations } }];
  }));
  return changed ? { ...state, world: { ...state.world, actors } } : state;
}
