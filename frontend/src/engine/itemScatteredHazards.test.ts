import {describe,expect,it} from 'vitest';
import items from '../../../scripts/content/data/item-completion-high-20260929.json';
import cards from '../testing/fixtures/item-catalog.cards.json';
import {bindSelfItemCost} from './cost';
import {executeAction} from './execute';
import {worldZonePayload} from '../solo-combat/combatAreas';
import type {RuleActionDefinition} from '../rules-core/domain';
import type {CharacterContext,RuntimeState} from '../mvp/contracts';
import type {Card} from '../types';

const source=cards.find(row=>row.card_number==='CARD-0799');
if(!source)throw Error('Ball bearings source missing');
const item={...source,mechanics:items['CARD-0799'].mechanics} as unknown as Card;
const state=():RuntimeState=>({hp:{current:12,max:12,temp:0},resources:{action:1},maxResources:{action:1},
 inventory:[{cardId:item.id,qty:1}],equipment:{},activeEffects:[]});
const character:CharacterContext={abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},profBonus:2,level:1,knownCards:[item]};

describe('deployed mundane hazards from item declarations',()=>{
 it('consumes the physical bag once and persists its 10-foot save zone',()=>{
  const mechanics=bindSelfItemCost(item.mechanics!,item.id);
  const action:RuleActionDefinition={id:'bearings',name:'Ball bearings',kind:'nonSpell',sourceEntityIds:[item.id],mechanics,
   targeting:{minTargets:0,maxTargets:0,rangeFt:5,requiresLineOfSight:true,allowedRelations:[]}};
  const zone=worldZonePayload(action)!;
  expect(zone.geometry).toEqual({shape:'cube',size_ft:10});
  expect(zone.tactical).toMatchObject({save:{ability:'dex',dc:10},triggers:['enter'],on_failure:[{kind:'condition',value:'prone'}]});
  const result=executeAction(state(),mechanics,{selfId:'hero',character,rng:()=>{throw Error('No roll during deployment');}});
  expect(result.state.resources.action).toBe(0);
  expect(result.state.inventory).toEqual([]);
  expect(result.state.activeEffects.some(entry=>(entry.mechanics as Record<string,unknown>).kind==='world_zone')).toBe(true);
  expect(()=>executeAction(result.state,mechanics,{selfId:'hero',character,rng:()=>0})).toThrow();
 });
 it('keeps a second item’s narrower damaging zone data independent',()=>{
  const otherSource=cards.find(row=>row.card_number==='CARD-0790')!;
  const otherMechanics=bindSelfItemCost(items['CARD-0790'].mechanics as RuleActionDefinition['mechanics'],otherSource.id);
  const other:RuleActionDefinition={id:'caltrops',name:'Caltrops',kind:'nonSpell',sourceEntityIds:[otherSource.id],mechanics:otherMechanics};
  const zone=worldZonePayload(other)!;
  expect(zone).toMatchObject({zone_type:'caltrops',geometry:{size_ft:5},tactical:{save:{dc:15}}});
  expect((zone.tactical as {on_failure:unknown[]}).on_failure).toEqual(expect.arrayContaining([
   expect.objectContaining({kind:'damage',type:'piercing'}),
   expect.objectContaining({kind:'grant_effect',value:'EFFECT-item-caltrops-speed'})]));
  const result=executeAction({...state(),inventory:[{cardId:otherSource.id,qty:1}]},otherMechanics,
   {selfId:'hero',character:{...character,knownCards:[otherSource as unknown as Card]},rng:()=>{throw Error('No deployment roll');}});
  expect(result.state.inventory).toEqual([]);
  expect(result.state.resources.action).toBe(0);
 });
});
