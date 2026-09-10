import {describe,it,expect} from 'vitest';
import {dropHeldItem,heldItemDropIssue} from './heldItemDrop';
import type {RuntimeState,CharacterContext} from '../mvp/contracts';
import {CARD_LONGSWORD} from '../mvp/fixtures';

const runtime=():RuntimeState=>({hp:{current:10,max:10,temp:0},resources:{},maxResources:{},activeEffects:[],equipment:{main_hand:CARD_LONGSWORD.id},inventory:[{cardId:CARD_LONGSWORD.id,qty:2},{cardId:CARD_LONGSWORD.id,qty:3,containerId:'bag'}]});
const character:CharacterContext={abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},profBonus:2,level:1,knownCards:[CARD_LONGSWORD]};
describe('physical held-item removal',()=>{
 it('drops the equipped copy and preserves bag contents and the input',()=>{
  const before=runtime(),saved=JSON.stringify(before);const next=dropHeldItem(before,'main_hand','owner',character);
  expect(JSON.stringify(before)).toBe(saved);expect(next.state.inventory).toEqual([{cardId:CARD_LONGSWORD.id,qty:2},{cardId:CARD_LONGSWORD.id,qty:3,containerId:'bag'}]);
  expect(next.state.equipment.main_hand).toBeNull();expect(next.events[0]).toMatchObject({type:'world_interaction',operation:'drop_held_item',parameters:{ownerActorId:'owner',hand:'main_hand',cardId:CARD_LONGSWORD.id}});
 });
 it('clears both grips of a two-handed object, but not a second one-handed copy',()=>{
  const state=runtime();state.equipment.off_hand=CARD_LONGSWORD.id;
  expect(dropHeldItem(state,'main_hand','owner',character).state.equipment.off_hand).toBe(CARD_LONGSWORD.id);
  const twoHanded:CharacterContext={...character,knownCards:[{...CARD_LONGSWORD,slot:'two_hands'}]};
  expect(dropHeldItem(state,'main_hand','owner',twoHanded).state.equipment.off_hand).toBeNull();
 });
 it('rejects a stale held reference backed only by an item inside a container',()=>{
  const state=runtime();state.inventory=state.inventory.filter(row=>row.containerId);expect(heldItemDropIssue(state,'main_hand')).toBeNull();
  expect(dropHeldItem(state,'main_hand','owner',character).state.equipment.main_hand).toBeNull();
 });
});
