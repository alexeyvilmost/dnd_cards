import {useEffect,useRef} from 'react';
import type {SoloCombatState} from './types';
import {persistedRollPresentation} from './persistedRollPresentation';

type AutomaticDecisionKind = 'roll_influence' | 'reaction';

/** Read-only identity for both current and archived encounters. Journal length
 * is bounded (80) and cannot identify a command. Revisions and entry IDs survive
 * JSON roundtrips and distinguish even identical rolls in successive actions. */
export function automaticCombatDecisionKey(state:SoloCombatState|null,kind:AutomaticDecisionKind|null):string|null {
 if(!state||!kind)return null;
 if(kind==='reaction'){
  const request=state.world.pendingResolution?.request;
  return request?.type==='reaction'?JSON.stringify([kind,state.world.id,request.id]):null;
 }
 const held=persistedRollPresentation(state.pendingD20Interrupt);
 if(!held?.held)return null;
 return JSON.stringify([kind,state.world.id,state.world.revision,state.log.at(-1)?.id,
  held.command.actorId,held.command.actionId,held.command.targetIds,held.held.kind,
  state.world.pendingResolution?.request.id]);
}

/** Local duplicate guard only. Continuation still goes through the normal
 * revision-checked command; this hook never rolls dice or spends resources. */
export function useAutomaticCombatDecision(
 state:SoloCombatState|null,kind:AutomaticDecisionKind|null,blocked:boolean,
 continueDecision:(kind:AutomaticDecisionKind)=>void,
){
 const attempted=useRef<string|null>(null);
 const key=automaticCombatDecisionKey(state,kind);
 useEffect(()=>{
  if(blocked||!kind||!key||attempted.current===key)return;
  attempted.current=key;
  continueDecision(kind);
 },[key,kind,blocked,continueDecision]);
}
