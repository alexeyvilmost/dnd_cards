import { describe, expect, it } from 'vitest';
import { FREEUSE_SHOWCASE_KEY } from '../engine/freeuse';
import type { RuleActionDefinition } from '../rules-core/domain';
import { filterCombatActionsByResource } from './CombatHotbar';

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
});
