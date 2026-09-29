import {describe,expect,it} from 'vitest';
import related from '../../../scripts/content/data/item-completion-middle-related-20260929.json';
import {executeAction} from './execute';
import type {CharacterContext,RuntimeState} from '../mvp/contracts';
import type {Card} from '../types';

const action=related.entities.find(row=>row.card_number==='ACT-item-completion-0413');
if(!action)throw Error('Missing marked deck action');
const base=action.patch.mechanics as Record<string,unknown>;
const ownerState=(id:string):RuntimeState=>({hp:{current:15,max:15,temp:0},resources:{},maxResources:{},inventory:[{cardId:id,qty:1}],equipment:{},activeEffects:[]});
const character=(id:string,int:number,wis:number,skills:string[]):CharacterContext=>({abilityMods:{str:0,dex:0,con:0,int,wis,cha:0},profBonus:2,level:2,
 knownCards:[{id,name:'Cards',type:'other',mechanics:{activation:{mode:'passive',while:'carried'}}} as unknown as Card],
 skillProficiencies:skills});

describe('observer-owned ability checks',()=>{
 it.each([
  {ownerInt:5,targetInt:-1,targetSkills:[],roll:.45,revealed:false},
  {ownerInt:-2,targetInt:4,targetSkills:['investigation'],roll:.45,revealed:true},
 ])('uses observer Intelligence and training, never the cheater’s bonus: %j',row=>{
  const itemId=String(base.requires_item_source),state=ownerState(itemId),target=ownerState('observer-item');
  const result=executeAction(state,base,{selfId:'cheater',character:character(itemId,row.ownerInt,0,[]),
   target:{id:'observer',runtimeState:target,characterContext:character('observer-item',row.targetInt,0,row.targetSkills)},rng:()=>row.roll});
  const roll=result.events.find(event=>event.type==='roll');
  expect(roll).toMatchObject({type:'roll',label:'Проверка (investigation)'});
  expect(result.events.some(event=>event.type==='world_interaction'&&event.operation==='reveal_information'
   &&event.parameters.targetActorId==='observer')).toBe(row.revealed);
  expect(state.inventory).toEqual([{cardId:itemId,qty:1}]);
 });
 it('runs another data declaration with a different observer ability, skill, and DC',()=>{
  const itemId='other-deck',mechanics=structuredClone(base);
  mechanics.requires_item_source=itemId;
  const effect=(mechanics.effects as Record<string,unknown>[])[0];
  effect.ability='wis';effect.skill='perception';effect.dc=14;
  const result=executeAction(ownerState(itemId),mechanics,{selfId:'owner',character:character(itemId,5,0,[]),
   target:{id:'witness',runtimeState:ownerState('witness'),characterContext:character('witness',-2,3,['perception'])},rng:()=>.45});
  expect(result.events).toContainEqual(expect.objectContaining({type:'world_interaction',operation:'reveal_information'}));
 });
});
