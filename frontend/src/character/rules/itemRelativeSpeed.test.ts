import {describe, expect, it} from 'vitest';
import {resolveCharacterRules} from './resolveCharacterRules';
import {buildCharacterContext} from '../runtime';
import {breakdownValue} from '../../engine/breakdown';
import {emptyDraft} from '../types';
import type {AssembledCharacter} from '../assemble';
import {freshFighterState} from '../../mvp/fixtures';

type Dict=Record<string,unknown>;
const auto=(...result:Dict[])=>({activation:{mode:'passive'},effects:[{resolution:'auto',result}]});
const speed=(value:number)=>({kind:'modifier',op:'add',value,applies_to:{roll:'speed'}});
const relative=(mode:string)=>({kind:'grant_speed',mode,value:'character_speed'});
function project(item:Dict,feature:Dict=auto()) {
  const draft={...emptyDraft(),level:5};
  const assembled={race:{id:'species',name:'Species',speed:30},effects:[{effect:{id:'feature',name:'Feature',mechanics:feature},origin:{kind:'feat',id:'feat',name:'Feat'}}],actions:[],spells:[],feats:[],pendingChoices:[],derived:{},featAbilityIncreases:[]} as unknown as AssembledCharacter;
  const rules=resolveCharacterRules({draft,assembled,runtimeSources:[{source:{type:'item',id:'item',name:'Item'},mechanics:item}]});
  const context=buildCharacterContext(rules,draft,[],null);
  return {rules,context,shown:breakdownValue('speed',context,freshFighterState(),[item,feature]).value};
}
describe('item speed bonuses feed relative movement without display duplication',()=>{
  it('an item providing flight and +15 speed gives 45-foot flight and walking speed',()=>{
    const result=project(auto(relative('fly'),speed(15)));
    expect(result.rules.speeds.fly).toBe(45);
    expect(result.rules.speed).toBe(45);
    expect(result.context.characterSpeed).toBe(45);
    expect(result.context.baseSpeed).toBe(30);
    expect(result.shown).toBe(45);
  });
  it('a different +5 item reaches a separate feature climb grant and its own +10 increase',()=>{
    const result=project(auto(speed(5)),auto(relative('climb'),speed(10)));
    expect(result.rules.speeds.climb).toBe(45);
    expect(result.rules.speed).toBe(45);
    expect(result.context.baseSpeed).toBe(30);
    expect(result.shown).toBe(45);
  });
  it('an absolute movement grant stays absolute while a relative one follows a speed multiplier',()=>{
    const result=project(auto(relative('swim'),speed(5),{kind:'grant_speed',mode:'fly',value:20},{kind:'modifier',op:'multiply',value:2,applies_to:{roll:'speed'}}));
    expect(result.rules.speed).toBe(70);
    expect(result.rules.speeds).toMatchObject({swim:70,fly:20});
    expect(result.shown).toBe(70);
  });
});
