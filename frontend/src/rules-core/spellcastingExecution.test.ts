import { describe, expect, it } from 'vitest';
import type { JsonObject } from './domain';
import type { SpellcastingAccessState } from './spellcastingAccess';
import {
  prepareSpellExecution,
  type SpellRuleActionDefinition,
} from './spellcastingExecution';

function spellAction(
  id = 'detect-magic',
  cost: JsonObject[] = [
    { resource: 'action' },
    { resource: 'spell_slot', level: 1, amount: 1 },
  ],
): SpellRuleActionDefinition {
  return {
    id,
    name: id,
    kind: 'spell',
    sourceEntityIds: [`SPELL:${id}`],
    spell: {
      level: id === 'light' ? 0 : 1,
      sourceClass: 'CLASS-wizard',
      components: { verbal: true, somatic: true, material: false },
    },
    mechanics: {
      activation: { mode: 'active', cost, note: { preserve: true } },
      effects: [{ resolution: 'auto', result: [{ kind: 'narrative', text: 'test' }] }],
    },
    targeting: {
      minTargets: 0,
      maxTargets: 1,
      rangeFt: 30,
      requiresLineOfSight: true,
      allowedRelations: ['self', 'ally'],
    },
  };
}

function accessState(
  grants: SpellcastingAccessState['grants'],
  preparedActionIds: string[] = grants.map((grant) => grant.actionId),
): SpellcastingAccessState {
  const spellbookSources = [...new Set(
    grants.filter((grant) => grant.access === 'spellbook').map((grant) => grant.sourceId),
  )];
  return {
    grants,
    preparedSources: Object.fromEntries(spellbookSources.map((sourceId) => {
      const availableActionIds = grants
        .filter((grant) => grant.sourceId === sourceId)
        .map((grant) => grant.actionId);
      return [sourceId, {
        sourceId,
        capacity: preparedActionIds.length,
        availableActionIds,
        preparedActionIds,
      }];
    })),
  };
}

const wizardDetectMagic = {
  grantId: 'wizard:detect-magic',
  actionId: 'detect-magic',
  sourceId: 'CLASS-wizard',
  access: 'spellbook' as const,
  level: 1,
  spellcastingAbility: 'int' as const,
  ritual: true,
  slotResource: 'spell_slot_1',
};

function runtimeResources(resources: Record<string, number>): Record<string, number> {
  return resources;
}

