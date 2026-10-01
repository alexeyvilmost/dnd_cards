import {describe,it,expect} from 'vitest';
import fixtureJson from './pinnedFighter.fixture.json';
import type {ForgeCharacter} from '../character/types';
import type {FrozenCombatCatalog} from './combatCatalog';
import {prepareRoguelikeCombatParticipant} from './combatCatalog';
import {projectRoguelikeCampInventory} from './campInventory';
import {unequipToInventory} from '../character/inventory';
import {forgeToRuntimeState,runtimeInventoryPayload} from '../character/runtime';

const fixture=fixtureJson as unknown as {character:ForgeCharacter;catalog:FrozenCombatCatalog;basicActionIds:string[]};
function input(){const value=structuredClone(fixture);value.character.turn_state={};return value;}
describe('canonical camp inventory projection',()=>{
 it.each([['qa-equipment-charges',3,'equipped'],['qa-carried-focus',5,'carried']] as const)('removes %s grants when its last physical copy is sold',async(key,amount,whileMode)=>{
  const request=input(),card=structuredClone(request.catalog.entities.card[0]);
  card.id='a2550000-0000-4000-8000-000000000042';card.card_number='QA-item-resource';card.name='Resource item';card.requires_attunement=true;
  const action=structuredClone(request.catalog.entities.action[0]);action.id='a2550000-0000-4000-8000-000000000043';action.card_number='QA-item-action';action.name='Item-owned action';
  action.mechanics={activation:{mode:'active',cost:[{resource:key}]},targeting:{shape:'self'},effects:[{resolution:'auto',result:[{kind:'narrative',description:'item action'}]}]};
  request.catalog.entities.action.push(action);
  card.mechanics={activation:{mode:'passive',while:whileMode},effects:[{resolution:'auto',result:[{kind:'resource',op:'grant',id:key,amount},{kind:'grant_action',value:action.id}]}]};
  request.catalog.entities.card.push(card);
  request.character.equipment={...request.character.equipment,main_hand:card.id,off_hand:card.id};
  request.character.turn_state={attuned_ids:[card.id]};request.character.resources={...request.character.resources,[key]:1};request.character.max_resources={...request.character.max_resources,[key]:amount};
  const untouched=structuredClone(request),before=await prepareRoguelikeCombatParticipant(request.character,request.catalog,request.basicActionIds);
  expect(before.status).toBe('ready');if(before.status!=='ready')return;
  expect(before.participant.canonical.actions.some(entry=>entry.sourceEntityIds.includes(action.id))).toBe(true);
  const result=await projectRoguelikeCampInventory({...request,sale:{cardId:card.id,quantity:1}});
  expect(result.status).toBe('ready');if(result.status!=='ready')return;
  expect(result.patch.equipment.main_hand).toBeNull();expect(result.patch.equipment.off_hand).toBeNull();
  expect(result.patch.inventory_items.some(row=>row.card_id===card.id)).toBe(false);
  expect(result.patch.turn_state.attuned_ids).toEqual([]);
  expect(result.patch.max_resources[key]??0).toBe(0);expect(result.patch.resources[key]??0).toBe(0);
  const rebuilt=await prepareRoguelikeCombatParticipant({...request.character,...result.patch},request.catalog,request.basicActionIds);
  expect(rebuilt.status).toBe('ready');if(rebuilt.status!=='ready')return;
  expect(rebuilt.participant.canonical.actions.some(entry=>entry.sourceEntityIds.includes(action.id))).toBe(false);
  expect(result.patch.resources['uses_ACT-second-wind']).toBe(request.character.resources!['uses_ACT-second-wind']);
  expect(request).toEqual(untouched);
 });
 it('retains attunement and spent charges when a carried stack still has another copy',async()=>{
  const request=input(),card=structuredClone(request.catalog.entities.card[0]);card.id='a2550000-0000-4000-8000-000000000044';card.card_number='QA-stack';card.requires_attunement=true;
  card.mechanics={activation:{mode:'passive',while:'carried'},effects:[{resolution:'auto',result:[{kind:'resource',op:'grant',id:'qa_stack_pool',amount:5}]}]};request.catalog.entities.card.push(card);
  request.character.inventory_items=[{card_id:card.id,qty:3}];request.character.turn_state={attuned_ids:[card.id]};request.character.resources={...request.character.resources,qa_stack_pool:1};request.character.max_resources={...request.character.max_resources,qa_stack_pool:5};
  const result=await projectRoguelikeCampInventory({...request,sale:{cardId:card.id,quantity:2}});expect(result.status).toBe('ready');if(result.status!=='ready')return;
  expect(result.patch.inventory_items).toEqual([{card_id:card.id,qty:1}]);expect(result.patch.turn_state.attuned_ids).toEqual([card.id]);expect(result.patch.resources.qa_stack_pool).toBe(1);expect(result.patch.max_resources.qa_stack_pool).toBe(5);
 });
 it('projects unequipping from the owned snapshot without restoring spent class resources',async()=>{
  const request=input();request.character.resources!['uses_ACT-second-wind']=0;
  const card=request.catalog.entities.card.find(row=>row.type==='weapon')??request.catalog.entities.card[0];request.character.equipment={...request.character.equipment,main_hand:card.id,off_hand:null};
  const moved=unequipToInventory(forgeToRuntimeState(request.character),'main_hand');
  const result=await projectRoguelikeCampInventory({...request,placement:{equipment:moved.equipment,inventoryItems:runtimeInventoryPayload(moved)}});
  expect(result.status).toBe('ready');if(result.status!=='ready')return;
  expect(result.patch.resources['uses_ACT-second-wind']).toBe(0);expect(result.patch.resources.hit_dice_d10).toBe(request.character.resources!.hit_dice_d10);
  expect(result.patch.equipment.main_hand).toBeNull();
  const world=result.patch.turn_state.canonical_rules_world_v1 as {world:{actors:Record<string,{runtime:{equipment:Record<string,string|null>}}>}};expect(world.world.actors[request.character.id].runtime.equipment.main_hand).toBeNull();
 });
 it('rejects overselling and nonempty containers and reports missing catalog without mutations',async()=>{
  const request=input(),cardId=request.catalog.entities.card[0].id,original=structuredClone(request);
  await expect(projectRoguelikeCampInventory({...request,sale:{cardId,quantity:10000}})).rejects.toThrow('количестве');
  request.character.inventory_items=[{card_id:cardId,qty:1},{card_id:request.catalog.entities.card[1]?.id??'inner',qty:1,container_id:cardId}];
  await expect(projectRoguelikeCampInventory({...request,sale:{cardId,quantity:1}})).rejects.toThrow('контейнер');
  const missing=structuredClone(original);missing.catalog.entities.class=[];expect((await projectRoguelikeCampInventory(missing)).status).toBe('needs_content');
 });
 it('cannot sell an equipped item whose own mechanic forbids removal',async()=>{
  const request=input(),card=structuredClone(request.catalog.entities.card[0]);card.id='a2550000-0000-4000-8000-000000000045';card.card_number='QA-item-cursed';card.name='Cursed item';
  card.mechanics={activation:{mode:'passive',while:'equipped'},effects:[{resolution:'auto',result:[{kind:'equipment_policy',cannot_remove:true}]}]};request.catalog.entities.card.push(card);
  request.character.equipment={...request.character.equipment,main_hand:card.id,off_hand:null};
  const before=structuredClone(request);await expect(projectRoguelikeCampInventory({...request,sale:{cardId:card.id,quantity:1}})).rejects.toThrow('Нельзя снять');expect(request).toEqual(before);
 });
});
