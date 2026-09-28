import { describe, expect, it } from 'vitest';
import type { Spell } from '../types';
import { projectRuleAction } from '../canon/ruleActionProjection';

describe('catalog spell cast facts', () => {
  it.each([
    { school: 'illusion', concentration: true },
    { school: 'abjuration', concentration: false },
  ])('freezes catalog school and concentration for $school', (facts) => {
    const entity = { id: 'catalog-spell', card_number: 'SPELL-facts', name: 'Spell', level: 1, ...facts,
      mechanics: { spell_class_list_ids: ['CLASS-wizard'], activation: { mode: 'active', cost: [{ resource: 'action' }] },
        targeting: { domain: 'actor', actor_targets: false, shape: 'self', min_targets: 0, max_targets: 1, range_ft: 0, requires_line_of_sight: false, allowed_relations: ['self'] }, effects: [] } } as unknown as Spell;
    const projected = projectRuleAction(entity);
    entity.school = 'evocation';
    entity.concentration = !facts.concentration;
    expect(projected.kind).toBe('spell');
    if (projected.kind !== 'spell') throw new Error('Expected spell');
    expect(projected.spell.school).toBe(facts.school);
    expect(projected.concentration === true).toBe(facts.concentration);
  });
});
