import {antimagicFields} from '../rules-core/magicSuppression';
import {actorFootprint,footprintDistanceFt} from './footprint';
import type {CombatAreaState,GridPosition,SoloCombatState} from './types';

/** Position authority also covers empty cells chosen for a teleport or a zone. */
type MagicBoard=Pick<SoloCombatState,'tokens'>&Partial<Pick<SoloCombatState,'world'|'tacticalFootprints'>>;
export function antimagicAt(state:MagicBoard,position:GridPosition,actorId:string):boolean{
 if(!state.world)return false;
 const world=state.world,actor=world.actors[actorId];
 return antimagicFields(world).some(field=>{
  const source=world.actors[field.actorId],token=state.tokens[field.actorId];
  return !!token&&source.planeId===actor?.planeId&&footprintDistanceFt(token.position,position,
   actorFootprint(source,state),actorFootprint(actor,state))<=field.radius;
 });
}
export function magicAreaSuppressed(state:MagicBoard,area:CombatAreaState,position:GridPosition,actorId:string):boolean{
 return !!area.magicOrigin&&!['artifact','deity'].includes(area.magicOrigin.kind)&&antimagicAt(state,position,actorId);
}
