import type {EngineEvent,ExecuteContext,ExecuteResult,RuntimeState} from '../mvp/contracts';
import {emitEvent} from './execute';

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
  const prepared={...state,resources,firedByPeriod:{...state.firedByPeriod,encounter:[]}};
  const next=emitEvent({kind:'encounter_start',source:'self'},prepared,ctx,events,[],undefined,[],true);
  return {state:next,events};
}

/** Round duration belongs to the global initiative boundary, not the owner's
 * first turn. Other durations keep their existing source/turn semantics. */
export function expireEncounterRound(state:RuntimeState):ExecuteResult {
  const events:EngineEvent[]=[];
  const activeEffects=state.activeEffects.filter(entry=>{
    if(entry.expiry!=='end_of_round')return true;
    events.push({type:'effect_expired',name:entry.name});return false;
  });
  return {state:activeEffects.length===state.activeEffects.length?state:{...state,activeEffects},events};
}
