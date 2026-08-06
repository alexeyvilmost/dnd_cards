import { describe, expect, it } from 'vitest';
import {
  createWorld,
  type ActorState,
  type RuleActionDefinition,
  type RulesCatalog,
  type WorldState,
} from './domain';
import {
  evolvePactTomeRestCompleted,
  evolvePactTomeOwnerDied,
  pactTomeActorWorldIssue,
  pactTomeOwnerDeathIntegrationFixture,
  pactTomeRestIntegrationFixture,
  pactTomeSpellCastAudit,
  planPactTomeOwnerDeathTransition,
  planPactTomeRestTransition,
  type AppliedPactTomeWorldRestPlan,
  type AppliedPactTomeWorldOwnerDeathPlan,
  type PactTomeOwnerDeathFact,
  type PactTomeRestSelection,
} from './pactTomeWorldAdapter';
import { PACT_BLADE_PHB_2024_LIFECYCLE_POLICY } from './testing/pactBladePolicyFixtures';

const ACTOR = 'warlock';
const SOURCE = 'effect:pact-tome';
const HASH = 'sha256:pact-tome-world';
const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'pact-tome-world-test@1',
  contentHash: HASH,
  errataVersion: '2024-test',
};

function tomeSpell(input: {
  id: string;
  level: number;
  ritual: boolean;
  classes: string[];
  source?: string;
  sourceClass?: string;
}): RuleActionDefinition {
  return {
    id: input.id,
    name: input.id,
    kind: 'spell',
    sourceEntityIds: [`spell:${input.id}`, input.source ?? SOURCE],
    spell: {
      level: input.level,
      sourceClass: input.sourceClass ?? 'CLASS-warlock',
      ritual: input.ritual,
      classListIds: [...input.classes],
    },
    mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      effects: [{ resolution: 'auto', result: [] }],
    },
  } as RuleActionDefinition;
}

const ACTIONS: RuleActionDefinition[] = [
  tomeSpell({ id: `guidance@${SOURCE}`, level: 0, ritual: false, classes: ['CLASS-cleric'] }),
  tomeSpell({ id: `light@${SOURCE}`, level: 0, ritual: false, classes: ['CLASS-cleric', 'CLASS-wizard'] }),
  tomeSpell({ id: `minor-illusion@${SOURCE}`, level: 0, ritual: false, classes: ['CLASS-wizard'] }),
  tomeSpell({ id: `fire-bolt@${SOURCE}`, level: 0, ritual: false, classes: ['CLASS-sorcerer'] }),
  tomeSpell({ id: `druidcraft@${SOURCE}`, level: 0, ritual: false, classes: ['CLASS-druid'] }),
  tomeSpell({ id: `thaumaturgy@${SOURCE}`, level: 0, ritual: false, classes: ['CLASS-cleric'] }),
  tomeSpell({ id: `detect-magic@${SOURCE}`, level: 1, ritual: true, classes: ['CLASS-cleric', 'CLASS-wizard'] }),
  tomeSpell({ id: `identify@${SOURCE}`, level: 1, ritual: true, classes: ['CLASS-wizard'] }),
  tomeSpell({ id: `speak-with-animals@${SOURCE}`, level: 1, ritual: true, classes: ['CLASS-bard', 'CLASS-druid'] }),
  tomeSpell({ id: `ceremony@${SOURCE}`, level: 1, ritual: true, classes: ['CLASS-cleric'] }),
  tomeSpell({ id: `mage-armor@${SOURCE}`, level: 1, ritual: false, classes: ['CLASS-wizard'] }),
  {
    id: `not-a-spell@${SOURCE}`, name: 'Not a spell', kind: 'nonSpell',
    sourceEntityIds: ['not-a-spell', SOURCE], mechanics: {},
  },
];

