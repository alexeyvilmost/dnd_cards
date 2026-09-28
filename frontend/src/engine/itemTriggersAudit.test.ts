import {describe,expect,it} from 'vitest';
import patches from '../../../scripts/content/data/item-triggers-20260929.json';
import {executeAction,emitEvent} from './execute';
import {startTurn,shortRest,longRest} from './turn';
import {collectListeners} from './dispatch';
import {activeConditionsOf} from './circumstances';
import {FIGHTER_CTX_EQUIPPED,equippedFighterState} from '../mvp/fixtures';
import type {ExecuteContext,RuntimeState,EngineEvent} from '../mvp/contracts';

type Dict=Record<string,unknown>;
const item=(n:number):Dict=>{
  const id=`CARD-${String(n).padStart(4,'0')}`;
  const row=(patches as Record<string,{append_payloads:unknown[];replace_mechanics?:Dict}>)[id];
  return {id,name:id,...(row.replace_mechanics??{activation:{mode:'passive'},effects:[{resolution:'auto',result:row.append_payloads}]})};
};
const state=(current=10,max=40):RuntimeState=>({...equippedFighterState(),hp:{current,max,temp:0}});
const ctx=(items:number[]=[],target?:RuntimeState,targetItems:number[]=[]):ExecuteContext=>({
  character:FIGHTER_CTX_EQUIPPED,selfId:'owner',passives:items.map(item),rng:()=>0,
  ...(target?{target:{id:'patient',ac:10,runtimeState:target,characterContext:FIGHTER_CTX_EQUIPPED,passives:targetItems.map(item)}}:{}),
});
const heal=(amount=4,who='target')=>({effects:[{resolution:'auto',who,result:[{kind:'healing',amount}]}]});
const spend=(resource:string)=>({activation:{mode:'active',cost:[{resource,amount:1}]},effects:[]});
const cast={effects:[]};
const attack=(ranged=false)=>({effects:[{resolution:'attack_roll',attack_kind:ranged?'weapon_ranged':'weapon_melee',attack_bonus_override:4,ability:ranged?'dex':'auto',on_hit:[{kind:'damage',amount:1,type:'force'}]}]});
const castContext=(items:number[],school='illusion',baseLevel=1,concentration=false):ExecuteContext=>({...ctx(items),spell:{baseLevel,castLevel:Math.max(1,baseLevel),school,concentration}});
const hasRider=(s:RuntimeState)=>s.activeEffects.filter(e=>(e.mechanics as Dict).kind==='damage_rider');

