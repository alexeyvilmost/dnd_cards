import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileMicroMvpL1ChoiceVariant,
  type CompiledMicroMvpL1Provider,
  type CompiledMicroMvpL1Root,
} from '../canon/microMvpL1Overlay';
import { readProdSnapshotCatalogs } from '../canon/prodSnapshotL1Fixtures';
import {
  createWorld,
  type ActorState,
  type GameCommand,
  type RuleActionDefinition,
  type RulesCatalog,
  type SpatialFacts,
  type WorldState,
} from './domain';
import { createLogicalClock, createStrictRngTape, type DieTapeEntry } from './determinism';
import {
  FIND_FAMILIAR_CAST_PATH_CHOICE,
  FIND_FAMILIAR_FORM_CHOICE,
  FIND_FAMILIAR_MATERIAL_RESOURCE,
  FIND_FAMILIAR_SPIRIT_CHOICE,
  familiarActorsOwnedBy,
} from './familiarRuntime';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';
import { replacePreparedSpells } from './spellcastingAccess';
import { migrateWorldState } from './worldMigration';
import {
  compileMicroMvpAcceptanceCorpus,
  type CompiledMicroMvpAcceptanceCorpus,
} from './testing/compiledMicroMvpAcceptanceCorpus';
import {
  createCompiledRuntimeScenarioFoundation,
  runCompiledRuntimeScenario,
} from './testing/compiledMicroMvpSpeciesFeatStyleRuntime';

const FIND_FAMILIAR_CARD = 'SPELL-0241';
const CURE_WOUNDS_CARD = 'SPELL-0214';
const CHILL_TOUCH_CARD = 'chill_touch';
const SHIELD_CARD = 'SPELL-0317';
const WIZARD = 'CLASS-wizard';
const CLERIC = 'CLASS-cleric';

const FAMILIAR_KNOCKOUT: RuleActionDefinition = {
  id: 'test.action.familiar-knockout',
  name: 'Familiar knockout',
  kind: 'nonSpell',
  sourceEntityIds: ['test:familiar-zero-hp'],
  targeting: {
    minTargets: 1,
    maxTargets: 1,
    rangeFt: 30,
    requiresLineOfSight: true,
    allowedRelations: ['enemy'],
  },
  mechanics: {
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    effects: [{
      resolution: 'auto',
      who: 'target',
      result: [{ kind: 'damage', amount: '99', type: 'force' }],
    }],
  },
};

/** Immutable catalog fixture for the generic Touch target-save continuation. */
const TOUCH_SAVE_SPELL: RuleActionDefinition = {
  id: 'test.spell.touch-save',
  name: 'Test Touch Save',
  kind: 'spell',
  sourceEntityIds: ['test:spell:touch-save'],
  spell: {
    level: 0,
    sourceClass: WIZARD,
    components: { verbal: true, somatic: true, material: false },
  },
  targeting: {
    minTargets: 1,
    maxTargets: 1,
    rangeFt: 5,
    requiresLineOfSight: true,
    requiresTouch: true,
    allowedRelations: ['enemy'],
  },
  mechanics: {
    name: 'Test Touch Save',
    targeting: {
      domain: 'actor',
      actor_targets: true,
      shape: 'single',
      min_targets: 1,
      max_targets: 1,
      range_ft: 5,
      requires_line_of_sight: true,
      requires_touch: true,
      allowed_relations: ['enemy'],
    },
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    effects: [{
      resolution: 'save',
      who: 'target',
      ability: 'con',
      dc: '12',
      on_fail: [{ kind: 'damage', dice: '1d4', type: 'necrotic' }],
      on_success: [],
    }],
  },
};

type CompiledSpell = Extract<RuleActionDefinition, { kind: 'spell' }>;
type SessionCommandInput = GameCommand extends infer Command
  ? Command extends GameCommand
    ? Omit<Command, 'schemaVersion' | 'expectedRevision' | 'rulesetContentHash' | 'actorId'>
    : never
  : never;

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function required<T>(value: T | undefined, description: string): T {
  if (value === undefined) throw new Error(`Missing Find Familiar fixture: ${description}`);
  return value;
}

function actorWithId(source: ActorState, id: string): ActorState {
  const actor = copy(source);
  actor.id = id;
  actor.name = id;
  actor.controllerId = `${id}:controller`;
  if (actor.warlockPacts?.chain) {
    actor.warlockPacts.chain.ownerActorId = id;
    actor.warlockPacts.chain.activeFamiliar = null;
  }
  return actor;
}

function addIncense(actor: ActorState, amount: number): void {
  actor.runtime.resources[FIND_FAMILIAR_MATERIAL_RESOURCE] = amount;
  actor.runtime.maxResources[FIND_FAMILIAR_MATERIAL_RESOURCE] = amount;
  actor.character.resourceRecharge = {
    ...(actor.character.resourceRecharge ?? {}),
    [FIND_FAMILIAR_MATERIAL_RESOURCE]: 'never',
  };
}

function spatial(relation: SpatialFacts['relation'], distanceFt = 5): SpatialFacts {
  return {
    factsSource: 'scenario',
    boardRevision: 1,
    distanceFt,
    lineOfSight: true,
    cover: 'none',
    relation,
  };
}

function catalogFor(...roots: CompiledMicroMvpL1Root[]): RulesCatalog {
  const actions = new Map(roots.flatMap((root) => root.rulesActions)
    .map((action) => [action.id, action] as const));
  return { getAction: (id) => actions.get(id) };
}

function findFamiliarSpell(root: CompiledMicroMvpL1Root): {
  action: CompiledSpell;
  grantId: string;
} {
  const entity = required(
    root.assembled.spells.find((spell) => spell.card_number === FIND_FAMILIAR_CARD),
    `${root.stableKey} Find Familiar entity`,
  );
  const action = required(root.rulesActions.find((candidate) => (
    candidate.kind === 'spell' && candidate.sourceEntityIds.includes(entity.id)
  )), `${root.stableKey} Find Familiar action`);
  if (action.kind !== 'spell') throw new Error('Find Familiar compiled as a non-spell action');
  const grant = required(root.actor.spellcastingAccess?.grants.find((candidate) => (
    candidate.actionId === action.id
  )), `${root.stableKey} Find Familiar grant`);
  return { action, grantId: grant.grantId };
}

function compiledSpell(
  provider: CompiledMicroMvpL1Provider,
  cardNumber: string,
  classCardNumber: string,
): {
  root: CompiledMicroMvpL1Root;
  action: CompiledSpell;
  grantId: string;
} {
  const root = required(provider.roots
    .filter((candidate) => candidate.matrixCase.klass.card_number === classCardNumber)
    .sort((left, right) => left.stableKey.localeCompare(right.stableKey))
    .find((candidate) => candidate.assembled.spells.some((spell) => (
      spell.card_number === cardNumber
    ))), `${classCardNumber} root containing ${cardNumber}`);
  const entity = required(root.assembled.spells.find((spell) => (
    spell.card_number === cardNumber
  )), `${cardNumber} entity`);
  const action = required(root.rulesActions.find((candidate): candidate is CompiledSpell => (
    candidate.kind === 'spell' && candidate.sourceEntityIds.includes(entity.id)
  )), `${cardNumber} compiled action`);
  const grant = required(root.actor.spellcastingAccess?.grants.find((candidate) => (
    candidate.actionId === action.id
  )), `${cardNumber} source-scoped grant`);
  return { root, action, grantId: grant.grantId };
}

