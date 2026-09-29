import {describe,expect,it} from 'vitest';
import items from '../../../scripts/content/data/item-completion-middle-20260929.json';
import related from '../../../scripts/content/data/item-completion-middle-related-20260929.json';
import {collectModifiers} from './modifiers';
import {finiteDurationRounds} from './duration';
import type {RuntimeState,TargetContext} from '../mvp/contracts';

const perfume=related.entities.find(entry=>entry.card_number==='EFFECT-item-perfume-check');
if(!perfume)throw Error('Missing perfume effect');
const effect=perfume.patch.mechanics as Record<string,unknown>;
const state:RuntimeState={hp:{current:10,max:10,temp:0},resources:{},maxResources:{},inventory:[],equipment:{},activeEffects:[
  {id:'perfume',name:'Perfume',source:'item',mechanics:effect,roundsLeft:finiteDurationRounds(effect.duration as Record<string,unknown>)}
]};
const target=(type:string,relation:TargetContext['relationToSource']):TargetContext=>({relationToSource:relation,characterContext:{creatureType:type} as TargetContext['characterContext']});
const grants=(skill:string,subject:TargetContext)=>collectModifiers(state,[],{roll:'ability_check',filter:{skill},evalCtx:{state,target:subject}}).hasAdvantage;

describe('item-origin timed persuasion circumstances',()=>{
 it('charges an action and grants exactly one hour, with no next-roll consumption',()=>{
  const action=items['CARD-0696'].mechanics as Record<string,unknown>;
  expect((action.activation as {cost:{resource:string}[]}).cost).toEqual([{resource:'action'}]);
  expect(state.activeEffects[0].roundsLeft).toBe(600);
  expect(effect).not.toHaveProperty('consume');
 });
 it('uses target facts for two distinct condition declarations and fails closed when unknown',()=>{
  expect(grants('persuasion',target('humanoid','neutral'))).toBe(true);
  expect(grants('persuasion',target('humanoid','enemy'))).toBe(false);
  expect(grants('persuasion',target('beast','neutral'))).toBe(false);
  expect(grants('deception',target('humanoid','neutral'))).toBe(false);
  expect(grants('persuasion',{})).toBe(false);
  const other:RuntimeState={...state,activeEffects:[{...state.activeEffects[0],id:'other',mechanics:{...effect,
   applies_to:{roll:'ability_check',filter:{skill:'deception'}},when:[{kind:'target_creature_type_in',values:['beast']},{kind:'target_relation_in',values:['enemy']}]}}]};
  const result=collectModifiers(other,[],{roll:'ability_check',filter:{skill:'deception'},evalCtx:{state:other,target:target('beast','enemy')}});
  expect(result.hasAdvantage).toBe(true);
 });
});
