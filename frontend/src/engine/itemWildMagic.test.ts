import {describe,expect,it} from 'vitest';
import items from '../../../scripts/content/data/item-completion-middle-20260929.json';
import {executeAction} from './execute';
import type {CharacterContext,RuntimeState} from '../mvp/contracts';

type Dict=Record<string,unknown>;
const ring=items['CARD-0641'].mechanics as Dict;
const character:CharacterContext={abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},profBonus:2,level:2};
const state=():RuntimeState=>({hp:{current:10,max:10,temp:0},resources:{},maxResources:{},inventory:[],equipment:{},activeEffects:[]});
const spell={activation:{mode:'active',cost:[]},effects:[{resolution:'auto',result:[]}]};
const listen=(mechanics:Dict,id='source')=>({id,name:id,...mechanics});

describe('source-owned arbitrary die rolls after spell casting',()=>{
 it('always records one d100 for a cantrip or leveled spell, without a d20 gate',()=>{
  for(const baseLevel of [0,3]){
   let draws=0;
   const result=executeAction(state(),spell,{character,selfId:'caster',spell:{baseLevel},
    passives:[listen(ring,'wild-ring')],rng:()=>{draws++;return .42;}});
   const dice=result.events.filter(event=>event.type==='roll'&&event.roll.dice[0]?.sides===100);
   expect(dice).toHaveLength(1);
   expect(dice[0]).toMatchObject({type:'roll',roll:{total:43,dice:[{sides:100,result:43}]}});
   expect(draws).toBe(1);
  }
 });
 it('does not roll on a mundane action and serves a distinct d8 source',()=>{
  const noSpell=executeAction(state(),spell,{character,selfId:'caster',passives:[listen(ring,'wild-ring')],rng:()=>{throw Error('No die expected');}});
  expect(noSpell.events.some(event=>event.type==='roll')).toBe(false);
  const other:Dict={activation:{mode:'passive'},effects:[{resolution:'auto',result:[{
   kind:'triggered_effect',id:'alternate-spell-die',event:'spell_cast',subject:'self',duration:{type:'while_active'},
   effects:[{resolution:'auto',who:'self',result:[{kind:'roll_die',sides:8,label:'Other spell die'}]}]
  }]}]};
  const result=executeAction(state(),spell,{character,selfId:'caster',spell:{baseLevel:1},passives:[listen(other)],rng:()=>0});
  expect(result.events.find(event=>event.type==='roll')).toMatchObject({type:'roll',roll:{total:1,dice:[{sides:8,result:1}]}});
 });
 it('rejects malformed die data before committing a spell outcome',()=>{
  const invalid=structuredClone(ring);
  const listener=(invalid.effects as Dict[])[0].result as Dict[];
  const nested=((listener[0].effects as Dict[])[0].result as Dict[])[0];
  nested.sides=1;
  expect(()=>executeAction(state(),spell,{character,selfId:'caster',spell:{baseLevel:1},
   passives:[listen(invalid)],rng:()=>{throw Error('Invalid die must not roll');}})).toThrow(/roll_die/);
 });
});
