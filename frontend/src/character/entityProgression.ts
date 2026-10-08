import type {Race, CharacterClass} from '../types';
import {gatherFeatureRefs} from './assemble';
import {payloadsFromMechanics} from '../mechanics/expandChoices';
import {normalizeAppliedGrantPrimitive} from '../mechanics/grantSemantics';
import {collectResourceGrantPayloads} from './resourceInit';
import {resolveByLevel, resolveCount} from '../engine/resources';
import {proficiencyBonusForLevel} from './derive';
import type {CharacterContext} from '../mvp/contracts';
import type {EntityReference, ReferenceEntityType} from '../api/entityReferences';
import {abilityFullRu} from '../engine/describeMechanics';

type Document = Record<string, unknown>;
export type ProgressionFeature = {reference:EntityReference; entity?:Document; level:number; note?:string};
export type ProgressionResource = {id:string; amount:string; source:string};
export type ProgressionRow = {level:number; features:ProgressionFeature[]; resources:ProgressionResource[]};
export function visibleEntityProgression(rows:ProgressionRow[],showTechnical:boolean){
  const visible=rows.map(row=>({...row,features:row.features.filter(feature=>showTechnical||!feature.entity?.is_technical)}))
    .filter(row=>row.features.length>0||row.resources.length>0);
  return {rows:visible,abilities:visible.some(row=>row.features.some(feature=>['effect','feat'].includes(feature.reference.entity_type))),
    actions:visible.some(row=>row.features.some(feature=>['action','spell'].includes(feature.reference.entity_type))),resources:visible.some(row=>row.resources.length>0)};
}
type LoadEntity = (type:ReferenceEntityType,id:string)=>Promise<Document|undefined>;
const formulaLabel=(text:string)=>text.replace(/\b(str|dex|con|int|wis|cha)\b/gi,abilityFullRu)
  .replace(/\[SELF_LEVEL\]/gi,'уровень').replace(/\[PROF\]/gi,'бонус мастерства');

