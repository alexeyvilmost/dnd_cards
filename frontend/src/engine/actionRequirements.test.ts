import { describe, expect, it } from 'vitest';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';
import type { Card } from '../types';
import { executeAction } from './execute';
import { activeEffectRequirementIssue } from './actionRequirements';

const state = (cardNumber?: string): RuntimeState => ({
  hp: { current: 10, max: 10, temp: 0 },
  resources: {},
  maxResources: {},
  equipment: {},
  inventory: [],
  activeEffects: cardNumber ? [{
    id: 'runtime-form',
    name: 'Форма',
    source: 'Дикий облик',
    mechanics: {},
    entityRef: { kind: 'effect', id: 'effect-id', cardNumber },
  }] : [],
});

describe('temporary library-effect action requirements', () => {
  it('uses exact effect provenance and never a localized display name', () => {
    const mechanics = { requires_active_effect: 'EFFECT-wild-shape-wolf' };
    expect(activeEffectRequirementIssue(mechanics, state())).toContain('активном облике');
    expect(activeEffectRequirementIssue(mechanics, state('EFFECT-wild-shape-rat'))).toContain('активном облике');
    expect(activeEffectRequirementIssue(mechanics, state('EFFECT-wild-shape-wolf'))).toBeNull();
  });

  it('does not gate ordinary actions', () => {
    expect(activeEffectRequirementIssue({ activation: { cost: [] } }, state())).toBeNull();
  });

  it('supports a data-owned stack requirement for a shared exit action', () => {
    const active = state('EFFECT-wild-shape-wolf');
    active.activeEffects[0].mechanics = { stack_id: 'wild_shape_form' };
    const mechanics = { requires_active_effect_stack: 'wild_shape_form' };
    expect(activeEffectRequirementIssue(mechanics, state())).toContain('активном облике');
    expect(activeEffectRequirementIssue(mechanics, active)).toBeNull();
  });

  it('blocks arming a second Metamagic option for the same next spell', () => {
    const active = state('EFFECT-metamagic-quickened-armed');
    active.activeEffects[0].mechanics = { stack_id: 'metamagic_next_spell' };
    expect(activeEffectRequirementIssue({
      forbids_active_effect_stack: 'metamagic_next_spell',
    }, active)).toContain('другой вариант Метамагии');
  });
});


it.each(['held','offhand','held_with_spare','backpack','container','missing','wrong','malformed'])('enforces physical weapon availability: %s',mode=>{
 const runtime=state();
 if(['backpack','container','held_with_spare'].includes(mode))runtime.inventory=[{cardId:'weapon',qty:1,...(mode==='container'?{containerId:'bag'}:{})}];
 if(['held','held_with_spare'].includes(mode))runtime.equipment.main_hand='weapon';
 if(mode==='offhand')runtime.equipment.off_hand='weapon';
 if(mode==='wrong')runtime.equipment.main_hand='other';
 const issue=activeEffectRequirementIssue({requires_held_item:mode==='malformed'?[]:'weapon'},runtime);
 if(['held','offhand','held_with_spare'].includes(mode))expect(issue).toBeNull();else expect(issue).toBeTruthy();
});

it.each(['heavy', 'shield'])('content-owned activation predicates are checked before payment: %s', kind => {
  const runtime = state(); runtime.resources = {bonus_action: 1};
  const card = {id:'equipment', type: kind === 'shield' ? 'shield' : 'chest', defense_type:kind} as Card;
  runtime.equipment[kind === 'shield' ? 'off_hand' : 'body'] = card.id;
  const character: CharacterContext = {abilityMods:{str:3,dex:2,con:1,int:0,wis:1,cha:0},level:1,profBonus:2,knownCards:[card]};
  const mechanics = {activation:{mode:'active',cost:[{resource:'bonus_action'}],when:[{kind:'not',of:kind === 'shield' ? {kind:'wielding_shield'} : {kind:'wearing_armor',category:'heavy'}}]},effects:[]};
  expect(activeEffectRequirementIssue(mechanics,runtime,character)).toBeTruthy();
  expect(() => executeAction(runtime,mechanics,{character,rng:() => 0.5})).toThrow('условия');
  expect(runtime.resources.bonus_action).toBe(1);
  expect(activeEffectRequirementIssue(mechanics,{...runtime,equipment:{}},character)).toBeNull();
});
