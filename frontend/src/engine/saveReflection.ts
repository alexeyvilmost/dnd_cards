import type {CharacterContext,RollLog,RuntimeState} from '../mvp/contracts';
import {payloadsOf} from './mechanicsView';
import {matchesWhen} from './circumstances';
type Dict=Record<string,unknown>;

/** Reflection uses the final, recorded saving total and the original DC.
 * The originating effect keeps its formulas and source; no replacement roll
 * or new spell payment is manufactured. */
export function reflectsSavingEffect(state:RuntimeState,passives:Dict[],character:CharacterContext|undefined,roll:RollLog|undefined):boolean {
  if(!roll||roll.target?.type!=='dc'||roll.total!==roll.target.value)return false;
  return [...passives,...state.activeEffects.map(effect=>effect.mechanics)].some(mechanics=>payloadsOf(mechanics).some(payload=>
    payload.kind==='save_reflection'&&payload.on_total==='dc'
    &&matchesWhen(payload.when as Dict[]|undefined,{state,character})));
}
