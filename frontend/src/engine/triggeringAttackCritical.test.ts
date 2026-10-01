import {describe,expect,it,vi} from 'vitest';
import definitions from '../../../scripts/content/data/combat-spell-repairs-20260930.json';
import {executeAction} from './execute';
import {startTurn} from './turn';
import {freshFighterState,FIGHTER_CTX_EQUIPPED} from '../mvp/fixtures';
import type {ExecuteContext} from '../mvp/contracts';

function context(critical=true):ExecuteContext {
  const target=freshFighterState();target.hp={current:200,max:200,temp:0};
  return {selfId:'caster',character:{...FIGHTER_CTX_EQUIPPED,spellcastingMod:3},rng:()=>0,
    target:{id:'target',characterContext:FIGHTER_CTX_EQUIPPED,runtimeState:target,saveMods:{str:0,con:0}},
    triggeringAttack:{targetActorId:'target',damageType:'slashing',critical}};
}
const mechanics=(cardNumber:string)=>definitions.find(row=>row.card_number===cardNumber)!.mechanics as Record<string,unknown>;

describe('data-owned hit-rider critical inheritance',()=>{
  it.each([{id:'unrelated-cold-rider',dice:'2d6',count:2,type:'cold'},
    {id:'independent-force-rider',dice:'1d4',count:1,type:'force'}])('$id doubles only its declared dice on the captured critical hit',data=>{
    const action={activation:{mode:'active',cost:[{resource:'bonus_action'}]},effects:[{resolution:'auto',who:'target',
      result:[{kind:'damage',dice:data.dice,type:data.type,inherit_attack_critical:true}]}]};
    for(const critical of [false,true]) {
      const result=executeAction(freshFighterState(),action,context(critical));
      const damage=result.events.find(event=>event.type==='damage');
      expect(damage).toMatchObject({damageType:data.type});
      if(damage?.type!=='damage')throw Error('Missing damage');
      expect(damage.roll?.dice).toHaveLength(data.count*(critical?2:1));
      expect(result.targetState?.hp.current).toBe(200-data.count*(critical?2:1));
    }
  });

  it('requires the saved triggering target before any resource or RNG use',()=>{
    const state=freshFighterState(),before=structuredClone(state),ctx=context(),rng=vi.fn(()=>0);
    ctx.target={...ctx.target!,id:'changed-target'};ctx.rng=rng;
    expect(()=>executeAction(state,{activation:{mode:'active',cost:[{resource:'bonus_action'}]},
      effects:[{resolution:'auto',who:'target',result:[{kind:'damage',dice:'1d6',type:'fire',inherit_attack_critical:true}]}]},ctx))
      .toThrow(/INVALID_MECHANICS.*saved triggering target/);
    expect(state).toEqual(before);expect(rng).not.toHaveBeenCalled();
  });

  it('keeps explicit false and unflagged legacy automatic damage noncritical',()=>{
    for(const policy of [false,undefined]) {
      const result=executeAction(freshFighterState(),{effects:[{resolution:'auto',who:'target',result:[
        {kind:'damage',dice:'1d6',type:'thunder',...(policy===undefined?{}:{inherit_attack_critical:policy})},
      ]}]},context());
      const damage=result.events.find(event=>event.type==='damage');
      expect(damage?.type==='damage'?damage.roll?.dice:undefined).toHaveLength(1);
    }
  });

  it.each([{card:'SPELL-0164',dice:8,sides:8},{card:'SPELL-0186',dice:8,sides:6}])('$card inherits a critical hit for its initial upcast damage',data=>{
    const state=freshFighterState();state.resources.spell_slot_1=1;state.maxResources.spell_slot_1=1;
    const ctx=context();ctx.spell={spellId:data.card,baseLevel:1,castLevel:3};ctx.forceSaveOutcome='success';
    const result=executeAction(state,mechanics(data.card),ctx);
    const damage=result.events.find(event=>event.type==='damage');
    expect(damage?.type==='damage'?damage.roll?.dice:undefined).toHaveLength(data.dice);
    expect(damage?.type==='damage'?damage.roll?.dice.every(die=>die.sides===data.sides):false).toBe(true);
  });

  it('doubles Searing initial dice but keeps its saved upcast turn-start ticks ordinary',()=>{
    const state=freshFighterState();state.resources.spell_slot_1=1;state.maxResources.spell_slot_1=1;
    const ctx=context();ctx.spell={spellId:'searing',baseLevel:1,castLevel:3};
    const initial=executeAction(state,mechanics('SPELL-0254'),ctx);
    const hitDamage=initial.events.find(event=>event.type==='damage');
    expect(hitDamage?.type==='damage'?hitDamage.roll?.dice:undefined).toHaveLength(6);
    const ownerContext={...FIGHTER_CTX_EQUIPPED,selfId:'target',rng:()=>0};
    const tick=startTurn(JSON.parse(JSON.stringify(initial.targetState!)),ownerContext);
    const tickDamage=tick.events.find(event=>event.type==='damage');
    expect(tickDamage?.type==='damage'?tickDamage.roll?.dice:undefined).toHaveLength(3);
    expect(tick.state.hp.current).toBe(200-6-3);
    expect(tick.state.activeEffects).toHaveLength(1);
  });
});
