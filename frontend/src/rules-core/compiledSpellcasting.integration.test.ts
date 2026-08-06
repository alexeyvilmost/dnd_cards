import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileMicroMvpL1ChoiceVariant,
  compileMicroMvpL1Overlay,
  type CompiledMicroMvpL1Provider,
  type CompiledMicroMvpL1Root,
} from '../canon/microMvpL1Overlay';
import { readProdSnapshotCatalogs } from '../canon/prodSnapshotL1Fixtures';
import {
  createLogicalClock,
  createSequentialIdFactory,
} from './determinism';
import { createWorld } from './domain';
import type {
  ActorState,
  RuleActionDefinition,
  RulesCatalog,
  UncommittedRuleEvent,
} from './domain';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';
import { replacePreparedSpells } from './spellcastingAccess';

const WIZARD = 'CLASS-wizard';
const WIZARD_BOOK = [
  'detect_magic',
  'SPELL-0174',
  'SPELL-0242',
  'SPELL-0317',
  'SPELL-0190',
  'SPELL-0171',
] as const;

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function required<T>(value: T | undefined, description: string): T {
  if (value === undefined) throw new Error(`Missing compiled spellcasting fixture: ${description}`);
  return value;
}

function declarations(events: readonly UncommittedRuleEvent[]) {
  return events.flatMap((entry) => (
    entry.payload.type === 'ActionDeclared' ? [entry.payload] : []
  ));
}

