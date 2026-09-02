import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../mvp/contracts';
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
