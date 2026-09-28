import {describe, expect, it} from 'vitest';
import manifest from '../../../backend/migrations/data/catalog-audit-20260929/items.json';
import {validateMechanics} from './validateMechanics';
import {parseWeaponProfile} from './weaponProfile';
import {collectModifiers} from './modifiers';
import {evaluateCondition} from './circumstances';
import {applyDeathSaveRoll, emptyDeathSaves, rollDeathSaveDie} from './deathSaves';
import {freshFighterState, equippedFighterState, FIGHTER_CTX_EQUIPPED} from '../mvp/fixtures';
import {executeAction, resolveFallLanding, applyIncomingDamage} from './execute';
import {attackRollQueryFacts} from './weapon';
import {bindSelfItemCost} from './cost';
import {rollD20} from './roll';
import {applyDamageDieRules} from './rollRules';

type Dict = Record<string, unknown>;
const records=manifest.entities as unknown as Array<{entity_type:string;id:string;card_number:string;name:string;preimage:Dict|null;patch:Dict;review:{status:string}}>;
const mechanics=(number:string):Dict=>{
  const row=records.find(r=>r.card_number===number)!;
  return (row.patch.mechanics??row.preimage?.mechanics) as Dict;
};
const face=(n:number,sides=20)=>(n-0.5)/sides;