const CATALOG: RulesCatalog = {
  getAction: (id) => ACTIONS.find((action) => action.id === id),
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function actor(overrides: Partial<ActorState> = {}): ActorState {
  return {
    id: ACTOR,
    name: 'Warlock',
    kind: 'playerCharacter',
    controllerId: 'controller:warlock',
    capabilities: {
      actionIds: ['core.action.hide', `old-unrelated@${SOURCE}`],
      featureSources: {
        'warlock.pact.tome': [SOURCE, 'EFF-pact-tome', 'CLASS-warlock'],
      },
    },
    character: {
      abilityMods: { str: 0, dex: 1, con: 2, int: 0, wis: 1, cha: 3 },
      profBonus: 2,
      level: 1,
      skillProficiencies: [],
      saveProficiencies: ['wis', 'cha'],
      classLevels: { warlock: 1 },
    },
    runtime: {
      hp: { current: 10, max: 10, temp: 0 },
      resources: { spell_slot_1: 1 },
      maxResources: { spell_slot_1: 1 },
      equipment: {}, inventory: [], activeEffects: [],
    },
    spellcastingAccess: {
      grants: [{
        grantId: 'grant:warlock:hex', actionId: 'hex', sourceId: 'CLASS-warlock',
        access: 'known', level: 1, spellcastingAbility: 'cha', slotResource: 'spell_slot_1',
      }],
      preparedSources: {},
    },
    ...overrides,
  };
}

function world(actorValue = actor()): WorldState {
  return createWorld({ id: 'world:pact-tome', ruleset: RULESET, actors: [actorValue] });
}

function selection(input: Partial<PactTomeRestSelection> = {}): PactTomeRestSelection {
  return {
    bookObjectId: 'book:first',
    cantripActionIds: [
      `guidance@${SOURCE}`, `light@${SOURCE}`, `minor-illusion@${SOURCE}`,
    ],
    ritualActionIds: [`detect-magic@${SOURCE}`, `identify@${SOURCE}`],
    ...input,
  };
}

function plan(input: {
  world?: WorldState;
  catalog?: RulesCatalog;
  rest?: 'short' | 'long';
  selection?: PactTomeRestSelection;
  actorId?: string;
  commandId?: string;
} = {}) {
  return planPactTomeRestTransition({
    world: input.world ?? world(),
    catalog: input.catalog ?? CATALOG,
    actorId: input.actorId ?? ACTOR,
    commandId: input.commandId ?? 'command:rest',
    rest: input.rest ?? 'short',
    selection: Object.hasOwn(input, 'selection') ? input.selection! : selection(),
  });
}

function applied(value = plan()): AppliedPactTomeWorldRestPlan {
  if (value.status === 'rejected') throw new Error(`${value.code}: ${value.message}`);
  return value;
}

function deathFact(
  worldValue: WorldState,
  overrides: Partial<PactTomeOwnerDeathFact> = {},
): PactTomeOwnerDeathFact {
  return {
    type: 'ActorDeathAdjudicated',
    provenance: 'canonical_actor_lifecycle',
    factId: `actor-death:${worldValue.revision}`,
    actorId: ACTOR,
    adjudicatedBy: 'system:canonical-actor-lifecycle',
    observedAtWorldRevision: worldValue.revision,
    rulesetContentHash: worldValue.ruleset.contentHash,
    ...overrides,
  };
}

function deathPlan(input: {
  world: WorldState;
  actorId?: string;
  commandId?: string;
  fact?: PactTomeOwnerDeathFact;
  catalog?: RulesCatalog;
}) {
  return planPactTomeOwnerDeathTransition({
    world: input.world,
    catalog: input.catalog ?? CATALOG,
    actorId: input.actorId ?? ACTOR,
    commandId: input.commandId ?? 'command:owner-death',
    deathFact: input.fact ?? deathFact(input.world),
  });
}

function deathApplied(
  value: ReturnType<typeof deathPlan>,
): AppliedPactTomeWorldOwnerDeathPlan {
  if (value.status === 'rejected') throw new Error(`${value.code}: ${value.message}`);
  return value;
}

function committedWorld(before: WorldState, value: AppliedPactTomeWorldRestPlan): WorldState {
  const evolved = evolvePactTomeRestCompleted(before, value.event);
  return { ...evolved, revision: value.event.revision };
}

function expectRejected(
  value: ReturnType<typeof plan> | ReturnType<typeof deathPlan>,
  code: string,
  message?: RegExp,
): void {
  expect(value.status).toBe('rejected');
  if (value.status !== 'rejected') throw new Error('Expected adapter rejection');
  expect(value.code).toBe(code);
  if (message) expect(value.message).toMatch(message);
}

describe('Pact Tome canonical WorldState adapter', () => {
  it('derives immutable mixed-class eligibility and atomically creates the first physical book', () => {
    const before = world();
    const result = applied(plan({ world: before }));
    expect(result.event).toMatchObject({
      type: 'PactTomeRestCompleted', commandId: 'command:rest', revision: 1,
      actorId: ACTOR, sourceEntityId: SOURCE, rest: 'short',
      removedBookObjectIds: [], removedSpellGrantIds: [],
      activeTome: {
        invocation: {
          kind: 'tome', sourceEntityId: SOURCE, ownerActorId: ACTOR,
          tome: {
            bookObjectId: 'book:first', createdAfterRest: 'short',
            cantripActionIds: selection().cantripActionIds.slice().sort(),
            ritualActionIds: selection().ritualActionIds.slice().sort(),
          },
        },
        bookObject: {
          id: 'book:first', name: 'Book of Shadows', ownerActorId: ACTOR,
          carriedByActorId: ACTOR, sourceActionId: SOURCE,
          tags: ['book_of_shadows', 'spellcasting_focus'],
        },
      },
    });
    const options = result.event.activeTome.selectedFromCatalog.options;
    expect(options.find((option) => option.actionId === `light@${SOURCE}`)?.classListIds)
      .toEqual(['CLASS-cleric', 'CLASS-wizard']);
    expect(options.find((option) => option.actionId === `identify@${SOURCE}`))
      .toMatchObject({ level: 1, ritual: true });

    const after = committedWorld(before, result);
    expect(after.objects['book:first']).toEqual(result.event.activeTome.bookObject);
    expect(after.actors[ACTOR].warlockPacts?.tome).toEqual(result.event.activeTome.invocation);
    expect(after.actors[ACTOR].spellcastingAccess?.grants.filter((grant) => (
      grant.sourceId === 'book:first'
    ))).toHaveLength(5);
    expect(after.actors[ACTOR].capabilities.actionIds).toEqual(expect.arrayContaining([
      'core.action.hide', `old-unrelated@${SOURCE}`, ...selection().cantripActionIds,
      ...selection().ritualActionIds,
    ]));
    expect(pactTomeActorWorldIssue(after, ACTOR)).toBeNull();
    expect(pactTomeRestIntegrationFixture(result)).toMatchObject({
      commandType: 'CompleteRest', expectedActorRevision: 0,
      removeObjectIds: [], removeSpellGrantIds: [],
      upsertObjects: [expect.objectContaining({ id: 'book:first' })],
      upsertSpellGrants: expect.arrayContaining([
        expect.objectContaining({ sourceId: 'book:first' }),
      ]),
    });
  });

  it('replaces a Short-Rest book on Long Rest and removes only its source-scoped grants/actions', () => {
    const initial = world();
    const first = applied(plan({ world: initial, commandId: 'rest:short' }));
    const afterFirst = committedWorld(initial, first);
    const nextSelection = selection({
      bookObjectId: 'book:second',
      cantripActionIds: [
        `fire-bolt@${SOURCE}`, `druidcraft@${SOURCE}`, `thaumaturgy@${SOURCE}`,
      ],
      ritualActionIds: [`speak-with-animals@${SOURCE}`, `ceremony@${SOURCE}`],
    });
    const second = applied(plan({
      world: afterFirst, rest: 'long', selection: nextSelection, commandId: 'rest:long',
    }));
    expect(second.event).toMatchObject({
      rest: 'long', revision: 2,
      removedBookObjectIds: ['book:first'],
      removedSpellGrantIds: first.event.activeTome.grants.map((grant) => grant.grantId).sort(),
    });
    const afterSecond = committedWorld(afterFirst, second);
    expect(afterSecond.objects['book:first']).toBeUndefined();
    expect(afterSecond.objects['book:second']).toBeDefined();
    expect(afterSecond.actors[ACTOR].spellcastingAccess?.grants.some((grant) => (
      grant.sourceId === 'book:first'
    ))).toBe(false);
    expect(afterSecond.actors[ACTOR].spellcastingAccess?.grants.filter((grant) => (
      grant.sourceId === 'book:second'
    ))).toHaveLength(5);
    for (const oldAction of [...selection().cantripActionIds, ...selection().ritualActionIds]) {
      expect(afterSecond.actors[ACTOR].capabilities.actionIds).not.toContain(oldAction);
    }
    expect(afterSecond.actors[ACTOR].capabilities.actionIds).toEqual(expect.arrayContaining([
      'core.action.hide', `old-unrelated@${SOURCE}`,
      ...nextSelection.cantripActionIds, ...nextSelection.ritualActionIds,
    ]));
    expect(pactTomeActorWorldIssue(afterSecond, ACTOR)).toBeNull();
  });

  it('supports an explicit same-ID book replacement without deleting foreign objects', () => {
    const initial = world();
    const first = applied(plan({ world: initial }));
    const afterFirst = committedWorld(initial, first);
    afterFirst.objects.foreign = {
      ...clone(afterFirst.objects['book:first']),
      id: 'foreign',
      ownerActorId: 'other',
      carriedByActorId: 'other',
      sourceActorId: 'other',
    };
    const replacement = applied(plan({
      world: afterFirst,
      rest: 'long',
      commandId: 'rest:same-id',
      selection: selection({ bookObjectId: 'book:first' }),
    }));
    const afterReplacement = committedWorld(afterFirst, replacement);
    expect(replacement.event.removedBookObjectIds).toEqual(['book:first']);
    expect(afterReplacement.objects['book:first']).toEqual(replacement.event.activeTome.bookObject);
    expect(afterReplacement.objects.foreign).toEqual(afterFirst.objects.foreign);

    const forgedPrevious = clone(afterFirst);
    forgedPrevious.actors[ACTOR].warlockPacts!.tome!.tome.bookObjectId = 'foreign';
    expect(() => evolvePactTomeRestCompleted(forgedPrevious, {
      ...replacement.event,
      removedBookObjectIds: ['foreign'],
    })).toThrow(/cannot replace invalid previous state.*physical/i);
    expect(forgedPrevious.objects.foreign).toEqual(afterFirst.objects.foreign);
  });

  it('atomically dismisses only the active Tome after an authoritative owner-death fact', () => {
    const initial = world();
    const rest = applied(plan({ world: initial }));
    const beforeDeath = committedWorld(initial, rest);
    const onlyTomeBefore = clone(beforeDeath);
    const onlyTomePlan = deathApplied(deathPlan({ world: onlyTomeBefore }));
    expect(evolvePactTomeOwnerDied(onlyTomeBefore, onlyTomePlan.event)
      .actors[ACTOR].warlockPacts).toBeUndefined();
    beforeDeath.objects.foreign = {
      ...clone(beforeDeath.objects['book:first']),
      id: 'foreign',
      ownerActorId: 'other',
      carriedByActorId: 'other',
      sourceActorId: 'other',
      sourceActionId: 'foreign-source',
    };
    beforeDeath.actors[ACTOR].warlockPacts!.blade = {
      kind: 'blade',
      sourceEntityId: 'effect:pact-blade',
      ownerActorId: ACTOR,
      bondActionId: 'action:pact-blade-bond',
      lifecyclePolicy: PACT_BLADE_PHB_2024_LIFECYCLE_POLICY,
      activeBond: null,
    };
    const planned = deathApplied(deathPlan({ world: beforeDeath }));
    const tome = beforeDeath.actors[ACTOR].warlockPacts!.tome!.tome;
    expect(beforeDeath.actors[ACTOR].runtime.hp.current).toBeGreaterThan(0);
    expect(planned.event).toEqual({
      schemaVersion: 1,
      type: 'PactTomeOwnerDied',
      commandId: 'command:owner-death',
      revision: 2,
      actorId: ACTOR,
      sourceEntityId: SOURCE,
      rulesetContentHash: HASH,
      deathFact: deathFact(beforeDeath),
      dismissedTome: beforeDeath.actors[ACTOR].warlockPacts!.tome,
      removedBookObjectIds: ['book:first'],
      removedSpellGrantIds: [...tome.spellGrantIds].sort(),
      removedActionIds: [...tome.cantripActionIds, ...tome.ritualActionIds].sort(),
    });
    const afterDeath = evolvePactTomeOwnerDied(beforeDeath, planned.event);
    expect(afterDeath.objects['book:first']).toBeUndefined();
    expect(afterDeath.objects.foreign).toEqual(beforeDeath.objects.foreign);
    expect(afterDeath.actors[ACTOR].warlockPacts).toEqual({
      blade: beforeDeath.actors[ACTOR].warlockPacts!.blade,
    });
    expect(afterDeath.actors[ACTOR].spellcastingAccess?.grants).toEqual([
      expect.objectContaining({ grantId: 'grant:warlock:hex', sourceId: 'CLASS-warlock' }),
    ]);
    expect(afterDeath.actors[ACTOR].capabilities.actionIds).toEqual([
      'core.action.hide', `old-unrelated@${SOURCE}`,
    ]);
    expect(pactTomeActorWorldIssue(afterDeath, ACTOR)).toBeNull();
    expect(evolvePactTomeOwnerDied(clone(beforeDeath), clone(planned.event)))
      .toEqual(afterDeath);
    expect(pactTomeOwnerDeathIntegrationFixture(planned)).toEqual({
      triggerEventType: 'ActorDied',
      requiredFactProvenance: 'canonical_actor_lifecycle',
      expectedWorldRevision: 1,
      actorId: ACTOR,
      sourceEntityId: SOURCE,
      removeObjectIds: ['book:first'],
      removeSpellGrantIds: [...tome.spellGrantIds].sort(),
      removeActionIds: [...tome.cantripActionIds, ...tome.ritualActionIds].sort(),
      clearPactTomeState: true,
    });
    planned.event.dismissedTome.tome.bookObjectId = 'tampered-event';
    expect(beforeDeath.actors[ACTOR].warlockPacts!.tome!.tome.bookObjectId).toBe('book:first');
    expect(afterDeath.actors[ACTOR].warlockPacts?.blade).toBeDefined();
  });

  it('fails closed for non-authoritative death facts and foreign Tome state or events', () => {
    const initial = world();
    const beforeDeath = committedWorld(initial, applied(plan({ world: initial })));
    expectRejected(deathPlan({ world: beforeDeath, actorId: 'missing' }), 'ActorNotFound');
    expectRejected(deathPlan({ world: world() }), 'TomeUnavailable');

    const noCapability = clone(beforeDeath);
    delete noCapability.actors[ACTOR].capabilities.featureSources;
    expectRejected(deathPlan({ world: noCapability }), 'FeatureNotGranted');
    expectRejected(deathPlan({
      world: beforeDeath,
      fact: deathFact(beforeDeath, { actorId: 'other' }),
    }), 'InvalidOwnerDeathFact', /another actor/);
    expectRejected(deathPlan({
      world: beforeDeath,
      fact: deathFact(beforeDeath, {
        provenance: 'client_claim' as 'canonical_actor_lifecycle',
      }),
    }), 'InvalidOwnerDeathFact', /non-authoritative/);

    const foreignBook = clone(beforeDeath);
    foreignBook.objects['book:first'].ownerActorId = 'other';
    expectRejected(deathPlan({ world: foreignBook }), 'InvalidWorldState');
    const missingGrant = clone(beforeDeath);
    missingGrant.actors[ACTOR].spellcastingAccess!.grants = missingGrant.actors[ACTOR]
      .spellcastingAccess!.grants.filter((grant) => grant.sourceId !== 'book:first');
    expectRejected(deathPlan({ world: missingGrant }), 'InvalidWorldState');

    const valid = deathApplied(deathPlan({ world: beforeDeath })).event;
    expect(() => evolvePactTomeOwnerDied(beforeDeath, { ...valid, actorId: 'missing' }))
      .toThrow(/unknown actor/);
    expect(() => evolvePactTomeOwnerDied(beforeDeath, { ...valid, revision: 7 }))
      .toThrow(/revision or ruleset/);
    expect(() => evolvePactTomeOwnerDied(beforeDeath, { ...valid, rulesetContentHash: 'other' }))
      .toThrow(/revision or ruleset/);
    expect(() => evolvePactTomeOwnerDied(beforeDeath, {
      ...valid,
      deathFact: deathFact(beforeDeath, { actorId: 'other' }),
    })).toThrow(/Invalid Pact Tome owner-death fact/);

    const noActive = clone(beforeDeath);
    delete noActive.actors[ACTOR].warlockPacts!.tome;
    expect(() => evolvePactTomeOwnerDied(noActive, valid)).toThrow(/no active Pact Tome/);
    expect(() => evolvePactTomeOwnerDied(beforeDeath, {
      ...valid,
      sourceEntityId: 'foreign-source',
    })).toThrow(/foreign invocation/);
    expect(() => evolvePactTomeOwnerDied(beforeDeath, {
      ...valid,
      dismissedTome: { ...valid.dismissedTome, sourceEntityId: 'foreign-source' },
    })).toThrow(/foreign invocation/);
    expect(() => evolvePactTomeOwnerDied(beforeDeath, {
      ...valid,
      removedBookObjectIds: ['foreign'],
    })).toThrow(/does not remove exactly/);
    expect(() => evolvePactTomeOwnerDied(foreignBook, valid))
      .toThrow(/cannot remove foreign state/);
  });

  it.each([
    [null as unknown as PactTomeRestSelection, /must be an object/],
    [selection({ bookObjectId: ' ' }), /requires a book object ID/],
    [selection({ cantripActionIds: null as unknown as string[] }), /must be arrays/],
    [selection({ ritualActionIds: [' '] }), /non-blank action IDs/],
  ])('rejects malformed explicit rest selection %#', (badSelection, message) => {
    expectRejected(plan({ selection: badSelection }), 'InvalidSelection', message);
  });

  it('fails closed without actor-owned Pact Tome capability or one stable invocation scope', () => {
    expectRejected(plan({ actorId: 'missing' }), 'ActorNotFound');
    const noFeature = world(actor({ capabilities: { actionIds: [] } }));
    expectRejected(plan({ world: noFeature }), 'FeatureNotGranted', /does not own/);
    const ambiguous = selection({
      cantripActionIds: [`guidance@${SOURCE}`, 'light@other', `minor-illusion@${SOURCE}`],
    });
    expectRejected(plan({ world: noFeature, selection: ambiguous }), 'FeatureNotGranted');
    const wrongOwnedSource = world(actor({
      capabilities: {
        actionIds: [], featureSources: { 'warlock.pact.tome': ['other-source'] },
      },
    }));
    expectRejected(plan({ world: wrongOwnedSource }), 'FeatureNotGranted', /no actor-owned/);
    const emptyOwnedSources = world(actor({
      capabilities: {
        actionIds: [],
        featureSources: {
          'warlock.pact.tome': [] as unknown as [string, ...string[]],
        },
      },
    }));
    expectRejected(plan({
      world: emptyOwnedSources,
      selection: selection({
        cantripActionIds: [`unknown@${SOURCE}`, `light@${SOURCE}`, `minor-illusion@${SOURCE}`],
      }),
    }), 'FeatureNotGranted');
    expectRejected(plan({
      selection: selection({
        cantripActionIds: ['guidance-without-scope', 'light@other', `minor-illusion@${SOURCE}`],
      }),
    }), 'InvalidCatalogAction', /Unknown immutable spell action/);
    const malformedCapability = world(actor({
      capabilities: {
        actionIds: [], featureSources: { 'warlock.pact.tome': [SOURCE, ' '] },
      },
    }));
    expectRejected(plan({ world: malformedCapability }), 'InvalidWorldState', /non-blank/);
  });

  it.each([
    {
      label: 'unknown action',
      value: selection({
        cantripActionIds: [`unknown@${SOURCE}`, `light@${SOURCE}`, `minor-illusion@${SOURCE}`],
      }),
      catalog: CATALOG,
      message: /Unknown immutable spell action/,
    },
    {
      label: 'non-spell action',
      value: selection({
        cantripActionIds: [`not-a-spell@${SOURCE}`, `light@${SOURCE}`, `minor-illusion@${SOURCE}`],
      }),
      catalog: CATALOG,
      message: /not an immutable spell action/,
    },
    {
      label: 'wrong source',
      value: selection(),
      catalog: {
        getAction: (id: string) => id === `guidance@${SOURCE}`
          ? tomeSpell({ id, level: 0, ritual: false, classes: ['CLASS-cleric'], source: 'other' })
          : CATALOG.getAction(id),
      },
      message: /not scoped to this Pact Tome/,
    },
    {
      label: 'missing ritual metadata',
      value: selection(),
      catalog: {
        getAction: (id: string) => {
          const action = clone(CATALOG.getAction(id)!);
          if (id === `guidance@${SOURCE}` && action.kind === 'spell') {
            delete (action.spell as { ritual?: boolean }).ritual;
          }
          return action;
        },
      },
      message: /lacks immutable ritual metadata/,
    },
    {
      label: 'missing class-list metadata',
      value: selection(),
      catalog: {
        getAction: (id: string) => id === `guidance@${SOURCE}`
          ? tomeSpell({ id, level: 0, ritual: false, classes: [] })
          : CATALOG.getAction(id),
      },
      message: /lacks immutable class-list provenance/,
    },
    {
      label: 'blank class-list metadata',
      value: selection(),
      catalog: {
        getAction: (id: string) => id === `guidance@${SOURCE}`
          ? tomeSpell({ id, level: 0, ritual: false, classes: [' '] })
          : CATALOG.getAction(id),
      },
      message: /lacks immutable class-list provenance/,
    },
    {
      label: 'duplicate class-list metadata',
      value: selection(),
      catalog: {
        getAction: (id: string) => id === `guidance@${SOURCE}`
          ? tomeSpell({ id, level: 0, ritual: false, classes: ['CLASS-cleric', 'CLASS-cleric'] })
          : CATALOG.getAction(id),
      },
      message: /lacks immutable class-list provenance/,
    },
  ])('rejects $label instead of trusting client spell claims', ({ label, value, catalog: custom, message }) => {
    expectRejected(
      plan({ selection: value, catalog: custom }),
      label === 'wrong source' ? 'FeatureNotGranted' : 'InvalidCatalogAction',
      label === 'wrong source' ? /no actor-owned invocation source/ : message,
    );
  });

  it('fails closed if an active invocation receives a spell outside its authoritative source', () => {
    const initial = world();
    const afterFirst = committedWorld(initial, applied(plan({ world: initial })));
    const wrongSourceCatalog: RulesCatalog = {
      getAction: (id) => id === `guidance@${SOURCE}`
        ? tomeSpell({ id, level: 0, ritual: false, classes: ['CLASS-cleric'], source: 'other' })
        : CATALOG.getAction(id),
    };
    expectRejected(plan({
      world: afterFirst,
      catalog: wrongSourceCatalog,
      selection: selection({ bookObjectId: 'book:second' }),
    }), 'InvalidCatalogAction', /not scoped to this Pact Tome/);
  });

  it('delegates exact counts, duplicates, levels, rituals, and already-prepared checks to the pure model', () => {
    expectRejected(plan({
      selection: selection({ cantripActionIds: [`guidance@${SOURCE}`, `light@${SOURCE}`] }),
    }), 'InvalidRestSelection', /exactly 3 distinct/);
    expectRejected(plan({
      selection: selection({
        cantripActionIds: [`guidance@${SOURCE}`, `guidance@${SOURCE}`, `light@${SOURCE}`],
      }),
    }), 'InvalidRestSelection', /exactly 3 distinct|distinct action IDs/);
    expectRejected(plan({
      selection: selection({
        ritualActionIds: [`identify@${SOURCE}`, `mage-armor@${SOURCE}`],
      }),
    }), 'InvalidRestSelection', /not an eligible level-1 ritual/);
    const prepared = actor({
      spellcastingAccess: {
        grants: [{
          grantId: 'grant:prepared:guidance', actionId: `guidance@${SOURCE}`,
          sourceId: 'CLASS-cleric', access: 'cantrip', level: 0, spellcastingAbility: 'wis',
        }, {
          grantId: 'grant:warlock:hex', actionId: 'hex', sourceId: 'CLASS-warlock',
          access: 'known', level: 1, spellcastingAbility: 'cha', slotResource: 'spell_slot_1',
        }],
        preparedSources: {},
      },
    });
    expectRejected(plan({ world: world(prepared) }), 'InvalidRestSelection', /already prepared/);
  });

  it('derives invocation provenance and Pact slot policy without reserved class or resource ids', () => {
    const renamedInvocationSource = 'effect:book-covenant-alpha';
    const renamedClassGrantSource = 'rules-source:caster-alpha';
    const renamedSlotResource = 'resource:pact-channel-alpha';
    const renamedCatalog: RulesCatalog = {
      getAction: (id) => {
        const original = CATALOG.getAction(id);
        if (!original || original.kind !== 'spell') return original;
        return {
          ...clone(original),
          sourceEntityIds: [original.sourceEntityIds[0], renamedInvocationSource],
          spell: { ...clone(original.spell), sourceClass: 'renamed-class-metadata' },
        };
      },
    };
    const renamedActor = actor({
      capabilities: {
        actionIds: ['core.action.hide'],
        featureSources: {
          'warlock.pact.tome': [
            renamedInvocationSource, 'effect-card:book-covenant-alpha', renamedClassGrantSource,
          ],
        },
      },
      runtime: {
        ...actor().runtime,
        resources: { [renamedSlotResource]: 1 },
        maxResources: { [renamedSlotResource]: 1 },
      },
      spellcastingAccess: {
        grants: [{
          grantId: 'grant:caster-alpha:known', actionId: 'spell:known-alpha',
          sourceId: renamedClassGrantSource, access: 'known', level: 1,
          spellcastingAbility: 'cha', slotResource: renamedSlotResource,
        }],
        preparedSources: {},
      },
    });
    const result = applied(plan({ world: world(renamedActor), catalog: renamedCatalog }));
    expect(result.event.sourceEntityId).toBe(renamedInvocationSource);
    expect(result.event.activeTome.grants.filter((grant) => grant.level === 1))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ slotResource: renamedSlotResource }),
      ]));
    expect(result.event.activeTome.selectedFromCatalog.options.every((option) => (
      option.classListIds.length > 0
    ))).toBe(true);
  });

  it('uses the empty access fallback when optional access changes after slot authorization', () => {
    const changingWorld = world();
    const changingActor = changingWorld.actors[ACTOR];
    const authorizedAccess = changingActor.spellcastingAccess;
    let accessReads = 0;
    Object.defineProperty(changingActor, 'spellcastingAccess', {
      configurable: true,
      get: () => {
        accessReads += 1;
        return accessReads === 1 ? authorizedAccess : undefined;
      },
    });

    const result = applied(plan({ world: changingWorld }));
    expect(accessReads).toBe(2);
    expect(result.event.activeTome.grants).toHaveLength(5);
  });

  it('rejects malformed existing Tome state and derives/fails the L1 slot without client input', () => {
    const noAccess = actor({ spellcastingAccess: undefined });
    const noAccessWorld = world(noAccess);
    expectRejected(plan({ world: noAccessWorld }), 'InvalidWorldState', /no level-1 Pact Magic slot/);
    const noSlot = actor({
      spellcastingAccess: { grants: [], preparedSources: {} },
      runtime: {
        ...actor().runtime, resources: {}, maxResources: {},
      },
    });
    expectRejected(plan({ world: world(noSlot) }), 'InvalidWorldState', /no level-1 Pact Magic slot/);

    const firstWorld = world();
    const first = applied(plan({ world: firstWorld }));
    const after = committedWorld(firstWorld, first);
    const missingObject = clone(after);
    delete missingObject.objects['book:first'];
    expectRejected(plan({ world: missingObject }), 'InvalidWorldState', /object is missing/);
    const missingAccess = clone(after);
    delete missingAccess.actors[ACTOR].spellcastingAccess;
    expectRejected(plan({ world: missingAccess }), 'InvalidWorldState', /no spellcasting access/);
    const missingGrant = clone(after);
    missingGrant.actors[ACTOR].spellcastingAccess!.grants = missingGrant.actors[ACTOR]
      .spellcastingAccess!.grants.filter((grant) => grant.sourceId !== 'book:first');
    expectRejected(plan({ world: missingGrant }), 'InvalidWorldState', /grant is missing/);
    const wrongOwner = clone(after);
    wrongOwner.actors[ACTOR].warlockPacts!.tome!.ownerActorId = 'other';
    expectRejected(plan({ world: wrongOwner }), 'InvalidWorldState', /does not match/);
    const invalidPhysicalBook = clone(after);
    invalidPhysicalBook.objects['book:first'].carriedByActorId = 'other';
    expectRejected(plan({ world: invalidPhysicalBook }), 'InvalidWorldState', /diverged/);
    const invalidOldCatalog: RulesCatalog = {
      getAction: (id) => id === `guidance@${SOURCE}`
        ? tomeSpell({ id, level: 0, ritual: false, classes: [] })
        : CATALOG.getAction(id),
    };
    expectRejected(plan({
      world: after,
      catalog: invalidOldCatalog,
      selection: selection({
        bookObjectId: 'book:replacement',
        cantripActionIds: [
          `fire-bolt@${SOURCE}`, `druidcraft@${SOURCE}`, `thaumaturgy@${SOURCE}`,
        ],
        ritualActionIds: [`speak-with-animals@${SOURCE}`, `ceremony@${SOURCE}`],
      }),
    }), 'InvalidWorldState', /class-list/);
  });

  it('fails closed while replaying malformed or non-atomic rest events', () => {
    const before = world();
    const valid = applied(plan({ world: before })).event;
    const withoutAccess = world(actor({ spellcastingAccess: undefined }));
    const initialized = evolvePactTomeRestCompleted(withoutAccess, valid);
    expect(initialized.actors[ACTOR].spellcastingAccess?.grants).toHaveLength(5);
    expect(() => evolvePactTomeRestCompleted(before, { ...valid, actorId: 'missing' }))
      .toThrow(/unknown actor/);
    expect(() => evolvePactTomeRestCompleted(before, { ...valid, revision: 3 }))
      .toThrow(/revision or ruleset provenance/);
    expect(() => evolvePactTomeRestCompleted(before, { ...valid, rulesetContentHash: 'other' }))
      .toThrow(/revision or ruleset provenance/);
    const noCapability = world(actor({ capabilities: { actionIds: [] } }));
    expect(() => evolvePactTomeRestCompleted(noCapability, valid))
      .toThrow(/source is not owned/);
    const invalidActive = clone(valid);
    invalidActive.activeTome.bookObject.carriedByActorId = 'other';
    expect(() => evolvePactTomeRestCompleted(before, invalidActive))
      .toThrow(/Invalid Pact Tome rest event/);
    expect(() => evolvePactTomeRestCompleted(before, {
      ...valid, removedBookObjectIds: ['foreign'],
    })).toThrow(/does not replace exactly/);

    const first = committedWorld(before, applied(plan({ world: before })));
    const second = applied(plan({
      world: first,
      rest: 'long',
      selection: selection({ bookObjectId: 'book:second' }),
    })).event;
    const missingOldObject = clone(first);
    delete missingOldObject.objects['book:first'];
    expect(() => evolvePactTomeRestCompleted(missingOldObject, second))
      .toThrow(/cannot replace invalid previous state.*missing Book/i);
    const objectCollision = clone(first);
    objectCollision.objects['book:second'] = clone(objectCollision.objects['book:first']);
    objectCollision.objects['book:second'].id = 'book:second';
    expect(() => evolvePactTomeRestCompleted(objectCollision, second))
      .toThrow(/cannot overwrite object/);
    const retainedCollision = clone(first);
    retainedCollision.actors[ACTOR].spellcastingAccess!.grants.push({
      grantId: 'foreign', actionId: 'foreign', sourceId: 'book:second',
      access: 'cantrip', level: 0, spellcastingAbility: 'cha',
    });
    expect(() => evolvePactTomeRestCompleted(retainedCollision, second))
      .toThrow(/collides with a retained/);
  });

  it('reports structural actor/world migration issues without a catalog', () => {
    expect(pactTomeActorWorldIssue(world(), 'missing')).toMatch(/Unknown actor/);
    expect(pactTomeActorWorldIssue(world(), ACTOR)).toBeNull();
    const before = world();
    const after = committedWorld(before, applied(plan({ world: before })));
    const noObject = clone(after);
    delete noObject.objects['book:first'];
    expect(pactTomeActorWorldIssue(noObject, ACTOR)).toMatch(/missing Book/);
    const noAccess = clone(after);
    delete noAccess.actors[ACTOR].spellcastingAccess;
    expect(pactTomeActorWorldIssue(noAccess, ACTOR)).toMatch(/no spellcasting access/);
    const wrongGrant = clone(after);
    wrongGrant.actors[ACTOR].spellcastingAccess!.grants = wrongGrant.actors[ACTOR]
      .spellcastingAccess!.grants.filter((grant) => grant.sourceId !== 'book:first');
    expect(pactTomeActorWorldIssue(wrongGrant, ACTOR)).toMatch(/grants diverge/);
    const noAction = clone(after);
    noAction.actors[ACTOR].capabilities.actionIds = ['core.action.hide'];
    expect(pactTomeActorWorldIssue(noAction, ACTOR)).toMatch(/absent from actor capabilities/);
    const invalidFocus = clone(after);
    invalidFocus.objects['book:first'].tags = ['book_of_shadows'];
    expect(pactTomeActorWorldIssue(invalidFocus, ACTOR)).toMatch(/invalid physical/);
    const foreignInvocation = clone(after);
    foreignInvocation.actors[ACTOR].warlockPacts!.tome!.ownerActorId = 'other';
    expect(pactTomeActorWorldIssue(foreignInvocation, ACTOR)).toMatch(/foreign owner/);
    const wrongCardinality = clone(after);
    wrongCardinality.actors[ACTOR].warlockPacts!.tome!.tome.cantripActionIds.pop();
    expect(pactTomeActorWorldIssue(wrongCardinality, ACTOR)).toMatch(/exactly three cantrips/);
    const outsideSelection = clone(after);
    outsideSelection.actors[ACTOR].spellcastingAccess!.grants
      .find((grant) => grant.sourceId === 'book:first')!.actionId = 'outside-selection';
    expect(pactTomeActorWorldIssue(outsideSelection, ACTOR)).toMatch(/outside the active book/);
  });

  it('audits normal and ritual casts against the active physical book and source grant', () => {
    const before = world();
    const after = committedWorld(before, applied(plan({ world: before })));
    const tome = after.actors[ACTOR].warlockPacts!.tome!.tome;
    const cantripActionId = tome.cantripActionIds[0];
    const ritualActionId = tome.ritualActionIds[0];
    const grants = after.actors[ACTOR].spellcastingAccess!.grants;
    const cantripGrant = grants.find((grant) => grant.actionId === cantripActionId)!;
    const ritualGrant = grants.find((grant) => grant.actionId === ritualActionId)!;
    const audit = (overrides: Partial<Parameters<typeof pactTomeSpellCastAudit>[0]> = {}) => (
      pactTomeSpellCastAudit({
        world: after,
        actorId: ACTOR,
        actionId: ritualActionId,
        grantId: ritualGrant.grantId,
        sourceId: tome.bookObjectId,
        mode: 'ritual',
        payment: { kind: 'none' },
        ...overrides,
      })
    );

    expect(audit()).toEqual({
      status: 'ready', focusObjectId: tome.bookObjectId, castingTimeAddedSeconds: 600,
    });
    expect(audit({ mode: 'normal', payment: { kind: 'slot', resource: 'spell_slot_1' } }))
      .toEqual({ status: 'ready', focusObjectId: tome.bookObjectId, castingTimeAddedSeconds: 0 });
    expect(audit({
      actionId: cantripActionId,
      grantId: cantripGrant.grantId,
      mode: 'normal',
      payment: { kind: 'none' },
    })).toEqual({ status: 'ready', focusObjectId: tome.bookObjectId, castingTimeAddedSeconds: 0 });
    expect(audit({ actorId: 'missing' })).toMatchObject({ status: 'rejected', message: 'Unknown actor missing' });
    expect(pactTomeSpellCastAudit({
      world: world(), actorId: ACTOR, actionId: 'hex', grantId: 'grant:warlock:hex',
      sourceId: 'CLASS-warlock', mode: 'normal', payment: { kind: 'slot', resource: 'spell_slot_1' },
    })).toEqual({ status: 'not_pact_tome' });
    expect(audit({ actionId: 'hex', sourceId: 'CLASS-warlock' })).toEqual({ status: 'not_pact_tome' });
    expect(audit({ actionId: 'hex' })).toMatchObject({ status: 'rejected', message: expect.stringMatching(/outside/) });

    const invalidFocus = clone(after);
    invalidFocus.objects[tome.bookObjectId].carriedByActorId = 'other';
    expect(audit({ world: invalidFocus })).toMatchObject({ status: 'rejected', message: expect.stringMatching(/physical/) });
    expect(audit({ sourceId: 'CLASS-warlock' })).toMatchObject({ status: 'rejected', message: expect.stringMatching(/not sourced/) });
    expect(audit({ grantId: 'grant:missing' })).toMatchObject({ status: 'rejected', message: expect.stringMatching(/not sourced/) });

    const mismatchedGrant = clone(after);
    mismatchedGrant.actors[ACTOR].spellcastingAccess!.grants
      .find((grant) => grant.grantId === ritualGrant.grantId)!.actionId = cantripActionId;
    expect(audit({ world: mismatchedGrant })).toMatchObject({ status: 'rejected', message: expect.stringMatching(/semantics/) });
    const shadowedGrant = clone(after);
    shadowedGrant.actors[ACTOR].spellcastingAccess!.grants.unshift({
      ...clone(ritualGrant),
      actionId: 'foreign-action',
      sourceId: 'foreign-source',
    });
    expect(audit({ world: shadowedGrant })).toMatchObject({
      status: 'rejected', message: expect.stringMatching(/diverges/),
    });
    expect(audit({
      actionId: cantripActionId,
      grantId: cantripGrant.grantId,
      mode: 'ritual',
      payment: { kind: 'none' },
    })).toMatchObject({ status: 'rejected', message: expect.stringMatching(/cantrip/) });
    expect(audit({ payment: { kind: 'free_use', resource: 'free' } }))
      .toMatchObject({ status: 'rejected', message: expect.stringMatching(/ritual/) });
    expect(audit({ mode: 'normal', payment: { kind: 'none' } }))
      .toMatchObject({ status: 'rejected', message: expect.stringMatching(/ritual/) });
    expect(audit({ mode: 'normal', payment: { kind: 'slot', resource: 'spell_slot_2' } }))
      .toMatchObject({ status: 'rejected', message: expect.stringMatching(/ritual/) });
    const malformedRitual = clone(after);
    delete malformedRitual.actors[ACTOR].spellcastingAccess!.grants
      .find((grant) => grant.grantId === ritualGrant.grantId)!.slotResource;
    expect(audit({ world: malformedRitual })).toMatchObject({ status: 'rejected', message: expect.stringMatching(/ritual/) });
  });

  it('keeps the reducer result and integration data detached from the recorded event', () => {
    const before = world();
    const result = applied(plan({ world: before }));
    const after = evolvePactTomeRestCompleted(before, result.event);
    after.objects['book:first'].name = 'tampered';
    after.actors[ACTOR].spellcastingAccess!.grants[0].actionId = 'tampered';
    expect(result.event.activeTome.bookObject.name).toBe('Book of Shadows');
    expect(result.event.activeTome.grants.some((grant) => grant.actionId === 'tampered')).toBe(false);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
