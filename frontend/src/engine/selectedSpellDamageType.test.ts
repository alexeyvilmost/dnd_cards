import {describe,it,expect} from 'vitest';
import {executeAction} from './execute';
import {equippedFighterState,FIGHTER_CTX_EQUIPPED} from '../mvp/fixtures';
import type {ExecuteContext} from '../mvp/contracts';
describe('selected item spell damage type',()=>{
 it.each([{spell:'spell-a',type:'fire'},{spell:'spell-b',type:'cold'}])('changes only $spell and applies its new type defenses',({spell,type})=>{
  const state=equippedFighterState();state.hp={current:20,max:20,temp:0};
  const ctx:ExecuteContext={selfId:'owner',character:FIGHTER_CTX_EQUIPPED,rng:()=>.5,spell:{spellId:spell,baseLevel:1},passives:[{kind:'damage_type_policy',spell_refs:[spell],value:type}],target:{id:'enemy',ac:10,runtimeState:state,characterContext:FIGHTER_CTX_EQUIPPED,passives:[{kind:'resistance',value:'resistance',damage_type:type}]}};
  const action={effects:[{resolution:'auto',who:'target',result:[{kind:'damage',type:'radiant',amount:6}]}]};
  const changed=executeAction(state,action,ctx);expect(changed.targetState?.hp.current).toBe(17);expect(changed.events.some(event=>event.type==='damage'&&event.damageType===type)).toBe(true);
  expect(executeAction(state,action,{...ctx,spell:{baseLevel:1,spellId:'unrelated'}}).targetState?.hp.current).toBe(14);
  expect(executeAction(state,action,{...ctx,passives:[]}).targetState?.hp.current).toBe(14);
 });
});
