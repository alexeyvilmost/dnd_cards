import {describe,expect,it} from 'vitest';
import items from '../../../scripts/content/data/item-completion-high-20260929.json';
import spells from '../../../outputs/catalog-completion-20260929/spells.json';
import {applySpellCastingOverride,declaredSpellCastingOverride,projectRuleAction} from '../canon/ruleActionProjection';
import {executeAction} from '../engine/execute';
import type {Card,Spell} from '../types';
import type {CharacterContext,RuntimeState} from '../mvp/contracts';

const raw=spells.find(spell=>spell.id==='6da6b18d-7609-4fcd-8078-8f979c4ffdeb');
if(!raw)throw Error('Canonical Fireball missing');
const fireball=raw as unknown as Spell;
const wandMechanics=items['CARD-0886'].mechanics as Record<string,unknown>;
const override=declaredSpellCastingOverride(wandMechanics,fireball)!;
const wandId=String((override.addCosts?.[0] as Record<string,unknown>).card_id);
const itemCard={id:wandId,name:'Wand',type:'other',mechanics:wandMechanics} as unknown as Card;
const character:CharacterContext={abilityMods:{str:0,dex:0,con:0,int:3,wis:0,cha:0},profBonus:2,level:5,spellcastingAbility:'int',spellcastingMod:3,knownCards:[itemCard]};
const state=():RuntimeState=>({hp:{current:20,max:20,temp:0},resources:{action:1,bonus_action:1,spell_slot_3:0},
 maxResources:{action:1,bonus_action:1,spell_slot_3:0},inventory:[{cardId:wandId,qty:1}],equipment:{},activeEffects:[]});

describe('unstable wand grants the canonical self-centered Fireball',()=>{
 it('replaces casting economy and adds one bound item cost without editing Fireball',()=>{
  const source=structuredClone(fireball);
  const altered=applySpellCastingOverride(fireball,override);
  const action=projectRuleAction(altered);
  expect(action.kind).toBe('spell');
  expect((altered.mechanics?.activation as {cost:unknown[]}).cost).toEqual([{resource:'bonus_action'},
   {resource:'item',card_id:wandId,amount:1,bound_self_item:true}]);
  expect(action.targeting?.rangeFt).toBe(0);
  expect(action.targeting?.maxTargets).toBe(8);
  expect(altered.mechanics?.effects).toEqual(fireball.mechanics?.effects);
  expect(fireball).toEqual(source);
 });
 it('spends exactly one wand and no spell slot, then resolves the original save and damage',()=>{
  const altered=applySpellCastingOverride(fireball,override);
  const mechanics={...altered.mechanics,requires_item_source:wandId};
  const before=state();
  const context={selfId:'caster',character,target:{id:'caster',saveMods:{dex:0},runtimeState:before,characterContext:character},
   spell:{spellId:fireball.id,baseLevel:3,castLevel:3,spellcastingAbility:'int' as const},rng:()=>.1};
  const result=executeAction(before,mechanics,context);
  expect(result.state.inventory).toEqual([]);
  expect(result.state.resources).toMatchObject({action:1,bonus_action:0,spell_slot_3:0});
  expect(result.events.some(event=>event.type==='damage'&&event.damageType==='fire')).toBe(true);
  expect(()=>executeAction(result.state,mechanics,{...context,target:{...context.target,runtimeState:result.state}})).toThrow();
 });
 it('applies the same additive cost primitive to another granted spell identity',()=>{
  const other={...fireball,id:'other-fireball',card_number:'other-fireball'} as Spell;
  const copied=applySpellCastingOverride(other,{...override,addCosts:[{resource:'item',card_id:'other-wand',amount:1,bound_self_item:true}]});
  expect((copied.mechanics?.activation as {cost:unknown[]}).cost).toEqual([{resource:'bonus_action'},
   {resource:'item',card_id:'other-wand',amount:1,bound_self_item:true}]);
 });
});
