import type {SoloCombatState,GridPosition} from './types';
import {payloadsOf} from '../engine/mechanicsView';
import {matchesWhen} from '../engine/circumstances';
import {actorIsDead,actorHasConsciousVitality} from '../engine/lifePolicies';
import {actorFootprint,footprintDistanceFt} from './footprint';
type State=Pick<SoloCombatState,'world'|'tokens'>&Partial<Pick<SoloCombatState,'sideByActorId'|'tacticalFootprints'>>;
type Dict=Record<string,unknown>;
/** Geometry is evaluated for each actual step, not from the mover's old aura
 * projection. Entering or leaving an aura therefore costs the same in preview
 * and execution, including after a source moves or its effect expires. */
export function auraDifficultStep(state:State,moverId:string,from:GridPosition,to:GridPosition):boolean{
 const mover=state.world.actors[moverId];if(!mover)return false;
 return Object.values(state.world.actors).some(source=>{
  const origin=state.tokens[source.id]?.position;if(!origin||actorIsDead(source)||source.planeId!==mover.planeId)return false;
  const a=state.sideByActorId?.[source.id],b=state.sideByActorId?.[moverId];
  const relation=source.id===moverId?'self':a&&b?a===b?'ally':'enemy':source.character.spatialObservations?.nearby.find(row=>row.actorId===moverId)?.relation??'neutral';
  return [...source.passives??[],...source.runtime.activeEffects.filter(e=>e.roundsLeft===undefined||e.roundsLeft>0).map(e=>e.mechanics)].flatMap(payloadsOf).some(p=>{
   if(p.kind!=='aura'||p.events!==undefined||!Array.isArray(p.effects)||!p.effects.some(v=>(v as Dict)?.kind==='movement_policy'&&(v as Dict).difficult_terrain===true))return false;
   if(p.requires_conscious===true&&!actorHasConsciousVitality(source)||!matchesWhen(p.when as Dict[]|undefined,{state:source.runtime,character:source.character}))return false;
   if(relation==='self'&&p.recipients!=='self'&&p.recipients!=='all'&&p.include_self!==true)return false;
   if(relation!=='self'&&p.recipients!=='all'&&p.recipients!=='others'&&!(relation==='ally'&&p.recipients==='allies')&&!(relation==='enemy'&&p.recipients==='enemies'))return false;
   const radius=Number(p.radius_ft);if(!Number.isFinite(radius)||radius<0)return false;
   return [from,to].some(point=>footprintDistanceFt(origin,point,actorFootprint(source,state),actorFootprint(mover,state))<=radius);
  });
 });
}

/** Authored material is observable even when the source gives no save DC or
 * friction rule. It never invents a fall check merely because it is ice. */
export function auraSurfacesAt(state:State,point:GridPosition):string[]{
 const surfaces=new Set<string>();
 for(const source of Object.values(state.world.actors)){
  const origin=state.tokens[source.id]?.position;if(!origin||actorIsDead(source))continue;
  for(const aura of [...source.passives??[],...source.runtime.activeEffects.filter(e=>e.roundsLeft===undefined||e.roundsLeft>0).map(e=>e.mechanics)].flatMap(payloadsOf)){
   if(aura.kind!=='aura'||aura.events!==undefined||!Array.isArray(aura.effects)||!matchesWhen(aura.when as Dict[]|undefined,{state:source.runtime,character:source.character}))continue;
   if(Math.max(Math.abs(point.x-origin.x),Math.abs(point.y-origin.y))*5>Number(aura.radius_ft))continue;
   for(const raw of aura.effects){const p=raw as Dict;if(p.kind==='terrain'&&typeof p.material==='string')surfaces.add(p.material);}
  }
 }
 return [...surfaces].sort();
}
