import {useEffect, useRef} from 'react';
import {conditionGrantedActions, type ConditionGrantedAction} from '../engine/conditionActions';
import {canUseConditionAction} from './engine';
import {combatLogRecords} from './combatLog';
import {decisionPolicyEnabled, decisionPolicyToggles} from './decisionPolicies';
import {isPlayerControlledCombatActor, type SoloCombatState} from './types';

export function combatTurnStartKey(state: SoloCombatState | null): string | null {
  const scene=state?.world.scene;
  return state&&state.outcome==='active'&&scene?.mode==='encounter'&&scene.turnStarted
    ?JSON.stringify([state.world.id,scene.round,scene.activeIndex,scene.initiative[scene.activeIndex]]):null;
}

/** Reloading in the middle of a turn must not turn a later knockdown into a
 * turn-start action. Use committed declarations, never journal text. */
function alreadyActedThisTurn(state: SoloCombatState, actorId: string): boolean {
  const scene=state.world.scene;
  if(scene.mode!=='encounter')return true;
  const entries=state.log.filter(entry=>entry.round===scene.round);
  let start=-1;
  entries.forEach((entry,index)=>{if(combatLogRecords(entry)
    .some(record=>record.actorId===actorId&&record.event?.type==='turn_started'))start=index;});
  return entries.slice(start<0?0:start).some(entry=>
    combatLogRecords(entry).some(record=>record.sourceActorId===actorId&&(record.kind==='action'||record.kind==='movement'))
    // Old text/bare-event journals cannot prove this is still the opening of
    // the turn. Leave an ambiguous saved opportunity to the player.
    || entry.actorId===actorId&&!entry.records?.length
      && (!entry.events?.length||entry.events.some(event=>event.type!=='turn_started')));
}

export function automaticTurnStartConditionAction(state: SoloCombatState|null, preferences: Readonly<Record<string,boolean>>): ConditionGrantedAction|null {
  if(!state||!combatTurnStartKey(state)||state.world.scene.mode!=='encounter')return null;
  const actorId=state.world.scene.initiative[state.world.scene.activeIndex];
  const actor=state.world.actors[actorId];
  if(!actor||!isPlayerControlledCombatActor(state,actorId)||alreadyActedThisTurn(state,actorId))return null;
  const policies=decisionPolicyToggles('turn_start').filter(policy=>policy.predicate==='granted_condition_action'
    &&decisionPolicyEnabled(policy,preferences));
  const actions=conditionGrantedActions(actor.runtime);
  return actions.find(action=>policies.some(policy=>action.decisionPolicies?.includes(policy.presentationKey??policy.id))
    &&(state.conditionActionSchemaVersion===1||actions[0]===action)
    &&canUseConditionAction(state,actorId,action.id))??null;
}

/** One opportunity per turn, after startup decisions/visual deliveries. Only
 * dispatches the normal command; it never changes resources or a condition. */
export function useAutomaticTurnStartAction(state: SoloCombatState|null, preferences: Readonly<Record<string,boolean>>,
  blocked: boolean, perform:(actorId:string,actionId:string)=>void) {
  const processed=useRef<string|null>(null);
  const key=combatTurnStartKey(state);
  useEffect(()=>{
    if(blocked||!state||!key||processed.current===key)return;
    if(state.world.pendingResolution||state.pendingD20Interrupt||state.pendingInterception||state.pendingTriggeredAction
      ||state.pendingTurnStartGrappleDamage||state.pendingAdditionalMovement||state.pendingReachEntry
      ||state.pendingCombatAreaTriggers?.length||state.pendingAlertSwapActorIds?.length||state.playerMovement||state.pendingMovementStep)return;
    processed.current=key;
    const action=automaticTurnStartConditionAction(state,preferences);
    if(action&&state.world.scene.mode==='encounter')perform(state.world.scene.initiative[state.world.scene.activeIndex],action.id);
  },[state,key,blocked,preferences,perform]);
}
