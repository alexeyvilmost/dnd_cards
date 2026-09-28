import type {WorldState} from '../rules-core/domain';
import type {EngineEvent} from '../mvp/contracts';
import {applyHealing} from './hp';
import {rollFormula} from './formula';
import {emptyDeathSaves} from './deathSaves';
import {collectModifiers} from './modifiers';

type Operation={kind:string;remaining_hp?:number;dice?:string};
export function journeyOperations(mechanics:Record<string,unknown>):Operation[]{
  const journey=mechanics.journey as {operations?:Operation[]}|undefined;
  return Array.isArray(journey?.operations)?journey.operations:[];
}
export function settleJourneyAuras(world:WorldState,partyIds:readonly string[],phase:'last_conscious'|'victory',rng:()=>number,preferredActorId?:string){
  let next=world;
  const records:Array<{actorId:string;source:string;events:EngineEvent[]}>=[];
  const party=partyIds.flatMap(id=>next.actors[id]?[next.actors[id]]:[]);
  const dead=(actor:typeof party[number])=>actor.runtime.deathSaves?.dead||(actor.runtime.deathSaves?.failures??0)>=3||actor.lifecycle?.status==='dead';
  if(phase==='last_conscious'){
    if(!party.length||party.some(a=>a.runtime.hp.current>0||dead(a)))return {world:next,records};
    const actor=party.find(a=>a.id===preferredActorId)??party[party.length-1];
    const aura=actor.runtime.activeEffects.find(e=>journeyOperations(e.mechanics).some(op=>op.kind==='last_conscious_survival'));
    const op=aura&&journeyOperations(aura.mechanics).find(op=>op.kind==='last_conscious_survival');
    if(!aura||!op||!Number.isInteger(op.remaining_hp)||(op.remaining_hp??0)<1)return {world:next,records};
    // Remaining at positive HP is prevention, not healing (like personal
    // zero-HP survival); it must not emit healing or trigger healing riders.
    const remainingHP=Math.min(actor.runtime.hp.max,op.remaining_hp!);
    next={...next,revision:next.revision+1,actors:{...next.actors}};
    for(const member of party){
      const runtime=member.id===actor.id?{...actor.runtime,hp:{...actor.runtime.hp,current:remainingHP},deathSaves:emptyDeathSaves()}:member.runtime;
      next.actors[member.id]={...member,runtime:{...runtime,activeEffects:runtime.activeEffects.filter(e=>e.id!==aura.id)}};
    }
    records.push({actorId:actor.id,source:aura.name,events:[{type:'narrative',text:`${aura.name}: последний герой остаётся с ${remainingHP} хитом. Аура исчезает.`}]});
  }else{
    for(const actor of party){
      if(dead(actor))continue;
      let runtime=actor.runtime;
      if(collectModifiers(runtime,actor.passives??[],{roll:'healing'}).denied)continue;
      for(const aura of runtime.activeEffects)for(const op of journeyOperations(aura.mechanics)){
        if(op.kind!=='combat_victory_heal'||!op.dice)continue;
        const roll=rollFormula(op.dice,{}, {rng});const healed=applyHealing(runtime,Math.max(0,roll.total));runtime=healed.state;
        records.push({actorId:actor.id,source:aura.name,events:[{type:'roll',label:aura.name,roll:{...roll,kind:'healing',advantage:'none'}},...healed.events]});
      }
      if(runtime!==actor.runtime){if(next===world)next={...world,revision:world.revision+1,actors:{...world.actors}};next.actors[actor.id]={...actor,runtime};}
    }
  }
  return {world:next,records};
}
