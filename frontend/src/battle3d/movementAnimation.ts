import {boardDimensions} from '../solo-combat/boardGeometry';
import {reachableRoutes} from '../solo-combat/tacticalGrid';
import type {GridPosition,SoloCombatState} from '../solo-combat/types';

export const MOVEMENT_STEP_SECONDS = .19;

export function movementPathForTransition(before:SoloCombatState,after:SoloCombatState,actorId:string):GridPosition[]|null {
  const from=before.tokens[actorId]?.position,to=after.tokens[actorId]?.position;
  if(!from||!to||(from.x===to.x&&from.y===to.y))return null;
  const pending=before.playerMovement?.actorId===actorId?before.playerMovement.steps
    :before.monsterMovement?.actorId===actorId?before.monsterMovement.steps:undefined;
  const completed=pending?.findIndex(step=>step.x===to.x&&step.y===to.y)??-1;
  if(pending&&completed>=0) {
    // The presentation holds the original route while advancing its visible
    // cells one by one. Do not replay its completed prefix or wait on a
    // zero-length duplicate of the current cell between approach steps.
    let start=-1;
    for(let index=0;index<=completed;index++)if(pending[index].x===from.x&&pending[index].y===from.y)start=index;
    return [from,...pending.slice(start+1,completed+1)];
  }
  const {width,height}=boardDimensions(before),maximumFeet=width*height*15;
  for(const state of [before,{...after,tokens:{...after.tokens,[actorId]:{...after.tokens[actorId],position:from}}}]) {
    const route=reachableRoutes(state,actorId,maximumFeet,to)
      .find(candidate=>candidate.destination.x===to.x&&candidate.destination.y===to.y);
    if(route)return [from,...route.path];
  }
  // A single forced step remains safe to depict even when no walk route exists.
  return Math.max(Math.abs(from.x-to.x),Math.abs(from.y-to.y))===1?[from,to]:null;
}

/** Queue and renderer use the same route, including detours around obstacles. */
export function movementDurationForTransition(before:SoloCombatState,after:SoloCombatState,actorId:string):number {
  const points=movementPathForTransition(before,after,actorId);
  return Math.max(0,(points?.length??1)-1)*MOVEMENT_STEP_SECONDS*1000;
}

/** Read-only animation over the route chosen by the tactical pathfinder. */
export function positionOnMovementPath(points: readonly GridPosition[], elapsedSeconds:number, stepSeconds=MOVEMENT_STEP_SECONDS) {
  if(points.length<2)return {position:points[0]??{x:0,y:0},moving:false};
  const segment=Math.max(0,elapsedSeconds)/stepSeconds;
  const index=Math.min(points.length-2,Math.floor(segment));
  if(segment>=points.length-1)return {position:points[points.length-1],moving:false};
  const progress=segment-index;
  const eased=progress*progress*(3-2*progress);
  const from=points[index],to=points[index+1];
  return {position:{x:from.x+(to.x-from.x)*eased,y:from.y+(to.y-from.y)*eased},moving:true};
}

/** A newer movement step continues the visible route instead of snapping back to its old origin. */
export function continueMovementPath(points: readonly GridPosition[], elapsedSeconds: number, next: GridPosition[], stepSeconds=MOVEMENT_STEP_SECONDS): GridPosition[] {
  const current = positionOnMovementPath(points, elapsedSeconds, stepSeconds);
  if (!current.moving) return next;
  const remaining = points.slice(Math.floor(Math.max(0, elapsedSeconds) / stepSeconds) + 1);
  const end = remaining[remaining.length - 1];
  const start = next[0];
  return [current.position, ...remaining, ...next.slice(end && start && end.x === start.x && end.y === start.y ? 1 : 0)];
}
