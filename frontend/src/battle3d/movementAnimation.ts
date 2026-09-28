import {boardDimensions} from '../solo-combat/boardGeometry';
import {reachableRoutes} from '../solo-combat/tacticalGrid';
import type {GridPosition,SoloCombatState} from '../solo-combat/types';

export function movementPathForTransition(before:SoloCombatState,after:SoloCombatState,actorId:string):GridPosition[]|null {
  const from=before.tokens[actorId]?.position,to=after.tokens[actorId]?.position;
  if(!from||!to||(from.x===to.x&&from.y===to.y))return null;
  const pending=before.playerMovement?.actorId===actorId?before.playerMovement.steps
    :before.monsterMovement?.actorId===actorId?before.monsterMovement.steps:undefined;
  const completed=pending?.findIndex(step=>step.x===to.x&&step.y===to.y)??-1;
  if(pending&&completed>=0)return [from,...pending.slice(0,completed+1)];
  const {width,height}=boardDimensions(before),maximumFeet=width*height*15;
  for(const state of [before,{...after,tokens:{...after.tokens,[actorId]:{...after.tokens[actorId],position:from}}}]) {
    const route=reachableRoutes(state,actorId,maximumFeet,to)
      .find(candidate=>candidate.destination.x===to.x&&candidate.destination.y===to.y);
    if(route)return [from,...route.path];
  }
  // A single forced step remains safe to depict even when no walk route exists.
  return Math.max(Math.abs(from.x-to.x),Math.abs(from.y-to.y))===1?[from,to]:null;
}

/** Read-only animation over the route chosen by the tactical pathfinder. */
export function positionOnMovementPath(points: readonly GridPosition[], elapsedSeconds:number, stepSeconds=.19) {
  if(points.length<2)return {position:points[0]??{x:0,y:0},moving:false};
  const segment=Math.max(0,elapsedSeconds)/stepSeconds;
  const index=Math.min(points.length-2,Math.floor(segment));
  if(segment>=points.length-1)return {position:points[points.length-1],moving:false};
  const progress=segment-index;
  const eased=progress*progress*(3-2*progress);
  const from=points[index],to=points[index+1];
  return {position:{x:from.x+(to.x-from.x)*eased,y:from.y+(to.y-from.y)*eased},moving:true};
}
