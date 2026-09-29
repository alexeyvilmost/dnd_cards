import {describe,expect,it} from 'vitest';
import {executeAction} from './execute';
import {equippedFighterState,FIGHTER_CTX_EQUIPPED} from '../mvp/fixtures';
import type {ExecuteContext,RollLog} from '../mvp/contracts';
const action={effects:[{resolution:'attack_roll',ability:'str',attack_bonus:0,vs:'ac',on_hit:[{kind:'damage',amount:8,type:'slashing'},
  {kind:'condition',op:'apply',value:'prone',duration:{type:'rounds',amount:1}}]}]};
const policy={kind:'modifier',op:'multiply',value:0,applies_to:{roll:'damage_received',filter:{attack_total_equals_ac:true}}};
describe('armor equality uses the final defended КД',()=>{
  it.each([18,19])('retains on-hit riders but prevents damage only at exact КД%s after defense',ac=>{
    const runtime={...equippedFighterState(),hp:{current:30,max:30,temp:0}};
    const roll:RollLog={kind:'d20',advantage:'none',dice:[{sides:20,result:14}],modifiers:[{source:'Attack',value:ac-14}],total:ac,
      target:{type:'ac',value:ac-5},outcome:'hit',text:'Saved attack'};
    const ctx:ExecuteContext={character:FIGHTER_CTX_EQUIPPED,selfId:'source',rng:()=>{throw Error('The saved roll must not reroll');},forcedAttackRoll:roll,
      target:{id:'target',ac,runtimeState:runtime,characterContext:FIGHTER_CTX_EQUIPPED,passives:[policy]}};
    const result=executeAction(runtime,action,ctx);
    expect(result.targetState?.hp.current).toBe(30);
    expect(result.targetState?.activeEffects.some(effect=>effect.mechanics.value==='prone')).toBe(true);
    const lowerAC=executeAction(runtime,action,{...ctx,target:{...ctx.target!,ac:ac-1}});
    expect(lowerAC.targetState?.hp.current).toBe(22);
    const higherAC=executeAction(runtime,action,{...ctx,target:{...ctx.target!,ac:ac+1}});
    expect(higherAC.targetState?.hp.current).toBe(30);
    expect(higherAC.targetState?.activeEffects.some(effect=>effect.mechanics.value==='prone')).toBe(false);
  });
});
