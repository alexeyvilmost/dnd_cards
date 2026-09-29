import {describe,expect,it} from 'vitest';
import related from '../../../scripts/content/data/item-completion-high-related-20260929.json';
import completion from '../../../scripts/content/data/item-completion-high-20260929.json';
import cards from '../../../outputs/catalog-completion-20260929/cards.json';
import {executeAction} from './execute';
import {activeConditionsOf} from './circumstances';
import {collectModifiers} from './modifiers';
import {equippedFighterState,FIGHTER_CTX_EQUIPPED} from '../mvp/fixtures';
import type {Card} from '../types';

const card=cards.find(row=>row.card_number==='CARD-0922')!;
const mechanics=(suffix:string)=>related.entities.find(row=>row.card_number===`ACT-item-completion-high-922-${suffix}`)!.patch.mechanics!;
const character={...FIGHTER_CTX_EQUIPPED,knownCards:[...(FIGHTER_CTX_EQUIPPED.knownCards??[]),
 {...card,mechanics:completion['CARD-0922'].mechanics} as unknown as Card]};
const deafened={id:'original-deafness',name:'Deafened',source:'Spell',mechanics:{kind:'condition',value:'deafened'},roundsLeft:10};

describe('held horn suppresses rather than erases deafness',()=>{
 it('masks an existing condition while held to the ear, then restores the same source and duration',()=>{
  const state=equippedFighterState();state.equipment.off_hand=card.id;state.activeEffects.push(deafened);
  expect(collectModifiers(state,[],{roll:'ability_check',filter:{sense:'hearing'}}).autoFail).toBe(true);
  const raised=executeAction(state,mechanics('raise'),{selfId:'hero',character,rng:()=>{throw Error('No roll');}}).state;
  expect(raised.activeEffects.find(effect=>effect.id===deafened.id)?.roundsLeft).toBe(10);
  expect(activeConditionsOf(raised).has('deafened')).toBe(false);
  expect(collectModifiers(raised,[],{roll:'ability_check',filter:{sense:'hearing'}}).autoFail).toBe(false);
  const blocked=executeAction(raised,{effects:[{resolution:'auto',who:'self',result:[{kind:'condition',op:'apply',value:'deafened'}]}]},
   {selfId:'hero',character,rng:()=>{throw Error('No roll');}}).state;
  expect(blocked.activeEffects.filter(effect=>(effect.mechanics as Record<string,unknown>).value==='deafened')).toHaveLength(1);
  const dropped={...raised,equipment:{...raised.equipment,off_hand:null}};
  expect(activeConditionsOf(dropped).has('deafened')).toBe(true);
  expect(collectModifiers(dropped,[],{roll:'ability_check',filter:{sense:'hearing'}}).autoFail).toBe(true);
  const lowered=executeAction(raised,mechanics('lower'),{selfId:'hero',character,rng:()=>0}).state;
  expect(activeConditionsOf(lowered).has('deafened')).toBe(true);
  expect(lowered.activeEffects.find(effect=>effect.id===deafened.id)?.roundsLeft).toBe(10);
 });
 it('a second suppression rule works for a different condition without erasing it',()=>{
  const state=equippedFighterState();state.equipment.main_hand='ward';state.activeEffects=[
   {id:'fear',name:'Fear',source:'Spell',mechanics:{kind:'condition',value:'frightened'},roundsLeft:3},
   {id:'ward',name:'Ward',source:'Item',mechanics:{kind:'condition_immunity',condition:'frightened',suppress_existing:true,requires_equipped_item_id:'ward',duration:{type:'manual'}}}
  ];
  expect(activeConditionsOf(state).has('frightened')).toBe(false);
  expect(activeConditionsOf({...state,equipment:{}}).has('frightened')).toBe(true);
  expect(state.activeEffects[0].roundsLeft).toBe(3);
 });
});
