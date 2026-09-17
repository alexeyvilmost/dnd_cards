import {previewCombatAttackRoll} from './engine';
import {spatialFacts} from './types';

/** Counterfactual uses the same executor, so cover-ignoring features are respected
 * without duplicating their rules in the UI. Both executions are read-only. */
export function previewAttackCover(input:Parameters<typeof previewCombatAttackRoll>[0],profile:ReturnType<typeof previewCombatAttackRoll>){
 const targetId=input.targetIds[0];
 const cover=spatialFacts(input.state,input.actorId,targetId,false).cover;
 const ac=profile?.target?.value;
 if(cover==='none')return {cover,ac,baseAc:ac,bonus:0};
 if(cover==='total'||ac===undefined)return {cover,ac,baseAc:undefined,bonus:undefined};
 const map=input.state.battleMap;
 const without=previewCombatAttackRoll({...input,state:{...input.state,creatureCoverVersion:undefined,
  battleMap:map?{...map,features:map.features.map(f=>({...f,cover:undefined,blocksSight:false}))}:undefined}});
 const baseAc=without?.target?.value;
 return {cover,ac,baseAc,bonus:baseAc===undefined?undefined:ac-baseAc};
}

export function attackCoverLabel(preview:ReturnType<typeof previewAttackCover>):string{
 if(preview.cover==='total')return 'Полное укрытие — выстрел перекрыт';
 if(preview.cover==='none')return 'Без укрытия · +0 к КД';
 const name=preview.cover==='half'?'Половинное укрытие':'Укрытие на три четверти';
 if(preview.bonus===undefined)return `${name} · бонус КД будет уточнён при доступной атаке`;
 if(preview.bonus===0)return `${name} · игнорируется этой атакой (+0 к КД)`;
 return `${name} · +${preview.bonus} к КД: ${preview.baseAc} → ${preview.ac}`;
}