// A catalog has no character ability scores. Resolve only level-owned values;
// leave actor-dependent formulas explicit instead of inventing a maximum.
export function progressionCount(raw:unknown,level:number,classLevels:Record<string,number>={}):string {
  if(typeof raw==='string' && /\b(str|dex|con|int|wis|cha)\b|\[VAR:|\[ABILITY:|\[RESOURCE:/i.test(raw)) return formulaLabel(raw);
  if(typeof raw==='number'||typeof raw==='string') {
    const value=resolveCount(raw,{level,profBonus:proficiencyBonusForLevel(level),classLevels,abilityMods:{}} as CharacterContext);
    return value===0 && typeof raw==='string' && Number.isNaN(Number(raw)) ? formulaLabel(raw) : String(value);
  }
  return 'Зависит от персонажа';
}

/** A read-only view of the canonical collector and declared grants. Choices
 * stay on their owning ability; their alternatives are never auto-selected. */
export async function loadEntityProgression(kind:'races'|'classes',entity:Race|CharacterClass,load:LoadEntity):Promise<ProgressionRow[]> {
  const race=kind==='races'?entity as Race:null;
  const klass=kind==='classes'?entity as CharacterClass:null;
  const ownUnlock=race?.is_subrace?race.subrace_level??1:klass?.is_subclass?klass.subclass_level??3:1;
  const parentId=race?.parent_race_id??klass?.parent_class_id;
  const parent=parentId?await load(kind==='races'?'race':'class',parentId):undefined;
  if(parentId&&!parent)throw Error('Не удалось загрузить основной вид или класс.');
  const parentRace=kind==='races'&&parent?parent as unknown as Race:null;
  const parentClass=kind==='classes'&&parent?parent as unknown as CharacterClass:null;
  const unlock=parent?1:ownUnlock;
  if(!Number.isSafeInteger(unlock)||unlock<1||unlock>20)throw Error('В каталоге указан некорректный уровень получения.');
  const refs=gatherFeatureRefs(race?.is_subrace?parentRace:race,klass?.is_subclass?parentClass:klass,[],20,
    race?.is_subrace?race:null,klass?.is_subclass?klass:null);
  const features:ProgressionFeature[]=[];
  const pools:Array<{id:string;amount:unknown;level:number;source:string}>=[];
  const seen=new Set<string>();
  const errors:string[]=[];
  const visit=async(type:ReferenceEntityType,id:string,level:number,ancestors:string[],note?:string):Promise<void>=>{
    const key=type+':'+id;
    if(ancestors.includes(key)||ancestors.length>=16)return;
    const visitKey=key+':'+level;
    if(seen.has(visitKey))return;seen.add(visitKey);
    let document:Document|undefined;
    try{document=await load(type,id);}catch{errors.push(id);}
    features.push({reference:{entity_type:type,entity_id:id,name:typeof document?.name==='string'?document.name:undefined,paths:[],missing:!document},entity:document,level,note});
    if(!document)return;
    const mechanics=document.mechanics as Document|undefined;
    const activation=mechanics?.activation as Document|undefined;
    // Active action outcomes are not permanent level-up grants.
    if(activation?.mode==='active'||activation?.mode==='reaction')return;
    for(const grant of collectResourceGrantPayloads(mechanics?[mechanics]:[])){
      const gate=Math.max(level,Number(grant.level_gate??grant.min_level??level));
      if(typeof grant.id==='string')pools.push({id:grant.id,amount:grant.amount??1,level:gate,source:String(document.name??entity.name)});
    }
    for(const payload of payloadsFromMechanics(mechanics)){
      const gate=Math.max(level,Number(payload.level_gate??payload.min_level??level));
      const grant=normalizeAppliedGrantPrimitive(payload);
      if(grant && (grant.kind==='spell'||grant.kind==='feat')){
        await visit(grant.kind,grant.value,gate,[...ancestors,key],grant.freeuse?grant.freeuse.atWill?'Без ограничений':`Бесплатно: ${progressionCount(grant.freeuse.count??1,gate)} · ${grant.freeuse.recharge==='short_rest'?'Короткий отдых':'Долгий отдых'}`:undefined);
      } else if(payload.kind==='grant_effect'||payload.kind==='grant_action'){
        const values=payload.value??payload.values;
        for(const ref of Array.isArray(values)?values:[values])if(typeof ref==='string')await visit(payload.kind==='grant_effect'?'effect':'action',ref,gate,[...ancestors,key]);
      }
    }
  };
  await Promise.all([
    ...refs.effectRefs.map(ref=>visit('effect',ref.id,ref.origin.progressionLevel??(ref.origin.id===entity.id?ownUnlock:1),[],ref.origin.name)),
    ...refs.actionRefs.map(ref=>visit('action',ref.id,ref.origin.progressionLevel??(ref.origin.id===entity.id?ownUnlock:1),[],ref.origin.name)),
  ]);
  if(errors.length)throw Error('Не удалось загрузить часть способностей. Повторите загрузку.');
  const classResources={...parentClass?.resources,...klass?.resources};
  return Array.from({length:20-unlock+1},(_,index)=>{
    const level=index+unlock;
    const ownerClass=parentClass??klass;
    const classLevels=ownerClass?{[(ownerClass.card_number||ownerClass.name).replace(/^CLASS[-_]/i,'').toLowerCase().replace(/-/g,'_')]:level}:{};
    const resources:ProgressionResource[]=pools.filter(pool=>pool.level<=level).map(pool=>({id:pool.id,source:pool.source,amount:progressionCount(pool.amount,level,classLevels)}));
    for(const [id,raw] of Object.entries(classResources)){
      if(!raw||typeof raw!=='object')continue;
      const definition=raw as Document;
      const value=resolveByLevel(definition.by_level,level)??definition.count??definition.max??0;
      const amount=progressionCount(value,level,classLevels);
      if(amount!=='0')resources.push({id,source:entity.name,amount});
    }
    const combined=new Map<string,ProgressionResource>();
    for(const resource of resources){
      const previous=combined.get(resource.id);
      if(!previous)combined.set(resource.id,{...resource});
      else previous.amount=Number.isFinite(Number(previous.amount))&&Number.isFinite(Number(resource.amount))
        ?String(Number(previous.amount)+Number(resource.amount)):`${previous.amount} + ${resource.amount}`;
    }
    return {level,features:features.filter(feature=>feature.level===level),resources:[...combined.values()].filter(pool=>pool.amount!=='0')};
  });
}
