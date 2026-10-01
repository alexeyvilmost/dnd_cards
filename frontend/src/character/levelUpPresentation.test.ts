import {describe,expect,it} from 'vitest';
import type {CharacterClass} from '../types';
import type {AssembledCharacter,OriginAction,OriginEffect} from './assemble';
import {availableSubclassAbilities,levelUpResourceGains,levelUpResourceOptions,subclassAbilitiesAtLevel,subclassProgressionLevels,type SubclassProgressionColumn} from './levelUpPresentation';

const effect=(id:string,subclassId:string,level?:number):OriginEffect=>({effect:{id,name:id} as OriginEffect['effect'],origin:{kind:'class',id:subclassId,name:subclassId,progressionLevel:level}});
const action=(id:string,subclassId:string,level:number):OriginAction=>({action:{id,name:id} as OriginAction['action'],origin:{kind:'class',id:subclassId,name:subclassId,progressionLevel:level}});
const columns:SubclassProgressionColumn[]=[
  {subclass:{id:'a',name:'A'} as CharacterClass,effects:[effect('unleveled-a','a'),effect('later-a','a',7)],actions:[action('action-a','a',3)]},
  {subclass:{id:'b',name:'B',subclass_level:2} as CharacterClass,effects:[effect('unleveled-b','b'),effect('later-b','b',9)],actions:[action('action-b','b',5)]},
];
describe('level-up read-only entity projections',()=>{
  it('compares all declared progression levels, including different subclass unlock levels',()=>{
    expect(subclassProgressionLevels(columns,3)).toEqual([2,3,5,7,9]);
    expect(subclassAbilitiesAtLevel(columns[0],3,3).effects.map(entry=>entry.effect.id)).toEqual(['unleveled-a']);
    expect(subclassAbilitiesAtLevel(columns[1],2,3).effects.map(entry=>entry.effect.id)).toEqual(['unleveled-b']);
    expect(subclassAbilitiesAtLevel(columns[1],5,3).actions.map(entry=>entry.action.id)).toEqual(['action-b']);
    expect(subclassAbilitiesAtLevel(columns[0],5,3)).toEqual({effects:[],actions:[]});
  });
  it('shows only the selected subclass abilities available at that class level',()=>{
    const assembled={effects:columns.flatMap(column=>column.effects),actions:columns.flatMap(column=>column.actions)} as AssembledCharacter;
    expect(availableSubclassAbilities(assembled,'a',4).effects.map(entry=>entry.effect.id)).toEqual(['unleveled-a']);
    expect(availableSubclassAbilities(assembled,'b',5).actions.map(entry=>entry.action.id)).toEqual(['action-b']);
    expect(availableSubclassAbilities(assembled,'a',7).effects.map(entry=>entry.effect.id)).toEqual(['unleveled-a','later-a']);
  });
  it('compares canonical maxima across any data-owned pools without introducing current charges',()=>{
    expect(levelUpResourceGains({pact_slot_2:2,resource_a:1,unchanged:5,removed:2},{pact_slot_2:3,resource_a:4,resource_b:2,unchanged:5})).toEqual([
      {key:'pact_slot_2',before:2,after:3,delta:1},
      {key:'resource_a',before:1,after:4,delta:3},
      {key:'resource_b',before:0,after:2,delta:2},
    ]);
  });
  it('uses canonical action source metadata for different generated usage pools and keeps registered overrides',()=>{
    const assembled={race:null,klass:null,background:null,feats:[],spells:[],resources:[],effects:[],actions:[
      {action:{id:'one',card_number:'ACT-one',name:'First action',description:'First description',image_url:'/first.png',mechanics:{activation:{mode:'active',cost:[{resource:'self_uses'}]},uses:{count:1,per:'short_rest'},effects:[]}},origin:{kind:'class',id:'class',name:'Class'}},
      {action:{id:'two',card_number:'ACT-two',name:'Other action',description:'Other description',mechanics:{activation:{mode:'active',cost:[{resource:'self_uses'}]},uses:{count:2,per:'long_rest'},effects:[]}},origin:{kind:'race',id:'race',name:'Race'}},
    ]} as unknown as AssembledCharacter;
    const options=levelUpResourceOptions([],assembled);
    expect(options).toEqual([
      {id:'uses_ACT-one',label:'First action',description:'First description',imageUrl:'/first.png',recharge:'short_rest',category:'class_resource'},
      {id:'uses_ACT-two',label:'Other action',description:'Other description',imageUrl:undefined,recharge:'long_rest',category:'character_resource'},
    ]);
    const registered={id:'uses_ACT-one',label:'Registered resource',description:'Registered definition'};
    expect(levelUpResourceOptions([registered],assembled).filter(option=>option.id==='uses_ACT-one')).toEqual([registered]);
  });
});
