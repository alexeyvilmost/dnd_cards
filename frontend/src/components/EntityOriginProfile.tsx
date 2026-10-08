import {useEffect,useState,type ReactNode} from 'react';
import {Link} from 'react-router-dom';
import type {Race,CharacterClass} from '../types';
import {abilityFullRu} from '../engine/describeMechanics';
import {getPropertyLabel} from '../utils/propertyLabels';
import {getRussianName} from '../utils/russianTranslations';
import {apiClient} from '../api/client';
import {loadReferenceEntity,ReferenceItem} from './EntityReferences';
import BackgroundEquipment from './BackgroundEquipment';
import ForgeTraitsBlock from './forge/ForgeTraitsBlock';

const armorLabel=(key:string)=>({light:'Лёгкие доспехи',medium:'Средние доспехи',heavy:'Тяжёлые доспехи',shields:'Щиты'}[key]??getPropertyLabel(key));
const weaponLabel=(key:string)=>({simple:'Простое оружие',martial:'Воинское оружие'}[key]??getPropertyLabel(key));

export default function EntityOriginProfile({kind,entity}:{kind:'races'|'classes';entity:Race|CharacterClass}) {
  const race=kind==='races'?entity as Race:null;const klass=kind==='classes'?entity as CharacterClass:null;
  const parentId=race?.parent_race_id??klass?.parent_class_id;
  const [family,setFamily]=useState<Array<{id:string;name:string}>>([]);const [parent,setParent]=useState<(Race|CharacterClass)|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    let live=true;setFamily([]);setParent(null);setError('');
    if(parentId)loadReferenceEntity(kind==='races'?'race':'class',parentId).then(row=>{if(live&&row)setParent(row as unknown as Race|CharacterClass);}).catch(()=>{if(live)setError('Не удалось загрузить родительскую сущность.');});
    else apiClient.get<Record<string,Array<{id:string;name:string}>>>(`/api/${kind}`,{params:{[kind==='races'?'parent_race_id':'parent_class_id']:entity.id,fields:'list',limit:100}}).then(response=>{if(live)setFamily(response.data[kind]??[]);}).catch(()=>{if(live)setError('Не удалось загрузить связанные варианты.');});
    return ()=>{live=false;};
  },[kind,entity.id,parentId]);
  const facts:Array<[string,ReactNode]>=[];
  const coreClass=klass?.is_subclass&&parent?parent as CharacterClass:klass;
  if(klass){
    if(coreClass?.hit_die)facts.push(['Кость хитов',coreClass.hit_die.replace(/^d/,'к')+' за уровень класса']);
    if(coreClass?.primary_abilities?.length)facts.push(['Основные характеристики',coreClass.primary_abilities.map(abilityFullRu).join(', ')]);
    if(coreClass?.saving_throws?.length)facts.push(['Владение спасбросками',coreClass.saving_throws.map(abilityFullRu).join(', ')]);
    if(coreClass?.armor_training?.length)facts.push(['Доспехи',coreClass.armor_training.map(armorLabel).join(', ')]);
    if(coreClass?.weapon_proficiencies?.length)facts.push(['Оружие',coreClass.weapon_proficiencies.map(weaponLabel).join(', ')]);
    if(coreClass?.tool_proficiencies?.length)facts.push(['Инструменты',coreClass.tool_proficiencies.map(key=>getRussianName('tool',key)).join(', ')]);
    const skills=coreClass?.skill_choices;
    if(skills?.count&&Array.isArray(skills.options))facts.push(['Навыки',`Выберите ${skills.count}: ${skills.options.map(skill=>getRussianName('skill',String(skill))).join(', ')}`]);
    if(klass.is_subclass)facts.push(['Уровень получения подкласса',klass.subclass_level??3]);
    else if(klass.subclass_level)facts.push(['Выбор подкласса',klass.subclass_level+'-й уровень']);
  }
  if(race){
    if(race.creature_type)facts.push(['Тип существа',({humanoid:'Гуманоид',fey:'Фея',construct:'Конструкт'}[race.creature_type]??race.creature_type)]);
    if(race.size)facts.push(['Размер',({small:'Маленький',medium:'Средний',large:'Большой'}[race.size]??race.size)]);
    if(race.speed!=null)facts.push(['Скорость',race.speed+' футов']);
    if(race.darkvision)facts.push(['Тёмное зрение',race.darkvision+' футов']);
  }
  return <>
    {(facts.length>0||parent)&&<section className="entity-page__panel entity-origin-profile"><h2>{klass?'Основные сведения':'Особенности вида'}</h2>
      {parent&&<p className="entity-origin-profile__parent">{klass?'Основной класс':'Основной вид'}: <Link to={`/entity/${kind}/${parent.id}`}>{parent.name}</Link></p>}
      <dl>{facts.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {race?.traits?.length?<ForgeTraitsBlock traits={race.traits}/>:null}
    </section>}
    {klass?.equipment_options&&<section className="entity-page__panel"><h2>Стартовое снаряжение</h2><BackgroundEquipment options={klass.equipment_options}/></section>}
    {klass&&!klass.is_subclass&&klass.multiclass_proficiencies&&<section className="entity-page__panel"><h2>Владения при мультиклассировании</h2>
      <dl>{[['Доспехи',klass.multiclass_proficiencies.armor?.map(armorLabel)],['Оружие',klass.multiclass_proficiencies.weapons?.map(weaponLabel)],['Инструменты',klass.multiclass_proficiencies.tools?.map(key=>getRussianName('tool',key))]].map(([label,values])=>Array.isArray(values)&&values.length?<div key={String(label)}><dt>{label}</dt><dd>{values.join(', ')}</dd></div>:null)}</dl>
      {klass.multiclass_proficiencies.choices?.map(choice=><p key={choice.id}>{choice.prompt} · Выберите {choice.count}: {choice.options.map(key=>getRussianName(choice.source==='skills'?'skill':'tool',key)).join(', ')}</p>)}
    </section>}
    {(family.length>0||error)&&<section className="entity-page__panel"><h2>{klass?'Подклассы':'Подвиды'}</h2>
      {error&&<p role="alert">{error}</p>}<div className="entity-origin-profile__family">{family.map(row=><ReferenceItem key={row.id} reference={{entity_type:klass?'class':'race',entity_id:row.id,name:row.name,paths:[]}} compact/>)}</div>
    </section>}
  </>;
}
