import {describe,expect,it} from 'vitest';
import items from '../../../scripts/content/data/item-completion-high-20260929.json';
import {collectItemMechanics} from '../character/attunement';
import {liftingCapacity} from './physicalCapacity';
import type {Card} from '../types';
import type {RuntimeState} from '../mvp/contracts';

const pulley={id:'pulley',name:'Block and tackle',type:'other',mechanics:items['CARD-0715'].mechanics} as unknown as Card;
const other={id:'other-lift',name:'Other tool',type:'other',mechanics:{activation:{mode:'passive',while:'carried'},effects:[{resolution:'auto',result:[
 {kind:'modifier',op:'multiply',value:2,applies_to:{roll:'lift_capacity'}}]}]}} as unknown as Card;
const cards=new Map([[pulley.id,pulley],[other.id,other]]);
const state=(inventory:string[]):RuntimeState=>({hp:{current:10,max:10,temp:0},resources:{},maxResources:{},equipment:{},
 inventory:inventory.map(cardId=>({cardId,qty:1})),activeEffects:[]});
const limit=(inventory:string[])=>{
 const runtime=state(inventory);
 return liftingCapacity(150,runtime,collectItemMechanics(runtime.equipment,cards,{},runtime.inventory).map(row=>row.mechanics));
};
describe('data-owned lifting tools',()=>{
 it('separates the fourfold lift limit from carried inventory weight',()=>{
  expect(limit([])).toBe(300);
  expect(limit(['pulley'])).toBe(1200);
  expect(limit(['other-lift'])).toBe(600);
 });
 it('revokes the limit when the source item is removed',()=>{
  const before=limit(['pulley']);
  expect(before).toBe(1200);
  expect(limit([])).toBe(300);
 });
});
