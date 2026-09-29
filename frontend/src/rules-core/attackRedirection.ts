import type {ActorState,RuleActionDefinition,WorldState,SpatialFacts} from './domain';
import type {RollLog} from '../mvp/contracts';
import {payloadsOf} from '../engine/mechanicsView';
import {activeConditionsOf,matchesWhen} from '../engine/circumstances';

type Dict=Record<string,unknown>;
export function attackRedirectionRules(source:ActorState,action:RuleActionDefinition,weaponId?:string):Dict[]{
 const attack=(action.mechanics.effects as Dict[]|undefined)?.find(effect=>effect.resolution==='attack_roll'&&String(effect.attack_kind).includes('weapon'));
 if(!attack)return [];
 const selected=weaponId??action.mechanics.weapon_source_id??source.runtime.equipment[(attack.tags as string[]|undefined)?.includes('off_hand')?'off_hand':'main_hand'];
 return [...source.passives??[],...source.runtime.activeEffects.filter(effect=>effect.roundsLeft===undefined||effect.roundsLeft>0).map(effect=>effect.mechanics)]
  .flatMap(payloadsOf).filter(payload=>payload.kind==='attack_redirection'&&payload.weapon_id===selected
   &&matchesWhen(payload.when as Dict[]|undefined,{state:source.runtime,character:source.character,activeConditions:activeConditionsOf(source.runtime)}));
}

/** The nearest eligible actor is selected from immutable board observations.
 * Ties have a stable identity order; no name or species inference is performed. */
export function redirectedAttackTarget(world:WorldState,source:ActorState,original:ActorState,rules:readonly Dict[],roll:RollLog):{target:ActorState;facts:SpatialFacts;roll:RollLog}|null{
 const natural=roll.dice.find(die=>die.sides===20&&!die.discarded&&die.role!=='bonus')?.result;
 for(const rule of rules){
  if(!Array.isArray(rule.natural_faces)||!rule.natural_faces.includes(natural)||rule.nearest_to!=='target'||rule.automatic_hit!==true||!Array.isArray(rule.target_tags)||!rule.target_tags.length)continue;
  const nearby=[{actorId:original.id,distanceFt:0},...(original.character.spatialObservations?.nearby??[])];
  const chosen=nearby.filter(row=>world.actors[row.actorId]&&world.actors[row.actorId].runtime.hp.current>0
   &&(rule.target_tags as string[]).every(tag=>world.actors[row.actorId].character.creatureTags?.includes(tag)))
   .sort((a,b)=>a.distanceFt-b.distanceFt||a.actorId.localeCompare(b.actorId))[0];
  if(!chosen)continue;
  const target=world.actors[chosen.actorId];
  const observation=source.character.spatialObservations?.nearby.find(row=>row.actorId===target.id);
  if(target.id!==source.id&&!observation)continue;
  const facts:SpatialFacts={factsSource:'board',boardRevision:source.character.spatialObservations?.boardRevision??0,
   distanceFt:observation?.distanceFt??0,relation:target.id===source.id?'self':observation!.relation,
   cover:observation?.cover??'none',lineOfSight:observation?.lineOfSight??true,
   canSeeTarget:observation?.canSeeTarget,targetCanSeeSource:observation?.targetCanSeeSource};
  return {target,facts,roll:{...roll,outcome:'hit',automaticHit:{reason:'Перенаправление атаки по правилу предмета',sourceEntityIds:[String(rule.weapon_id)]}}};
 }
 return null;
}
