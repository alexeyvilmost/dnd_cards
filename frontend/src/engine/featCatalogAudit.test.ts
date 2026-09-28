import {describe, expect, it} from 'vitest';
import {auditedRow, featEffects, featMechanics, auditPayloads} from '../testing/featAuditFixtures';
import {FIGHTER_CTX, CARD_LEATHER_ARMOR, freshFighterState} from '../mvp/fixtures';
import {applyIncomingDamage, executeAction} from './execute';
import {collectModifiers, type ModifierQueryFacts} from './modifiers';
import {compileDeclaredMechanicsTargeting} from '../rules-core/actionTargeting';
import {expandPassiveChoicePayloads} from '../mechanics/expandChoices';
import {applyDamageDieRules} from './rollRules';

describe('fresh feat mechanics runtime audit', () => {
  it('Battle Medic spends one kit use and one target Hit Die, adding the healer proficiency rather than the target proficiency', () => {
    const actor = {...freshFighterState(), inventory:[{cardId:'6112aaef-39b3-4b91-a0fa-96f56987ebb2',qty:1}], resources:{action:1,'uses_CARD-0491':10}};
    const target = {...freshFighterState(), hp:{current:1,max:30,temp:0}, resources:{hit_dice_d8:2}};
    const result = executeAction(actor, auditedRow('ACT-feat-healer-medic').mechanics, {
      character:{...FIGHTER_CTX,profBonus:6,hitDie:'d10'},
      target:{id:'patient', runtimeState:target, characterContext:{...FIGHTER_CTX,profBonus:2,hitDie:'d8'}}, rng:()=>0,
    });
    expect(result.targetState?.hp.current).toBe(8); // target d8 rolls 1 + healer PB 6
    expect(result.targetState?.resources.hit_dice_d8).toBe(1);
    expect(result.state.resources['uses_CARD-0491']).toBe(9);
    expect(result.state.resources.action).toBe(0);
    expect(result.state.inventory).toEqual(actor.inventory);
    expect(actor.resources['uses_CARD-0491']).toBe(10);
    expect(target.resources.hit_dice_d8).toBe(2);
    expect(result.events.find(e=>e.type==='healing')).toMatchObject({amount:7});
  });
  it('Battle Medic fails without a kit charge and leaves the input target unchanged', () => {
    const target = {...freshFighterState(), hp:{current:1,max:30,temp:0},resources:{hit_dice_d8:2}};
    const actor = {...freshFighterState(),resources:{action:1,'uses_CARD-0491':0}};
    expect(()=>executeAction(actor,auditedRow('ACT-feat-healer-medic').mechanics,{
      character:FIGHTER_CTX,target:{runtimeState:target,characterContext:{...FIGHTER_CTX,hitDie:'d8'}},rng:()=>0,
    })).toThrow();
    expect(target.hp.current).toBe(1);
    expect(target.resources.hit_dice_d8).toBe(2);
    expect(actor.resources.action).toBe(1);
  });
  it('Durable heals the Hit Die alone; an unrelated declaration can still use the target Constitution', () => {
    const state = {...freshFighterState(),hp:{current:1,max:50,temp:0},resources:{bonus_action:1,hit_dice_d10:2}};
    const character = {...FIGHTER_CTX,profBonus:6,hitDie:'d10',abilityMods:{...FIGHTER_CTX.abilityMods,con:4}};
    const durable = executeAction(state,auditedRow('ACT-general-durable').mechanics,{character,rng:()=>0});
    expect(durable.state.hp.current).toBe(2);
    expect(durable.state.resources.hit_dice_d10).toBe(1);
    expect(durable.state.resources.bonus_action).toBe(0);
    const alternate = {effects:[{who:'target',resolution:'auto',result:[{kind:'healing',hit_die:'target',hit_die_modifier:'con',hit_die_modifier_source:'target'}]}]};
    const result = executeAction(state,alternate,{character,target:{runtimeState:state,characterContext:{...character,abilityMods:{...character.abilityMods,con:2}}},rng:()=>0});
    expect(result.targetState?.hp.current).toBe(4);
  });
  it('Healer rerolls spell and Battle Medic ones once without applying to unrelated healing', () => {
    const character={...FIGHTER_CTX,hitDie:'d8',profBonus:2};
    const state={...freshFighterState(),hp:{current:1,max:40,temp:0},resources:{action:1,hit_dice_d8:2,'uses_CARD-0491':10}};
    for(const spell of [undefined,{baseLevel:1,castLevel:1}]) {
      let calls=0;
      const result=executeAction(state,{effects:[{resolution:'auto',result:[{kind:'healing',amount:'1d8'}]}]}, {
        character,passives:featMechanics(6),spell,rng:()=>calls++===0?0:0.99,
      });
      expect(result.state.hp.current).toBe(spell?9:2);
      expect(calls).toBe(spell?2:1);
    }
    let calls=0;
    const medic=executeAction(state,auditedRow('ACT-feat-healer-medic').mechanics,{
      character,passives:featMechanics(6),target:{runtimeState:state,characterContext:character},rng:()=>calls++===0?0:0.99,
    });
    expect(medic.targetState?.hp.current).toBe(11);
    expect(medic.targetState?.resources.hit_dice_d8).toBe(1);
    expect(calls).toBe(2);
  });
  it.each(['wis','cha'])('Inspiring Leader %s compiles selected targets and spends its declared use', ability => {
    const mechanics = auditedRow(`ACT-general-inspiring-leader-${ability}`).mechanics;
    expect(()=>compileDeclaredMechanicsTargeting(mechanics)).not.toThrow();
    const state = {...freshFighterState(),resources:{inspiring_leader_rest:1}};
    const result = executeAction(state,mechanics,{
      character:{...FIGHTER_CTX,level:9,abilityMods:{...FIGHTER_CTX.abilityMods,wis:2,cha:4}},
      target:{id:'ally',runtimeState:freshFighterState(),characterContext:FIGHTER_CTX},rng:()=>0,
    });
    expect(result.targetState?.hp.temp).toBe(ability==='wis'?11:13);
    expect(result.state.resources.inspiring_leader_rest).toBe(0);
  });
  function collect(n:number,roll:string,filter:ModifierQueryFacts) {
    const state=freshFighterState();
    return collectModifiers(state,featMechanics(n),{roll,filter,formulaCtx:{weaponMod:4},evalCtx:{state,character:FIGHTER_CTX}});
  }
  function bonus(n:number,roll:string,filter:ModifierQueryFacts) {return collect(n,roll,filter).modifiers.reduce((sum,p)=>sum+p.value,0);}
  it('Savage Attacker covers either weapon category and rejects spell/unarmed damage', () => {
    for (const weaponCategory of ['melee','ranged'] as const) {
      expect(collect(4,'damage',{attackKind:'weapon',weaponCategory,weaponDamageLine:'base'}).rules).toContainEqual(expect.objectContaining({op:'reroll_damage',keep:'highest',once_per_turn:'origin_feat.savage_attacker'}));
    }
    for(const attackKind of ['spell','unarmed'] as const) expect(collect(4,'damage',{attackKind}).rules).toEqual([]);
    expect(collect(4,'damage',{attackKind:'weapon',weaponDamageLine:'extra'}).rules).toEqual([]);
    const rules=collect(4,'damage',{attackKind:'weapon',weaponDamageLine:'base'}).rules;
    let calls=0;
    const reroll=applyDamageDieRules([{sides:6,result:6},{sides:6,result:1}],rules,{rng:()=>[0,0.99][calls++]});
    expect(reroll.dice.filter(die=>!die.discarded).map(die=>die.result)).toEqual([6,1]);
    expect(reroll.delta).toBe(0); // equal totals 7; never picks [6,6] from separate rolls
    expect(reroll.usedRuleKeys).toEqual(['origin_feat.savage_attacker']);
  });
  it('Dueling guards a one-handed melee weapon and the base damage line', () => {
    const facts:ModifierQueryFacts={attackKind:'weapon',weaponCategory:'melee',weaponDamageLine:'base',otherWeaponEquipped:false,weaponWieldedInTwoHands:false};
    expect(bonus(54,'damage',facts)).toBe(2);
    for(const bad of [{otherWeaponEquipped:true},{weaponWieldedInTwoHands:true},{weaponCategory:'ranged' as const},{weaponDamageLine:'extra' as const}]) expect(bonus(54,'damage',{...facts,...bad})).toBe(0);
  });
  it('Defense requires worn armor as well as the incoming armor fact', () => {
    const state={...freshFighterState(),equipment:{body:CARD_LEATHER_ARMOR.id}};
    const opts={roll:'ac',filter:{wearingArmor:true},evalCtx:{state,character:{...FIGHTER_CTX,equippedCards:[CARD_LEATHER_ARMOR]}}};
    expect(collectModifiers(state,featMechanics(56),opts).modifiers.reduce((sum,p)=>sum+p.value,0)).toBe(1);
    expect(collectModifiers(state,featMechanics(56),{...opts,evalCtx:{...opts.evalCtx,state:{...state,equipment:{}}}}).modifiers).toEqual([]);
  });
  it('Great Weapon Fighting only declares the minimum for a two-handed melee weapon', () => {
    expect(collect(59,'damage',{attackKind:'weapon',weaponCategory:'melee',weaponWieldedInTwoHands:true}).rules).toContainEqual(expect.objectContaining({op:'minimum_die',value:3}));
    expect(collect(59,'damage',{attackKind:'weapon',weaponCategory:'melee',weaponWieldedInTwoHands:false}).rules).toEqual([]);
  });
  it('Two-Weapon Fighting does not double an already included ability modifier', () => {
    expect(bonus(61,'damage',{attackKind:'weapon',extraAttackSource:'light_property',abilityModifierAlreadyIncluded:false})).toBe(4);
    expect(bonus(61,'damage',{attackKind:'weapon',extraAttackSource:'light_property',abilityModifierAlreadyIncluded:true})).toBe(0);
  });
  it('Thrown Weapon Fighting and Archery respect separate ranged/base/thrown facts', () => {
    const facts:ModifierQueryFacts={attackKind:'weapon',weaponCategory:'ranged',weaponDamageLine:'base',weaponHasThrownProperty:true};
    expect(bonus(62,'damage',facts)).toBe(2);
    expect(bonus(62,'damage',{...facts,weaponHasThrownProperty:false})).toBe(0);
    expect(bonus(62,'damage',{...facts,weaponDamageLine:'extra'})).toBe(0);
    expect(bonus(63,'attack',facts)).toBe(2);
    expect(bonus(63,'attack',{...facts,weaponCategory:'melee'})).toBe(0);
    expect(bonus(63,'attack',{...facts,attackKind:'spell'})).toBe(0);
  });
  it('Energy Resistance materializes exactly the selected two resistances through canonical choice expansion', () => {
    const effect=featEffects(72)[0];
    const passives=expandPassiveChoicePayloads(effect.mechanics,effect.id,{epic_boon_energy_resistances:['cold','fire']});
    expect(passives.filter(p=>p.kind==='resistance')).toHaveLength(2);
    const state={...freshFighterState(),hp:{current:50,max:50,temp:0}};
    const ctx={character:FIGHTER_CTX,passives,rng:()=>0};
    expect(applyIncomingDamage(state,10,ctx,{damageType:'cold'}).state.hp.current).toBe(45);
    expect(applyIncomingDamage(state,10,ctx,{damageType:'fire'}).state.hp.current).toBe(45);
    expect(applyIncomingDamage(state,10,ctx,{damageType:'poison'}).state.hp.current).toBe(40);
  });
  it('Irresistible Offense bypasses physical resistance without granting a bonus against elemental resistance', () => {
    for(const type of ['slashing','piercing','bludgeoning','fire']) {
      const target={...freshFighterState(),hp:{current:50,max:50,temp:0}};
      const result=executeAction(freshFighterState(),{effects:[{resolution:'auto',who:'target',result:[{kind:'damage',amount:10,type}]}]}, {
        character:FIGHTER_CTX,passives:featMechanics(69),target:{runtimeState:target,characterContext:FIGHTER_CTX,passives:[{kind:'resistance',damage_type:type,value:'resistance'}]},rng:()=>0,
      });
      expect(result.targetState?.hp.current).toBe(type==='fire'?45:40);
    }
  });
  it('undeclared boon reactions are not silently made unconditional', () => {
    for(const n of [64,65,66,68,70,74]) {
      expect([...auditPayloads(featEffects(n))].filter(p=>p.kind && !['choice','grant_ability_score'].includes(p.kind))).toEqual([]);
    }
  });
});
