import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIGHTER_CTX_EQUIPPED, equippedFighterState } from '../mvp/fixtures';
import { executeAction } from './execute';
import { startTurn, shortRest } from './turn';
import { reconcileEndedEffects } from './effectLifecycle';
import { collectModifiers, deniedCapabilities, foldModifiers } from './modifiers';
import { applySourceTurnBoundary } from './sourceTurnExpiry';
import type { ExecuteContext, RuntimeState } from '../mvp/contracts';
import type { PassiveEffect } from '../types';

const related = JSON.parse(readFileSync(new URL('../../../scripts/content/data/item-completion-high-related-20260929.json', import.meta.url), 'utf8')).entities;
const haste = related.find((entry: {card_number:string})=>entry.card_number==='EFFECT-item-completion-high-883-haste').patch as PassiveEffect;
const state = ():RuntimeState => ({...equippedFighterState(),hp:{current:5,max:30,temp:0}});
const ctx: ExecuteContext = { character:FIGHTER_CTX_EQUIPPED, selfId:'owner',rng:()=>{throw Error('No RNG expected');}, grantedEffects:{[haste.card_number!]:haste} };
const turnCtx = {...FIGHTER_CTX_EQUIPPED,selfId:'owner',rng:ctx.rng};
const grant = {effects:[{resolution:'auto',who:'self',result:[{kind:'grant_effect',value:haste.card_number,bind_action_context:true}]}]};

describe('data-owned consequences when an effect ends',()=>{
  it('expires the exact potion effect after three owner turns and keeps lethargy through that turn',()=>{
    let runtime=executeAction(state(),grant,ctx).state;
    expect(runtime.resources.haste_action).toBe(1);
    expect(foldModifiers(30,collectModifiers(runtime,[],{roll:'speed'})).value).toBe(60);
    for(let turn=0;turn<2;turn++) {
      runtime=startTurn(JSON.parse(JSON.stringify(runtime)),turnCtx).state;
      expect(runtime.resources.haste_action).toBe(1);
      expect(deniedCapabilities(runtime).has('action')).toBe(false);
    }
    const beforeThird=runtime;
    runtime=startTurn(runtime,turnCtx).state;
    expect(runtime.resources.haste_action).toBe(0);expect(runtime.maxResources.haste_action).toBe(0);
    expect(deniedCapabilities(runtime).has('action')).toBe(true);
    expect(foldModifiers(30,collectModifiers(runtime,[],{roll:'speed'})).value).toBe(0);
    expect(runtime.activeEffects.every(effect=>effect.sourceTurnExpiry?.armed)).toBe(true);
    const ended=applySourceTurnBoundary(runtime,{sourceActorId:'owner',ownerActorId:'owner',boundary:'end'}).state;
    expect(deniedCapabilities(ended).has('action')).toBe(false);
    expect(startTurn(ended,turnCtx).state.activeEffects).toEqual([]);
    expect(shortRest(beforeThird,turnCtx).state.activeEffects).toEqual([]);
  });
  it('a mid-turn removal waits for the next owner turn, and retrying the postimage cannot repeat it',()=>{
    const original=executeAction(state(),grant,ctx).state;
    const removed={...original,activeEffects:[]};
    const result=reconcileEndedEffects(original,removed,ctx,executeAction);
    const reloaded=JSON.parse(JSON.stringify(result.state)) as RuntimeState;
    expect(applySourceTurnBoundary(reloaded,{sourceActorId:'owner',ownerActorId:'owner',boundary:'end'}).state).toEqual(reloaded);
    const armed=applySourceTurnBoundary(reloaded,{sourceActorId:'owner',ownerActorId:'owner',boundary:'start'}).state;
    expect(applySourceTurnBoundary(armed,{sourceActorId:'owner',ownerActorId:'owner',boundary:'end'}).state.activeEffects).toEqual([]);
    expect(reconcileEndedEffects(reloaded,reloaded,ctx,executeAction).events).toEqual([]);
  });
  it('an independent effect heals its owner using the saved source formula when it expires',()=>{
    const initial=state();
    initial.activeEffects=[{id:'second-instance',name:'Deferred blessing',source:'Other owner',ownerId:'owner',sourceId:'caster',roundsLeft:1,
      actionContext:{sourceId:'caster',character:{level:5,profBonus:3,abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0}}},
      mechanics:{on_end:{effects:[{resolution:'auto',who:'self',result:[{kind:'healing',amount:'prof_bonus'}]}]}}}];
    const result=startTurn(JSON.parse(JSON.stringify(initial)),turnCtx);
    expect(result.state.hp.current).toBe(8);expect(result.state.activeEffects).toEqual([]);
    expect(startTurn(result.state,turnCtx).state.hp.current).toBe(8);
  });
});
