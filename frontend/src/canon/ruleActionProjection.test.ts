import { describe, expect, it } from 'vitest';
import type { Spell } from '../types';
import {
  applySpellCastingOverride,
  declaredSpellCastingOverride,
  projectRuleAction,
  RuleActionProjectionError,
} from './ruleActionProjection';

type Dict = Record<string, unknown>;

function spell(mechanics: Dict, classes: string[] = ['волшебник']): Spell {
  return {
    id: 'spell-entity-id',
    card_number: 'SPELL-stable',
    name: 'Локализованное имя',
    description: '',
    rarity: 'common',
    level: 1,
    component_verbal: true,
    component_somatic: true,
    component_material: false,
    classes,
    concentration: false,
    ritual: false,
    is_healing: false,
    mechanics,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  } as Spell;
}

function declaredMechanics(): Dict {
  return {
    spell_class_list_ids: ['CLASS-wizard'],
    activation: {
      mode: 'active',
      cost: [
        { resource: 'action' },
        { resource: 'spell_slot', level: 1, amount: 1 },
      ],
    },
    targeting: {
      domain: 'actor',
      actor_targets: true,
      shape: 'single',
      min_targets: 1,
      max_targets: 1,
      range_ft: 60,
      requires_line_of_sight: true,
      allowed_relations: ['ally', 'enemy', 'neutral'],
    },
    effects: [],
  };
}

describe('shared declarative rule-action projection', () => {
  it('takes spell-list identity only from mechanics, never localized display classes', () => {
    const first = projectRuleAction(spell(declaredMechanics(), ['волшебник']));
    const renamed = projectRuleAction(spell(declaredMechanics(), ['совсем другой текст']));

    expect(first.kind).toBe('spell');
    expect(renamed.kind).toBe('spell');
    if (first.kind !== 'spell' || renamed.kind !== 'spell') throw new Error('Expected spells');
    expect(first.spell.classListIds).toEqual(['CLASS-wizard']);
    expect(renamed.spell.classListIds).toEqual(first.spell.classListIds);
  });

  it('fails closed when an executable spell omits its cost or stable class-list ids', () => {
    const withoutCost = declaredMechanics();
    delete (withoutCost.activation as Dict).cost;
    expect(() => projectRuleAction(spell(withoutCost)))
      .toThrow(/requires explicit mechanics\.activation\.cost/);

    const withoutClassIds = declaredMechanics();
    delete withoutClassIds.spell_class_list_ids;
    expect(() => projectRuleAction(spell(withoutClassIds)))
      .toThrow(/spell_class_list_ids must be explicit stable class ids/);

    const duplicateClassIds = declaredMechanics();
    duplicateClassIds.spell_class_list_ids = ['CLASS-wizard', 'CLASS-wizard'];
    expect(() => projectRuleAction(spell(duplicateClassIds)))
      .toThrow(/spell_class_list_ids must be explicit stable class ids/);
  });

  it('applies the exact grant-owned casting override without mutating the spell card', () => {
    const source = spell(declaredMechanics());
    const grant = {
      effects: [{
        resolution: 'auto',
        result: [{
          kind: 'grant_spell',
          value: source.card_number,
          casting_override: {
            remove_cost_resources: ['spell_slot'],
            targeting: {
              domain: 'actor',
              actor_targets: false,
              shape: 'self',
              min_targets: 0,
              max_targets: 1,
              range_ft: 0,
              requires_line_of_sight: false,
              allowed_relations: [],
            },
          },
        }],
      }],
    };

    const override = declaredSpellCastingOverride(grant, source);
    const projected = applySpellCastingOverride(source, override);
    expect(((projected.mechanics?.activation as Dict).cost as Dict[]))
      .toEqual([{ resource: 'action' }]);
    expect((projected.mechanics?.targeting as Dict).shape).toBe('self');
    expect(((source.mechanics?.activation as Dict).cost as Dict[]))
      .toHaveLength(2);
    expect((source.mechanics?.targeting as Dict).shape).toBe('single');
  });

  it('rejects inert or ambiguous casting overrides', () => {
    const source = spell(declaredMechanics());
    expect(() => applySpellCastingOverride(source, {
      removeCostResources: ['pact_slot'],
    })).toThrow(RuleActionProjectionError);

    const duplicate = {
      effects: [
        { kind: 'grant_spell', value: source.id, casting_override: { remove_cost_resources: ['spell_slot'] } },
        { kind: 'grant_spell', value: source.card_number, casting_override: { remove_cost_resources: ['spell_slot'] } },
      ],
    };
    expect(() => declaredSpellCastingOverride(duplicate, source))
      .toThrow(/ambiguous casting_override declarations/);
  });
});
