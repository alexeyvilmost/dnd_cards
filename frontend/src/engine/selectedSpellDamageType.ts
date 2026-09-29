import type {ExecuteContext,RuntimeState} from '../mvp/contracts';
import {payloadsOf} from './mechanicsView';
import {matchesWhen,activeConditionsOf} from './circumstances';
const TYPES=new Set(['acid','bludgeoning','cold','fire','force','lightning','necrotic','piercing','poison','psychic','radiant','slashing','thunder']);
/** Source-scoped choices are expanded by the ordinary item assembler; this
 * interpreter only accepts the immutable spell identity and a known type. */
export function selectedSpellDamageType(state:RuntimeState,ctx:ExecuteContext,original:string):string{
 if(!ctx.spell?.spellId)return original;
 const sources=[...(ctx.passives??[]),...state.activeEffects.filter(e=>e.roundsLeft===undefined||e.roundsLeft>0).map(e=>e.mechanics)];
 let result=original;
 for(const payload of sources.flatMap(payloadsOf)){
  if(payload.kind!=='damage_type_policy'||!Array.isArray(payload.spell_refs)||!payload.spell_refs.includes(ctx.spell.spellId)||!TYPES.has(String(payload.value)))continue;
  if(matchesWhen(payload.when as Record<string,unknown>[]|undefined,{state,character:ctx.character,activeConditions:activeConditionsOf(state)}))result=String(payload.value);
 }
 return result;
}
