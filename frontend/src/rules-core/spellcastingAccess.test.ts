import { describe, expect, it } from 'vitest';
import {
  replacePreparedSpells,
  resolveSpellAccess,
  type SpellcastingAccessState,
} from './spellcastingAccess';

function wizardState(): SpellcastingAccessState {
  const spellIds = ['burning-hands', 'detect-magic', 'false-life', 'mage-armor', 'magic-missile', 'shield'];
  return {
    grants: spellIds.map((actionId) => ({
      grantId: `wizard:${actionId}`,
      actionId,
      sourceId: 'CLASS-wizard',
      access: 'spellbook' as const,
      level: 1,
      spellcastingAbility: 'int' as const,
      ritual: actionId === 'detect-magic',
      slotResource: 'spell_slot_1',
    })),
    preparedSources: {
      'CLASS-wizard': {
        sourceId: 'CLASS-wizard',
        capacity: 4,
        availableActionIds: spellIds,
        preparedActionIds: ['burning-hands', 'detect-magic', 'mage-armor', 'shield'],
      },
    },
  };
}

describe('source-scoped spellcasting access', () => {
  it('rejects unknown spells, mismatched grants, and unknown preparation sources', () => {
    const state = wizardState();
    expect(resolveSpellAccess({ state, actionId: 'unknown', resources: {} }))
      .toMatchObject({ status: 'rejected', code: 'SpellNotGranted' });
    expect(resolveSpellAccess({
      state, actionId: 'shield', grantId: 'not-the-wizard-grant', resources: { spell_slot_1: 1 },
    })).toMatchObject({ status: 'rejected', code: 'SpellSourceNotGranted' });
    expect(replacePreparedSpells(state, 'CLASS-cleric', []))
      .toMatchObject({ status: 'rejected', code: 'PreparationSourceNotFound' });
  });

  it('keeps a six-spell Wizard book separate from its exact four-spell prepared subset', () => {
    const state = wizardState();
    expect(resolveSpellAccess({
      state,
      actionId: 'mage-armor',
      resources: { spell_slot_1: 1 },
    })).toMatchObject({
      status: 'allowed',
      grant: { sourceId: 'CLASS-wizard', spellcastingAbility: 'int' },
      payment: { kind: 'slot', resource: 'spell_slot_1' },
    });
    expect(resolveSpellAccess({
      state,
      actionId: 'magic-missile',
      resources: { spell_slot_1: 1 },
    })).toEqual({
      status: 'rejected',
      code: 'SpellNotPrepared',
      message: 'Spell action magic-missile is in CLASS-wizard but is not prepared',
    });
    expect(state.preparedSources['CLASS-wizard']?.availableActionIds).toHaveLength(6);
    expect(state.preparedSources['CLASS-wizard']?.preparedActionIds).toHaveLength(4);
  });

  it('changes only the Wizard prepared subset and rejects duplicates, wrong counts, and foreign spells', () => {
    const state = wizardState();
    const replaced = replacePreparedSpells(
      state,
      'CLASS-wizard',
      ['magic-missile', 'false-life', 'detect-magic', 'shield'],
    );
    expect('status' in replaced).toBe(false);
    if ('status' in replaced) throw new Error(replaced.message);
    expect(replaced.preparedSources['CLASS-wizard']).toEqual({
      sourceId: 'CLASS-wizard',
      capacity: 4,
      availableActionIds: ['burning-hands', 'detect-magic', 'false-life', 'mage-armor', 'magic-missile', 'shield'],
      preparedActionIds: ['detect-magic', 'false-life', 'magic-missile', 'shield'],
    });
    expect(state.preparedSources['CLASS-wizard']?.preparedActionIds)
      .toEqual(['burning-hands', 'detect-magic', 'mage-armor', 'shield']);

    expect(replacePreparedSpells(state, 'CLASS-wizard', [
      'shield', 'shield', 'mage-armor', 'detect-magic',
    ])).toMatchObject({ status: 'rejected', code: 'DuplicatePreparedSpell' });
    expect(replacePreparedSpells(state, 'CLASS-wizard', ['shield']))
      .toMatchObject({ status: 'rejected', code: 'PreparationCountMismatch' });
    expect(replacePreparedSpells(state, 'CLASS-wizard', [
      'shield', 'mage-armor', 'detect-magic', 'foreign-spell',
    ])).toMatchObject({ status: 'rejected', code: 'SpellOutsidePreparationSource' });
  });

  it('allows a spellbook ritual without preparation but rejects a non-ritual ritual cast', () => {
    const state = wizardState();
    const unpreparedDetectMagic = replacePreparedSpells(
      state,
      'CLASS-wizard',
      ['burning-hands', 'false-life', 'mage-armor', 'shield'],
    );
    if ('status' in unpreparedDetectMagic) throw new Error(unpreparedDetectMagic.message);
    expect(resolveSpellAccess({
      state: unpreparedDetectMagic,
      actionId: 'detect-magic',
      mode: 'ritual',
      resources: {},
    })).toMatchObject({ status: 'allowed', payment: { kind: 'none' } });
    expect(resolveSpellAccess({
      state,
      actionId: 'magic-missile',
      mode: 'ritual',
      resources: { spell_slot_1: 1 },
    })).toMatchObject({ status: 'rejected', code: 'RitualNotAllowed' });

    const ritualOnly: SpellcastingAccessState = {
      grants: [{
        grantId: 'ritual-source:identify', actionId: 'identify', sourceId: 'ritual-source',
        access: 'ritual_only', level: 1, spellcastingAbility: 'int', ritual: true,
      }],
      preparedSources: {},
    };
    expect(resolveSpellAccess({ state: ritualOnly, actionId: 'identify', resources: {} }))
      .toMatchObject({ status: 'rejected', code: 'SpellNormalCastNotAllowed' });
    expect(resolveSpellAccess({
      state: ritualOnly, actionId: 'identify', mode: 'ritual', resources: {},
    })).toMatchObject({ status: 'allowed', payment: { kind: 'none' } });
  });

  it('fails closed on an ambiguous spell source and preserves source-specific ability and payment', () => {
    const state: SpellcastingAccessState = {
      grants: [
        {
          grantId: 'elf:light', actionId: 'light', sourceId: 'lineage:high-elf', access: 'cantrip',
          level: 0, spellcastingAbility: 'cha',
        },
        {
          grantId: 'cleric:light', actionId: 'light', sourceId: 'CLASS-cleric', access: 'cantrip',
          level: 0, spellcastingAbility: 'wis',
        },
      ],
      preparedSources: {},
    };
    expect(resolveSpellAccess({ state, actionId: 'light', resources: {} }))
      .toMatchObject({ status: 'rejected', code: 'SpellSourceAmbiguous' });
    expect(resolveSpellAccess({
      state,
      actionId: 'light',
      grantId: 'elf:light',
      resources: {},
    })).toMatchObject({
      status: 'allowed',
      grant: { sourceId: 'lineage:high-elf', spellcastingAbility: 'cha' },
      payment: { kind: 'none' },
    });
  });

  it('uses a Magic Initiate free cast first and still permits a slot cast afterwards', () => {
    const state: SpellcastingAccessState = {
      grants: [{
        grantId: 'feat:magic-initiate:mage-armor',
        actionId: 'mage-armor',
        sourceId: 'FEAT-magic-initiate',
        access: 'always_prepared',
        level: 1,
        spellcastingAbility: 'wis',
        freeUseResource: 'freeuse:feat:magic-initiate:mage-armor',
        slotResource: 'spell_slot_1',
      }],
      preparedSources: {},
    };
    expect(resolveSpellAccess({
      state,
      actionId: 'mage-armor',
      resources: { 'freeuse:feat:magic-initiate:mage-armor': 1, spell_slot_1: 1 },
    })).toMatchObject({ status: 'allowed', payment: { kind: 'free_use' } });
    expect(resolveSpellAccess({
      state,
      actionId: 'mage-armor',
      resources: { 'freeuse:feat:magic-initiate:mage-armor': 0, spell_slot_1: 1 },
    })).toMatchObject({ status: 'allowed', payment: { kind: 'slot' } });
    expect(resolveSpellAccess({
      state,
      actionId: 'mage-armor',
      resources: { 'freeuse:feat:magic-initiate:mage-armor': 0, spell_slot_1: 0 },
    })).toMatchObject({ status: 'rejected', code: 'SpellResourceUnavailable' });
    expect(resolveSpellAccess({
      state,
      actionId: 'mage-armor',
      resources: {},
    })).toMatchObject({ status: 'rejected', code: 'SpellResourceUnavailable' });
    expect(resolveSpellAccess({
      state,
      actionId: 'mage-armor',
      resources: { 'freeuse:feat:magic-initiate:mage-armor': 1, spell_slot_1: 1 },
      preferFreeUse: false,
    })).toMatchObject({ status: 'allowed', payment: { kind: 'slot' } });
  });

  it('allows an explicit at-will innate levelled grant without inventing a slot payment', () => {
    const state: SpellcastingAccessState = {
      grants: [{
        grantId: 'invocation:armor-of-shadows:mage-armor',
        actionId: 'mage-armor@armor-of-shadows',
        sourceId: 'EFF-invoc-armor_of_shadows',
        access: 'innate',
        level: 1,
        spellcastingAbility: 'cha',
      }],
      preparedSources: {},
    };
    expect(resolveSpellAccess({
      state,
      actionId: 'mage-armor@armor-of-shadows',
      resources: { spell_slot_1: 0 },
    })).toMatchObject({
      status: 'allowed',
      payment: { kind: 'none' },
      grant: { sourceId: 'EFF-invoc-armor_of_shadows', access: 'innate' },
    });
  });

  it('rejects an unprepared spellbook grant when its preparation source is absent', () => {
    const state = wizardState();
    state.preparedSources = {};
    expect(resolveSpellAccess({
      state, actionId: 'shield', resources: { spell_slot_1: 1 },
    })).toMatchObject({ status: 'rejected', code: 'SpellNotPrepared' });
  });
});
