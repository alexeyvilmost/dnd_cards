import { describe, expect, it } from 'vitest';
import type { SpellGrantAccess, SpellcastingAccessState } from './spellcastingAccess';
import {
  PACT_TOME_CANONICAL_REST_INTEGRATION_PLAN,
  PACT_TOME_CANONICAL_OWNER_DEATH_INTEGRATION_PLAN,
  PACT_TOME_CATALOG_PROVENANCE,
  PACT_TOME_OWNER_DEATH_FACT_PROVENANCE,
  PACT_TOME_RITUAL_CASTING_TIME_ADDED_SECONDS,
  PACT_TOME_RUNTIME_SCHEMA_VERSION,
  createPactTomeCanonicalOwnerDeathIntegrationFixture,
  createPactTomeCanonicalRestIntegrationFixture,
  createPactTomeRuntimeState,
  pactTomeRuntimeStateIssue,
  replayPactTomeRuntime,
  transitionPactTomeRuntime,
  type AdjudicatePactTomeOwnerDeathCommand,
  type AppliedPactTomeRuntimeTransition,
  type CastPactTomeSpellCommand,
  type CompletePactTomeRestCommand,
  type PactTomeCatalogSelectionSource,
  type PactTomeOwnerDeathFact,
  type PactTomeRuntimeCommand,
  type PactTomeRuntimeRejectionCode,
  type PactTomeRuntimeState,
  type PactTomeRuntimeTransitionResult,
  type RecordedPactTomeRuntimeTransition,
} from './pactTomeRuntime';

const ACTOR = 'actor:warlock';
const SOURCE = 'effect:pact-tome';
const HASH = 'sha256:rules-2024-test';

const CATALOG_OPTIONS: PactTomeCatalogSelectionSource['options'] = [
  { actionId: 'guidance', level: 0, ritual: false, classListIds: ['CLASS-cleric'] },
  { actionId: 'light', level: 0, ritual: false, classListIds: ['CLASS-cleric', 'CLASS-wizard'] },
  { actionId: 'minor-illusion', level: 0, ritual: false, classListIds: ['CLASS-wizard'] },
  { actionId: 'fire-bolt', level: 0, ritual: false, classListIds: ['CLASS-sorcerer', 'CLASS-wizard'] },
  { actionId: 'druidcraft', level: 0, ritual: false, classListIds: ['CLASS-druid'] },
  { actionId: 'thaumaturgy', level: 0, ritual: false, classListIds: ['CLASS-cleric'] },
  { actionId: 'detect-magic', level: 1, ritual: true, classListIds: ['CLASS-cleric', 'CLASS-wizard'] },
  { actionId: 'identify', level: 1, ritual: true, classListIds: ['CLASS-wizard'] },
  { actionId: 'speak-with-animals', level: 1, ritual: true, classListIds: ['CLASS-bard', 'CLASS-druid'] },
  { actionId: 'ceremony', level: 1, ritual: true, classListIds: ['CLASS-cleric'] },
  { actionId: 'mage-armor', level: 1, ritual: false, classListIds: ['CLASS-wizard'] },
  { actionId: 'invalid-level-two', level: 2, ritual: true, classListIds: ['CLASS-wizard'] },
  { actionId: 'eldritch-blast', level: 0, ritual: false, classListIds: ['CLASS-warlock'] },
  { actionId: 'resource-less-prepared', level: 1, ritual: true, classListIds: ['CLASS-warlock'] },
];

const BASE_GRANTS: SpellGrantAccess[] = [
  {
    grantId: 'grant:warlock:eldritch-blast', actionId: 'eldritch-blast',
    sourceId: 'CLASS-warlock', access: 'cantrip', level: 0, spellcastingAbility: 'cha',
  },
  {
    grantId: 'grant:warlock:hex', actionId: 'hex', sourceId: 'CLASS-warlock',
    access: 'known', level: 1, spellcastingAbility: 'cha', slotResource: 'spell_slot_1',
  },
  {
    grantId: 'grant:wizard-book:guidance', actionId: 'guidance', sourceId: 'wizard-book',
    access: 'spellbook', level: 0, spellcastingAbility: 'int',
  },
  {
    grantId: 'grant:feat:shield', actionId: 'shield', sourceId: 'FEAT-magic-initiate',
    access: 'always_prepared', level: 1, spellcastingAbility: 'int',
    freeUseResource: 'magic_initiate_free', slotResource: 'spell_slot_1',
  },
  {
    grantId: 'grant:warlock:resource-less', actionId: 'resource-less-prepared',
    sourceId: 'CLASS-warlock', access: 'known', level: 1, spellcastingAbility: 'cha',
  },
];

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function initialState(): PactTomeRuntimeState {
  return createPactTomeRuntimeState({
    ownerActorId: ACTOR,
    sourceEntityId: SOURCE,
    capabilitySourceEntityIds: ['EFF-pact-tome', SOURCE, 'CLASS-warlock'],
    rulesetContentHash: HASH,
  });
}

