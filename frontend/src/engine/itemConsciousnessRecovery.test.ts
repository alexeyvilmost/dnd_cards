import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {applyIncomingDamage,executeAction} from './execute';
import {longRest} from './turn';
import {equippedFighterState,FIGHTER_CTX_EQUIPPED} from '../mvp/fixtures';
import type {ExecuteContext} from '../mvp/contracts';
const data=JSON.parse(readFileSync(new URL('../../../scripts/content/data/item-completion-high-20260929.json', import.meta.url), 'utf8'));
const ring=data['CARD-0936'].mechanics;
const ctx:ExecuteContext={selfId:'owner',character:FIGHTER_CTX_EQUIPPED,passives:[ring],rng:()=>{throw Error('No random roll');}};
const state=()=>({...equippedFighterState(),hp:{current:5,max:20,temp:0}});
describe('first loss of consciousness shares one persistent recovery allowance',()=>{
  it('recovers at zero once, survives reload, and only a long rest resets the allowance',()=>{
    const first=applyIncomingDamage(state(),5,ctx,{damageType:'force'});
    expect(first.state.hp.current).toBe(1);
    const again=applyIncomingDamage(JSON.parse(JSON.stringify(first.state)),1,ctx,{damageType:'force'});
    expect(again.state.hp.current).toBe(0);
    const restContext={...FIGHTER_CTX_EQUIPPED,selfId:'owner',passives:[ring],rng:ctx.rng};
    const rested=longRest(again.state,restContext).state;
    expect(applyIncomingDamage(rested,rested.hp.current,ctx,{damageType:'force'}).state.hp.current).toBe(1);
    const conscious={...ctx,passives:[ring,{kind:'life_policy',remain_conscious_at_zero:true}]};
    expect(applyIncomingDamage(state(),5,conscious,{damageType:'force'}).state.hp.current).toBe(0);
  });
  it.each([1,3])('a recipient-owned recovery of %s never heals the foreign condition source',amount=>{
    const passive=JSON.parse(JSON.stringify(ring));
    for(const effect of passive.effects[0].result)effect.effects[0].result[0].amount=amount;
    const target=state(),caster=state();
    const result=executeAction(caster,{effects:[{resolution:'auto',who:'target',result:[{kind:'condition',op:'apply',value:'unconscious'}]}]},
      {...ctx,passives:[],target:{id:'recipient',characterContext:FIGHTER_CTX_EQUIPPED,runtimeState:target,passives:[passive]}});
    expect(result.state.hp.current).toBe(5);expect(result.targetState?.hp.current).toBe(5+amount);
    const next=applyIncomingDamage(JSON.parse(JSON.stringify(result.targetState)),5+amount,{...ctx,selfId:'recipient',passives:[passive]},{damageType:'force'});
    expect(next.state.hp.current).toBe(0);
  });
});