function grantCompiledSpell(
  actor: ActorState,
  spell: ReturnType<typeof compiledSpell>,
): void {
  const grant = required(spell.root.actor.spellcastingAccess?.grants.find((candidate) => (
    candidate.grantId === spell.grantId
  )), `${spell.action.id} grant`);
  actor.capabilities.actionIds = [...new Set([...actor.capabilities.actionIds, spell.action.id])].sort();
  actor.spellcastingAccess = {
    grants: [...(actor.spellcastingAccess?.grants ?? []), copy(grant)]
      .sort((left, right) => left.sourceId.localeCompare(right.sourceId)
        || left.actionId.localeCompare(right.actionId)
        || left.grantId.localeCompare(right.grantId)),
    preparedSources: { ...(actor.spellcastingAccess?.preparedSources ?? {}) },
  };
}

function prepareSpellOnActor(actor: ActorState, sourceId: string, actionId: string): void {
  const access = required(actor.spellcastingAccess, `${actor.id} spellcasting access`);
  const source = required(access.preparedSources[sourceId], `${actor.id} prepared source ${sourceId}`);
  const selected = [
    actionId,
    ...source.preparedActionIds.filter((candidate) => candidate !== actionId),
    ...source.availableActionIds.filter((candidate) => (
      candidate !== actionId && !source.preparedActionIds.includes(candidate)
    )),
  ].slice(0, source.capacity);
  const replaced = replacePreparedSpells(access, sourceId, selected);
  if ('status' in replaced) throw new Error(replaced.message);
  actor.spellcastingAccess = replaced;
}

function recordedEngineEvents(events: ReturnType<typeof accept>['events']) {
  return events.flatMap((event) => (
    event.payload.type === 'EngineEventRecorded' ? [event.payload.event] : []
  ));
}

function command(
  session: InMemoryRulesSession,
  rulesetHash: string,
  actorId: string,
  value: SessionCommandInput,
): GameCommand {
  return {
    schemaVersion: 1,
    expectedRevision: session.getState().revision,
    rulesetContentHash: rulesetHash,
    actorId,
    ...value,
  } as GameCommand;
}

function accept(
  session: InMemoryRulesSession,
  rulesetHash: string,
  actorId: string,
  value: Parameters<typeof command>[3],
) {
  const result = session.dispatch(command(session, rulesetHash, actorId, value));
  if (result.status === 'rejected') throw new Error(`${result.code}: ${result.message}`);
  return result;
}

function reject(
  session: InMemoryRulesSession,
  rulesetHash: string,
  actorId: string,
  value: Parameters<typeof command>[3],
) {
  const before = copy(session.getState());
  const result = session.dispatch(command(session, rulesetHash, actorId, value));
  expect(result.status).toBe('rejected');
  expect(session.getState()).toEqual(before);
  return result;
}

function assertReplay(initial: WorldState, session: InMemoryRulesSession): void {
  const persisted = copy(session.getState());
  expect(migrateWorldState(persisted)).toEqual(persisted);
  expect(foldEvents(copy(initial), copy(session.getEvents()))).toEqual(session.getState());
}