function baseAccess(input: {
  preparedWizardActions?: string[];
  extraGrants?: SpellGrantAccess[];
} = {}): SpellcastingAccessState {
  return {
    grants: jsonClone([...BASE_GRANTS, ...(input.extraGrants ?? [])]),
    preparedSources: {
      'wizard-book': {
        sourceId: 'wizard-book', capacity: input.preparedWizardActions?.length ?? 0,
        availableActionIds: ['guidance'],
        preparedActionIds: [...(input.preparedWizardActions ?? [])],
      },
    },
  };
}

function catalog(
  options: PactTomeCatalogSelectionSource['options'] = CATALOG_OPTIONS,
): PactTomeCatalogSelectionSource {
  return {
    provenance: PACT_TOME_CATALOG_PROVENANCE,
    rulesetContentHash: HASH,
    options: jsonClone(options),
  };
}

function restCommand(
  state: PactTomeRuntimeState,
  overrides: Partial<CompletePactTomeRestCommand> = {},
): CompletePactTomeRestCommand {
  return {
    schemaVersion: PACT_TOME_RUNTIME_SCHEMA_VERSION,
    type: 'CompletePactTomeRest',
    commandId: `rest:${state.revision}`,
    expectedRevision: state.revision,
    rulesetContentHash: HASH,
    actorId: ACTOR,
    sourceEntityId: SOURCE,
    rest: 'short',
    bookObjectId: `book:${state.revision + 1}`,
    cantripActionIds: ['guidance', 'light', 'minor-illusion'],
    ritualActionIds: ['detect-magic', 'identify'],
    catalog: catalog(),
    actorSpellcastingAccess: baseAccess(),
    slotResource: 'spell_slot_1',
    ...overrides,
  };
}

function accessWithActiveTome(
  state: PactTomeRuntimeState,
  access: SpellcastingAccessState = baseAccess(),
): SpellcastingAccessState {
  if (!state.activeTome) throw new Error('Test fixture requires an active Pact Tome');
  return {
    grants: [...jsonClone(access.grants), ...jsonClone(state.activeTome.grants)],
    preparedSources: jsonClone(access.preparedSources),
  };
}

function castCommand(
  state: PactTomeRuntimeState,
  input: {
    actionId: string;
    mode?: 'normal' | 'ritual';
    resources?: Record<string, number>;
    overrides?: Partial<CastPactTomeSpellCommand>;
  },
): CastPactTomeSpellCommand {
  if (!state.activeTome) throw new Error('Test fixture requires an active Pact Tome');
  const grant = state.activeTome.grants.find((candidate) => candidate.actionId === input.actionId);
  if (!grant) throw new Error(`Missing test grant for ${input.actionId}`);
  return {
    schemaVersion: PACT_TOME_RUNTIME_SCHEMA_VERSION,
    type: 'CastPactTomeSpell',
    commandId: `cast:${state.revision}:${input.actionId}:${input.mode ?? 'normal'}`,
    expectedRevision: state.revision,
    rulesetContentHash: HASH,
    actorId: ACTOR,
    sourceEntityId: SOURCE,
    bookObjectId: state.activeTome.invocation.tome.bookObjectId,
    actionId: input.actionId,
    grantId: grant.grantId,
    mode: input.mode ?? 'normal',
    actorSpellcastingAccess: accessWithActiveTome(state),
    resources: input.resources ?? {},
    ...input.overrides,
  };
}

function ownerDeathFact(
  state: PactTomeRuntimeState,
  overrides: Partial<PactTomeOwnerDeathFact> = {},
): PactTomeOwnerDeathFact {
  return {
    type: 'ActorDeathAdjudicated',
    provenance: PACT_TOME_OWNER_DEATH_FACT_PROVENANCE,
    factId: `actor-death:${state.revision}`,
    actorId: ACTOR,
    adjudicatedBy: 'system:canonical-actor-lifecycle',
    observedAtWorldRevision: state.revision,
    rulesetContentHash: HASH,
    ...overrides,
  };
}

function ownerDeathCommand(
  state: PactTomeRuntimeState,
  overrides: Partial<AdjudicatePactTomeOwnerDeathCommand> = {},
): AdjudicatePactTomeOwnerDeathCommand {
  return {
    schemaVersion: PACT_TOME_RUNTIME_SCHEMA_VERSION,
    type: 'AdjudicatePactTomeOwnerDeath',
    commandId: `owner-death:${state.revision}`,
    expectedRevision: state.revision,
    rulesetContentHash: HASH,
    actorId: ACTOR,
    sourceEntityId: SOURCE,
    deathFact: ownerDeathFact(state),
    actorSpellcastingAccess: accessWithActiveTome(state),
    ...overrides,
  };
}

function applied(result: PactTomeRuntimeTransitionResult): AppliedPactTomeRuntimeTransition {
  if (result.status === 'rejected') {
    throw new Error(`Unexpected rejection ${result.code}: ${result.message}`);
  }
  return result;
}

