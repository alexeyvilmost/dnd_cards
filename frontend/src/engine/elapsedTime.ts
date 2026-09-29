import type {ExecuteContext,ExecuteResult,RuntimeState} from '../mvp/contracts';
import {executeAction} from './execute';
import {reconcileEndedEffects} from './effectLifecycle';
import {reconcileTemporaryResourceGrants} from './temporaryResourceGrants';
/** Work advances effect time without granting any short/long-rest benefit. */
export function advanceEffectTime(state:RuntimeState,seconds:number,ctx:ExecuteContext):ExecuteResult {
  if(!Number.isSafeInteger(seconds)||seconds<0)throw Error('Elapsed work time must be nonnegative seconds');
  const rounds=Math.floor(seconds/6),events:ExecuteResult['events']=[];
  if(!rounds)return {state,events};
  const after={...state,activeEffects:state.activeEffects.flatMap(effect=>{
    const expired=(effect.roundsLeft!==undefined&&effect.roundsLeft<=rounds)
      || (!!effect.sourceTurnExpiry&&rounds>=2)
      || (['start_of_next_turn','end_of_turn','end_of_round'].includes(String(effect.expiry))&&rounds>=1);
    if(expired){events.push({type:'effect_expired',name:effect.name});return [];}
    return [effect.roundsLeft===undefined?effect:{...effect,roundsLeft:effect.roundsLeft-rounds}];
  })};
  const ended=reconcileEndedEffects(state,after,ctx,executeAction,{elapsedRounds:rounds});
  return {state:reconcileTemporaryResourceGrants(state,ended.state,ctx.character),events:[...events,...ended.events]};
}