describe('source-scoped spell execution preparation', () => {
  it('fails closed when a spell grant is ambiguous', () => {
    const action = spellAction('light', [{ resource: 'action' }]);
    const state = accessState([
      {
        grantId: 'wizard:light', actionId: 'light', sourceId: 'CLASS-wizard',
        access: 'cantrip', level: 0, spellcastingAbility: 'int',
      },
      {
        grantId: 'lineage:light', actionId: 'light', sourceId: 'LINEAGE-high-elf',
        access: 'cantrip', level: 0, spellcastingAbility: 'cha',
      },
    ]);

    expect(prepareSpellExecution({ action, accessState: state, resources: {} })).toEqual({
      status: 'rejected',
      stage: 'access',
      code: 'SpellSourceAmbiguous',
      message: 'Spell action light has 2 grants; grantId is required',
    });
  });

  it('rejects an unprepared spellbook spell and a grant that does not own the action', () => {
    const state = accessState([wizardDetectMagic], []);
    expect(prepareSpellExecution({
      action: spellAction(),
      accessState: state,
      resources: runtimeResources({ spell_slot_1: 1 }),
    })).toMatchObject({ status: 'rejected', stage: 'access', code: 'SpellNotPrepared' });
    expect(prepareSpellExecution({
      action: spellAction(),
      accessState: state,
      resources: { spell_slot_1: 1 },
      declaration: { grantId: 'cleric:detect-magic' },
    })).toMatchObject({ status: 'rejected', stage: 'access', code: 'SpellSourceNotGranted' });
  });

  it.each([
    {
      label: 'ordinary slot',
      grant: wizardDetectMagic,
      resources: { spell_slot_1: 1 },
      expectedPayment: { kind: 'slot', resource: 'spell_slot_1' },
    },
    {
      label: 'Pact Magic slot',
      grant: {
        ...wizardDetectMagic,
        grantId: 'warlock:detect-magic',
        sourceId: 'CLASS-warlock',
        access: 'known' as const,
        spellcastingAbility: 'cha' as const,
        slotResource: 'pact_slot_1',
      },
      resources: runtimeResources({ pact_slot_1: 1 }),
      expectedPayment: { kind: 'slot', resource: 'pact_slot_1' },
    },
    {
      label: 'free use',
      grant: {
        ...wizardDetectMagic,
        grantId: 'feat:detect-magic',
        sourceId: 'FEAT-magic-initiate',
        access: 'always_prepared' as const,
        spellcastingAbility: 'wis' as const,
        freeUseResource: 'freeuse-FEAT-detect-magic',
      },
      resources: runtimeResources({ 'freeuse-FEAT-detect-magic': 1, spell_slot_1: 1 }),
      expectedPayment: { kind: 'free_use', resource: 'freeuse-FEAT-detect-magic' },
    },
  ])('rewrites a generic spell cost to the exact $label payment', ({
    grant, resources, expectedPayment,
  }) => {
    const action = spellAction('detect-magic', [
      { resource: 'bonus_action', amount: 1 },
      { resource: 'spell_slot', level: 1, amount: 3, legacy: true },
      { resource: 'item', card_id: 'material-component', amount: 1 },
    ]);
    const result = prepareSpellExecution({
      action,
      accessState: accessState([grant]),
      resources,
    });
    expect(result).toMatchObject({ status: 'ready', payment: expectedPayment });
    if (result.status !== 'ready') throw new Error(result.message);
    expect((result.executableAction.mechanics.activation as JsonObject).cost).toEqual([
      { resource: 'bonus_action', amount: 1 },
      { resource: 'item', card_id: 'material-component', amount: 1 },
      { resource: expectedPayment.resource, amount: 1 },
    ]);
  });

  it('honors a declaration that preserves the free use and pays the ordinary slot', () => {
    const action = spellAction();
    const grant = {
      ...wizardDetectMagic,
      grantId: 'feat:detect-magic',
      sourceId: 'FEAT-magic-initiate',
      access: 'always_prepared' as const,
      freeUseResource: 'freeuse-FEAT-detect-magic',
    };
    const result = prepareSpellExecution({
      action,
      accessState: accessState([grant]),
      resources: { 'freeuse-FEAT-detect-magic': 1, spell_slot_1: 1 },
      declaration: { preferFreeUse: false },
    });

    expect(result).toMatchObject({
      status: 'ready',
      payment: { kind: 'slot', resource: 'spell_slot_1' },
    });
    if (result.status !== 'ready') throw new Error(result.message);
    expect((result.executableAction.mechanics.activation as JsonObject).cost).toEqual([
      { resource: 'action' },
      { resource: 'spell_slot_1', amount: 1 },
    ]);
  });

  it('removes the imported slot cost for an explicit at-will innate invocation grant', () => {
    const action = spellAction('mage-armor@armor-of-shadows', [
      { resource: 'action' },
      { resource: 'spell_slot', level: 1, amount: 1 },
    ]);
    const result = prepareSpellExecution({
      action,
      accessState: accessState([{
        ...wizardDetectMagic,
        grantId: 'invocation:armor-of-shadows:mage-armor',
        actionId: action.id,
        sourceId: 'EFF-invoc-armor_of_shadows',
        access: 'innate',
        spellcastingAbility: 'cha',
        slotResource: undefined,
      }]),
      resources: { action: 1, spell_slot_1: 0 },
    });

    expect(result).toMatchObject({
      status: 'ready',
      payment: { kind: 'none' },
      provenance: { sourceId: 'EFF-invoc-armor_of_shadows', access: 'innate' },
    });
    if (result.status !== 'ready') throw new Error(result.message);
    expect((result.executableAction.mechanics.activation as JsonObject).cost)
      .toEqual([{ resource: 'action' }]);
  });

  it('uses the declared source ability and source provenance', () => {
    const action = spellAction('light', [{ resource: 'action' }]);
    const state = accessState([
      {
        grantId: 'wizard:light', actionId: 'light', sourceId: 'CLASS-wizard',
        access: 'cantrip', level: 0, spellcastingAbility: 'int',
      },
      {
        grantId: 'lineage:light', actionId: 'light', sourceId: 'LINEAGE-high-elf',
        access: 'cantrip', level: 0, spellcastingAbility: 'cha',
      },
    ]);
    const result = prepareSpellExecution({
      action,
      accessState: state,
      resources: {},
      declaration: { grantId: 'lineage:light' },
    });

    expect(result).toMatchObject({
      status: 'ready',
      payment: { kind: 'none' },
      provenance: {
        grantId: 'lineage:light',
        sourceId: 'LINEAGE-high-elf',
        access: 'cantrip',
        spellcastingAbility: 'cha',
        mode: 'normal',
      },
    });
    if (result.status !== 'ready') throw new Error(result.message);
    expect((result.executableAction.mechanics.activation as JsonObject).cost)
      .toEqual([{ resource: 'action' }]);
  });

  it('ritual casting removes only spell payment while preserving action and other costs', () => {
    const action = spellAction('detect-magic', [
      { resource: 'action' },
      { resource: 'spell_slot_1', amount: 1 },
      { resource: 'item', card_id: 'incense', amount: 1 },
    ]);
    const state = accessState([wizardDetectMagic], []);
    const result = prepareSpellExecution({
      action,
      accessState: state,
      resources: {},
      declaration: { mode: 'ritual' },
    });

    expect(result).toMatchObject({
      status: 'ready',
      payment: { kind: 'none' },
      provenance: { mode: 'ritual', spellcastingAbility: 'int' },
    });
    if (result.status !== 'ready') throw new Error(result.message);
    expect((result.executableAction.mechanics.activation as JsonObject).cost).toEqual([
      { resource: 'action' },
      { resource: 'item', card_id: 'incense', amount: 1 },
    ]);
  });

  it('does not mutate or retain mutable mechanics from the action or access state', () => {
    const action = spellAction();
    const state = accessState([wizardDetectMagic]);
    const resources = { spell_slot_1: 1 };
    const actionBefore = structuredClone(action);
    const stateBefore = structuredClone(state);
    const resourcesBefore = structuredClone(resources);
    const result = prepareSpellExecution({
      action,
      accessState: state,
      resources,
    });
    if (result.status !== 'ready') throw new Error(result.message);

    expect(action).toEqual(actionBefore);
    expect(state).toEqual(stateBefore);
    expect(resources).toEqual(resourcesBefore);
    expect(result.executableAction).not.toBe(action);
    expect(result.executableAction.mechanics).not.toBe(action.mechanics);
    expect(result.executableAction.spell).not.toBe(action.spell);
    expect(result.executableAction.targeting).not.toBe(action.targeting);

    const executableEffects = result.executableAction.mechanics.effects as JsonObject[];
    const executableActivation = result.executableAction.mechanics.activation as JsonObject;
    executableEffects[0].resolution = 'changed';
    (executableActivation.note as JsonObject).preserve = false;
    result.executableAction.targeting!.allowedRelations.push('enemy');

    expect(action).toEqual(actionBefore);
    expect(state).toEqual(stateBefore);
    expect(resources).toEqual(resourcesBefore);
  });

  it('rejects malformed activation costs instead of discarding unknown input', () => {
    const action = spellAction();
    action.mechanics.activation = { mode: 'active', cost: 'action + slot' };
    expect(prepareSpellExecution({
      action,
      accessState: accessState([wizardDetectMagic]),
      resources: { spell_slot_1: 1 },
    })).toEqual({
      status: 'rejected',
      stage: 'action_definition',
      code: 'MalformedSpellActivationCost',
      message: 'Spell action detect-magic has a malformed activation cost',
    });
  });

  it('rejects a grant whose declared level could otherwise erase the action slot cost', () => {
    const action = spellAction();
    expect(prepareSpellExecution({
      action,
      accessState: accessState([{ ...wizardDetectMagic, level: 0 }]),
      resources: {},
    })).toEqual({
      status: 'rejected',
      stage: 'action_definition',
      code: 'SpellGrantLevelMismatch',
      message: 'Grant wizard:detect-magic has level 0, but detect-magic has level 1',
    });
  });
});