describe('catalog item event ownership and persisted trigger effects',()=>{
  it('108 responds only to paid owner channel, without paying or running on an invalid command',()=>{
    const before=state(); before.resources.channel_divinity=1;
    const result=executeAction(before,spend('channel_divinity'),ctx([108]));
    expect(result.state.hp.temp).toBe(10);expect(result.state.resources.channel_divinity).toBe(0);
    expect(()=>executeAction(result.state,spend('channel_divinity'),ctx([108]))).toThrow();
    expect(before.resources.channel_divinity).toBe(1);expect(before.hp.temp).toBe(0);
    expect(executeAction(before,spend('action'),ctx([108])).state.hp.temp).toBe(0);
    expect(collectListeners({kind:'resource_spent',source:'other',data:{resource:'channel_divinity'}},before,[item(108)],{rollerActorId:'owner'})).toEqual([]);
  });
  it('457 heals the actual inspiration recipient, while its resource belongs to the bard',()=>{
    const before=state();before.resources.bardic_inspiration=2;
    const result=executeAction(before,spend('bardic_inspiration'),ctx([457],state(2)));
    expect(result.state.resources.bardic_inspiration).toBe(1);expect(result.state.hp.current).toBe(10);
    expect(result.targetState?.hp.current).toBe(3);
    expect(executeAction(before,spend('bardic_inspiration'),ctx([457])).state.hp.current).toBe(10);
  });
  it('418 grants capped inspiration only on long rest',()=>{
    const context={...FIGHTER_CTX_EQUIPPED,passives:[item(418)],rng:()=>0};
    const once=longRest(state(),context);expect(once.state.resources.heroic_inspiration).toBe(1);
    expect(longRest(once.state,context).state.resources.heroic_inspiration).toBe(1);
    const without=state();without.resources.heroic_inspiration=0;
    expect(shortRest(without,context).state.resources.heroic_inspiration??0).toBe(0);
  });
  it('577 and 615 route the healing recipient and owner separately, including self healing',()=>{
    const result=executeAction(state(),heal(),ctx([577,615],state(2)));
    expect(result.targetState?.hp).toMatchObject({current:6,temp:3});
    expect(result.state.hp).toMatchObject({current:12,temp:3}); // ring self-heal is also healing
    const self=executeAction(state(),heal(4,'self'),ctx([577,615],state(2)));
    expect(self.state.hp).toMatchObject({current:14,temp:3});expect(self.targetState).toBeUndefined();
    const capped=executeAction(state(),heal(),ctx([577,615],state(40)));
    expect(capped.state.hp).toMatchObject({current:10,temp:0});expect(capped.targetState?.hp.temp).toBe(0);
  });
  it('594 requires a positive canonical concentration fact',()=>{
    expect(executeAction(state(),cast,castContext([594],'abjuration',1,true)).state.hp.temp).toBe(8);
    expect(executeAction(state(),cast,castContext([594],'illusion')).state.hp.temp).toBe(0);
    expect(executeAction(state(),cast,{...ctx([594]),spell:{baseLevel:1,castLevel:1}}).state.hp.temp).toBe(0);
  });
  it('636 heals a bloodied melee attacker, but never for ranged attacks, misses, or a healthy attacker',()=>{
    const hit=ctx([636],state());hit.rng=()=>0.6;
    const resolved=executeAction(state(20),attack(),hit);
    expect(resolved.state.hp.current,JSON.stringify(resolved.events)).toBe(23);
    expect(executeAction(state(21),attack(),hit).state.hp.current).toBe(21);
    expect(executeAction(state(20),attack(true),hit).state.hp.current).toBe(20);
    expect(executeAction(state(20),attack(),ctx([636],state())).state.hp.current).toBe(20);
  });
  it('item healing triggered during a spell keeps its own source classification',()=>{
    const context={...ctx([636],state()),spell:{baseLevel:0}};
    context.passives!.push({kind:'modifier',op:'reroll_healing_ones',applies_to:{roll:'healing',filter:{healingSource:'spell'}}});
    let call=0;context.rng=()=>++call===1?0.6:0;
    const result=executeAction(state(20),attack(),context);
    expect(result.state.hp.current).toBe(21);expect(call).toBe(2);
  });
  it('655 grants a recipient-owned, persistable, non-stacking next-attack rider',()=>{
    const prepared=executeAction(state(),heal(),ctx([],state(2),[655]));
    expect(hasRider(prepared.state)).toHaveLength(0);
    expect(hasRider(prepared.targetState!)).toHaveLength(1);
    expect(hasRider(prepared.targetState!)[0]).toMatchObject({ownerId:'patient',sourceId:'patient'});
    const loaded=JSON.parse(JSON.stringify(prepared.targetState)) as RuntimeState;
    const again=executeAction(state(),heal(),ctx([],loaded,[655]));
    expect(hasRider(again.targetState!)).toHaveLength(1);
    const hit={...ctx([],state()),selfId:'patient',rng:()=>0.6};
    const result=executeAction(again.targetState!,attack(),hit);
    expect(result.events).toContainEqual(expect.objectContaining({type:'damage',damageType:'poison',amount:4}));
    expect(hasRider(result.state)).toHaveLength(0);
    const missed=executeAction(loaded,attack(),{...hit,rng:()=>0});
    expect(missed.events.some(e=>e.type==='damage'&&e.damageType==='poison')).toBe(false);
    expect(hasRider(missed.state)).toHaveLength(0);
  });
  it('does not expire a fresh next-attack rider granted after the current hit',()=>{
    const original=executeAction(state(),heal(),ctx([],state(2),[655])).targetState!;
    const grant=(item(655).effects as Dict[])[0].result as Dict[];
    const rider=(grant[0].effects as Dict[])[0].result as Dict[];
    const context={...ctx([],state()),selfId:'patient',rng:()=>0.6,passives:[{
      id:'second-source',activation:{mode:'triggered',trigger:{event:'hit',subject:'self'}},
      effects:[{resolution:'auto',who:'self',result:rider}],
    }]};
    const result=executeAction(original,attack(),context);
    expect(hasRider(result.state)).toHaveLength(1);
    expect(hasRider(result.state)[0].id).not.toBe(hasRider(original)[0].id);
  });
  it('661 stabilizes only the living zero-HP owner at the beginning of their turn',()=>{
    const context={...FIGHTER_CTX_EQUIPPED,passives:[item(661)],rng:()=>0};
    expect(startTurn(state(0),context).state.deathSaves?.stable).toBe(true);
    expect(startTurn(state(2),context).state.deathSaves?.stable??false).toBe(false);
    const dead=state(0);dead.deathSaves={successes:0,failures:3,stable:false,dead:true};
    expect(startTurn(dead,context).state.deathSaves).toEqual(dead.deathSaves);
  });
  it('766 gates canonical leveled illusion, persists its use, expires, and recharges on short rest',()=>{
    const context=castContext([766]);
    const first=executeAction(state(),cast,context);
    expect(activeConditionsOf(first.state).has('invisible')).toBe(true);
    const loaded=JSON.parse(JSON.stringify(first.state)) as RuntimeState;
    const expired=startTurn(loaded,FIGHTER_CTX_EQUIPPED).state;
    expect(activeConditionsOf(expired).has('invisible')).toBe(false);
    expect(executeAction(expired,cast,context).state.activeEffects).toHaveLength(0);
    const rested=shortRest(expired,FIGHTER_CTX_EQUIPPED).state;
    expect(activeConditionsOf(executeAction(rested,cast,context).state).has('invisible')).toBe(true);
    for(const c of [castContext([766],'evocation'),castContext([766],'illusion',0),{...ctx([766]),spell:{baseLevel:1}}]){
      expect(executeAction(state(),cast,c).state.activeEffects).toHaveLength(0);
    }
  });
  it('does not auto-execute optional healing reactions',()=>{
    const context=ctx();context.passives=[{activation:{mode:'reaction',trigger:{event:'healing_received'}},effects:[{resolution:'auto',result:[{kind:'temp_hp',amount:99}]}]}];
    const events:EngineEvent[]=[];
    const result=emitEvent({kind:'healing_received',source:'self'},state(),context,events,[],undefined,[],true);
    expect(result.hp.temp).toBe(0);
  });
  it('set_value current_hp formulas use the real target HP and ignore spoofed character variables',()=>{
    const context=ctx([],state(31));
    context.character={...context.character,variables:{current_hp:999}};
    context.target!.characterContext={...FIGHTER_CTX_EQUIPPED,variables:{current_hp:999}};
    const result=executeAction(state(20),{effects:[{resolution:'auto',who:'target',result:[{kind:'set_value',target:'current_hp',formula:'ceil(current_hp / 2)'}]}]},context);
    expect(result.targetState?.hp.current).toBe(16);expect(result.state.hp.current).toBe(20);
  });
});
