import {describe,expect,it,vi} from 'vitest';
import related from '../../../scripts/content/data/item-completion-high-related-20260929.json';
import cards from '../testing/fixtures/item-catalog.cards.json';
import completion from '../../../scripts/content/data/item-completion-high-20260929.json';
import {bindSelfItemCost} from './cost';
import {executeAction} from './execute';
import {breakdownValue} from './breakdown';
import type {CharacterContext,RuntimeState} from '../mvp/contracts';
import type {Card} from '../types';

const scar=related.entities.find(entry=>entry.card_number==='ACT-item-completion-high-918-accept-scar');
if(!scar)throw Error('Scar action missing');
const owner=String(scar.patch.mechanics?.requires_item_source??'');
if(!owner)throw Error('Scar owner missing');
const mechanics=bindSelfItemCost(scar.patch.mechanics as Record<string,unknown>,owner);
const initial=():RuntimeState=>({hp:{current:26,max:30,temp:0},resources:{},maxResources:{},
 inventory:[{cardId:owner,qty:1}],equipment:{},activeEffects:[]});
const character:CharacterContext={abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},profBonus:2,level:4,hitDie:'d8',
 knownCards:[{...cards.find(card=>card.id===owner)!,mechanics:completion['CARD-0918'].mechanics} as unknown as Card]};

describe('permanent rolled item sacrifices',()=>{
 it('rolls three dice once, commits the exact penalty, clamps current HP and consumes the card',()=>{
  const rng=vi.fn(()=>0.5);
  const committed=executeAction(initial(),mechanics,{selfId:'hero',character,rng});
  expect(rng).toHaveBeenCalledTimes(3);
  expect(committed.state.inventory).toEqual([]);
  expect(committed.state.hp).toEqual({current:18,max:18,temp:0});
  const saved=JSON.parse(JSON.stringify(committed.state)) as RuntimeState;
  expect(saved.activeEffects[0].mechanics).toMatchObject({kind:'modifier',value:-12,applies_to:{roll:'max_hp'}});
  expect(breakdownValue('max_hp',character,saved,[]).parts).toEqual(expect.arrayContaining([expect.objectContaining({value:-12})]));
  expect(()=>executeAction(saved,mechanics,{selfId:'hero',character,rng})).toThrow();
  expect(rng).toHaveBeenCalledTimes(3);
 });
 it('uses the same once-rolled maximum-HP operation for a different benefit',()=>{
  const boon={activation:{mode:'active',cost:[]},effects:[{resolution:'auto',who:'self',result:[
   {kind:'modifier',op:'add',value:'1d4',value_timing:'on_apply',applies_to:{roll:'max_hp'},duration:{type:'manual'}}
  ]}]};
  const rng=vi.fn(()=>0);
  const result=executeAction(initial(),boon,{selfId:'hero',character,rng});
  expect(result.state.hp).toEqual({current:26,max:31,temp:0});
  expect(result.state.activeEffects[0].mechanics).toMatchObject({kind:'modifier',value:1});
  expect(rng).toHaveBeenCalledTimes(1);
 });
});
