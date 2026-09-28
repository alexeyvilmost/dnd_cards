import {describe,it,expect} from 'vitest';
import fixture from '../pages/rulesLabFixture.generated.json';
import {createWorld,type ActorState} from '../rules-core/domain';
import definitions from '../../../backend/roguelikecontent/urvin.json';
import {settleJourneyAuras} from './journeyAuras';
import {collectModifiers} from './modifiers';
import {executeAction,applyIncomingDamage} from './execute';
import {FIGHTER_CTX,freshFighterState} from '../mvp/fixtures';
import type {ExecuteContext} from '../mvp/contracts';
function world(key:string,count=2){
  const effect=definitions.auras.find(a=>a.key===key)!;
  const actors=Array.from({length:count},(_,i)=>{const a=structuredClone(fixture.roots.magicInitiateFighter.actor) as unknown as ActorState;a.id=`hero-${i}`;a.runtime.hp={current:0,max:20,temp:0};a.runtime.activeEffects=[{id:effect.id,name:effect.name,mechanics:effect.mechanics,source:effect.name}];return a;});
  return createWorld({id:'journey',actors,ruleset:{systemId:'dnd5e-2024',releaseId:'test',contentHash:'test',errataVersion:'test'}});
}
describe('data-owned party auras',()=>{
  it.each(['species-trait','equipped-item'])('waits until personal %s survival is exhausted',source=>{
    const w=world('phoenix',1),actor=w.actors['hero-0'];actor.runtime.hp.current=5;
    const personal={id:source,name:source,uses:{per:'long_rest'},activation:{mode:'triggered',trigger:{event:'reduced_to_0_hp'}},effects:[{resolution:'auto',result:[{kind:'set_value',target:'hp',value:'1'}]}]};
    const context={character:FIGHTER_CTX,passives:[personal],rng:()=>.5};
    actor.runtime=applyIncomingDamage(actor.runtime,6,context,{damageType:'slashing'}).state;
    expect(actor.runtime.hp.current).toBe(1);expect(actor.runtime.firedThisRest).toContain(source);
    expect(settleJourneyAuras(w,[actor.id],'last_conscious',()=>.5).world).toBe(w);
    expect(actor.runtime.activeEffects).toHaveLength(1);
    actor.runtime=applyIncomingDamage(actor.runtime,2,context,{damageType:'slashing'}).state;
    expect(actor.runtime.hp.current).toBe(0);
    const rescued=settleJourneyAuras(w,[actor.id],'last_conscious',()=>.5).world.actors[actor.id];
    expect(rescued.runtime.hp.current).toBe(1);expect(rescued.runtime.activeEffects).toHaveLength(0);
  });
  it('uses shared survival once and only after personal survival has failed',()=>{
    const w=world('phoenix');w.actors['hero-0'].runtime.hp.current=1;
    expect(settleJourneyAuras(w,['hero-0','hero-1'],'last_conscious',()=>.5).world).toBe(w);
    w.actors['hero-0'].runtime.hp.current=0;
    const result=settleJourneyAuras(w,['hero-0','hero-1'],'last_conscious',()=>.5,'hero-0');
    expect(result.records.flatMap(r=>r.events).some(e=>e.type==='healing')).toBe(false);
    expect(result.world.actors['hero-0'].runtime.hp.current).toBe(1);expect(result.world.actors['hero-1'].runtime.hp.current).toBe(0);
    expect(Object.values(result.world.actors).every(a=>a.runtime.activeEffects.length===0)).toBe(true);expect(w.actors['hero-0'].runtime.hp.current).toBe(0);
    result.world.actors['hero-0'].runtime.hp.current=0;
    expect(settleJourneyAuras(result.world,['hero-0','hero-1'],'last_conscious',()=>.5).records).toEqual([]);
  });
  it('accepts a second survival entity with a different amount, not a hardcoded aura ID',()=>{
    const w=world('phoenix',1);w.actors['hero-0'].runtime.activeEffects=[{id:'other',name:'Other',source:'item',mechanics:{journey:{operations:[{kind:'last_conscious_survival',remaining_hp:3}]}}}];
    expect(settleJourneyAuras(w,['hero-0'],'last_conscious',()=>0).world.actors['hero-0'].runtime.hp.current).toBe(3);
  });
  it('rolls healing independently for every member and respects the HP cap',()=>{
    const w=world('restoration');w.actors['hero-0'].runtime.hp.current=19;let calls=0;
    const result=settleJourneyAuras(w,['hero-0','hero-1'],'victory',()=>{calls++;return .5});
    expect(calls).toBe(2);expect(result.world.actors['hero-0'].runtime.hp.current).toBe(20);expect(result.world.actors['hero-1'].runtime.hp.current).toBe(4);
  });
  it('ferocity adds attack and attack damage, but not saving-spell or environmental damage',()=>{
    const actor=world('ferocity',1).actors['hero-0'];
    expect(collectModifiers(actor.runtime,[],{roll:'attack'}).modifiers.map(m=>m.value)).toEqual([1]);
    expect(collectModifiers(actor.runtime,[],{roll:'damage',filter:{attackDamage:true}}).modifiers.map(m=>m.value)).toEqual([1]);
    expect(collectModifiers(actor.runtime,[],{roll:'damage',filter:{attackKind:'spell'}}).modifiers).toEqual([]);
  });
  it.each(['weapon_melee','unarmed','spell'])('applies +1 to both the %s attack and its damage through execution',kind=>{
    const aura=definitions.auras.find(a=>a.key==='ferocity')!;
    const ability=kind==='spell'?'spellcasting':'str';
    const mechanics={activation:{mode:'active',cost:[]},effects:[{resolution:'attack_roll',who:'target',attack_kind:kind,ability,attack_bonus_override:5,on_hit:[{kind:'damage',dice:'1d6',type:'force'}]}]};
    const state=freshFighterState();
    const run=(passives:Record<string,unknown>[])=>executeAction(state,mechanics,{character:{...FIGHTER_CTX,spellcastingMod:3},passives,target:{id:'target',ac:1,runtimeState:{...freshFighterState(),hp:{current:100,max:100,temp:0}},characterContext:FIGHTER_CTX},rng:()=>.6} as ExecuteContext);
    const normal=run([]),boosted=run([aura.mechanics]);
    const attack=(r:typeof normal)=>r.events.find(e=>e.type==='roll'&&e.roll.kind==='d20');
    const damage=(r:typeof normal)=>r.events.find(e=>e.type==='damage');
    expect(attack(boosted)).toMatchObject({roll:{total:(attack(normal) as {roll:{total:number}}).roll.total+1}});
    expect(damage(boosted)).toMatchObject({amount:(damage(normal) as {amount:number}).amount+1});
  });
});
