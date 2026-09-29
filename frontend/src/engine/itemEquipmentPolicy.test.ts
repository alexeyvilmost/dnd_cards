import {describe,it,expect} from 'vitest';
import {itemEquipmentChangeIssue} from './itemEquipmentPolicy';
import {dropHeldItem} from './heldItemDrop';
import {CARD_LONGSWORD,equippedFighterState,FIGHTER_CTX_EQUIPPED} from '../mvp/fixtures';
describe('catalog item equipment restrictions',()=>{
 it.each(['ring_1','boots'])('forbids removing/replacing %s, including moving it into another slot',slot=>{
  const card={...CARD_LONGSWORD,id:'curse-'+slot,name:'Curse '+slot,mechanics:{effects:[{resolution:'auto',result:[{kind:'equipment_policy',cannot_remove:true}]}]}};
  const before={equipment:{[slot]:card.id}};
  expect(itemEquipmentChangeIssue(before,{equipment:{}},[card])).toContain(card.name);
  expect(itemEquipmentChangeIssue(before,{equipment:{[slot]:'replacement'}},[card])).toContain(card.name);
  expect(itemEquipmentChangeIssue(before,{equipment:{[slot]:card.id,head:'new-helmet'}},[card])).toBeNull();
  expect(itemEquipmentChangeIssue({equipment:{}},before,[card])).toBeNull();
 });
 it.each(['main_hand','off_hand'] as const)('disarm protects only the declared weapon in %s',hand=>{
  const state=equippedFighterState();state.equipment={main_hand:'weapon-a',off_hand:'weapon-b'};
  const other=hand==='main_hand'?'off_hand':'main_hand';const policy={kind:'equipment_policy',cannot_be_disarmed:true,weapon_id:state.equipment[hand]};
  expect(dropHeldItem(state,hand,'owner',FIGHTER_CTX_EQUIPPED,{forced:true,passives:[policy]}).state).toBe(state);
  expect(dropHeldItem(state,other,'owner',FIGHTER_CTX_EQUIPPED,{forced:true,passives:[policy]}).state.equipment[other]).toBeNull();
  expect(dropHeldItem(state,hand,'owner',FIGHTER_CTX_EQUIPPED,{forced:false,passives:[policy]}).state.equipment[hand]).toBeNull();
 });
});
