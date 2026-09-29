import {describe,expect,it} from 'vitest';
import items from '../../../scripts/content/data/item-completion-high-20260929.json';
import {applyGeneralSpellFeatActionRules} from './generalSpellFeatRuntime';
import type {RuleActionDefinition} from './domain';

const grimoire=items['CARD-0935'].mechanics as Record<string,unknown>;
const passives=[grimoire];
const spell=(id:string,distance:number|string,targetRange:number):RuleActionDefinition=>({
 id,name:id,kind:'spell',spell:{level:2},sourceEntityIds:[id],
 targeting:{rangeFt:targetRange,minTargets:0,maxTargets:1,requiresLineOfSight:false,allowedRelations:['self','ally']},
 mechanics:{activation:{mode:'active',cost:[{resource:'action'}]},targeting:{shape:targetRange?'single':'self',range_ft:targetRange},
  effects:[{resolution:'auto',result:[{kind:'movement',value:'teleport',distance}]}]}
});
const range=(action:RuleActionDefinition)=>((action.mechanics.effects as {result:{distance:number}[]}[])[0].result[0].distance);

describe('data-owned spell teleport range',()=>{
 it('extends two different spell profiles and leaves catalog originals untouched',()=>{
  const self=spell('self-step',30,0),target=spell('target-step','15',30);
  const extendedSelf=applyGeneralSpellFeatActionRules(self,passives);
  const extendedTarget=applyGeneralSpellFeatActionRules(target,passives);
  expect(range(extendedSelf)).toBe(45);
  expect(extendedSelf.targeting?.rangeFt).toBe(0);
  expect(range(extendedTarget)).toBe(30);
  expect(extendedTarget.targeting?.rangeFt).toBe(45);
  expect((extendedTarget.mechanics.targeting as {range_ft:number}).range_ft).toBe(45);
  expect(range(self)).toBe(30);
  expect(range(target)).toBe('15');
 });
 it('does not extend non-spells or ordinary movement',()=>{
  const action=spell('dash',30,5);
  const {spell:_,...notSpell}=action;
  const nonSpell={...notSpell,kind:'nonSpell' as const};
  expect(applyGeneralSpellFeatActionRules(nonSpell,passives)).toEqual(nonSpell);
  const walk=structuredClone(action);
  (walk.mechanics.effects as {result:{value:string}[]}[])[0].result[0].value='move';
  expect(applyGeneralSpellFeatActionRules(walk,passives)).toEqual(walk);
 });
});
