import type {EngineEvent,ExecuteContext,ExecuteResult,RuntimeState} from '../mvp/contracts';
import {emitEvent} from './execute';
import {resetEventOccurrences} from './eventOccurrence';

/** The caller owns the authoritative transition from exploration to encounter.
 * Calling this helper is not itself permission to restart an active encounter. */
export function startEncounter(state:RuntimeState,ctx:ExecuteContext):ExecuteResult {
  const events:EngineEvent[]=[];
  const resources={...state.resources};
  for(const [key,cadence] of Object.entries(ctx.character.resourceRecharge??{})) {
    const maximum=state.maxResources[key];
    if(cadence!=='encounter'||!Number.isFinite(maximum)||maximum<0)continue;
    const before=resources[key]??0;
    resources[key]=maximum;
    if(maximum>before)events.push({type:'resource_restored',resource:key,amount:maximum-before,current:maximum});
  }
  const prepared=resetEventOccurrences({...state,encounterActive:true,resources,firedByPeriod:{...state.firedByPeriod,encounter:[]}},'encounter');
  const next=emitEvent({kind:'encounter_start',source:'self'},prepared,ctx,events,[],undefined,[],true);
  return {state:next,events};
}

/** A finalized encounter owns one boundary, including after persistence/reload. */
export function endEncounter(state:RuntimeState,ctx:ExecuteContext):ExecuteResult {
  if(state.encounterActive!==true)return {state,events:[]};
  const events:EngineEvent[]=[];
  const next=emitEvent({kind:'encounter_end',source:'self'},state,ctx,events,[],undefined,[],true);
  return {state:{...next,encounterActive:false},events};
}

/** Round duration belongs to the global initiative boundary, not the owner's
 * first turn. Other durations keep their existing source/turn semantics. */
export function expireEncounterRound(state:RuntimeState):ExecuteResult {
  const events:EngineEvent[]=[];
  const activeEffects=state.activeEffects.filter(entry=>{
    if(entry.expiry!=='end_of_round')return true;
    events.push({type:'effect_expired',name:entry.name});return false;
  });
  return {state:resetEventOccurrences(activeEffects.length===state.activeEffects.length?state:{...state,activeEffects},'round'),events};
}
