import { describe, expect, it } from 'vitest';
import type { RuleActionDefinition } from '../rules-core/domain';
import {
  projectSpellcastingAccess,
  SpellcastingAccessProjectionError,
} from './spellcastingAccessProjection';

function spell(id: string, level: number): RuleActionDefinition {
  return {
    id,
    name: id,
    kind: 'spell',
    sourceEntityIds: [`entity:${id}`],
    spell: { level },
    mechanics: { activation: { mode: 'active', cost: [] } },
    targeting: {
      minTargets: 1,
      maxTargets: 1,
      rangeFt: 60,
      requiresLineOfSight: true,
      allowedRelations: ['enemy'],
    },
  };
}

describe('compiled source-scoped spellcasting access projection', () => {
  it('builds a deterministic six-spell Wizard book and exact four-spell prepared subset', () => {
    const actions = Array.from({ length: 6 }, (_, index) => spell(`wizard-${6 - index}`, 1));
    const state = projectSpellcastingAccess({
      grants: actions.map((action) => ({
        action,
        sourceId: 'CLASS-wizard',
        access: 'spellbook' as const,
        spellcastingAbility: 'int' as const,
        ritual: action.id === 'wizard-6',
        slotResource: 'spell_slot_1',
      })),
      preparedSources: [{
        sourceId: 'CLASS-wizard',
        capacity: 4,
        availableActionIds: actions.map((action) => action.id),
        preparedActionIds: ['wizard-6', 'wizard-4', 'wizard-2', 'wizard-1'],
      }],
    });

    expect(state.preparedSources['CLASS-wizard']).toEqual({
      sourceId: 'CLASS-wizard',
      capacity: 4,
      availableActionIds: ['wizard-1', 'wizard-2', 'wizard-3', 'wizard-4', 'wizard-5', 'wizard-6'],
      preparedActionIds: ['wizard-1', 'wizard-2', 'wizard-4', 'wizard-6'],
    });
    expect(state.grants).toHaveLength(6);
    expect(state.grants[5]).toMatchObject({
      grantId: 'spell-grant:CLASS-wizard:wizard-6',
      ritual: true,
      spellcastingAbility: 'int',
    });
  });

  it('keeps same-spell grants from different sources distinct', () => {
    const action = spell('light@class', 0);
    const featAction = { ...action, id: 'light@feat' };
    const state = projectSpellcastingAccess({
      grants: [
        { action, sourceId: 'CLASS-cleric', access: 'cantrip', spellcastingAbility: 'wis' },
        { action: featAction, sourceId: 'FEAT-magic-initiate', access: 'cantrip', spellcastingAbility: 'int' },
      ],
    });

    expect(state.grants.map((grant) => grant.grantId)).toEqual([
      'spell-grant:CLASS-cleric:light@class',
      'spell-grant:FEAT-magic-initiate:light@feat',
    ]);
  });

  it('fails closed for duplicate grants, missing payment, and an inconsistent prepared source', () => {
    const action = spell('detect-magic', 1);
    expect(() => projectSpellcastingAccess({
      grants: [
        { action, sourceId: 'CLASS-wizard', access: 'spellbook', spellcastingAbility: 'int' },
        { action, sourceId: 'CLASS-wizard', access: 'spellbook', spellcastingAbility: 'int' },
      ],
      preparedSources: [{
        sourceId: 'CLASS-wizard',
        capacity: 1,
        availableActionIds: ['another-action'],
        preparedActionIds: ['another-action'],
      }],
    })).toThrow(SpellcastingAccessProjectionError);
  });

  it('never invents a prepared subset when the persisted selection is absent', () => {
    const actions = Array.from({ length: 2 }, (_, index) => spell(`wizard-${index}`, 1));
    expect(() => projectSpellcastingAccess({
      grants: actions.map((action) => ({
        action,
        sourceId: 'CLASS-wizard',
        access: 'spellbook' as const,
        spellcastingAbility: 'int' as const,
        slotResource: 'spell_slot_1',
      })),
      preparedSources: [{
        sourceId: 'CLASS-wizard',
        capacity: 1,
        availableActionIds: actions.map((action) => action.id),
      } as never],
    })).toThrow(/explicit preparedActionIds are required/);
  });
});