describe('current item catalog data audit',()=>{
  it('counts enchantment once and does not leak it to a different weapon',()=>{
    for(const [number,bonus] of [[119,2],[121,4],[123,3],[353,3],[364,2],[439,1],[441,3]]){
      const mech=mechanics(`CARD-${String(number).padStart(4,'0')}`);
      const profile=parseWeaponProfile({id:String(number),mechanics:mech});
      expect(profile.valid).toBe(true);
      if(!profile.valid)throw new Error(profile.issue);
      expect(profile.profile.enchantment).toMatchObject({attackBonus:bonus,damageBonus:bonus});
      for(const roll of ['attack','damage'] as const){
        expect(collectModifiers(freshFighterState(),[mech],{roll,filter:{weaponId:'different-weapon',attackKind:'weapon'}}).modifiers).toEqual([]);
      }
    }
    expect(collectModifiers(freshFighterState(),[mechanics('CARD-0866')],{roll:'attack',filter:{attackKind:'spell'}}).modifiers.map(m=>m.value)).toEqual([2]);
    expect(collectModifiers(freshFighterState(),[mechanics('CARD-0342')],{roll:'ac'}).modifiers).toEqual([]);
    expect(mechanics('CARD-0342').armor_profile).toMatchObject({ac_formula:'19'});
  });
  it('applies die-specific luck to damage and healing, and universal luck to different dice',()=>{
    for(const [id,die] of [['CARD-0372',4],['CARD-0373',6],['CARD-0374',8],['CARD-0375',10],['CARD-0376',12]] as const){
      for(const roll of ['damage','healing'] as const){
        const rules=collectModifiers(freshFighterState(),[mechanics(id)],{roll}).rules;
        const adjusted=applyDamageDieRules([{sides:die,result:2},{sides:20,result:8},{sides:die,result:4,discarded:true}],rules,{rng:()=>0.5});
        expect(adjusted.delta).toBe(1);
        expect(adjusted.dice.map(d=>d.result)).toEqual([3,8,4]);
      }
    }
    const rules=collectModifiers(freshFighterState(),[mechanics('CARD-0384')],{roll:'damage'}).rules;
    expect(applyDamageDieRules([{sides:4,result:2},{sides:12,result:9}],rules,{rng:()=>0.5}).delta).toBe(2);
    expect(collectModifiers(freshFighterState(),[mechanics('CARD-0384')],{roll:'ability_check'}).modifiers.map(m=>m.value)).toEqual([1]);
  });
  it('includes every active source item exactly once and never promotes a fully verified status',()=>{
    const cards=records.filter(r=>r.entity_type==='card');
    expect(cards).toHaveLength(886);
    expect(new Set(cards.map(r=>r.id)).size).toBe(886);
    expect(records.filter(r=>['verified','partial_narrative_verified'].includes(r.review.status))).toEqual([]);
  });
  it('validates complete changed declarations and strict weapon profiles through canonical parsers',()=>{
    const errors:string[]=[];
    for(const row of records){
      const mech=row.patch.mechanics as Dict|undefined;
      if(!mech)continue;
      const validation=validateMechanics(mech,{id:row.card_number,name:row.name,kind:'passive_effect'});
      if(!validation.valid)errors.push(`${row.card_number}: ${validation.errors.join('; ')}`);
      if(mech.weapon_profile){
        const profile=parseWeaponProfile({id:row.id,mechanics:mech});
        if(!profile.valid)errors.push(`${row.card_number}: ${profile.issue}`);
      }
    }
    expect(errors).toEqual([]);
  });
  it('keeps skill bonuses narrow on two different actual item declarations',()=>{
    const state=freshFighterState();
    const pendant=mechanics('CARD-0111');
    const druid=mechanics('CARD-0208');
    const sum=(passive:Dict,skill:string,ability:string)=>collectModifiers(state,[passive],{roll:'ability_check',filter:{skill,ability}}).modifiers.reduce((n,m)=>n+m.value,0);
    expect(sum(pendant,'religion','int')).toBe(1);
    expect(sum(pendant,'arcana','int')).toBe(0);
    expect(sum(druid,'nature','int')).toBe(1);
    expect(sum(druid,'religion','int')).toBe(0);
  });
  it('limits spell attack bonuses on two actual magic items without benefiting weapon attacks',()=>{
    for(const id of ['CARD-0084','CARD-0173']){
      const mech=mechanics(id);
      expect(collectModifiers(freshFighterState(),[mech],{roll:'attack',filter:{attackKind:'spell'}}).modifiers.map(m=>m.value)).toEqual([1]);
      expect(collectModifiers(freshFighterState(),[mech],{roll:'attack',filter:{attackKind:'weapon'}}).modifiers).toEqual([]);
    }
  });
  it('applies death-save bonuses while preserving natural 1/20, including after serialization',()=>{
    for(const id of ['CARD-0610','CARD-0658']){
      const roll=rollDeathSaveDie(JSON.parse(JSON.stringify(freshFighterState())),[mechanics(id)],{},()=>face(8));
      expect(roll.total).toBe(10);
      expect(roll.modifiers.map(m=>m.value)).toEqual([2]);
      expect(applyDeathSaveRoll(emptyDeathSaves(),8,roll.total).outcome).toBe('success');
    }
    expect(applyDeathSaveRoll(emptyDeathSaves(),1,30).outcome).toBe('crit_fail');
    expect(applyDeathSaveRoll(emptyDeathSaves(),20,2).outcome).toBe('revive');
  });
  it('uses persisted death-save attempts for first-save success and honors a different cursed outcome',()=>{
    const state=freshFighterState();state.deathSaves=emptyDeathSaves();
    const passives=[mechanics('CARD-0888')];
    const first=rollDeathSaveDie(state,passives,{},()=>face(1));
    const result=applyDeathSaveRoll(state.deathSaves,1,first.total,first.outcome);
    expect(result).toMatchObject({outcome:'success',next:{successes:1,failures:0}});
    state.deathSaves=result.next;
    const second=rollDeathSaveDie(JSON.parse(JSON.stringify(state)),passives,{},()=>face(1));
    expect(applyDeathSaveRoll(state.deathSaves,1,second.total,second.outcome)).toMatchObject({outcome:'crit_fail',next:{successes:1,failures:2}});
    const cursed=rollDeathSaveDie(state,[mechanics('CARD-0927')],{},()=>face(19));
    expect(applyDeathSaveRoll(state.deathSaves,19,cursed.total,cursed.outcome).next.failures).toBe(2);
    expect(applyDeathSaveRoll(emptyDeathSaves(),20,20,'success').outcome).toBe('revive');
  });
  it('retains actual dice and explains different declared d20 floors without making a floor a natural critical',()=>{
    for(const floor of [8,12]){
      const rules=collectModifiers(freshFighterState(),[{effects:[{resolution:'auto',result:[{kind:'modifier',op:'minimum_die',value:floor,applies_to:{roll:'d20'}}]}]}],{roll:'ability_check'}).rules;
      const roll=rollD20({rules,modifiers:[{value:3,source:'ability'}],rng:()=>face(2),target:{type:'dc',value:10}});
      expect(roll.total).toBe(floor+3);
      expect(roll.dice[0].result).toBe(2);
      expect(roll.modifiers.some(m=>m.value===floor-2)).toBe(true);
      expect(rollD20({rules,rng:()=>face(1),target:{type:'ac',value:5}}).outcome).toBe('miss');
    }
  });
  it('applies target-owned spell save defenses and a separate condition-scoped item',()=>{
    const action={effects:[{resolution:'save',who:'target',ability:'dex',dc:15,on_fail:[{kind:'condition',op:'apply',value:'prone',duration:{type:'rounds',amount:1}}]}]};
    const ctx={character:FIGHTER_CTX_EQUIPPED,rng:()=>face(10),target:{id:'target',runtimeState:freshFighterState(),saveMods:{dex:0},passives:[mechanics('CARD-0170')],characterContext:FIGHTER_CTX_EQUIPPED}};
    const normal=executeAction(freshFighterState(),action,ctx);
    const magical=executeAction(freshFighterState(),action,{...ctx,spell:{baseLevel:1}});
    expect(normal.events.find(e=>e.type==='roll')).toMatchObject({roll:{advantage:'none'}});
    expect(magical.events.find(e=>e.type==='roll')).toMatchObject({roll:{advantage:'advantage'}});
    const conditional=executeAction(freshFighterState(),action,{...ctx,target:{...ctx.target,passives:[mechanics('CARD-0221')]}});
    expect(conditional.events.find(e=>e.type==='roll')).toMatchObject({roll:{total:13}});
  });
  it('does not lend attacker equipment resistances to a separate unprotected recipient',()=>{
    for(const [id,type] of [['CARD-0531','fire'],['CARD-0654','slashing']]){
      const source=freshFighterState();const target=freshFighterState();target.hp={current:30,max:30,temp:0};
      const action={effects:[{resolution:'auto',who:'target',result:[{kind:'damage',amount:10,type}]}]};
      const ctx={character:FIGHTER_CTX_EQUIPPED,rng:()=>0.5,passives:[mechanics(id)],target:{id:'other',runtimeState:target}};
      expect(executeAction(source,action,ctx).targetState?.hp.current).toBe(20);
      expect(executeAction(source,action,{...ctx,target:{...ctx.target,passives:[mechanics(id)]}}).targetState?.hp.current).toBe(25);
    }
  });
  it('derives weapon identity/type from selected equipment and does not leak a bonus to a second weapon',()=>{
    const state=equippedFighterState();
    const effect={attack_kind:'weapon_melee'};
    const facts=attackRollQueryFacts(effect,'main',FIGHTER_CTX_EQUIPPED,state.equipment);
    expect(facts.weaponId).toBe(state.equipment.main_hand);
    expect(facts.weaponType).toBeTruthy();
    const rule={effects:[{resolution:'auto',result:[{kind:'modifier',op:'add',value:3,applies_to:{roll:'attack',filter:{weaponId:facts.weaponId}}}]}]};
    expect(collectModifiers(state,[rule],{roll:'attack',filter:facts}).modifiers[0].value).toBe(3);
    expect(collectModifiers(state,[rule],{roll:'attack',filter:{...facts,weaponId:'other'}}).modifiers).toEqual([]);
  });
  it('checks health and concentration from persisted state, failing closed when absent',()=>{
    const state=freshFighterState();state.hp={current:5,max:10,temp:50};
    const health={kind:'hp_fraction_at_most',value:0.5};
    expect(evaluateCondition(health,{state})).toBe(true);
    expect(evaluateCondition(health,{state:{...state,hp:{...state.hp,current:6}}})).toBe(false);
    expect(evaluateCondition(health,{})).toBe(false);
    const concentration={kind:'concentrating'};
    expect(evaluateCondition(concentration,{state})).toBe(false);
    state.activeEffects.push({id:'concentration',name:'concentration',source:'test',mechanics:{kind:'concentration'}});
    expect(evaluateCondition(concentration,{state:JSON.parse(JSON.stringify(state))})).toBe(true);
  });
  it('consumes two different actual healing potions and cannot use an absent potion',()=>{
    for(const id of ['CARD-0039','CARD-0078']){
      const row=records.find(r=>r.card_number===id)!;
      const state=freshFighterState();state.hp={current:1,max:30,temp:0};
      state.resources.action=1;state.inventory=[{cardId:row.id,qty:1}];
      const ctx={character:FIGHTER_CTX_EQUIPPED,rng:()=>0.5};
      const result=executeAction(state,bindSelfItemCost(mechanics(id),row.id),ctx);
      expect(result.state.hp.current).toBe(9);
      expect(result.state.inventory.find(r=>r.cardId===row.id)?.qty??0).toBe(0);
      expect(()=>executeAction({...result.state,resources:{...result.state.resources,action:1}},bindSelfItemCost(mechanics(id),row.id),ctx)).toThrow();
    }
  });
  it('uses the recipient passive immunity, including concentration gates and source provenance',()=>{
    const condition=(value:string)=>({activation:{mode:'active',cost:[]},effects:[{resolution:'auto',who:'target',result:[{kind:'condition',op:'apply',value,duration:{type:'rounds',amount:2}}]}]});
    for(const [id,value] of [['CARD-0133','blinded'],['CARD-0597','prone']]){
      const target=freshFighterState();
      const passive={...mechanics(id),id};
      const ctx={character:FIGHTER_CTX_EQUIPPED,rng:()=>0.5,target:{id:'recipient',runtimeState:target,passives:[passive],characterContext:FIGHTER_CTX_EQUIPPED}};
      const result=executeAction(freshFighterState(),condition(value),ctx);
      expect(result.events.find(e=>e.type==='condition_immune')).toMatchObject({condition:value,sourceEntityIds:[id]});
      // Attacker-owned protection cannot immunize a different recipient.
      const ordinary=executeAction(freshFighterState(),condition(value),{...ctx,passives:[passive],target:{...ctx.target,passives:[]}});
      expect(ordinary.events.some(e=>e.type==='condition_immune')).toBe(false);
    }
    const state=freshFighterState();
    const ctx={character:FIGHTER_CTX_EQUIPPED,rng:()=>0.5,passives:[mechanics('CARD-0455')]};
    const self={activation:{mode:'active',cost:[]},effects:[{resolution:'auto',result:[{kind:'condition',op:'apply',value:'prone',duration:{type:'rounds',amount:2}}]}]};
    expect(executeAction(state,self,ctx).events.some(e=>e.type==='condition_immune')).toBe(false);
    state.activeEffects.push({id:'focus',name:'focus',source:'test',mechanics:{kind:'concentration'}});
    expect(executeAction(JSON.parse(JSON.stringify(state)),self,ctx).events.some(e=>e.type==='condition_immune')).toBe(true);
  });
  it('resolves two permanent fall protections and two rolled reductions without blocking attacks',()=>{
    for(const id of ['CARD-0520','CARD-0598']){
      const state=freshFighterState();state.hp={current:30,max:30,temp:0};
      const ctx={character:FIGHTER_CTX_EQUIPPED,rng:()=>0.5,passives:[mechanics(id)]};
      const landing=resolveFallLanding(state,{distanceFt:30,damage:12},ctx);
      expect(landing.state.hp.current).toBe(30);
      expect(applyIncomingDamage(state,12,ctx,{damageType:'bludgeoning'}).state.hp.current).toBe(18);
      expect(resolveFallLanding(JSON.parse(JSON.stringify(landing.state)),{distanceFt:40,damage:15},ctx).state.hp.current).toBe(30);
    }
    for(const [id,reduction] of [['CARD-0219',3],['CARD-0585',4]] as const){
      const state=freshFighterState();state.hp={current:30,max:30,temp:0};
      const result=resolveFallLanding(state,{distanceFt:30,damage:12},{character:FIGHTER_CTX_EQUIPPED,rng:()=>0.5,passives:[mechanics(id)]});
      expect(result.state.hp.current).toBe(18+reduction);
      expect(result.events.find(e=>e.type==='damage_reduction')).toMatchObject({amount:reduction,roll:{total:reduction}});
    }
  });
});
