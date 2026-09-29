import {describe,expect,it} from 'vitest';
import {collectModifiers} from './modifiers';
import {evaluateCondition} from './circumstances';
import {equippedFighterState,FIGHTER_CTX_EQUIPPED} from '../mvp/fixtures';
describe('item predicates from saved runtime',()=>{
  it('distinguishes ordinary invisibility from the Hide action for two items',()=>{
    const state=equippedFighterState();
    state.activeEffects=[{id:'hide',name:'unrelated label',source:'test',mechanics:{kind:'condition',value:'invisible'}}];
    expect(evaluateCondition({kind:'you_are_hidden'},{state})).toBe(false);
    (state.activeEffects[0].mechanics as Record<string,unknown>).hidden_end_triggers=['enemy_finds_actor','actor_makes_attack_roll'];
    for(const bonus of [1,2]){const effect={kind:'modifier',op:'add',value:bonus,applies_to:{roll:'attack'},when:[{kind:'you_are_hidden'}]};expect(collectModifiers(state,[effect],{roll:'attack',evalCtx:{state}}).modifiers.map(m=>m.value)).toEqual([bonus]);}
    state.activeEffects[0].roundsLeft=0;expect(evaluateCondition({kind:'you_are_hidden'},{state})).toBe(false);
  });
  it.each([{stack_id:'wild_shape_form'},{kind:'illusion',form:'self_disguise'}])('recognizes a saved transformed/disguised state %j',mechanics=>{
    const state=equippedFighterState();state.activeEffects=[{id:'form',name:'test',source:'test',mechanics}];
    expect(evaluateCondition({kind:'you_transformed_or_disguised'},{state})).toBe(true);
    state.activeEffects=[];expect(evaluateCondition({kind:'you_transformed_or_disguised'},{state})).toBe(false);
  });
  it('fails closed for unknown target equipment and distinguishes an armored target',()=>{
    expect(evaluateCondition({kind:'target_unarmored'},{})).toBe(false);
    const state=equippedFighterState();
    expect(evaluateCondition({kind:'target_unarmored'},{target:{runtimeState:state,characterContext:FIGHTER_CTX_EQUIPPED}})).toBe(false);
    state.equipment={};
    expect(evaluateCondition({kind:'target_unarmored'},{target:{runtimeState:state,characterContext:FIGHTER_CTX_EQUIPPED}})).toBe(true);
  });
});
