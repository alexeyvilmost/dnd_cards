import {describe, expect, it} from 'vitest';
import patches from '../../../scripts/content/data/item-healing-20260929.json';
import {executeAction} from './execute';
import {FIGHTER_CTX, freshFighterState} from '../mvp/fixtures';
import type {ExecuteContext, RuntimeState} from '../mvp/contracts';

const item=(number:keyof typeof patches)=>({id:number,name:number,activation:{mode:'passive'},effects:[{resolution:'auto',result:patches[number].append_payloads}]});
const runtime=(current=1,max=100,temp=0):RuntimeState=>({...freshFighterState(),hp:{current,max,temp}});
const healing=(amount:string|number='1d8 + 3',who='target')=>({effects:[{who,resolution:'auto',result:[{kind:'healing',amount}]}]});
const temporary=(amount:string|number=9,who='target')=>({effects:[{who,resolution:'auto',result:[{kind:'temp_hp',amount}]}]});
const context=(source:string[]=[],recipient:string[]=[],targetState=runtime()):ExecuteContext=>({
  character:{...FIGHTER_CTX,profBonus:5},passives:source.map(n=>item(n as keyof typeof patches)),
  target:{id:'target',runtimeState:targetState,characterContext:{...FIGHTER_CTX,profBonus:2},passives:recipient.map(n=>item(n as keyof typeof patches))},rng:()=>0,
});
describe('source-owned and recipient-owned item healing modifiers',()=>{
  it('adds the source proficiency, including the explained roll, without borrowing the recipient bonus',()=>{
    const result=executeAction(runtime(),healing(),context(['CARD-0429']));
    expect(result.targetState?.hp.current).toBe(10); // 1 + (1d8=1 + 3 + source PB5)
    const event=result.events.find(e=>e.type==='healing');
    expect(event).toMatchObject({amount:9,roll:{total:9}});
    if(event?.type!=='healing')throw new Error('missing healing event');
    expect(event.roll?.modifiers).toContainEqual(expect.objectContaining({value:5,source:'Диадема целителя'}));
    expect(executeAction(runtime(),healing(),context([],['CARD-0429'])).targetState?.hp.current).toBe(5);
  });
  it('maximizes received dice only and keeps fixed bonuses and the HP cap',()=>{
    const ctx=context([],['CARD-0660']);
    ctx.rng=()=>{throw new Error('Maximum dice need no randomness');};
    const result=executeAction(runtime(),healing(),ctx);
    expect(result.targetState?.hp.current).toBe(12);
    expect(result.events.find(e=>e.type==='healing')).toMatchObject({amount:11,roll:{dice:[{sides:8,result:8}],total:11}});
    expect(executeAction(runtime(),healing(),context(['CARD-0660'])).targetState?.hp.current).toBe(5);
    const capped=executeAction(runtime(),healing(),context([],['CARD-0660'],runtime(97)));
    expect(capped.events.find(e=>e.type==='healing')).toMatchObject({amount:3,roll:{total:11}});
    expect(executeAction(runtime(),healing(4),context([],['CARD-0660'])).targetState?.hp.current).toBe(5);
  });
  it('checks bloodied on the recipient before each healing, never the source or temporary HP',()=>{
    const first=executeAction(runtime(90),healing(),context([],['CARD-0371'],runtime(50,100,100)));
    expect(first.targetState?.hp.current).toBe(61);
    const next=executeAction(runtime(1),healing(),context([],['CARD-0371'],first.targetState));
    expect(next.targetState?.hp.current).toBe(65);
    expect(executeAction(runtime(1),healing(),context(['CARD-0371'],[],runtime(50))).targetState?.hp.current).toBe(54);
  });
  it('combines source additions/doubling before recipient reduction and records all contributions',()=>{
    const result=executeAction(runtime(),healing(),context(['CARD-0429','CARD-0937'],['CARD-0925']));
    expect(result.targetState?.hp.current).toBe(10); // (1 + 3 + PB5) * 2 * .5
    const event=result.events.find(e=>e.type==='healing');
    if(event?.type!=='healing')throw new Error('missing healing event');
    expect(event.roll?.modifiers.map(m=>m.source)).toEqual(expect.arrayContaining(['Диадема целителя','Кадуцей','Жертва: Милосердие']));
    expect(executeAction(runtime(),healing(),context([],['CARD-0937'])).targetState?.hp.current).toBe(5);
    expect(executeAction(runtime(),healing(5),context([],['CARD-0925'])).targetState?.hp.current).toBe(3);
  });
  it('uses self passives once per channel and ignores unrelated selected-target passives for self healing',()=>{
    const ctx=context(['CARD-0429','CARD-0937','CARD-0925'],['CARD-0660']);
    const result=executeAction(runtime(),healing('1d8 + 3','self'),ctx);
    expect(result.state.hp.current).toBe(10);
    expect(result.targetState).toBeUndefined();
  });
  it('halves new temporary HP, preserves an existing larger pool, and keeps healing-only bonuses separate',()=>{
    const ctx=context(['CARD-0429','CARD-0937'],['CARD-0925']);
    const result=executeAction(runtime(),temporary(),ctx);
    expect(result.targetState?.hp.temp).toBe(4);
    expect(result.events.find(e=>e.type==='temp_hp')).toMatchObject({amount:4});
    expect(executeAction(runtime(),temporary(),context(['CARD-0925'])).targetState?.hp.temp).toBe(9);
    expect(executeAction(runtime(),temporary(),context([],['CARD-0925'],runtime(1,100,12))).targetState?.hp.temp).toBe(12);
    const self=executeAction(runtime(),temporary(9,'self'),context(['CARD-0925']));
    expect(self.state.hp.temp).toBe(4);
  });
  it('supports a second generic declared amount and blocks received healing before bonuses',()=>{
    const ctx=context();
    ctx.passives=[{kind:'modifier',op:'add',value:'2 * prof_bonus',source:'Other entity',applies_to:{roll:'healing'}}];
    expect(executeAction(runtime(),healing(1),ctx).targetState?.hp.current).toBe(12);
    ctx.target!.passives=[{kind:'modifier',op:'deny',applies_to:{roll:'healing_received'}}];
    expect(executeAction(runtime(),healing(1),ctx).targetState?.hp.current).toBe(1);
  });
  it('applies healing die bonuses to matching live dice, after rerolls, with an independent minimum rule',()=>{
    const ctx=context();
    ctx.passives=[
      {kind:'modifier',op:'reroll_healing_ones',applies_to:{roll:'healing'}},
      {kind:'modifier',op:'die_bonus',value:2,source:'d6 ring',applies_to:{roll:'healing',die:6}},
      {kind:'modifier',op:'minimum_die',value:3,source:'d8 charm',applies_to:{roll:'healing',die:8}},
    ];
    let call=0;ctx.rng=()=>++call<=2?0:0.2;
    const result=executeAction(runtime(),healing('1d6 + 1d8 + 4'),ctx);
    expect(result.targetState?.hp.current).toBe(12); // 1 HP + (2+2) + max(2,3) + 4
    const event=result.events.find(e=>e.type==='healing');
    if(event?.type!=='healing')throw new Error('Missing healing event');
    expect(event.roll?.dice.filter(d=>!d.discarded)).toEqual([{sides:6,result:4},{sides:8,result:3}]);
    expect(event.roll?.dice.filter(d=>d.discarded)).toHaveLength(2);
    expect(event.roll?.modifiers.map(m=>m.source)).toEqual(expect.arrayContaining(['d6 ring','d8 charm']));
    expect(executeAction(runtime(),healing(4),ctx).targetState?.hp.current).toBe(5);
  });
  it('supports a separate entity adding to every healing die, without changing constants or damage-only rules',()=>{
    const ctx=context();ctx.rng=()=>0.3;
    ctx.passives=[
      {kind:'modifier',op:'die_bonus',value:1,source:'all dice item',applies_to:{roll:'healing'}},
      {kind:'modifier',op:'die_bonus',value:99,source:'damage only',applies_to:{roll:'damage'}},
    ];
    const result=executeAction(runtime(),healing('1d4 + 1d10 + 4'),ctx);
    expect(result.targetState?.hp.current).toBe(13); // 1 HP + 2+1 + 4+1 + constant4
    const event=result.events.find(e=>e.type==='healing');
    if(event?.type!=='healing')throw new Error('Missing healing event');
    expect(event.roll?.dice).toEqual([{sides:4,result:3},{sides:10,result:5}]);
    expect(executeAction(runtime(),healing(4),ctx).targetState?.hp.current).toBe(5);
  });
});