describe('canonical compiled Find Familiar world runtime', () => {
  let provider: CompiledMicroMvpL1Provider;
  let acceptanceCorpus: CompiledMicroMvpAcceptanceCorpus;
  let wizardRoot: CompiledMicroMvpL1Root;
  let chainRoot: CompiledMicroMvpL1Root;
  let wizardFamiliar: ReturnType<typeof findFamiliarSpell>;
  let chainFamiliar: ReturnType<typeof findFamiliarSpell>;
  let cureWounds: ReturnType<typeof compiledSpell>;
  let chillTouch: ReturnType<typeof compiledSpell>;
  let shield: ReturnType<typeof compiledSpell>;

  beforeAll(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('network is forbidden for Find Familiar runtime tests');
    };
    try {
      acceptanceCorpus = await compileMicroMvpAcceptanceCorpus();
      provider = acceptanceCorpus.compiled;
      const catalogs = readProdSnapshotCatalogs();
      const wizardBase = required(provider.roots.find((root) => (
        root.matrixCase.klass.card_number === WIZARD
      )), 'Wizard root');
      const wizardBookCards = [
        FIND_FAMILIAR_CARD,
        'detect_magic',
        'SPELL-0174',
        'SPELL-0242',
        'SPELL-0317',
        'SPELL-0190',
      ];
      wizardRoot = await compileMicroMvpL1ChoiceVariant({
        stableKey: wizardBase.stableKey,
        overrides: {
          wizard_cantrips: ['fire_bolt', 'SPELL-0218', CHILL_TOUCH_CARD],
          wizard_spellbook_level_1: wizardBookCards.map((cardNumber) => required(
            catalogs.spells.find((spell) => spell.card_number === cardNumber),
            cardNumber,
          ).id),
        },
      });
      wizardFamiliar = findFamiliarSpell(wizardRoot);
      const access = required(wizardRoot.actor.spellcastingAccess, 'Wizard spell access');
      const prepared = required(access.preparedSources[WIZARD], 'Wizard prepared source');
      const selected = [
        wizardFamiliar.action.id,
        ...prepared.availableActionIds.filter((id) => id !== wizardFamiliar.action.id)
          .slice(0, prepared.capacity - 1),
      ];
      const replaced = replacePreparedSpells(access, WIZARD, selected);
      if ('status' in replaced) throw new Error(replaced.message);
      wizardRoot = {
        ...wizardRoot,
        actor: { ...wizardRoot.actor, spellcastingAccess: replaced },
      };

      const warlockBase = required(provider.roots.find((root) => (
        root.matrixCase.klass.card_number === 'CLASS-warlock'
      )), 'Warlock root');
      chainRoot = await compileMicroMvpL1ChoiceVariant({
        stableKey: warlockBase.stableKey,
        overrides: { warlock_invocation_l1: ['EFF-pact-chain'] },
      });
      chainFamiliar = findFamiliarSpell(chainRoot);
      cureWounds = compiledSpell(provider, CURE_WOUNDS_CARD, CLERIC);
      chillTouch = compiledSpell({ ...provider, roots: [wizardRoot] }, CHILL_TOUCH_CARD, WIZARD);
      shield = compiledSpell({ ...provider, roots: [wizardRoot] }, SHIELD_CARD, WIZARD);
      expect((wizardFamiliar.action.mechanics.primitive as Record<string, unknown>).type)
        .toBe('find_familiar');
      expect((chainFamiliar.action.mechanics.primitive as Record<string, unknown>).type)
        .toBe('find_familiar');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 60_000);

  function makeSession(input: {
    id: string;
    owner: ActorState;
    support: ActorState;
    catalog: RulesCatalog;
    dice?: readonly DieTapeEntry[];
  }) {
    const initial = createWorld({
      id: input.id,
      ruleset: provider.ruleset,
      actors: [input.owner, input.support],
    });
    const tape = createStrictRngTape(input.dice ?? []);
    return {
      initial: copy(initial),
      tape,
      session: new InMemoryRulesSession(initial, input.catalog, {
        rng: tape.rng,
        clock: createLogicalClock(50_000),
        nextId: () => {
          throw new Error('Persisted IDs must be command-derived');
        },
      }),
    };
  }

  function assertMandatoryProtocol(
    root: CompiledMicroMvpL1Root,
    scenarioId: string,
    index: number,
  ): void {
    const foundation = createCompiledRuntimeScenarioFoundation({
      corpus: acceptanceCorpus,
      root,
      index,
      idPrefix: scenarioId.toLowerCase(),
    });
    runCompiledRuntimeScenario({ foundation, spec: copy(foundation.spec) });
  }

  it('ritually creates one pinned actor, runs strict turns/senses/dismiss/reappear, and never restores incense', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-FAMILIAR-LIFECYCLE-01' },
  }, () => {
    assertMandatoryProtocol(wizardRoot, 'SC-FAMILIAR-LIFECYCLE-01', 9_010);
    const wizard = actorWithId(wizardRoot.actor, 'wizard');
    const fighter = actorWithId(wizardRoot.actor, 'fighter');
    addIncense(wizard, 30);
    const test = makeSession({
      id: 'find-familiar:wizard-lifecycle',
      owner: wizard,
      support: fighter,
      catalog: catalogFor(wizardRoot),
      dice: [
        { label: 'owl initiative', sides: 20, value: 14 },
        { label: 'wizard familiar-lifecycle check', sides: 20, value: 12 },
        { label: 'fighter familiar-lifecycle save', sides: 20, value: 13 },
      ],
    });
    const slotsBefore = wizard.runtime.resources.spell_slot_1;
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'UseAction',
      commandId: 'wizard:ritual-cast',
      actionId: wizardFamiliar.action.id,
      targetIds: [],
      spell: { baseLevel: 1, grantId: wizardFamiliar.grantId, mode: 'ritual' },
      choices: {
        [FIND_FAMILIAR_FORM_CHOICE]: 'owl',
        [FIND_FAMILIAR_SPIRIT_CHOICE]: 'fey',
        [FIND_FAMILIAR_CAST_PATH_CHOICE]: 'ritual',
      },
    });
    let familiar = required(familiarActorsOwnedBy(test.session.getState(), 'wizard')[0], 'created owl');
    expect(familiar).toMatchObject({
      kind: 'summonedActor',
      name: 'Owl',
      controllerId: 'wizard:controller',
      capabilities: { actionIds: [] },
      familiarState: {
        ownerActorId: 'wizard',
        spiritType: 'fey',
        presence: 'present',
        initiative: { mode: 'own', total: null },
        canAttackNormally: false,
      },
      familiarMetadata: {
        formId: 'owl',
        statBlockId: 'mm2025.creature.owl',
        summoningActionId: wizardFamiliar.action.id,
      },
    });
    expect(test.session.getState().actors.wizard.runtime.resources).toMatchObject({
      spell_slot_1: slotsBefore,
      [FIND_FAMILIAR_MATERIAL_RESOURCE]: 20,
    });
    const castCheckpoint = migrateWorldState(copy(test.session.getState()));
    expect(castCheckpoint).toEqual(test.session.getState());

    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'TakeLongRest', commandId: 'wizard:long-rest', durationHours: 8,
    });
    expect(test.session.getState().actors.wizard.runtime.resources[FIND_FAMILIAR_MATERIAL_RESOURCE])
      .toBe(20);

    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'StartEncounter',
      commandId: 'wizard:start-encounter',
      initiative: ['wizard', familiar.id, 'fighter'],
    });
    familiar = test.session.getState().actors[familiar.id];
    expect(familiar.familiarState?.initiative).toEqual({
      mode: 'own', d20Roll: 14, modifier: 1, total: 15,
    });
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'StartTurn', commandId: 'wizard:r1:start',
    });
    const check = accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'AbilityCheck', commandId: 'wizard:r1:check', ability: 'int', dc: 10,
    });
    expect(check.events).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'EngineEventRecorded',
        event: expect.objectContaining({ type: 'roll', roll: expect.objectContaining({ kind: 'check' }) }),
      }),
    }));
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'UseFamiliarSharedSenses',
      commandId: 'wizard:r1:senses',
      familiarActorId: familiar.id,
      facts: {
        factsSource: 'scenario', boardRevision: 2, distanceFt: 80, lineOfSight: false,
      },
    });
    const senses = required(
      test.session.getState().actors[familiar.id].familiarState?.sharedSenses ?? undefined,
      'shared-senses lifetime',
    );
    expect(senses.expiresAtOwnerTurnStart).toBe(senses.activatedOnOwnerTurn + 1);
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'EndTurn', commandId: 'wizard:r1:end',
    });
    accept(test.session, provider.ruleset.contentHash, familiar.id, {
      type: 'StartTurn', commandId: 'owl:r1:start',
    });
    const ordinaryAttack = reject(test.session, provider.ruleset.contentHash, familiar.id, {
      type: 'BeginAttackAction', commandId: 'owl:r1:illegal-attack',
    });
    expect(ordinaryAttack).toMatchObject({ status: 'rejected', code: 'CapabilityDenied' });
    accept(test.session, provider.ruleset.contentHash, familiar.id, {
      type: 'EndTurn', commandId: 'owl:r1:end',
    });
    accept(test.session, provider.ruleset.contentHash, 'fighter', {
      type: 'StartTurn', commandId: 'fighter:r1:start',
    });
    const save = accept(test.session, provider.ruleset.contentHash, 'fighter', {
      type: 'SavingThrow', commandId: 'fighter:r1:save', ability: 'dex', dc: 10,
    });
    expect(save.events).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'EngineEventRecorded',
        event: expect.objectContaining({ type: 'roll', roll: expect.objectContaining({ kind: 'save' }) }),
      }),
    }));
    accept(test.session, provider.ruleset.contentHash, 'fighter', {
      type: 'EndTurn', commandId: 'fighter:r1:end',
    });

    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'StartTurn', commandId: 'wizard:r2:start',
    });
    expect(test.session.getState().actors[familiar.id].familiarState?.sharedSenses).toBeNull();
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'DismissFamiliar',
      commandId: 'wizard:r2:dismiss',
      familiarActorId: familiar.id,
      mode: 'temporary',
    });
    expect(test.session.getState().actors[familiar.id].familiarState?.presence)
      .toBe('pocket_dimension');
    expect((test.session.getState().scene as { initiative: string[] }).initiative)
      .toEqual(['wizard', 'fighter']);
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'EndTurn', commandId: 'wizard:r2:end',
    });
    accept(test.session, provider.ruleset.contentHash, 'fighter', {
      type: 'StartTurn', commandId: 'fighter:r2:start',
    });
    accept(test.session, provider.ruleset.contentHash, 'fighter', {
      type: 'EndTurn', commandId: 'fighter:r2:end',
    });
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'StartTurn', commandId: 'wizard:r3:start',
    });
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'ReappearFamiliar',
      commandId: 'wizard:r3:reappear',
      familiarActorId: familiar.id,
      facts: {
        factsSource: 'scenario', boardRevision: 3, distanceFt: 25,
        lineOfSight: false, unoccupiedSpace: true,
      },
    });
    expect(test.session.getState().actors[familiar.id].familiarState?.presence).toBe('present');
    expect((test.session.getState().scene as { initiative: string[] }).initiative)
      .toEqual(['wizard', familiar.id, 'fighter']);

    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'EndTurn', commandId: 'wizard:r3:end',
    });
    accept(test.session, provider.ruleset.contentHash, familiar.id, {
      type: 'StartTurn', commandId: 'owl:r3:start',
    });
    accept(test.session, provider.ruleset.contentHash, familiar.id, {
      type: 'EndTurn', commandId: 'owl:r3:end',
    });
    accept(test.session, provider.ruleset.contentHash, 'fighter', {
      type: 'StartTurn', commandId: 'fighter:r3:start',
    });
    accept(test.session, provider.ruleset.contentHash, 'fighter', {
      type: 'EndTurn', commandId: 'fighter:r3:end',
    });
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'StartTurn', commandId: 'wizard:r4:start',
    });
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'DismissFamiliar',
      commandId: 'wizard:r4:dismiss-forever',
      familiarActorId: familiar.id,
      mode: 'forever',
    });
    expect(test.session.getState().actors[familiar.id]).toBeUndefined();
    expect((test.session.getState().scene as { initiative: string[] }).initiative)
      .toEqual(['wizard', 'fighter']);

    assertReplay(test.initial, test.session);
    test.tape.assertExhausted();
  });

  it('casts Pact Chain at will, gives the familiar its own turn, and replaces exactly one owner attack with its Reaction', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-FAMILIAR-PACT-CHAIN-01' },
  }, () => {
    assertMandatoryProtocol(chainRoot, 'SC-FAMILIAR-PACT-CHAIN-01', 9_011);
    const warlock = actorWithId(chainRoot.actor, 'warlock');
    const fighter = actorWithId(wizardRoot.actor, 'fighter');
    addIncense(warlock, 20);
    fighter.runtime.hp.current = fighter.runtime.hp.max;
    const test = makeSession({
      id: 'find-familiar:pact-chain-attack',
      owner: warlock,
      support: fighter,
      catalog: catalogFor(chainRoot, wizardRoot),
      dice: [
        { label: 'warlock Pact Chain check', sides: 20, value: 12 },
        { label: 'owl conjured initiative', sides: 20, value: 11 },
        { label: 'fighter Pact Chain save', sides: 20, value: 13 },
        { label: 'owl talons attack', sides: 20, value: 16 },
      ],
    });
    const slotsBefore = warlock.runtime.resources.spell_slot_1;
    accept(test.session, provider.ruleset.contentHash, 'warlock', {
      type: 'StartEncounter', commandId: 'chain:encounter', initiative: ['warlock', 'fighter'],
    });
    accept(test.session, provider.ruleset.contentHash, 'warlock', {
      type: 'StartTurn', commandId: 'chain:r1:warlock:start',
    });
    accept(test.session, provider.ruleset.contentHash, 'warlock', {
      type: 'AbilityCheck', commandId: 'chain:r1:warlock:check', ability: 'cha', dc: 10,
    });
    accept(test.session, provider.ruleset.contentHash, 'warlock', {
      type: 'UseAction',
      commandId: 'chain:cast',
      actionId: chainFamiliar.action.id,
      targetIds: [],
      spell: { baseLevel: 1, grantId: chainFamiliar.grantId, mode: 'normal' },
      choices: {
        [FIND_FAMILIAR_FORM_CHOICE]: 'owl',
        [FIND_FAMILIAR_SPIRIT_CHOICE]: 'fiend',
        [FIND_FAMILIAR_CAST_PATH_CHOICE]: 'pact_chain_magic_action',
      },
    });
    const familiar = required(familiarActorsOwnedBy(test.session.getState(), 'warlock')[0], 'Pact owl');
    expect(test.session.getState().actors.warlock.runtime.resources).toMatchObject({
      spell_slot_1: slotsBefore,
      [FIND_FAMILIAR_MATERIAL_RESOURCE]: 10,
    });
    expect(familiar.familiarState?.initiative).toEqual({
      mode: 'own', d20Roll: 11, modifier: 1, total: 12,
    });
    expect(test.session.getState().actors.warlock.warlockPacts?.chain?.activeFamiliar)
      .toMatchObject({
        actorId: familiar.id,
        ownerActorId: 'warlock',
        formId: 'owl',
        reactionAvailable: true,
      });
    const castCheckpoint = migrateWorldState(copy(test.session.getState()));
    expect(castCheckpoint).toEqual(test.session.getState());

    accept(test.session, provider.ruleset.contentHash, 'warlock', {
      type: 'EndTurn', commandId: 'chain:r1:warlock:end',
    });
    accept(test.session, provider.ruleset.contentHash, familiar.id, {
      type: 'StartTurn', commandId: 'chain:r1:owl:start',
    });
    accept(test.session, provider.ruleset.contentHash, familiar.id, {
      type: 'EndTurn', commandId: 'chain:r1:owl:end',
    });
    accept(test.session, provider.ruleset.contentHash, 'fighter', {
      type: 'StartTurn', commandId: 'chain:r1:fighter:start',
    });
    accept(test.session, provider.ruleset.contentHash, 'fighter', {
      type: 'SavingThrow', commandId: 'chain:r1:fighter:save', ability: 'dex', dc: 10,
    });
    accept(test.session, provider.ruleset.contentHash, 'fighter', {
      type: 'EndTurn', commandId: 'chain:r1:fighter:end',
    });
    accept(test.session, provider.ruleset.contentHash, 'warlock', {
      type: 'StartTurn', commandId: 'chain:r2:warlock:start',
    });
    const begin = accept(test.session, provider.ruleset.contentHash, 'warlock', {
      type: 'BeginAttackAction', commandId: 'chain:r2:attack',
    });
    const attackActionId = required(begin.events.flatMap((event) => (
      event.payload.type === 'AttackActionStarted' ? [event.payload.attackAction.id] : []
    ))[0], 'owner Attack action');
    const hpBefore = test.session.getState().actors.fighter.runtime.hp.current;
    accept(test.session, provider.ruleset.contentHash, 'warlock', {
      type: 'PerformPactChainFamiliarAttack',
      commandId: 'chain:r2:owl-talons',
      attackActionId,
      familiarActorId: familiar.id,
      familiarActionId: 'mm2025.owl.talons',
      targetActorId: 'fighter',
      facts: spatial('enemy'),
    });
    const attackLedger = test.session.getState().attackActions[attackActionId];
    expect(attackLedger).toMatchObject({
      actorId: 'warlock',
      status: 'completed',
      sequence: {
        attacksRemaining: 0,
        usedReplacementKeys: ['pact-chain:familiar-attack'],
      },
    });
    expect(attackLedger.sequence.entries).toEqual([expect.objectContaining({
      kind: 'replacement',
      actionId: 'mm2025.owl.talons',
      sourceEntityIds: expect.arrayContaining([
        chainRoot.actor.warlockPacts!.chain!.sourceEntityId,
        'phb2024.beast.owl',
      ]),
    })]);
    expect(test.session.getState().actors.fighter.runtime.hp.current).toBe(hpBefore - 1);
    expect(test.session.getState().actors[familiar.id].runtime.resources.reaction).toBe(0);
    expect(test.session.getState().actors[familiar.id].familiarState?.reactionAvailable).toBe(false);
    expect(test.session.getState().actors.warlock.warlockPacts?.chain?.activeFamiliar?.reactionAvailable)
      .toBe(false);

    const second = reject(test.session, provider.ruleset.contentHash, 'warlock', {
      type: 'PerformPactChainFamiliarAttack',
      commandId: 'chain:r2:second-attack',
      attackActionId,
      familiarActorId: familiar.id,
      familiarActionId: 'mm2025.owl.talons',
      targetActorId: 'fighter',
      facts: spatial('enemy'),
    });
    expect(second).toMatchObject({ status: 'rejected', code: 'AttackActionClosed' });

    assertReplay(test.initial, test.session);
    test.tape.assertExhausted();
  });

  it('uses a normal slot to change the one existing spirit form and rejects hour-long casting in combat', () => {
    const wizard = actorWithId(wizardRoot.actor, 'wizard');
    const fighter = actorWithId(wizardRoot.actor, 'fighter');
    addIncense(wizard, 30);
    const test = makeSession({
      id: 'find-familiar:normal-recast',
      owner: wizard,
      support: fighter,
      catalog: catalogFor(wizardRoot),
      dice: [{ label: 'changed familiar initiative', sides: 20, value: 9 }],
    });
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'UseAction',
      commandId: 'recast:ritual-cat',
      actionId: wizardFamiliar.action.id,
      targetIds: [],
      spell: { baseLevel: 1, grantId: wizardFamiliar.grantId, mode: 'ritual' },
      choices: {
        [FIND_FAMILIAR_FORM_CHOICE]: 'cat',
        [FIND_FAMILIAR_SPIRIT_CHOICE]: 'celestial',
        [FIND_FAMILIAR_CAST_PATH_CHOICE]: 'ritual',
      },
    });
    const first = required(familiarActorsOwnedBy(test.session.getState(), 'wizard')[0], 'first form');
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'TakeLongRest', commandId: 'recast:rest', durationHours: 8,
    });
    const slotBefore = test.session.getState().actors.wizard.runtime.resources.spell_slot_1;
    const recast = accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'UseAction',
      commandId: 'recast:slot-owl',
      actionId: wizardFamiliar.action.id,
      targetIds: [],
      spell: { baseLevel: 1, grantId: wizardFamiliar.grantId, mode: 'normal' },
      choices: {
        [FIND_FAMILIAR_FORM_CHOICE]: 'owl',
        [FIND_FAMILIAR_SPIRIT_CHOICE]: 'celestial',
        [FIND_FAMILIAR_CAST_PATH_CHOICE]: 'spell_slot',
      },
    });
    const changed = required(familiarActorsOwnedBy(test.session.getState(), 'wizard')[0], 'changed form');
    expect(changed.id).toBe(first.id);
    expect(changed.familiarMetadata?.formId).toBe('owl');
    expect(familiarActorsOwnedBy(test.session.getState(), 'wizard')).toHaveLength(1);
    expect(test.session.getState().actors.wizard.runtime.resources).toMatchObject({
      spell_slot_1: slotBefore - 1,
      [FIND_FAMILIAR_MATERIAL_RESOURCE]: 10,
    });
    expect(recast.events.find((event) => event.payload.type === 'FamiliarActorUpserted')?.payload)
      .toMatchObject({
        casting: { method: 'spell_slot', consumedIncenseGp: 10, created: false, changedForm: true },
      });

    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'StartEncounter', commandId: 'recast:start-encounter',
      initiative: ['wizard', changed.id, 'fighter'],
    });
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'StartTurn', commandId: 'recast:wizard:start',
    });
    const illegalCombatCast = reject(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'UseAction',
      commandId: 'recast:illegal-combat-slot',
      actionId: wizardFamiliar.action.id,
      targetIds: [],
      spell: { baseLevel: 1, grantId: wizardFamiliar.grantId, mode: 'normal' },
      choices: {
        [FIND_FAMILIAR_FORM_CHOICE]: 'bat',
        [FIND_FAMILIAR_SPIRIT_CHOICE]: 'fiend',
        [FIND_FAMILIAR_CAST_PATH_CHOICE]: 'spell_slot',
      },
    });
    expect(illegalCombatCast).toMatchObject({ status: 'rejected', code: 'InvalidActionTiming' });
    assertReplay(test.initial, test.session);
    test.tape.assertExhausted();
  });

  it('delivers a real compiled Touch spell from the familiar, spends its Reaction, then refreshes it on its turn', () => {
    const wizard = actorWithId(wizardRoot.actor, 'wizard');
    const fighter = actorWithId(wizardRoot.actor, 'fighter');
    grantCompiledSpell(wizard, cureWounds);
    addIncense(wizard, 10);
    fighter.runtime.hp = { current: 4, max: 30, temp: 0 };
    const test = makeSession({
      id: 'find-familiar:touch-delivery',
      owner: wizard,
      support: fighter,
      catalog: catalogFor(wizardRoot, cureWounds.root),
      dice: [
        { label: 'touch familiar initiative', sides: 20, value: 12 },
        { label: 'delivered Cure Wounds die 1', sides: 8, value: 3 },
        { label: 'delivered Cure Wounds die 2', sides: 8, value: 4 },
      ],
    });
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'UseAction',
      commandId: 'touch:ritual-cast',
      actionId: wizardFamiliar.action.id,
      targetIds: [],
      spell: { baseLevel: 1, grantId: wizardFamiliar.grantId, mode: 'ritual' },
      choices: {
        [FIND_FAMILIAR_FORM_CHOICE]: 'owl',
        [FIND_FAMILIAR_SPIRIT_CHOICE]: 'celestial',
        [FIND_FAMILIAR_CAST_PATH_CHOICE]: 'ritual',
      },
    });
    const familiar = required(familiarActorsOwnedBy(test.session.getState(), 'wizard')[0], 'touch familiar');
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'TakeLongRest', commandId: 'touch:rest', durationHours: 8,
    });
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'StartEncounter', commandId: 'touch:encounter',
      initiative: ['wizard', familiar.id, 'fighter'],
    });
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'StartTurn', commandId: 'touch:wizard:start',
    });
    const tooFar = reject(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'DeliverTouchSpellThroughFamiliar',
      commandId: 'touch:too-far',
      familiarActorId: familiar.id,
      spellActionId: cureWounds.action.id,
      targetActorId: 'fighter',
      ownerToFamiliarFacts: {
        factsSource: 'scenario', boardRevision: 2, distanceFt: 101, lineOfSight: false,
      },
      familiarToTargetFacts: spatial('ally'),
      spell: { baseLevel: 1, grantId: cureWounds.grantId, mode: 'normal' },
    });
    expect(tooFar).toMatchObject({ status: 'rejected', code: 'InvalidDecision' });

    const slotBefore = test.session.getState().actors.wizard.runtime.resources.spell_slot_1;
    const hpBefore = test.session.getState().actors.fighter.runtime.hp.current;
    const delivered = accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'DeliverTouchSpellThroughFamiliar',
      commandId: 'touch:deliver-cure',
      familiarActorId: familiar.id,
      spellActionId: cureWounds.action.id,
      targetActorId: 'fighter',
      ownerToFamiliarFacts: {
        factsSource: 'scenario', boardRevision: 3, distanceFt: 80, lineOfSight: false,
      },
      familiarToTargetFacts: spatial('ally'),
      spell: { baseLevel: 1, grantId: cureWounds.grantId, mode: 'normal' },
    });
    const expectedHealing = 3 + 4 + (wizard.character.abilityMods.wis ?? 0);
    expect(test.session.getState().actors.fighter.runtime.hp.current)
      .toBe(Math.min(30, hpBefore + expectedHealing));
    expect(test.session.getState().actors.wizard.runtime.resources.spell_slot_1).toBe(slotBefore - 1);
    expect(test.session.getState().actors[familiar.id].runtime.resources.reaction).toBe(0);
    expect(test.session.getState().actors[familiar.id].familiarState?.reactionAvailable).toBe(false);
    expect(delivered.events.find((event) => (
      event.payload.type === 'ActionDeclared' && event.payload.actionId === cureWounds.action.id
    ))?.payload).toMatchObject({
      actorId: 'wizard',
      targetIds: ['fighter'],
      facts: { deliveryActorId: familiar.id },
    });

    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'EndTurn', commandId: 'touch:wizard:end',
    });
    accept(test.session, provider.ruleset.contentHash, familiar.id, {
      type: 'StartTurn', commandId: 'touch:familiar:start',
    });
    expect(test.session.getState().actors[familiar.id].runtime.resources.reaction).toBe(1);
    expect(test.session.getState().actors[familiar.id].familiarState?.reactionAvailable).toBe(true);
    assertReplay(test.initial, test.session);
    test.tape.assertExhausted();
  });

  it('delivers compiled Chill Touch through a familiar across Shield, reload, strict turns, and exact replay', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-FAMILIAR-TOUCH-ATTACK-01' },
  }, () => {
    assertMandatoryProtocol(wizardRoot, 'SC-FAMILIAR-TOUCH-ATTACK-01', 9_012);
    const wizard = actorWithId(wizardRoot.actor, 'wizard');
    const defender = actorWithId(wizardRoot.actor, 'defender');
    prepareSpellOnActor(defender, WIZARD, shield.action.id);
    addIncense(wizard, 10);
    defender.runtime.hp = { current: 20, max: 20, temp: 0 };
    const runtimeCatalog = catalogFor(wizardRoot);
    const test = makeSession({
      id: 'find-familiar:touch-attack-reload',
      owner: wizard,
      support: defender,
      catalog: runtimeCatalog,
      dice: [
        { label: 'touch-attack familiar initiative', sides: 20, value: 12 },
        { label: 'touch-attack owner Arcana check', sides: 20, value: 12 },
        { label: 'delivered Chill Touch attack', sides: 20, value: 18 },
        { label: 'delivered Chill Touch damage', sides: 10, value: 6 },
        { label: 'touch-attack defender Dexterity save', sides: 20, value: 13 },
      ],
    });
    expect(Object.values(test.initial.actors).filter((actor) => (
      actor.kind === 'playerCharacter'
    ))).toHaveLength(2);
    expect(wizard.capabilities.actionIds).toContain(chillTouch.action.id);
    expect(defender.capabilities.actionIds).toContain(shield.action.id);

    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'UseAction',
      commandId: 'touch-attack:ritual-cast',
      actionId: wizardFamiliar.action.id,
      targetIds: [],
      spell: { baseLevel: 1, grantId: wizardFamiliar.grantId, mode: 'ritual' },
      choices: {
        [FIND_FAMILIAR_FORM_CHOICE]: 'owl',
        [FIND_FAMILIAR_SPIRIT_CHOICE]: 'fey',
        [FIND_FAMILIAR_CAST_PATH_CHOICE]: 'ritual',
      },
    });
    const familiar = required(
      familiarActorsOwnedBy(test.session.getState(), 'wizard')[0],
      'Chill Touch familiar',
    );
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'TakeLongRest', commandId: 'touch-attack:rest', durationHours: 8,
    });
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'StartEncounter', commandId: 'touch-attack:encounter',
      initiative: ['wizard', familiar.id, 'defender'],
    });
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'StartTurn', commandId: 'touch-attack:wizard:start',
    });
    const check = accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'AbilityCheck', commandId: 'touch-attack:wizard:check', ability: 'int', dc: 10,
    });
    expect(recordedEngineEvents(check.events)).toContainEqual(expect.objectContaining({
      type: 'roll', roll: expect.objectContaining({ kind: 'check' }),
    }));

    const illegalRange = reject(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'DeliverTouchSpellThroughFamiliar',
      commandId: 'touch-attack:illegal-range',
      familiarActorId: familiar.id,
      spellActionId: chillTouch.action.id,
      targetActorId: 'defender',
      ownerToFamiliarFacts: {
        factsSource: 'scenario', boardRevision: 2, distanceFt: 80, lineOfSight: false,
      },
      familiarToTargetFacts: spatial('enemy', 10),
      spell: { baseLevel: 0, grantId: chillTouch.grantId, mode: 'normal' },
    });
    expect(illegalRange).toMatchObject({ status: 'rejected', code: 'OutOfRange' });

    const invalidProtectionFacts = reject(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'DeliverTouchSpellThroughFamiliar',
      commandId: 'touch-attack:invalid-protection-facts',
      familiarActorId: familiar.id,
      spellActionId: chillTouch.action.id,
      targetActorId: 'defender',
      ownerToFamiliarFacts: {
        factsSource: 'scenario', boardRevision: 3, distanceFt: 80, lineOfSight: false,
      },
      familiarToTargetFacts: spatial('enemy'),
      protectionCandidates: [{
        factsSource: 'scenario',
        boardRevision: -1,
        protectorActorId: 'forged-protector',
        protectorCanSeeAttacker: true,
        protectorDistanceToTargetFt: 5,
      }],
      spell: { baseLevel: 0, grantId: chillTouch.grantId, mode: 'normal' },
    });
    expect(invalidProtectionFacts).toMatchObject({ status: 'rejected', code: 'InvalidFacts' });

    const ownerActionBefore = test.session.getState().actors.wizard.runtime.resources.action;
    const ownerSlotBefore = test.session.getState().actors.wizard.runtime.resources.spell_slot_1;
    const familiarReactionBefore = test.session.getState().actors[familiar.id].runtime.resources.reaction;
    const defenderHpBefore = test.session.getState().actors.defender.runtime.hp.current;
    const opening = accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'DeliverTouchSpellThroughFamiliar',
      commandId: 'touch-attack:deliver-chill',
      familiarActorId: familiar.id,
      spellActionId: chillTouch.action.id,
      targetActorId: 'defender',
      ownerToFamiliarFacts: {
        factsSource: 'scenario', boardRevision: 3, distanceFt: 80, lineOfSight: false,
      },
      familiarToTargetFacts: spatial('enemy'),
      spell: { baseLevel: 0, grantId: chillTouch.grantId, mode: 'normal' },
    });
    expect(test.session.getState().pendingResolution).toMatchObject({
      type: 'attack_reaction',
      sourceActorId: 'wizard',
      targetActorId: 'defender',
      actionId: chillTouch.action.id,
      request: {
        actorId: 'defender',
        trigger: { type: 'hit_by_attack', sourceActorId: 'wizard' },
      },
    });
    expect(test.session.getState().actors.defender.runtime.hp.current).toBe(defenderHpBefore);
    expect(recordedEngineEvents(opening.events).filter((event) => event.type === 'damage')).toEqual([]);
    expect(test.session.getState().actors.wizard.runtime.resources.action)
      .toBe(ownerActionBefore - 1);
    expect(test.session.getState().actors.wizard.runtime.resources.spell_slot_1)
      .toBe(ownerSlotBefore);
    expect(test.session.getState().actors[familiar.id].runtime.resources.reaction)
      .toBe(familiarReactionBefore - 1);
    expect(test.session.getState().actors[familiar.id].familiarState?.reactionAvailable).toBe(false);
    expect(recordedEngineEvents(opening.events).filter((event) => (
      event.type === 'resource_spent' && event.resource === 'action'
    ))).toHaveLength(1);

    const duplicateWhilePending = reject(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'DeliverTouchSpellThroughFamiliar',
      commandId: 'touch-attack:duplicate-pending',
      familiarActorId: familiar.id,
      spellActionId: chillTouch.action.id,
      targetActorId: 'defender',
      ownerToFamiliarFacts: {
        factsSource: 'scenario', boardRevision: 4, distanceFt: 80, lineOfSight: false,
      },
      familiarToTargetFacts: spatial('enemy'),
      spell: { baseLevel: 0, grantId: chillTouch.grantId, mode: 'normal' },
    });
    expect(duplicateWhilePending).toMatchObject({ status: 'rejected', code: 'ResolutionInProgress' });

    const checkpoint = migrateWorldState(copy(test.session.getState()));
    expect(checkpoint).toEqual(test.session.getState());
    const prefixEvents = copy(test.session.getEvents());
    const forgedReactionMirror = copy(checkpoint);
    forgedReactionMirror.actors[familiar.id].runtime.resources.reaction = 1;
    expect(() => migrateWorldState(forgedReactionMirror)).toThrow(/Reaction resource/);

    const resumed = new InMemoryRulesSession(checkpoint, runtimeCatalog, {
      rng: test.tape.rng,
      clock: createLogicalClock(70_000),
      nextId: () => {
        throw new Error('Persisted IDs must be command-derived');
      },
    });
    const pending = resumed.getState().pendingResolution;
    if (!pending || pending.type !== 'attack_reaction') {
      throw new Error('Delivered Chill Touch lost its Shield window after reload');
    }
    const wrongResolver = reject(resumed, provider.ruleset.contentHash, 'wizard', {
      type: 'ResolveDecision',
      commandId: 'touch-attack:wrong-resolver',
      resolutionId: pending.id,
      requestId: pending.request.id,
      response: { kind: 'reaction', actionId: null },
    });
    expect(wrongResolver).toMatchObject({ status: 'rejected', code: 'InvalidDecision' });
    const forgedReaction = reject(resumed, provider.ruleset.contentHash, 'defender', {
      type: 'ResolveDecision',
      commandId: 'touch-attack:forged-reaction',
      resolutionId: pending.id,
      requestId: pending.request.id,
      response: { kind: 'reaction', actionId: wizardFamiliar.action.id },
    });
    expect(forgedReaction).toMatchObject({ status: 'rejected', code: 'InvalidDecision' });

    const defenderReactionBefore = resumed.getState().actors.defender.runtime.resources.reaction;
    const defenderSlotBefore = resumed.getState().actors.defender.runtime.resources.spell_slot_1;
    const resolved = accept(resumed, provider.ruleset.contentHash, 'defender', {
      type: 'ResolveDecision',
      commandId: 'touch-attack:defender:shield',
      resolutionId: pending.id,
      requestId: pending.request.id,
      response: {
        kind: 'reaction',
        actionId: shield.action.id,
        spell: { grantId: shield.grantId, mode: 'normal' },
      },
    });
    expect(resumed.getState().pendingResolution).toBeNull();
    expect(resumed.getState().actors.defender.runtime.hp.current).toBe(defenderHpBefore - 6);
    expect(resumed.getState().actors.defender.runtime.resources.reaction)
      .toBe(defenderReactionBefore - 1);
    expect(resumed.getState().actors.defender.runtime.resources.spell_slot_1)
      .toBe(defenderSlotBefore - 1);
    expect(resumed.getState().actors.wizard.runtime.resources.action)
      .toBe(ownerActionBefore - 1);
    expect(resumed.getState().actors.wizard.runtime.resources.spell_slot_1)
      .toBe(ownerSlotBefore);
    expect(resumed.getState().actors[familiar.id].runtime.resources.reaction)
      .toBe(familiarReactionBefore - 1);
    expect(recordedEngineEvents(resolved.events)).toContainEqual(expect.objectContaining({
      type: 'damage', amount: 6, damageType: 'necrotic',
    }));
    expect(resumed.getState().actors.defender.runtime.activeEffects).toContainEqual(
      expect.objectContaining({
        ownerId: 'defender',
        sourceId: 'wizard',
        mechanics: expect.objectContaining({ applies_to: { roll: 'healing' }, op: 'deny' }),
      }),
    );
    const allEventsAfterResolution = [...prefixEvents, ...copy(resumed.getEvents())];
    expect(allEventsAfterResolution.filter((event) => (
      event.payload.type === 'ActionDeclared'
      && event.payload.actorId === 'wizard'
      && event.payload.actionId === chillTouch.action.id
    ))).toHaveLength(1);
    expect(allEventsAfterResolution.flatMap((event) => (
      event.payload.type === 'EngineEventRecorded' ? [event.payload.event] : []
    )).filter((event) => (
      event.type === 'resource_spent' && event.resource === 'action'
    ))).toHaveLength(2); // Find Familiar plus exactly one Chill Touch action.

    accept(resumed, provider.ruleset.contentHash, 'wizard', {
      type: 'EndTurn', commandId: 'touch-attack:wizard:end',
    });
    accept(resumed, provider.ruleset.contentHash, familiar.id, {
      type: 'StartTurn', commandId: 'touch-attack:familiar:start',
    });
    expect(resumed.getState().actors[familiar.id].runtime.resources.reaction).toBe(1);
    expect(resumed.getState().actors[familiar.id].familiarState?.reactionAvailable).toBe(true);
    accept(resumed, provider.ruleset.contentHash, familiar.id, {
      type: 'EndTurn', commandId: 'touch-attack:familiar:end',
    });
    accept(resumed, provider.ruleset.contentHash, 'defender', {
      type: 'StartTurn', commandId: 'touch-attack:defender:start',
    });
    const save = accept(resumed, provider.ruleset.contentHash, 'defender', {
      type: 'SavingThrow', commandId: 'touch-attack:defender:save', ability: 'dex', dc: 10,
    });
    expect(recordedEngineEvents(save.events)).toContainEqual(expect.objectContaining({
      type: 'roll', roll: expect.objectContaining({ kind: 'save' }),
    }));
    expect(resumed.getState().actors.defender.runtime.activeEffects).toContainEqual(
      expect.objectContaining({ sourceId: 'wizard', mechanics: expect.objectContaining({ op: 'deny' }) }),
    );

    const replayed = foldEvents(copy(test.initial), [
      ...prefixEvents,
      ...copy(resumed.getEvents()),
    ]);
    expect(replayed).toEqual(resumed.getState());
    expect(migrateWorldState(copy(resumed.getState()))).toEqual(resumed.getState());
    test.tape.assertExhausted();
  });

  it('opens and resumes an immutable catalog Touch target-save without double-paying its owner or familiar', () => {
    const wizard = actorWithId(wizardRoot.actor, 'wizard');
    const defender = actorWithId(wizardRoot.actor, 'defender');
    addIncense(wizard, 10);
    wizard.capabilities.actionIds = [...new Set([
      ...wizard.capabilities.actionIds,
      TOUCH_SAVE_SPELL.id,
    ])].sort();
    wizard.spellcastingAccess = {
      grants: [
        ...(wizard.spellcastingAccess?.grants ?? []),
        {
          grantId: 'test.grant.touch-save',
          actionId: TOUCH_SAVE_SPELL.id,
          sourceId: 'test:spell-source',
          access: 'cantrip',
          level: 0,
          spellcastingAbility: 'int',
        },
      ],
      preparedSources: { ...(wizard.spellcastingAccess?.preparedSources ?? {}) },
    };
    defender.runtime.hp = { current: 20, max: 20, temp: 0 };
    const baseCatalog = catalogFor(wizardRoot);
    const runtimeCatalog: RulesCatalog = {
      getAction: (id) => id === TOUCH_SAVE_SPELL.id
        ? TOUCH_SAVE_SPELL
        : baseCatalog.getAction(id),
    };
    const test = makeSession({
      id: 'find-familiar:touch-save',
      owner: wizard,
      support: defender,
      catalog: runtimeCatalog,
      dice: [{ label: 'delivered Touch save damage', sides: 4, value: 3 }],
    });
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'UseAction',
      commandId: 'touch-save:ritual-cast',
      actionId: wizardFamiliar.action.id,
      targetIds: [],
      spell: { baseLevel: 1, grantId: wizardFamiliar.grantId, mode: 'ritual' },
      choices: {
        [FIND_FAMILIAR_FORM_CHOICE]: 'cat',
        [FIND_FAMILIAR_SPIRIT_CHOICE]: 'celestial',
        [FIND_FAMILIAR_CAST_PATH_CHOICE]: 'ritual',
      },
    });
    const familiar = required(
      familiarActorsOwnedBy(test.session.getState(), 'wizard')[0],
      'Touch-save familiar',
    );
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'TakeLongRest', commandId: 'touch-save:rest', durationHours: 8,
    });
    const actionBefore = test.session.getState().actors.wizard.runtime.resources.action;
    const reactionBefore = test.session.getState().actors[familiar.id].runtime.resources.reaction;
    const hpBefore = test.session.getState().actors.defender.runtime.hp.current;
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'DeliverTouchSpellThroughFamiliar',
      commandId: 'touch-save:deliver',
      familiarActorId: familiar.id,
      spellActionId: TOUCH_SAVE_SPELL.id,
      targetActorId: 'defender',
      ownerToFamiliarFacts: {
        factsSource: 'scenario', boardRevision: 1, distanceFt: 100, lineOfSight: false,
      },
      familiarToTargetFacts: spatial('enemy'),
      spell: { baseLevel: 0, grantId: 'test.grant.touch-save', mode: 'normal' },
    });
    expect(test.session.getState().pendingResolution).toMatchObject({
      type: 'target_save',
      sourceActorId: 'wizard',
      targetActorId: 'defender',
      actionId: TOUCH_SAVE_SPELL.id,
      request: { actorId: 'defender', ability: 'con', dc: 12 },
    });
    expect(test.session.getState().actors.wizard.runtime.resources.action).toBe(actionBefore - 1);
    expect(test.session.getState().actors[familiar.id].runtime.resources.reaction)
      .toBe(reactionBefore - 1);
    expect(test.session.getState().actors.defender.runtime.hp.current).toBe(hpBefore);
    const checkpoint = migrateWorldState(copy(test.session.getState()));
    const prefixEvents = copy(test.session.getEvents());
    const resumed = new InMemoryRulesSession(checkpoint, runtimeCatalog, {
      rng: test.tape.rng,
      clock: createLogicalClock(90_000),
      nextId: () => {
        throw new Error('Persisted IDs must be command-derived');
      },
    });
    const pending = resumed.getState().pendingResolution;
    if (!pending || pending.type !== 'target_save') throw new Error('Touch target save was not persisted');
    const resolution = accept(resumed, provider.ruleset.contentHash, 'defender', {
      type: 'ResolveDecision',
      commandId: 'touch-save:resolve',
      resolutionId: pending.id,
      requestId: pending.request.id,
      response: {
        kind: 'roll',
        roll: { mode: 'manual', dice: [{ sides: 20, value: 1 }] },
      },
    });
    expect(recordedEngineEvents(resolution.events)).toContainEqual(expect.objectContaining({
      type: 'damage', amount: 3, damageType: 'necrotic',
    }));
    expect(resumed.getState().actors.defender.runtime.hp.current).toBe(hpBefore - 3);
    expect(resumed.getState().actors.wizard.runtime.resources.action).toBe(actionBefore - 1);
    expect(resumed.getState().actors[familiar.id].runtime.resources.reaction)
      .toBe(reactionBefore - 1);
    expect(foldEvents(copy(test.initial), [
      ...prefixEvents,
      ...copy(resumed.getEvents()),
    ])).toEqual(resumed.getState());
    test.tape.assertExhausted();
  });

  it('automatically drops a zero-HP familiar out of initiative and requires a new casting', () => {
    const wizard = actorWithId(wizardRoot.actor, 'wizard');
    const fighter = actorWithId(wizardRoot.actor, 'fighter');
    fighter.capabilities.actionIds = [FAMILIAR_KNOCKOUT.id];
    delete fighter.spellcastingAccess;
    addIncense(wizard, 10);
    const baseCatalog = catalogFor(wizardRoot);
    const test = makeSession({
      id: 'find-familiar:zero-hp',
      owner: wizard,
      support: fighter,
      catalog: {
        getAction: (id) => id === FAMILIAR_KNOCKOUT.id
          ? FAMILIAR_KNOCKOUT
          : baseCatalog.getAction(id),
      },
      dice: [{ label: 'zero-HP familiar initiative', sides: 20, value: 7 }],
    });
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'UseAction',
      commandId: 'zero:ritual-cast',
      actionId: wizardFamiliar.action.id,
      targetIds: [],
      spell: { baseLevel: 1, grantId: wizardFamiliar.grantId, mode: 'ritual' },
      choices: {
        [FIND_FAMILIAR_FORM_CHOICE]: 'owl',
        [FIND_FAMILIAR_SPIRIT_CHOICE]: 'fiend',
        [FIND_FAMILIAR_CAST_PATH_CHOICE]: 'ritual',
      },
    });
    const familiar = required(familiarActorsOwnedBy(test.session.getState(), 'wizard')[0], 'zero-HP familiar');
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'TakeLongRest', commandId: 'zero:rest', durationHours: 8,
    });
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'StartEncounter', commandId: 'zero:encounter',
      initiative: ['wizard', familiar.id, 'fighter'],
    });
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'StartTurn', commandId: 'zero:wizard:start',
    });
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'EndTurn', commandId: 'zero:wizard:end',
    });
    accept(test.session, provider.ruleset.contentHash, familiar.id, {
      type: 'StartTurn', commandId: 'zero:familiar:start',
    });
    accept(test.session, provider.ruleset.contentHash, familiar.id, {
      type: 'EndTurn', commandId: 'zero:familiar:end',
    });
    accept(test.session, provider.ruleset.contentHash, 'fighter', {
      type: 'StartTurn', commandId: 'zero:fighter:start',
    });
    const knockout = accept(test.session, provider.ruleset.contentHash, 'fighter', {
      type: 'UseAction',
      commandId: 'zero:knockout',
      actionId: FAMILIAR_KNOCKOUT.id,
      targetIds: [familiar.id],
      factsByTarget: { [familiar.id]: spatial('enemy') },
    });
    expect(knockout.events.some((event) => (
      event.payload.type === 'FamiliarStateChanged' && event.payload.reason === 'zero_hp'
    ))).toBe(true);
    expect(test.session.getState().actors[familiar.id]).toMatchObject({
      runtime: { hp: { current: 0 } },
      familiarState: { presence: 'disappeared_zero_hp' },
    });
    expect((test.session.getState().scene as { initiative: string[] }).initiative)
      .toEqual(['wizard', 'fighter']);
    accept(test.session, provider.ruleset.contentHash, 'fighter', {
      type: 'EndTurn', commandId: 'zero:fighter:end',
    });
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'StartTurn', commandId: 'zero:wizard:r2:start',
    });
    const cannotReappear = reject(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'ReappearFamiliar',
      commandId: 'zero:illegal-reappear',
      familiarActorId: familiar.id,
      facts: {
        factsSource: 'scenario', boardRevision: 4, distanceFt: 10,
        lineOfSight: true, unoccupiedSpace: true,
      },
    });
    expect(cannotReappear).toMatchObject({ status: 'rejected', code: 'InvalidFacts' });
    assertReplay(test.initial, test.session);
    test.tape.assertExhausted();
  });

  it('fails closed for forged catalog metadata, Reaction mirrors, and duplicate owner familiars', () => {
    const wizard = actorWithId(wizardRoot.actor, 'wizard');
    const fighter = actorWithId(wizardRoot.actor, 'fighter');
    addIncense(wizard, 10);
    const test = makeSession({
      id: 'find-familiar:migration-integrity',
      owner: wizard,
      support: fighter,
      catalog: catalogFor(wizardRoot),
    });
    accept(test.session, provider.ruleset.contentHash, 'wizard', {
      type: 'UseAction',
      commandId: 'integrity:cast',
      actionId: wizardFamiliar.action.id,
      targetIds: [],
      spell: { baseLevel: 1, grantId: wizardFamiliar.grantId, mode: 'ritual' },
      choices: {
        [FIND_FAMILIAR_FORM_CHOICE]: 'cat',
        [FIND_FAMILIAR_SPIRIT_CHOICE]: 'celestial',
        [FIND_FAMILIAR_CAST_PATH_CHOICE]: 'ritual',
      },
    });
    const valid = migrateWorldState(copy(test.session.getState()));
    const familiar = required(familiarActorsOwnedBy(valid, 'wizard')[0], 'integrity familiar');

    const badCatalog = copy(valid);
    badCatalog.actors[familiar.id].familiarMetadata!.catalogContentHash = 'fnv1a32:forged';
    expect(() => migrateWorldState(badCatalog)).toThrow(/pinned catalog/);

    const badReaction = copy(valid);
    badReaction.actors[familiar.id].runtime.resources.reaction = 0;
    expect(() => migrateWorldState(badReaction)).toThrow(/Reaction resource/);

    const duplicate = copy(valid);
    const second = copy(duplicate.actors[familiar.id]);
    second.id = 'forged-second-familiar';
    second.familiarState!.actorId = second.id;
    duplicate.actors[second.id] = second;
    expect(() => migrateWorldState(duplicate)).toThrow(/multiple canonical familiar actors/);
  });
});
