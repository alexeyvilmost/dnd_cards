import type {EngineEvent,ExecuteContext,RuntimeState} from '../mvp/contracts';
import {payloadsOf} from './mechanicsView';
import {matchesWhen,activeConditionsOf} from './circumstances';

/** Echo the damage that survived mitigation, including damage absorbed by
 * Temporary HP. Its recipient gets the ordinary damage/reaction pipeline. */
export function damageEchoEvents(state:RuntimeState,amount:number,damageType:string,ctx:ExecuteContext):EngineEvent[]{
 if(amount<=0||!ctx.selfId)return [];
 const events:EngineEvent[]=[];
 for(const entry of state.activeEffects){
  if(!entry.sourceId||entry.sourceId===ctx.selfId||entry.roundsLeft!==undefined&&entry.roundsLeft<=0)continue;
  for(const payload of payloadsOf(entry.mechanics)){
   if(payload.kind!=='damage_echo'||payload.recipient!=='effect_source'||typeof payload.fraction!=='number'||payload.fraction<=0||payload.fraction>1
    ||!matchesWhen(payload.when as Record<string,unknown>[]|undefined,{state,character:ctx.character,activeConditions:activeConditionsOf(state)}))continue;
   const echo=Math.floor(amount*payload.fraction);
   if(echo)events.push({type:'area_damage',amount:echo,damageType,sourceActorId:ctx.selfId,targetIds:[entry.sourceId],source:entry.name,damageSourceKind:'spell'});
  }
 }
 return events;
}
