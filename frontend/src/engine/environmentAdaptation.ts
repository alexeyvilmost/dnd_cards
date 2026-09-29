import type {RuntimeState,CharacterContext} from '../mvp/contracts';
import {payloadsOf} from './mechanicsView';
import {matchesWhen} from './circumstances';
type Dict=Record<string,unknown>;
export interface EnvironmentAdaptation {breathing:string[];weightless:boolean;canPassGaps:boolean;minPassageInches?:number;cannotAttack:boolean;cannotCast:boolean}
/** Capabilities only answer explicitly authored environment questions; they do
 * not manufacture oxygen timers, flying speeds, or openings in solid walls. */
export function environmentAdaptation(state:RuntimeState,passives:readonly Dict[]=[],character?:CharacterContext):EnvironmentAdaptation{
 const result:EnvironmentAdaptation={breathing:['air'],weightless:false,canPassGaps:false,cannotAttack:false,cannotCast:false};
 for(const payload of [...passives,...state.activeEffects.filter(e=>e.roundsLeft===undefined||e.roundsLeft>0).map(e=>e.mechanics)].flatMap(payloadsOf)){
  if(!matchesWhen(payload.when as Dict[]|undefined,{state,character}))continue;
  if(payload.kind==='movement_policy'&&typeof payload.minimum_passage_inches==='number'&&payload.minimum_passage_inches>0){result.minPassageInches=Math.min(result.minPassageInches??Infinity,payload.minimum_passage_inches);continue;}
  if(payload.kind!=='environment_adaptation')continue;
  if(Array.isArray(payload.breathing))result.breathing.push(...payload.breathing.filter((s):s is string=>typeof s==='string'));
  result.weightless ||= payload.weightless===true;result.canPassGaps ||= payload.can_pass_gaps===true;
  result.cannotAttack ||= payload.cannot_attack===true;result.cannotCast ||= payload.cannot_cast===true;
 }
 result.breathing=[...new Set(result.breathing)];return result;
}
export function environmentActionIssue(state:RuntimeState,mechanics:Dict,passives:readonly Dict[],character:CharacterContext,isSpell:boolean):string|null{
 const adaptation=environmentAdaptation(state,passives,character);
 if(adaptation.cannotCast&&isSpell)return 'Текущая форма запрещает использовать заклинания';
 const attacks=(value:unknown):boolean=>Array.isArray(value)?value.some(attacks):!!value&&typeof value==='object'&&((value as Dict).resolution==='attack_roll'||Object.values(value).some(attacks));
 return adaptation.cannotAttack&&attacks(mechanics.effects)?'Текущая форма запрещает атаковать':null;
}