describe('compiled source-scoped Wizard spell execution', () => {
  let provider: CompiledMicroMvpL1Provider;
  let wizard: CompiledMicroMvpL1Root;
  let detectMagic: Extract<RuleActionDefinition, { kind: 'spell' }>;
  let detectMagicGrantId: string;
  let catalog: RulesCatalog;
  let highElf: CompiledMicroMvpL1Root;
  let highElfSpell: Extract<RuleActionDefinition, { kind: 'spell' }>;
  let highElfGrantId: string;
  let highElfCatalog: RulesCatalog;
  let armorWarlock: CompiledMicroMvpL1Root;
  let armorOfShadows: Extract<RuleActionDefinition, { kind: 'spell' }>;
  let armorOfShadowsGrantId: string;
  let armorWarlockCatalog: RulesCatalog;

  beforeAll(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('network is forbidden for compiled spell execution tests');
    };
    try {
      provider = await compileMicroMvpL1Overlay();
      const base = required(
        provider.roots.find((root) => root.matrixCase.klass.card_number === WIZARD),
        'Wizard root',
      );
      const spells = readProdSnapshotCatalogs().spells;
      const spellIds = WIZARD_BOOK.map((cardNumber) => required(
        spells.find((spell) => spell.card_number === cardNumber),
        `spell ${cardNumber}`,
      ).id);
      wizard = await compileMicroMvpL1ChoiceVariant({
        stableKey: base.stableKey,
        overrides: { wizard_spellbook_level_1: spellIds },
      });
      const detectMagicCard = required(
        spells.find((spell) => spell.card_number === 'detect_magic'),
        'Detect Magic card',
      );
      const action = required(wizard.rulesActions.find((candidate) => (
        candidate.kind === 'spell'
          && candidate.sourceEntityIds.includes(detectMagicCard.id)
          && candidate.sourceEntityIds.includes(wizard.matrixCase.klass.id)
      )), 'Wizard Detect Magic action');
      if (action.kind !== 'spell') throw new Error('Detect Magic compiled as a non-spell action');
      detectMagic = action;
      detectMagicGrantId = required(
        wizard.actor.spellcastingAccess?.grants.find((grant) => (
          grant.actionId === detectMagic.id && grant.sourceId === WIZARD
        )),
        'Wizard Detect Magic grant',
      ).grantId;
      const actionMap = new Map(wizard.rulesActions.map((candidate) => [candidate.id, candidate]));
      catalog = { getAction: (id) => actionMap.get(id) };

      const highElfBase = required(provider.roots.find((root) => (
        root.matrixCase.species.card_number === 'RACE-0004'
          && root.speciesAudit.lineageCardNumber === 'sub-high_elf'
      )), 'High Elf root');
      highElf = await compileMicroMvpL1ChoiceVariant({
        stableKey: highElfBase.stableKey,
        overrides: { elf_lineage_spellcasting_ability: ['cha'] },
      });
      const lineageGrant = required(highElf.actor.spellcastingAccess?.grants.find((grant) => (
        grant.sourceId === highElf.speciesAudit.lineageId && grant.level === 0
      )), 'High Elf lineage cantrip grant');
      const lineageAction = required(highElf.rulesActions.find((candidate) => (
        candidate.id === lineageGrant.actionId
      )), 'High Elf lineage cantrip action');
      if (lineageAction.kind !== 'spell') throw new Error('High Elf cantrip compiled as non-spell');
      highElfSpell = lineageAction;
      highElfGrantId = lineageGrant.grantId;
      const highElfActionMap = new Map(highElf.rulesActions.map((candidate) => [candidate.id, candidate]));
      highElfCatalog = { getAction: (id) => highElfActionMap.get(id) };

      armorWarlock = required(provider.roots.find((root) => (
        root.matrixCase.klass.card_number === 'CLASS-warlock'
          && root.selectedInvocationEffectIds.length === 1
          && root.assembled.effects.some((item) => (
            item.effect.id === root.selectedInvocationEffectIds[0]
              && item.effect.card_number === 'EFF-invoc-armor_of_shadows'
          ))
      )), 'Armor of Shadows Warlock root');
      const armorGrant = required(armorWarlock.actor.spellcastingAccess?.grants.find((grant) => (
        grant.sourceId === 'EFF-invoc-armor_of_shadows'
      )), 'Armor of Shadows Mage Armor grant');
      const armorAction = required(armorWarlock.rulesActions.find((candidate) => (
        candidate.id === armorGrant.actionId
      )), 'Armor of Shadows Mage Armor action');
      if (armorAction.kind !== 'spell') throw new Error('Armor of Shadows compiled as non-spell');
      armorOfShadows = armorAction;
      armorOfShadowsGrantId = armorGrant.grantId;
      const armorActionMap = new Map(armorWarlock.rulesActions.map((candidate) => [candidate.id, candidate]));
      armorWarlockCatalog = { getAction: (id) => armorActionMap.get(id) };
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 60_000);

  function actorWithPreparedDetectMagic(prepared: boolean): ActorState {
    const actor = copy(wizard.actor);
    actor.id = 'wizard';
    actor.controllerId = 'wizard:controller';
    const access = required(actor.spellcastingAccess, 'actor spell access');
    const source = required(access.preparedSources[WIZARD], 'Wizard prepared source');
    const otherSpells = source.availableActionIds.filter((id) => id !== detectMagic.id);
    const selected = prepared
      ? [detectMagic.id, ...otherSpells.slice(0, source.capacity - 1)]
      : otherSpells.slice(0, source.capacity);
    const replaced = replacePreparedSpells(access, WIZARD, selected);
    if ('status' in replaced) throw new Error(replaced.message);
    actor.spellcastingAccess = replaced;
    return actor;
  }

  function session(actor: ActorState) {
    const initial = createWorld({
      id: `compiled-spell:${actor.id}`,
      ruleset: provider.ruleset,
      actors: [actor],
    });
    return {
      initial,
      session: new InMemoryRulesSession(initial, catalog, {
        rng: () => 0.5,
        clock: createLogicalClock(20_000),
        nextId: createSequentialIdFactory('compiled-spell'),
      }),
    };
  }

  it('rejects an unprepared normal cast and a foreign grant before costs or events', () => {
    for (const [index, grantId] of [detectMagicGrantId, 'spell-grant:CLASS-cleric:foreign'].entries()) {
      const test = session(actorWithPreparedDetectMagic(false));
      const before = copy(test.session.getState());
      const result = test.session.dispatch({
        schemaVersion: 1,
        type: 'UseAction',
        commandId: `compiled-spell:reject:${index}`,
        expectedRevision: 0,
        rulesetContentHash: provider.ruleset.contentHash,
        actorId: 'wizard',
        actionId: detectMagic.id,
        targetIds: [],
        spell: { baseLevel: 1, grantId, mode: 'normal' },
      });

      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') expect(result.code).toBe('InvalidSpellDeclaration');
      expect(test.session.getState()).toEqual(before);
      expect(test.session.getEvents()).toEqual([]);
    }
  });

  it('casts an unprepared Wizard ritual without a slot and persists exact source provenance', () => {
    const actor = actorWithPreparedDetectMagic(false);
    const slotBefore = actor.runtime.resources.spell_slot_1;
    const test = session(actor);
    const result = test.session.dispatch({
      schemaVersion: 1,
      type: 'UseAction',
      commandId: 'compiled-spell:ritual',
      expectedRevision: 0,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: actor.id,
      actionId: detectMagic.id,
      targetIds: [],
      spell: { baseLevel: 1, grantId: detectMagicGrantId, mode: 'ritual' },
    });

    if (result.status !== 'accepted') throw new Error(`${result.code}: ${result.message}`);
    expect(test.session.getState().actors.wizard.runtime.resources.spell_slot_1).toBe(slotBefore);
    expect(declarations(result.events)).toContainEqual(expect.objectContaining({
      actorId: 'wizard',
      actionId: detectMagic.id,
      spell: expect.objectContaining({
        grantId: detectMagicGrantId,
        sourceId: WIZARD,
        spellcastingAbility: 'int',
        mode: 'ritual',
        payment: { kind: 'none' },
      }),
    }));
    expect(test.session.getState().concentrations.wizard?.actionId).toBe(detectMagic.id);
    expect(foldEvents(copy(test.initial), copy(test.session.getEvents())))
      .toEqual(test.session.getState());
  });

  it('casts a prepared Wizard spell with exactly one source-owned slot payment', () => {
    const actor = actorWithPreparedDetectMagic(true);
    const slotBefore = actor.runtime.resources.spell_slot_1;
    const test = session(actor);
    const result = test.session.dispatch({
      schemaVersion: 1,
      type: 'UseAction',
      commandId: 'compiled-spell:prepared',
      expectedRevision: 0,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: actor.id,
      actionId: detectMagic.id,
      targetIds: [],
      spell: { baseLevel: 1, grantId: detectMagicGrantId, mode: 'normal' },
    });

    if (result.status !== 'accepted') throw new Error(`${result.code}: ${result.message}`);
    expect(test.session.getState().actors.wizard.runtime.resources.spell_slot_1).toBe(slotBefore - 1);
    expect(declarations(result.events)).toContainEqual(expect.objectContaining({
      spell: expect.objectContaining({
        grantId: detectMagicGrantId,
        sourceId: WIZARD,
        spellcastingAbility: 'int',
        mode: 'normal',
        payment: { kind: 'slot', resource: 'spell_slot_1' },
      }),
    }));
    expect(foldEvents(copy(test.initial), copy(test.session.getEvents())))
      .toEqual(test.session.getState());
  });

  it('executes an Elf lineage cantrip with the persisted player-selected ability', () => {
    const actor = copy(highElf.actor);
    actor.id = 'high-elf';
    actor.controllerId = 'high-elf:controller';
    const initial = createWorld({
      id: 'compiled-spell:high-elf', ruleset: provider.ruleset, actors: [actor],
    });
    const test = new InMemoryRulesSession(initial, highElfCatalog, {
      rng: () => 0.5,
      clock: createLogicalClock(30_000),
      nextId: createSequentialIdFactory('high-elf-spell'),
    });
    const needsTarget = (highElfSpell.targeting?.minTargets ?? 0) > 0;
    const result = test.dispatch({
      schemaVersion: 1,
      type: 'UseAction',
      commandId: 'compiled-spell:high-elf',
      expectedRevision: 0,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: actor.id,
      actionId: highElfSpell.id,
      targetIds: needsTarget ? [actor.id] : [],
      ...(needsTarget ? {
        factsByTarget: {
          [actor.id]: {
            factsSource: 'scenario', boardRevision: 1, distanceFt: 0,
            lineOfSight: true, cover: 'none', relation: 'self',
          },
        },
      } : {}),
      spell: { baseLevel: 0, grantId: highElfGrantId },
      worldInput: {
        type: 'prestidigitation',
        option: {
          kind: 'sensory_effect',
          description: 'A harmless shower of sparks',
          facts: {
            factsSource: 'scenario', boardRevision: 1, distanceFt: 5, lineOfSight: true,
          },
        },
      },
    });

    if (result.status !== 'accepted') throw new Error(`${result.code}: ${result.message}`);
    expect(highElf.speciesAudit.lineageSpellcastingAbility).toBe('cha');
    expect(declarations(result.events)).toContainEqual(expect.objectContaining({
      actionId: highElfSpell.id,
      spell: expect.objectContaining({
        grantId: highElfGrantId,
        sourceId: highElf.speciesAudit.lineageId,
        spellcastingAbility: 'cha',
        payment: { kind: 'none' },
      }),
    }));
    expect(foldEvents(copy(initial), copy(test.getEvents()))).toEqual(test.getState());
  });

  it('executes Armor of Shadows as at-will Mage Armor without spending a pact slot', () => {
    const actor = copy(armorWarlock.actor);
    actor.id = 'armor-warlock';
    actor.controllerId = 'armor-warlock:controller';
    const slotBefore = actor.runtime.resources.pact_slot_1;
    const initial = createWorld({
      id: 'compiled-spell:armor-of-shadows', ruleset: provider.ruleset, actors: [actor],
    });
    const test = new InMemoryRulesSession(initial, armorWarlockCatalog, {
      rng: () => 0.5,
      clock: createLogicalClock(40_000),
      nextId: createSequentialIdFactory('armor-of-shadows'),
    });
    const result = test.dispatch({
      schemaVersion: 1,
      type: 'UseAction',
      commandId: 'compiled-spell:armor-of-shadows',
      expectedRevision: 0,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: actor.id,
      actionId: armorOfShadows.id,
      targetIds: [actor.id],
      factsByTarget: {
        [actor.id]: {
          factsSource: 'scenario', boardRevision: 1, distanceFt: 0,
          lineOfSight: true, cover: 'none', relation: 'self', willing: true,
        },
      },
      spell: { baseLevel: 1, grantId: armorOfShadowsGrantId },
    });

    if (result.status !== 'accepted') throw new Error(`${result.code}: ${result.message}`);
    expect(test.getState().actors[actor.id].runtime.resources.pact_slot_1).toBe(slotBefore);
    expect(test.getState().actors[actor.id].runtime.activeEffects).toContainEqual(
      expect.objectContaining({ roundsLeft: 4_800 }),
    );
    expect(declarations(result.events)).toContainEqual(expect.objectContaining({
      actionId: armorOfShadows.id,
      spell: expect.objectContaining({
        grantId: armorOfShadowsGrantId,
        sourceId: 'EFF-invoc-armor_of_shadows',
        spellcastingAbility: 'cha',
        payment: { kind: 'none' },
      }),
    }));
    expect(foldEvents(copy(initial), copy(test.getEvents()))).toEqual(test.getState());
  });
});
