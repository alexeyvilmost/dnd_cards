import type {ActorState,DeterministicEnvironment} from './domain';
import {actorIsDead,resurrectionPermitted} from '../engine/lifePolicies';
import {payloadsOf} from '../engine/mechanicsView';
import {matchesWhen} from '../engine/circumstances';
import {canPay,pay} from '../engine/cost';
import {longRest} from '../engine/turn';
import {emptyDeathSaves} from '../engine/deathSaves';
type Dict=Record<string,unknown>;
const object=(value:unknown):value is Dict=>!!value&&typeof value==='object'&&!Array.isArray(value);

/** Death is observed after the authoritative damage/save transition. Recovery
 * reuses the real rest reducer and consumes its declared item in that commit. */
export function recoverAfterDeath(before:ActorState,after:ActorState,env:DeterministicEnvironment){
  if(actorIsDead(before)||!actorIsDead(after))return null;
  if(!resurrectionPermitted(after.runtime,after.passives,after.character))return null;
  const sources=[...(after.passives??[]),...after.runtime.activeEffects.map(effect=>({...effect.mechanics,id:effect.entityRef?.id??effect.id,name:effect.name}))];
  for(const source of sources)for(const payload of payloadsOf(source)){
    if(payload.kind!=='life_policy'||payload.on_death===undefined)continue;
    if(!matchesWhen(payload.when as Dict[]|undefined,{state:after.runtime,character:after.character}))continue;
    const policy=payload.on_death;
    if(!object(policy)||policy.rest!=='long'||!Array.isArray(policy.cost)||!policy.cost.length
      ||policy.cost.some(cost=>!object(cost)||cost.resource!=='item'||typeof cost.card_id!=='string'||!cost.card_id
        ||!Number.isInteger(cost.amount)||Number(cost.amount)<1))throw Error('Death recovery requires a long rest and explicit item consumption');
    const cost=policy.cost as Dict[];
    if(!canPay(after.runtime,cost).ok)continue;
    const context={...after.character,passives:after.passives,rng:env.rng,skipRestPolicies:true};
    const restored=longRest(after.runtime,context);
    const consumed=pay(restored.state,cost);
    const removed=new Set(cost.map(row=>String(row.card_id)).filter(id=>!consumed.state.inventory.some(row=>row.cardId===id&&row.qty>0)));
    const state={...consumed.state,deathSaves:emptyDeathSaves(),equipment:Object.fromEntries(Object.entries(consumed.state.equipment)
      .map(([slot,id])=>[slot,typeof id==='string'&&removed.has(id)?null:id]))};
    return {state,events:[...restored.events,...consumed.events],sourceId:String(source.id??cost[0].card_id)};
  }
  return null;
}
