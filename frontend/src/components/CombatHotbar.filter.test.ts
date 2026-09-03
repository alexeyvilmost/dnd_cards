import { describe, expect, it } from 'vitest';
import { FREEUSE_SHOWCASE_KEY } from '../engine/freeuse';
import type { RuleActionDefinition } from '../rules-core/domain';
import { combatActionTimingAvailability, combatHotbarResourceKeys, filterCombatActionsByResource } from './CombatHotbar';

function action(id: string, resource?: string, level?: number): RuleActionDefinition {
  return {
    id,
    name: id,
    kind: id.startsWith('spell') ? 'spell' : 'action',
    mechanics: resource ? {
      activation: { mode: 'active', cost: [{ resource, amount: 1, ...(level ? { level } : {}) }] },
    } : {},
  } as RuleActionDefinition;
}

describe('combat hotbar resource filter', () => {
  const actions = [
    action('main', 'action'),
    action('bonus', 'bonus_action'),
    action('spell-slot', 'spell_slot', 2),
    action('spell-free', 'action'),
    action('passive'),
  ];

  it('shows every action by default and filters by exact canonical costs', () => {
    const freeuse = new Set(['spell-free']);
    expect(filterCombatActionsByResource(actions, null, freeuse)).toEqual(actions);
    expect(filterCombatActionsByResource(actions, 'action', freeuse).map(({ id }) => id))
      .toEqual(['main', 'spell-free']);
    expect(filterCombatActionsByResource(actions, 'bonus_action', freeuse).map(({ id }) => id))
      .toEqual(['bonus']);
    expect(filterCombatActionsByResource(actions, 'spell_slot_2', freeuse).map(({ id }) => id))
      .toEqual(['spell-slot']);
  });

  it('uses the declared free-use grant set instead of spell names', () => {
    expect(filterCombatActionsByResource(actions, FREEUSE_SHOWCASE_KEY, new Set(['spell-free']))
      .map(({ id }) => id)).toEqual(['spell-free']);
  });

  it('exposes class resources and Pact slots as usable hotbar filters', () => {
    const classActions = [action('flurry', 'focus'), action('font', 'sorcery_points')];
    expect(combatHotbarResourceKeys(classActions, {
      action: 1, bonus_action: 1, reaction: 1, focus: 2, sorcery_points: 2,
      pact_slot_1: 2, hit_dice_d8: 2, 'freeuse-misty-step': 1,
      'uses_EFF-innate-sorcery': 1, 'uses_CARD-0491': 10,
    })).toEqual([
      'action', 'bonus_action', 'reaction', 'focus', 'sorcery_points', 'pact_slot_1',
    ]);
  });

  it('shows temporary Action Surge and Quickened Spell economy with readable filters', () => {
    expect(combatHotbarResourceKeys(actions, {
      action: 1,
      action_surge_action: 1,
      quickened_spell_action: 1,
    })).toEqual(['action', 'action_surge_action', 'quickened_spell_action']);
    expect(filterCombatActionsByResource(actions, 'action_surge_action', new Set())
      .map(({ id }) => id)).toEqual(['main']);
    expect(filterCombatActionsByResource(actions, 'quickened_spell_action', new Set())
      .map(({ id }) => id)).toEqual(['spell-free']);
  });

  it('keeps reaction cards inspectable but not proactively activatable', () => {
    const reaction = {
      ...action('shield', 'reaction'),
      mechanics: {
        activation: {
          mode: 'reaction',
          cost: [{ resource: 'reaction' }, { resource: 'spell_slot', level: 1 }],
          trigger: { event: 'hit_by_attack' },
        },
      },
    } as RuleActionDefinition;

    expect(combatActionTimingAvailability(reaction)).toEqual({
      enabled: false,
      reason: 'Доступно только в окне реакции после подходящего события',
    });
    expect(filterCombatActionsByResource([reaction], 'reaction', new Set())).toEqual([reaction]);
  });
});