function rejected(
  state: PactTomeRuntimeState,
  command: PactTomeRuntimeCommand,
  code: PactTomeRuntimeRejectionCode,
  message?: RegExp,
): void {
  const before = jsonClone(state);
  const result = transitionPactTomeRuntime(state, command);
  expect(result.status).toBe('rejected');
  if (result.status !== 'rejected') throw new Error('Expected Pact Tome rejection');
  expect(result.code).toBe(code);
  if (message) expect(result.message).toMatch(message);
  expect(result.state).toEqual(before);
  expect(state).toEqual(before);
}

function conjuredShortRest(): AppliedPactTomeRuntimeTransition {
  const state = initialState();
  return applied(transitionPactTomeRuntime(state, restCommand(state)));
}

describe('pure Pact of the Tome L1 runtime', () => {
  it('creates a deterministic empty authority state and publishes the future canonical-rest boundary', () => {
    const state = initialState();
    expect(state).toEqual({
      schemaVersion: 1,
      revision: 0,
      authority: {
        capabilityId: 'warlock.pact.tome',
        ownerActorId: ACTOR,
        sourceEntityId: SOURCE,
        capabilitySourceEntityIds: ['CLASS-warlock', 'EFF-pact-tome', SOURCE],
        rulesetContentHash: HASH,
      },
      activeTome: null,
    });
    expect(pactTomeRuntimeStateIssue(state)).toBeNull();
    expect(PACT_TOME_CANONICAL_REST_INTEGRATION_PLAN).toMatchObject({
      commandType: 'CompleteRest',
      atomicCommit: expect.arrayContaining([
        'upsert the new physical Book of Shadows focus',
        'upsert exactly five source-scoped grants',
      ]),
    });
    expect(() => createPactTomeRuntimeState({
      ownerActorId: '', sourceEntityId: SOURCE,
      capabilitySourceEntityIds: [SOURCE], rulesetContentHash: HASH,
    })).toThrow(/requires actor, source, and ruleset/);
    expect(() => createPactTomeRuntimeState({
      ownerActorId: ACTOR, sourceEntityId: SOURCE,
      capabilitySourceEntityIds: ['other'], rulesetContentHash: HASH,
    })).toThrow(/not owned by the actor capability/);
    expect(() => createPactTomeRuntimeState({
      ownerActorId: ACTOR, sourceEntityId: SOURCE,
      capabilitySourceEntityIds: [SOURCE, ' '], rulesetContentHash: HASH,
    })).toThrow(/non-blank, unique, and sorted/);
  });

  it('completes a Short Rest with mixed class lists and creates the physical focus plus five book-scoped grants', () => {
    const state = initialState();
    const command = restCommand(state);
    const commandBefore = jsonClone(command);
    const result = applied(transitionPactTomeRuntime(state, command));
    const active = result.state.activeTome;
    expect(state.activeTome).toBeNull();
    expect(command).toEqual(commandBefore);
    expect(result.state.revision).toBe(1);
    expect(active?.invocation).toMatchObject({
      kind: 'tome', sourceEntityId: SOURCE, ownerActorId: ACTOR,
      tome: {
        createdAfterRest: 'short', bookObjectId: 'book:1',
        cantripActionIds: ['guidance', 'light', 'minor-illusion'],
        ritualActionIds: ['detect-magic', 'identify'],
      },
    });
    expect(active?.bookObject).toMatchObject({
      id: 'book:1', name: 'Book of Shadows', kind: 'item',
      ownerActorId: ACTOR, carriedByActorId: ACTOR,
      sourceActorId: ACTOR, sourceActionId: SOURCE,
      tags: ['book_of_shadows', 'spellcasting_focus'],
    });
    expect(active?.grants).toHaveLength(5);
    expect(active?.grants.every((grant) => grant.sourceId === 'book:1')).toBe(true);
    expect(active?.grants.filter((grant) => grant.level === 0)).toHaveLength(3);
    expect(active?.grants.filter((grant) => grant.level === 1)).toEqual([
      expect.objectContaining({
        actionId: 'detect-magic', access: 'always_prepared', ritual: true,
        slotResource: 'spell_slot_1', spellcastingAbility: 'cha',
      }),
      expect.objectContaining({
        actionId: 'identify', access: 'always_prepared', ritual: true,
        slotResource: 'spell_slot_1', spellcastingAbility: 'cha',
      }),
    ]);
    expect(active?.selectedFromCatalog.options.flatMap((option) => option.classListIds))
      .toEqual(expect.arrayContaining(['CLASS-cleric', 'CLASS-wizard']));
    expect(result.transition.event).toMatchObject({
      type: 'PactTomeRestCompleted', rest: 'short', revision: 1,
      removedBookObjectIds: [], removedSpellGrantIds: [],
    });

    const fixture = createPactTomeCanonicalRestIntegrationFixture(result.transition);
    expect(fixture).toMatchObject({
      commandType: 'CompleteRest', expectedActorRevision: 0,
      actorId: ACTOR, sourceEntityId: SOURCE,
      removeObjectIds: [], removeSpellGrantIds: [],
      upsertObjects: [expect.objectContaining({ id: 'book:1' })],
      upsertSpellGrants: expect.arrayContaining([
        expect.objectContaining({ sourceId: 'book:1' }),
      ]),
      pactState: expect.objectContaining({ kind: 'tome' }),
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('completes a Long Rest by atomically replacing only the old source-owned book and grants', () => {
    const first = conjuredShortRest();
    const oldActive = first.state.activeTome!;
    const command = restCommand(first.state, {
      commandId: 'rest:long-replacement',
      rest: 'long',
      bookObjectId: 'book:replacement',
      actorSpellcastingAccess: accessWithActiveTome(first.state),
    });
    const second = applied(transitionPactTomeRuntime(first.state, command));
    expect(second.state.activeTome?.invocation.tome).toMatchObject({
      createdAfterRest: 'long', bookObjectId: 'book:replacement',
      cantripActionIds: oldActive.invocation.tome.cantripActionIds,
      ritualActionIds: oldActive.invocation.tome.ritualActionIds,
    });
    expect(second.state.activeTome?.grants.every((grant) => (
      grant.sourceId === 'book:replacement'
    ))).toBe(true);
    expect(second.transition.event).toMatchObject({
      type: 'PactTomeRestCompleted',
      removedBookObjectIds: ['book:1'],
      removedSpellGrantIds: oldActive.grants.map((grant) => grant.grantId).sort(),
    });
    const fixture = createPactTomeCanonicalRestIntegrationFixture(second.transition);
    expect(fixture.removeObjectIds).toEqual(['book:1']);
    expect(fixture.removeSpellGrantIds).toEqual(oldActive.grants.map((grant) => grant.grantId).sort());
    expect(fixture.upsertObjects[0].id).toBe('book:replacement');
    expect(fixture.upsertSpellGrants).not.toEqual(oldActive.grants);
  });

  it('dismisses the exact active Tome from an explicit authoritative owner-death fact and replays it', () => {
    const rest = conjuredShortRest();
    const active = rest.state.activeTome!;
    const command = ownerDeathCommand(rest.state);
    expect(command).not.toHaveProperty('hp');
    const death = applied(transitionPactTomeRuntime(rest.state, command));
    expect(death.state).toMatchObject({ revision: 2, activeTome: null });
    expect(death.transition.event).toEqual({
      schemaVersion: 1,
      type: 'PactTomeOwnerDied',
      commandId: 'owner-death:1',
      revision: 2,
      actorId: ACTOR,
      sourceEntityId: SOURCE,
      rulesetContentHash: HASH,
      deathFact: ownerDeathFact(rest.state),
      dismissedTome: active.invocation,
      removedBookObjectIds: ['book:1'],
      removedSpellGrantIds: active.grants.map((grant) => grant.grantId).sort(),
      removedActionIds: [
        ...active.invocation.tome.cantripActionIds,
        ...active.invocation.tome.ritualActionIds,
      ].sort(),
    });
    const fixture = createPactTomeCanonicalOwnerDeathIntegrationFixture(death.transition);
    expect(fixture).toEqual({
      triggerEventType: 'ActorDied',
      requiredFactProvenance: 'canonical_actor_lifecycle',
      expectedWorldRevision: 1,
      actorId: ACTOR,
      sourceEntityId: SOURCE,
      removeObjectIds: ['book:1'],
      removeSpellGrantIds: active.grants.map((grant) => grant.grantId).sort(),
      removeActionIds: [
        ...active.invocation.tome.cantripActionIds,
        ...active.invocation.tome.ritualActionIds,
      ].sort(),
      clearPactTomeState: true,
    });
    expect(PACT_TOME_CANONICAL_OWNER_DEATH_INTEGRATION_PLAN).toMatchObject({
      triggerEventType: 'ActorDied',
      factProvenance: 'canonical_actor_lifecycle',
      acceptFrom: expect.stringMatching(/never infer.*HP=0/),
    });
    expect(replayPactTomeRuntime(initialState(), [rest.transition, death.transition]))
      .toEqual(death.state);
    expect(JSON.parse(JSON.stringify(death))).toEqual(death);
    expect(() => createPactTomeCanonicalOwnerDeathIntegrationFixture(rest.transition))
      .toThrow(/requires a Pact Tome death transition/);
  });

  it('rejects missing, client-like, stale, foreign, or grant-divergent owner-death facts', () => {
    const rest = conjuredShortRest();
    const rejectFact = (
      fact: unknown,
      message: RegExp,
    ) => rejected(rest.state, ownerDeathCommand(rest.state, {
      deathFact: fact as PactTomeOwnerDeathFact,
    }), 'InvalidOwnerDeathFact', message);
    rejectFact(null, /authoritative actor-lifecycle fact/);
    rejectFact({ ...ownerDeathFact(rest.state), type: 'ClientSaysDead' }, /non-authoritative/);
    rejectFact({
      ...ownerDeathFact(rest.state),
      provenance: 'client_claim',
    }, /non-authoritative/);
    rejectFact({ ...ownerDeathFact(rest.state), factId: ' ' }, /fact and adjudicator/);
    rejectFact({ ...ownerDeathFact(rest.state), adjudicatedBy: '' }, /fact and adjudicator/);
    rejectFact({ ...ownerDeathFact(rest.state), actorId: 'actor:other' }, /another actor/);
    rejectFact({ ...ownerDeathFact(rest.state), observedAtWorldRevision: 1.5 }, /another world revision/);
    rejectFact({ ...ownerDeathFact(rest.state), observedAtWorldRevision: 0 }, /another world revision/);
    rejectFact({ ...ownerDeathFact(rest.state), rulesetContentHash: 'sha256:other' }, /another ruleset/);

    const missingGrant = accessWithActiveTome(rest.state);
    missingGrant.grants = missingGrant.grants.filter((grant) => (
      grant.grantId !== rest.state.activeTome!.grants[0].grantId
    ));
    rejected(rest.state, ownerDeathCommand(rest.state, {
      actorSpellcastingAccess: missingGrant,
    }), 'GrantOwnershipMismatch', /does not exactly own/);

    const empty = initialState();
    const withoutTome = {
      ...ownerDeathCommand(rest.state),
      commandId: 'owner-death:no-tome',
      expectedRevision: empty.revision,
      deathFact: ownerDeathFact(empty),
      actorSpellcastingAccess: baseAccess(),
    };
    rejected(empty, withoutTome, 'TomeUnavailable');
  });

  it('resolves a level-1 spell with a Pact slot and the same spell as a ten-minute no-slot ritual', () => {
    const rest = conjuredShortRest();
    const slot = applied(transitionPactTomeRuntime(rest.state, castCommand(rest.state, {
      actionId: 'identify', resources: { spell_slot_1: 1 },
    })));
    expect(slot.transition.event).toMatchObject({
      type: 'PactTomeSpellCast', actionId: 'identify', mode: 'normal',
      focusObjectId: 'book:1', payment: { kind: 'slot', resource: 'spell_slot_1' },
      resourceChanges: [{ resource: 'spell_slot_1', delta: -1 }],
      castingTimeAddedSeconds: 0,
    });
    const ritual = applied(transitionPactTomeRuntime(slot.state, castCommand(slot.state, {
      actionId: 'identify', mode: 'ritual', resources: { spell_slot_1: 0 },
    })));
    expect(ritual.transition.event).toMatchObject({
      type: 'PactTomeSpellCast', actionId: 'identify', mode: 'ritual',
      payment: { kind: 'none' }, resourceChanges: [],
      castingTimeAddedSeconds: PACT_TOME_RITUAL_CASTING_TIME_ADDED_SECONDS,
    });
    const cantrip = applied(transitionPactTomeRuntime(ritual.state, castCommand(ritual.state, {
      actionId: 'guidance', resources: {},
    })));
    expect(cantrip.transition.event).toMatchObject({
      type: 'PactTomeSpellCast', actionId: 'guidance', mode: 'normal',
      payment: { kind: 'none' }, resourceChanges: [], castingTimeAddedSeconds: 0,
    });

    const recorded = [rest.transition, slot.transition, ritual.transition, cantrip.transition];
    expect(replayPactTomeRuntime(initialState(), recorded)).toEqual(cantrip.state);
    expect(JSON.parse(JSON.stringify(recorded))).toEqual(recorded);
    expect(() => createPactTomeCanonicalRestIntegrationFixture(slot.transition))
      .toThrow(/requires a Pact Tome rest transition/);
  });

  it.each([
    {
      label: 'only two cantrips',
      mutate: (command: CompletePactTomeRestCommand) => {
        command.cantripActionIds = ['guidance', 'light'];
      },
      message: /exactly 3 distinct/,
    },
    {
      label: 'duplicate cantrip',
      mutate: (command: CompletePactTomeRestCommand) => {
        command.cantripActionIds = ['guidance', 'guidance', 'light'];
      },
      message: /exactly 3 distinct/,
    },
    {
      label: 'duplicate ritual',
      mutate: (command: CompletePactTomeRestCommand) => {
        command.ritualActionIds = ['identify', 'identify'];
      },
      message: /exactly 2 distinct/,
    },
    {
      label: 'level-one spell in cantrips',
      mutate: (command: CompletePactTomeRestCommand) => {
        command.cantripActionIds = ['guidance', 'light', 'detect-magic'];
      },
      message: /not an eligible cantrip/,
    },
    {
      label: 'level-two ritual',
      mutate: (command: CompletePactTomeRestCommand) => {
        command.ritualActionIds = ['identify', 'invalid-level-two'];
      },
      message: /not an eligible level-1 ritual/,
    },
    {
      label: 'level-one spell without Ritual tag',
      mutate: (command: CompletePactTomeRestCommand) => {
        command.ritualActionIds = ['identify', 'mage-armor'];
      },
      message: /not an eligible level-1 ritual/,
    },
    {
      label: 'duplicate catalog action identity',
      mutate: (command: CompletePactTomeRestCommand) => {
        command.catalog.options.push(jsonClone(command.catalog.options[0]));
      },
      message: /options must have distinct action IDs/,
    },
    {
      label: 'invalid rest kind',
      mutate: (command: CompletePactTomeRestCommand) => {
        command.rest = 'invalid' as 'short';
      },
      message: /completed rest/,
    },
    {
      label: 'blank slot resource',
      mutate: (command: CompletePactTomeRestCommand) => {
        command.slotResource = ' ';
      },
      message: /slot resource is required/,
    },
  ])('rejects $label through conjurePactTome without mutating state', ({ mutate, message }) => {
    const state = initialState();
    const command = restCommand(state);
    mutate(command);
    rejected(state, command, 'InvalidRestSelection', message);
  });

  it('derives already-prepared exclusions from spellcasting access while ignoring the replaced book source', () => {
    const state = initialState();
    const preparedGuidance = restCommand(state, {
      actorSpellcastingAccess: baseAccess({ preparedWizardActions: ['guidance'] }),
    });
    rejected(state, preparedGuidance, 'InvalidRestSelection', /guidance is already prepared/);

    const preparedCantrip = restCommand(state, {
      cantripActionIds: ['eldritch-blast', 'light', 'minor-illusion'],
    });
    rejected(state, preparedCantrip, 'InvalidRestSelection', /eldritch-blast is already prepared/);

    const preparedWithoutResource = restCommand(state, {
      ritualActionIds: ['identify', 'resource-less-prepared'],
    });
    rejected(
      state,
      preparedWithoutResource,
      'InvalidRestSelection',
      /resource-less-prepared is already prepared/,
    );

    const first = conjuredShortRest();
    const replacement = restCommand(first.state, {
      expectedRevision: first.state.revision,
      actorSpellcastingAccess: accessWithActiveTome(first.state),
      bookObjectId: 'book:same-selections',
    });
    expect(transitionPactTomeRuntime(first.state, replacement).status).toBe('applied');
  });

  it.each([
    {
      label: 'wrong catalog provenance',
      mutate: (command: CompletePactTomeRestCommand) => {
        command.catalog.provenance = 'client_claim' as typeof PACT_TOME_CATALOG_PROVENANCE;
      },
      message: /immutable rules-catalog provenance/,
    },
    {
      label: 'blank catalog hash',
      mutate: (command: CompletePactTomeRestCommand) => {
        command.catalog.rulesetContentHash = '';
      },
      message: /authoritative ruleset hash/,
    },
    {
      label: 'different catalog hash',
      mutate: (command: CompletePactTomeRestCommand) => {
        command.catalog.rulesetContentHash = 'sha256:other';
      },
      message: /authoritative ruleset hash/,
    },
    {
      label: 'non-array options',
      mutate: (command: CompletePactTomeRestCommand) => {
        command.catalog.options = null as unknown as PactTomeCatalogSelectionSource['options'];
      },
      message: /options must be an array/,
    },
    {
      label: 'missing class list',
      mutate: (command: CompletePactTomeRestCommand) => {
        command.catalog.options[0].classListIds = [];
      },
      message: /no authoritative class-list provenance/,
    },
    {
      label: 'blank class identity',
      mutate: (command: CompletePactTomeRestCommand) => {
        command.catalog.options[0].classListIds = [' '];
      },
      message: /blank class-list identity/,
    },
    {
      label: 'duplicate class identity',
      mutate: (command: CompletePactTomeRestCommand) => {
        command.catalog.options[0].classListIds = ['CLASS-cleric', 'CLASS-cleric'];
      },
      message: /repeats a class-list identity/,
    },
  ])('fails closed for $label', ({ mutate, message }) => {
    const state = initialState();
    const command = restCommand(state);
    mutate(command);
    rejected(state, command, 'InvalidProvenance', message);
  });

  it('fails closed for malformed state, command envelopes, authority, and ruleset identity', () => {
    const valid = initialState();
    const invalidStates: PactTomeRuntimeState[] = [
      { ...jsonClone(valid), schemaVersion: 2 as 1 },
      { ...jsonClone(valid), revision: -1 },
      {
        ...jsonClone(valid),
        authority: { ...jsonClone(valid.authority), capabilityId: 'other' as 'warlock.pact.tome' },
      },
      {
        ...jsonClone(valid),
        authority: { ...jsonClone(valid.authority), rulesetContentHash: '' },
      },
      {
        ...jsonClone(valid),
        authority: { ...jsonClone(valid.authority), capabilitySourceEntityIds: ['other'] },
      },
      {
        ...jsonClone(valid),
        authority: {
          ...jsonClone(valid.authority), capabilitySourceEntityIds: [SOURCE, 'CLASS-warlock'],
        },
      },
    ];
    for (const invalid of invalidStates) {
      rejected(invalid, restCommand(valid), 'InvalidState');
    }

    const invalidEnvelope = restCommand(valid, { schemaVersion: 2 as 1 });
    rejected(valid, invalidEnvelope, 'InvalidCommand');
    rejected(valid, restCommand(valid, { commandId: '' }), 'InvalidCommand');
    rejected(valid, restCommand(valid, { expectedRevision: 0.5 }), 'InvalidCommand');
    rejected(valid, restCommand(valid, { expectedRevision: 1 }), 'RevisionConflict');
    rejected(valid, restCommand(valid, { actorId: 'other' }), 'AuthorityMismatch');
    rejected(valid, restCommand(valid, { sourceEntityId: 'other' }), 'AuthorityMismatch');
    rejected(valid, restCommand(valid, { rulesetContentHash: 'sha256:other' }), 'RulesetMismatch');
    rejected(valid, { ...restCommand(valid), type: 'Other' } as unknown as PactTomeRuntimeCommand, 'InvalidCommand');
  });

  it('fails closed when active physical state or actor spellcasting ownership diverges', () => {
    const rest = conjuredShortRest();
    const active = rest.state.activeTome!;
    const tamperedProvenance = jsonClone(rest.state);
    tamperedProvenance.activeTome!.selectedFromCatalog.provenance = (
      'client_claim' as typeof PACT_TOME_CATALOG_PROVENANCE
    );
    rejected(
      tamperedProvenance,
      castCommand(rest.state, { actionId: 'guidance' }),
      'InvalidState',
      /immutable rules-catalog provenance/,
    );

    const tamperedBook = jsonClone(rest.state);
    tamperedBook.activeTome!.bookObject.carriedByActorId = 'other';
    rejected(
      tamperedBook,
      castCommand(rest.state, { actionId: 'guidance' }),
      'InvalidState',
      /book, grants, or catalog provenance diverged/,
    );

    const tamperedSlot = jsonClone(rest.state);
    for (const grant of tamperedSlot.activeTome!.grants.filter((candidate) => candidate.level === 1)) {
      delete grant.slotResource;
    }
    rejected(
      tamperedSlot,
      castCommand(rest.state, { actionId: 'guidance' }),
      'InvalidState',
      /Invalid active Pact Tome state/,
    );

    const missingGrantAccess = accessWithActiveTome(rest.state);
    missingGrantAccess.grants = missingGrantAccess.grants.filter((grant) => (
      grant.grantId !== active.grants[0].grantId
    ));
    rejected(rest.state, castCommand(rest.state, {
      actionId: 'guidance',
      overrides: { actorSpellcastingAccess: missingGrantAccess },
    }), 'GrantOwnershipMismatch', /does not exactly own/);

    const duplicateAccess = accessWithActiveTome(rest.state);
    duplicateAccess.grants.push(jsonClone(duplicateAccess.grants[0]));
    rejected(rest.state, castCommand(rest.state, {
      actionId: 'guidance', overrides: { actorSpellcastingAccess: duplicateAccess },
    }), 'GrantOwnershipMismatch', /non-blank and unique/);

    const blankGrantAccess = accessWithActiveTome(rest.state);
    blankGrantAccess.grants[0].grantId = '';
    rejected(rest.state, castCommand(rest.state, {
      actionId: 'guidance', overrides: { actorSpellcastingAccess: blankGrantAccess },
    }), 'GrantOwnershipMismatch', /non-blank and unique/);

    const blankActionAccess = accessWithActiveTome(rest.state);
    blankActionAccess.grants[0].actionId = '';
    rejected(rest.state, castCommand(rest.state, {
      actionId: 'guidance', overrides: { actorSpellcastingAccess: blankActionAccess },
    }), 'GrantOwnershipMismatch', /action and source provenance/);

    const nonArrayAccess = accessWithActiveTome(rest.state);
    nonArrayAccess.grants = null as unknown as SpellGrantAccess[];
    rejected(rest.state, castCommand(rest.state, {
      actionId: 'guidance', overrides: { actorSpellcastingAccess: nonArrayAccess },
    }), 'GrantOwnershipMismatch', /must be an array/);

    const replacementAccess = accessWithActiveTome(rest.state);
    replacementAccess.grants = replacementAccess.grants.filter((grant) => (
      grant.grantId !== active.grants[0].grantId
    ));
    rejected(rest.state, restCommand(rest.state, {
      actorSpellcastingAccess: replacementAccess,
      bookObjectId: 'book:failed-replacement',
    }), 'GrantOwnershipMismatch', /does not exactly own/);
  });

  it('rejects every cast not owned by the carried active Book of Shadows', () => {
    const empty = initialState();
    const fabricatedCast = {
      ...restCommand(empty),
      type: 'CastPactTomeSpell', bookObjectId: 'missing', actionId: 'guidance',
      grantId: 'missing', mode: 'normal', resources: {},
    } as unknown as CastPactTomeSpellCommand;
    rejected(empty, fabricatedCast, 'TomeUnavailable');

    const rest = conjuredShortRest();
    rejected(rest.state, castCommand(rest.state, {
      actionId: 'guidance', overrides: { bookObjectId: 'other-book' },
    }), 'GrantOwnershipMismatch', /active Book/);
    rejected(rest.state, castCommand(rest.state, {
      actionId: 'guidance', overrides: { grantId: 'other-grant' },
    }), 'GrantOwnershipMismatch', /not owned/);
    rejected(rest.state, castCommand(rest.state, {
      actionId: 'guidance', overrides: { actionId: 'other-action' },
    }), 'GrantOwnershipMismatch', /not owned/);
    rejected(rest.state, castCommand(rest.state, {
      actionId: 'guidance', overrides: { mode: 'invalid' as 'normal' },
    }), 'InvalidCommand', /normal or ritual/);
    rejected(rest.state, castCommand(rest.state, {
      actionId: 'guidance', overrides: { resources: { spell_slot_1: -1 } },
    }), 'InvalidCommand', /non-negative integer/);
    rejected(rest.state, castCommand(rest.state, {
      actionId: 'guidance', overrides: { resources: { spell_slot_1: 0.5 } },
    }), 'InvalidCommand', /non-negative integer/);
    rejected(rest.state, castCommand(rest.state, {
      actionId: 'guidance', overrides: { resources: { ' ': 0 } },
    }), 'InvalidCommand', /named keys/);
    rejected(rest.state, castCommand(rest.state, {
      actionId: 'guidance', mode: 'ritual',
    }), 'RitualNotAllowed');
    rejected(rest.state, castCommand(rest.state, {
      actionId: 'identify', resources: { spell_slot_1: 0 },
    }), 'SpellResourceUnavailable');
  });

  it('rejects source collisions when a rest would overwrite another grant owner', () => {
    const state = initialState();
    const collidingSource: SpellGrantAccess = {
      grantId: 'unrelated-grant', actionId: 'unrelated-spell', sourceId: 'book:1',
      access: 'cantrip', level: 0, spellcastingAbility: 'cha',
    };
    rejected(state, restCommand(state, {
      actorSpellcastingAccess: baseAccess({ extraGrants: [collidingSource] }),
    }), 'GrantOwnershipMismatch', /collides with another spellcasting source/);

    const collidingGrantId: SpellGrantAccess = {
      grantId: 'spell-grant:book:1:guidance', actionId: 'other', sourceId: 'other-source',
      access: 'cantrip', level: 0, spellcastingAbility: 'cha',
    };
    rejected(state, restCommand(state, {
      actorSpellcastingAccess: baseAccess({ extraGrants: [collidingGrantId] }),
    }), 'GrantOwnershipMismatch', /collides with another spellcasting source/);
  });

  it('detects invalid replay origins, rejected recorded commands, and event divergence', () => {
    const rest = conjuredShortRest();
    const invalidInitial = initialState();
    invalidInitial.revision = -1;
    expect(() => replayPactTomeRuntime(invalidInitial, []))
      .toThrow(/Cannot replay invalid Pact Tome state/);

    const stale = jsonClone(rest.transition);
    stale.command.expectedRevision = 7;
    expect(() => replayPactTomeRuntime(initialState(), [stale]))
      .toThrow(/Recorded Pact Tome transition rejected: RevisionConflict/);

    const divergent = jsonClone(rest.transition);
    divergent.event.revision = 999;
    expect(() => replayPactTomeRuntime(initialState(), [divergent]))
      .toThrow(/transition diverged/);

    const emptyReplay = replayPactTomeRuntime(initialState(), []);
    expect(emptyReplay).toEqual(initialState());
    expect(emptyReplay).not.toBe(initialState());
  });

  it('keeps transition records detached from commands, events, and integration fixtures', () => {
    const rest = conjuredShortRest();
    const recorded: RecordedPactTomeRuntimeTransition = rest.transition;
    const fixture = createPactTomeCanonicalRestIntegrationFixture(recorded);
    fixture.upsertObjects[0].name = 'tampered';
    fixture.upsertSpellGrants[0].actionId = 'tampered';
    fixture.pactState.tome.bookObjectId = 'tampered';
    expect(rest.transition.event).toMatchObject({
      type: 'PactTomeRestCompleted',
      activeTome: {
        bookObject: { name: 'Book of Shadows' },
        invocation: { tome: { bookObjectId: 'book:1' } },
      },
    });
    if (rest.transition.event.type !== 'PactTomeRestCompleted') {
      throw new Error('Expected rest event');
    }
    expect(rest.transition.event.activeTome.grants[0].actionId).not.toBe('tampered');
  });
});
