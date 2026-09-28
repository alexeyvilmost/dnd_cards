import {describe, expect, it} from 'vitest';
import {applyIncomingDamage} from './execute';
import {FIGHTER_CTX, freshFighterState} from '../mvp/fixtures';
import type {ExecuteContext} from '../mvp/contracts';

const state = () => ({...freshFighterState(),hp:{current:50,max:50,temp:0},equipment:{head:'item:first',body:'item:second'}});
const first = {id:'effect:first',name:'First entity',sourceEntityIds:['item:first'],activation:{mode:'passive'},effects:[{resolution:'auto',result:[{
  kind:'reduce_damage',amount:'1',filter:{source:'attack',damage_types:['bludgeoning']},when:[{kind:'item_equipped',id:'item:first'}],
}]}]};
const second = {id:'effect:second',name:'Second entity',sourceEntityIds:['item:second'],activation:{mode:'passive'},effects:[{resolution:'auto',result:[{
  kind:'reduce_damage',amount:'4',when:[{kind:'item_equipped',id:'item:second'}],
}]}]};
function ctx(passives:Record<string,unknown>[]=[first,second]):ExecuteContext {return {character:FIGHTER_CTX,passives,rng:()=>{throw new Error('A static reduction must not roll');}};}
describe('data-owned static incoming damage reductions', () => {
  it.each(['d6','prof_bonus d6'])('rejects hidden dice in %s without consuming the damage command RNG',amount=>{
    let calls=0;
    const context={...ctx([{id:`invalid:${amount}`,kind:'reduce_damage',amount}]),rng:()=>{calls++;return 0.5;}};
    const result=applyIncomingDamage(state(),12,context,{damageType:'fire',delivery:'other'});
    expect(result.state.hp.current).toBe(38);expect(calls).toBe(0);
    expect(result.events.some(e=>e.type==='damage_reduction')).toBe(false);
  });
  it('applies two critical-only declarations solely to critical attack packets',()=>{
    for(const amount of [1,2]){
      const passive={id:`helm-${amount}`,effects:[{resolution:'auto',result:[{kind:'reduce_damage',amount,filter:{source:'attack',critical:true}}]}]};
      expect(applyIncomingDamage(state(),10,ctx([passive]),{damageType:'piercing',delivery:'attack',crit:true}).state.hp.current).toBe(40+amount);
      expect(applyIncomingDamage(state(),10,ctx([passive]),{damageType:'piercing',delivery:'attack',crit:false}).state.hp.current).toBe(40);
      expect(applyIncomingDamage(state(),10,ctx([passive]),{damageType:'piercing',delivery:'other',crit:true}).state.hp.current).toBe(40);
    }
  });
  it('combines two unrelated entities with different scopes and keeps source provenance', () => {
    const result=applyIncomingDamage(state(),12,ctx(),{damageType:'bludgeoning',delivery:'attack'});
    expect(result.state.hp.current).toBe(43);
    expect(result.events.filter(e=>e.type==='damage_reduction')).toEqual([
      {type:'damage_reduction',amount:1,source:'First entity',sourceEntityIds:['item:first','effect:first']},
      {type:'damage_reduction',amount:4,source:'Second entity',sourceEntityIds:['item:second','effect:second']},
    ]);
    expect(applyIncomingDamage(state(),12,ctx(),{damageType:'fire',delivery:'attack'}).state.hp.current).toBe(42);
    expect(applyIncomingDamage(state(),12,ctx(),{damageType:'bludgeoning',delivery:'other'}).state.hp.current).toBe(42);
  });
  it('honors equipment, damage-source filters and unknown predicates without making a broad fallback', () => {
    expect(applyIncomingDamage({...state(),equipment:{}},12,ctx(),{damageType:'bludgeoning',delivery:'attack'}).state.hp.current).toBe(38);
    const passive={kind:'reduce_damage',amount:5,filter:{source:'other'}};
    expect(applyIncomingDamage(state(),12,ctx([passive]),{damageType:'cold',delivery:'other'}).state.hp.current).toBe(43);
    expect(applyIncomingDamage(state(),12,ctx([passive]),{damageType:'cold',delivery:'attack'}).state.hp.current).toBe(38);
    for(const bad of [{...passive,when:[{kind:'unimplemented'}]}, {...passive,filter:{unknown:true}}, {...passive,filter:{source:'wrong'}}, {...passive,when:{}}, {...passive,amount:'1d6'}]) {
      expect(applyIncomingDamage(state(),12,ctx([bad]),{damageType:'cold',delivery:'other'}).state.hp.current).toBe(38);
    }
  });
  it('uses an authoritative ability score, never its modifier or a user-supplied variable', () => {
    const passive={id:'third',kind:'reduce_damage',amount:'wis_score',filter:{damage_types:['psychic']}};
    const context={...ctx([passive]),character:{...FIGHTER_CTX,abilityScores:{str:10,dex:10,con:10,int:10,wis:18,cha:10},abilityMods:{...FIGHTER_CTX.abilityMods,wis:4},variables:{wis_score:99}}};
    expect(applyIncomingDamage(state(),20,context,{damageType:'psychic'}).state.hp.current).toBe(48);
    expect(applyIncomingDamage(state(),20,{...context,character:{...context.character,abilityScores:undefined}},{damageType:'psychic'}).state.hp.current).toBe(30);
  });
  it('never heals from over-reduction and ignores active/reaction/triggered mechanics', () => {
    expect(applyIncomingDamage(state(),2,ctx(),{damageType:'bludgeoning',delivery:'attack'}).state.hp.current).toBe(50);
    for(const mode of ['active','reaction','triggered']) {
      expect(applyIncomingDamage(state(),12,ctx([{...second,activation:{mode}}]),{damageType:'fire'}).state.hp.current).toBe(38);
    }
    expect(applyIncomingDamage(state(),0,ctx(),{damageType:'fire'}).events.some(e=>e.type==='damage_reduction')).toBe(false);
  });
  it('applies the independent legacy heavy-armor ledger exactly once, alongside the generic item', () => {
    const armor={id:'heavy',name:'Heavy',type:'chest',slot:'body',defense_type:'heavy',bonus_type:'defense',bonus_value:'16'};
    const ham={id:'ham',capabilities:[{id:'general_feat.heavy_armor_master'}],effects:[{resolution:'auto',result:[{kind:'reduce_damage',amount:'prof',filter:{source:'attack',armor:'heavy',damage_types:['bludgeoning','piercing','slashing']}}]}]};
    const context={...ctx([ham,{kind:'reduce_damage',amount:1}]),attackCommandId:'attack-1',character:{...FIGHTER_CTX,profBonus:3,equippedCards:[armor as never]}};
    const result=applyIncomingDamage({...state(),equipment:{body:'heavy'}},10,context,{damageType:'slashing',delivery:'attack'});
    expect(result.state.hp.current).toBe(44);
    expect(applyIncomingDamage(result.state,10,context,{damageType:'piercing',delivery:'attack'}).state.hp.current).toBe(35);
  });
});
