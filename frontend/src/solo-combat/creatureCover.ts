import {actorHasConsciousVitality} from '../engine/lifePolicies';
import {breakdownValue} from '../engine/breakdown';
import type {SoloCombatState} from './types';
import type {CoverObstacle} from './boardGeometry';
import {actorFootprint} from './footprint';

type CreatureCoverState = Pick<SoloCombatState,'tokens'> & Partial<Pick<SoloCombatState,'world'|'tacticalFootprints'|'creatureCoverVersion'>>;

/** Shared attack obstacles. Separate from vision: a creature blocks a shot, not
 * perception/spells that explicitly do not require an unobstructed path.
 * Capability preserves the geometry of encounters pinned to older artifacts. */
export function creatureCoverObstacles(state:CreatureCoverState,sourceId:string,targetId:string):CoverObstacle[]{
 if(state.creatureCoverVersion!==1||!state.world)return [];
 const attachedOwnerId=state.world.actors[sourceId]?.itemTurn?.ownerActorId;
 return Object.values(state.tokens).flatMap(token=>{
  if(token.actorId===sourceId||token.actorId===targetId||token.actorId===attachedOwnerId||token.attachedToActorId)return [];
  const actor=state.world!.actors[token.actorId];
  // Defeated bodies no longer occupy a tactical cell, just as in movement.
  if(!actor||!actorHasConsciousVitality(actor))return [];
  const size=breakdownValue('size',actor.character,actor.runtime,actor.passives??[]).value;
  const footprint=actorFootprint(actor,state);
  return [{...token.position,width:footprint,height:footprint,
   ...(size>=2?{blocksSight:true}:{cover:'half' as const})}];
 });
}
