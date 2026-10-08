import {describe,it,expect} from 'vitest';
import type {Race,CharacterClass} from '../types';
import {loadEntityProgression,progressionCount,visibleEntityProgression,type ProgressionRow} from './entityProgression';
const passive=(...result:Record<string,unknown>[])=>({activation:{mode:'passive'},effects:[{resolution:'auto',result}]});
describe('catalog level presentation',()=>{
  it('drops empty levels and columns after the technical display filter, without hiding nonempty resource rows',()=>{
    const feature=(type:'action'|'effect',technical=false)=>({level:5,reference:{entity_type:type,entity_id:type,paths:[]},entity:{is_technical:technical}});
    const rows:ProgressionRow[]=[{level:1,features:[feature('effect',true)],resources:[]},{level:2,features:[],resources:[]},{level:5,features:[feature('action')],resources:[]}];
    const visible=visibleEntityProgression(rows,false);expect(visible.rows.map(row=>row.level)).toEqual([5]);expect(visible.abilities).toBe(false);expect(visible.actions).toBe(true);expect(visible.resources).toBe(false);
    expect(visibleEntityProgression(rows,true).rows.map(row=>row.level)).toEqual([1,5]);
    const resourceRows=[...rows,{level:6,features:[],resources:[{id:'focus',amount:'2',source:'Класс'}]}];
    expect(visibleEntityProgression(resourceRows,false).rows.map(row=>row.level)).toEqual([5,6]);expect(visibleEntityProgression(resourceRows,false).resources).toBe(true);
  });
  it('keeps species spell gates and unchosen alternatives on their owning feature',async()=>{
    const race={id:'elf',name:'Эльф',is_subrace:true,subrace_level:1,related_effects:['lineage']} as Race;
    const documents:Record<string,Record<string,unknown>>={lineage:{name:'Линия',mechanics:passive(
      {kind:'grant_spell',value:'magic',level_gate:3},{kind:'grant_spell',value:'step',level_gate:5},
      {kind:'choice',options:{items:[{id:'optional',grants:[{kind:'grant_spell',value:'not-chosen'}]}]}})},magic:{name:'Магия'},step:{name:'Шаг'}};
    const rows=await loadEntityProgression('races',race,async(_type,id)=>documents[id]);
    expect(rows[0].features.map(f=>f.reference.entity_id)).toEqual(['lineage']);
    expect(rows[2].features.map(f=>f.reference.entity_id)).toEqual(['magic']);
    expect(rows[4].features.map(f=>f.reference.entity_id)).toEqual(['step']);
    expect(rows.flatMap(row=>row.features).some(f=>f.reference.entity_id==='not-chosen')).toBe(false);
  });
  it('uses subclass unlock levels, nested actions, and canonical level-based charge counts',async()=>{
    const klass={id:'subclass',name:'Подкласс',is_subclass:true,subclass_level:3,related_effects:['start'],
      level_progression:{'6':{effects:['later']}},resources:{charge:{by_level:{'3':2,'7':4}}}} as unknown as CharacterClass;
    const documents:Record<string,Record<string,unknown>>={start:{name:'Начало',mechanics:passive({kind:'grant_action',value:'act'},
      {kind:'resource',op:'grant',id:'focus',amount:'self_level'})},act:{name:'Действие',mechanics:{activation:{mode:'active'},effects:[{resolution:'auto',result:[{kind:'grant_effect',value:'temporary'}]}]}},later:{name:'Позднее'}};
    const rows=await loadEntityProgression('classes',klass,async(_type,id)=>documents[id]);
    expect(rows[0].level).toBe(3);expect(rows[0].features.map(f=>f.reference.entity_id)).toEqual(['start','act']);
    expect(rows.find(row=>row.level===6)?.features[0].reference.entity_id).toBe('later');
    expect(rows.find(row=>row.level===7)?.resources.map(r=>[r.id,r.amount])).toEqual([['focus','7'],['charge','4']]);
    expect(rows.flatMap(row=>row.features).some(f=>f.reference.entity_id==='temporary')).toBe(false);
  });
  it('does not invent ability-dependent maxima or recurse into effect cycles',async()=>{
    expect(progressionCount('[WIS]',3)).toBe('[Мудрость]');
    const race={id:'r',name:'Вид',related_effects:['one']} as Race;
    const rows=await loadEntityProgression('races',race,async()=>({name:'One',mechanics:passive({kind:'grant_effect',value:'one'})}));
    expect(rows.flatMap(row=>row.features)).toHaveLength(1);
  });
  it('includes parent class progression on a subclass page without granting the subclass early',async()=>{
    const klass={id:'child',name:'Подкласс',is_subclass:true,parent_class_id:'parent',subclass_level:3,related_effects:['child-start'],level_progression:{'6':{effects:['child-later']}}} as unknown as CharacterClass;
    const documents:Record<string,Record<string,unknown>>={parent:{id:'parent',name:'Класс',card_number:'CLASS-example',level_progression:{'1':{effects:['parent-start']},'5':{effects:['parent-later']}},resources:{slot:{by_level:{'1':2,'3':3}}}},'parent-start':{name:'Старт'},'parent-later':{name:'Развитие'},'child-start':{name:'Подкласс'},'child-later':{name:'Развитие подкласса'}};
    const rows=await loadEntityProgression('classes',klass,async(_type,id)=>documents[id]);
    expect(rows[0].features.map(f=>f.reference.entity_id)).toEqual(['parent-start']);
    expect(rows[2].features.map(f=>f.reference.entity_id)).toEqual(['child-start']);
    expect(rows[4].features.map(f=>f.reference.entity_id)).toEqual(['parent-later']);
    expect(rows[5].features.map(f=>f.reference.entity_id)).toEqual(['child-later']);
    expect(rows[2].resources[0].amount).toBe('3');
  });
});
