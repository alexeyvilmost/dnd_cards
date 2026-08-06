import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileMicroMvpL1ChoiceVariant,
  compileMicroMvpL1Overlay,
  type CompiledMicroMvpL1Provider,
  type CompiledMicroMvpL1Root,
} from '../../canon/microMvpL1Overlay';
import {
  canonicalStringify,
  createLogicalClock,
  createSequentialIdFactory,
} from '../determinism';
import {
  createWorld,
  type GameCommand,
  type RuleActionDefinition,
  type RulesCatalog,
} from '../domain';
import { InMemoryRulesSession } from '../session';
import type { SpellcastingAccessState } from '../spellcastingAccess';
import {
  adaptCompiledMicroMvpL1Root,
  CompiledMicroMvpScenarioAdapterError,
  createCompiledMicroMvpScenarioFixtureProvider,
  type CompiledMicroMvpScenarioActorState,
} from './compiledMicroMvpScenarioAdapter';
import { runScenario, type ScenarioSpec } from './scenario';

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function rootForClass(provider: CompiledMicroMvpL1Provider, cardNumber: string): CompiledMicroMvpL1Root {
  const root = provider.roots.find((candidate) => candidate.matrixCase.klass.card_number === cardNumber);
  if (!root) throw new Error(`Missing compiled root for ${cardNumber}`);
  return root;
}

function withActor(
  root: CompiledMicroMvpL1Root,
  actor: CompiledMicroMvpL1Root['actor'],
): CompiledMicroMvpL1Root {
  return { ...root, actor };
}

function catalogIncludingRoot(
  base: RulesCatalog,
  root: CompiledMicroMvpL1Root,
): RulesCatalog {
  const rootActions = new Map(root.rulesActions.map((action) => [action.id, action]));
  return { getAction: (actionId) => rootActions.get(actionId) ?? base.getAction(actionId) };
}

describe('compiled micro-MVP scenario actor adapter', () => {
  let compiled: CompiledMicroMvpL1Provider;
  let fighter: CompiledMicroMvpL1Root;
  let wizard: CompiledMicroMvpL1Root;
  let pactTomeWarlock: CompiledMicroMvpL1Root;

  beforeAll(async () => {
    compiled = await compileMicroMvpL1Overlay();
    fighter = rootForClass(compiled, 'CLASS-warrior');
    wizard = rootForClass(compiled, 'CLASS-wizard');
    const warlock = rootForClass(compiled, 'CLASS-warlock');
    pactTomeWarlock = await compileMicroMvpL1ChoiceVariant({
      stableKey: warlock.stableKey,
      overrides: { warlock_invocation_l1: ['EFF-pact-tome'] },
    });
  }, 60_000);

  it('projects one real compiler root without duplicating mechanics or losing build state', () => {
    const fixture = adaptCompiledMicroMvpL1Root(fighter, compiled.ruleset);

    expect(fixture.fixtureId).toBe(fighter.fixtureId);
    expect(fixture.actor).not.toBe(fighter.actor);
    expect(fixture.actor.character).toEqual(fighter.actor.character);
    expect(fixture.actor.runtime).toEqual(fighter.actor.runtime);
    expect(fixture.actor.runtime).not.toBe(fighter.actor.runtime);
    expect(fixture.actor.passives).toEqual(fighter.actor.passives);
    expect(fixture.actor.grantedEffects).toEqual(fighter.actor.grantedEffects);
    expect(fixture.actor.masteryEffects).toEqual(fighter.actor.masteryEffects);
    expect(fixture.actor.capabilities.actionIds).toEqual(
      fighter.rulesActions.map((action) => action.id).sort(),
    );
    for (const action of fighter.rulesActions) {
      expect(fixture.actor.capabilities.featureSources?.[action.id]).toEqual(action.sourceEntityIds);
      expect(fixture.actions.find((candidate) => candidate.id === action.id)).toEqual(action);
    }

    expect(fixture.actor.choices).toEqual(fighter.decisions);
    expect(fixture.actor.choices).not.toBe(fighter.decisions);
    expect(fixture.actor.ruleState).toEqual(fighter.ruleState);
    expect(fixture.actor.ruleState).not.toBe(fighter.ruleState);
    expect(fixture.actor.compiledSource).toEqual({
      schemaVersion: 1,
      fixtureId: fighter.fixtureId,
      sourceFixtureId: fighter.sourceFixtureId,
      stableKey: fighter.stableKey,
      ruleset: compiled.ruleset,
      entities: {
        species: {
          id: fighter.matrixCase.species.id,
          cardNumber: fighter.matrixCase.species.card_number,
        },
        class: {
          id: fighter.matrixCase.klass.id,
          cardNumber: fighter.matrixCase.klass.card_number,
        },
        background: {
          id: fighter.matrixCase.background.id,
          cardNumber: fighter.matrixCase.background.card_number,
        },
        originFeat: {
          id: fighter.matrixCase.originFeat.id,
          cardNumber: fighter.matrixCase.originFeat.card_number,
        },
        ...(fighter.speciesAudit.lineageId && fighter.speciesAudit.lineageCardNumber ? {
          lineage: {
            id: fighter.speciesAudit.lineageId,
            cardNumber: fighter.speciesAudit.lineageCardNumber,
          },
        } : {}),
      },
      selectedSpellIds: [...fighter.selectedSpellIds].sort(),
      selectedInvocationEffectIds: [...fighter.selectedInvocationEffectIds].sort(),
      excludedResourceIds: [...fighter.excludedResourceIds].sort(),
    });
  });

  it('retains optional compiled traits and source-scoped spell access when the compiler supplies them', () => {
    const actorWithExtensions = {
      ...copy(wizard.actor),
      traits: {
        darkvision: { rangeFt: 60, sourceEntityIds: [wizard.matrixCase.species.id] },
      },
    } as CompiledMicroMvpL1Root['actor'] & {
      traits: Record<string, unknown>;
      spellcastingAccess?: SpellcastingAccessState;
    };
    const extendedRoot = withActor(wizard, actorWithExtensions);
    const fixture = adaptCompiledMicroMvpL1Root(extendedRoot, compiled.ruleset);

    expect(fixture.actor.traits).toEqual(actorWithExtensions.traits);
    expect(fixture.actor.traits).not.toBe(actorWithExtensions.traits);
    expect(actorWithExtensions.spellcastingAccess).toBeDefined();
    expect(fixture.actor.spellcastingAccess).toEqual(actorWithExtensions.spellcastingAccess);
    expect(fixture.actor.spellcastingAccess).not.toBe(actorWithExtensions.spellcastingAccess);
  });

  it('keeps compiled Arcane Recovery catalog-only and preserves its rest capability provenance', () => {
    const recoveryActions = wizard.rulesActions.filter((action) => {
      const activation = action.mechanics.activation as Record<string, unknown> | undefined;
      return activation?.mode === 'rest_decision';
    });
    expect(recoveryActions).toHaveLength(1);
    const [recovery] = recoveryActions;
    const fixture = adaptCompiledMicroMvpL1Root(wizard, compiled.ruleset);
    const provider = createCompiledMicroMvpScenarioFixtureProvider(compiled, {
      fixtureIds: [wizard.fixtureId],
    });

    expect(fixture.actions).toContainEqual(recovery);
    expect(provider.catalog.getAction(recovery.id)).toEqual(recovery);
    expect(wizard.actor.capabilities.actionIds).not.toContain(recovery.id);
    expect(fixture.actor.capabilities.actionIds).not.toContain(recovery.id);
    expect(fixture.actor.capabilities.featureSources?.[recovery.id]).toBeUndefined();
    const capabilityId = recovery.restDecision!.capabilityId;
    const provenance = fixture.actor.capabilities.featureSources?.[capabilityId];
    expect(provenance).toEqual(wizard.actor.capabilities.featureSources?.[capabilityId]);
    expect(provenance).toEqual(expect.arrayContaining([...recovery.sourceEntityIds]));
  });

  it('accepts compiled Pact Tome spells as prepared Warlock grants with ritual access', () => {
    const invocation = pactTomeWarlock.actor.warlockPacts?.tome;
    if (!invocation) throw new Error('Focused Warlock root unexpectedly has no Pact Tome state');
    const bookObjectId = invocation.tome.bookObjectId;
    const ritualGrants = pactTomeWarlock.actor.spellcastingAccess?.grants.filter((grant) => (
      grant.sourceId === bookObjectId && grant.level === 1
    ));
    expect(ritualGrants).toHaveLength(2);
    expect(ritualGrants?.every((grant) => (
      grant.access === 'always_prepared'
        && grant.ritual === true
        && grant.slotResource === 'spell_slot_1'
    ))).toBe(true);

    const fixture = adaptCompiledMicroMvpL1Root(pactTomeWarlock, compiled.ruleset);
    const selectedActionIds = new Set([
      ...invocation.tome.cantripActionIds,
      ...invocation.tome.ritualActionIds,
    ]);
    const tomeCatalogActions = pactTomeWarlock.rulesActions.filter((action) => (
      action.sourceEntityIds.includes(invocation.sourceEntityId)
    ));
    const catalogOnlyAlternatives = tomeCatalogActions.filter((action) => (
      !selectedActionIds.has(action.id)
    ));
    expect(catalogOnlyAlternatives.length).toBeGreaterThan(0);
    expect(fixture.actions.filter((action) => (
      action.sourceEntityIds.includes(invocation.sourceEntityId)
    ))).toEqual(tomeCatalogActions);
    expect(fixture.actor.capabilities.actionIds).toEqual(
      [...pactTomeWarlock.actor.capabilities.actionIds].sort(),
    );
    expect(fixture.actor.capabilities.actionIds).toEqual(expect.arrayContaining([...selectedActionIds]));
    for (const alternative of catalogOnlyAlternatives) {
      expect(fixture.actor.capabilities.actionIds).not.toContain(alternative.id);
      expect(fixture.actor.capabilities.featureSources?.[alternative.id]).toBeUndefined();
    }
    expect(fixture.actor.spellcastingAccess?.grants.filter((grant) => (
      grant.sourceId === bookObjectId && grant.level === 1
    ))).toEqual(ritualGrants);
    expect(fixture.actor.warlockPacts).toEqual(pactTomeWarlock.actor.warlockPacts);
    expect(fixture.objects).toEqual(pactTomeWarlock.initialWorldObjects);
    expect(fixture.objects).not.toBe(pactTomeWarlock.initialWorldObjects);

    const provider = createCompiledMicroMvpScenarioFixtureProvider({
      ...compiled,
      roots: [pactTomeWarlock],
      catalog: catalogIncludingRoot(compiled.catalog, pactTomeWarlock),
    });
    for (const alternative of catalogOnlyAlternatives) {
      expect(provider.catalog.getAction(alternative.id)).toEqual(alternative);
    }
    const world = createWorld({
      id: 'compiled-adapter.pact-tome-catalog-boundary',
      ruleset: provider.ruleset,
      actors: [fixture.actor],
      objects: fixture.objects,
    });
    const session = new InMemoryRulesSession(world, provider.catalog, {
      rng: () => { throw new Error('A catalog-only Tome action must be rejected before rolling'); },
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('compiled-adapter-tome'),
    });
    const alternative = catalogOnlyAlternatives[0];
    if (alternative.kind !== 'spell') throw new Error('Pact Tome alternative must be a spell');
    const rejected = session.dispatch({
      schemaVersion: 1,
      type: 'UseAction',
      commandId: 'use-unselected-tome-alternative',
      expectedRevision: world.revision,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: fixture.actor.id,
      actionId: alternative.id,
      targetIds: [],
      spell: { baseLevel: alternative.spell.level },
    } satisfies GameCommand);
    expect(rejected).toMatchObject({ status: 'rejected', code: 'ActionNotGranted' });
    expect(session.getState()).toEqual(world);
  });

  it('is deterministic under action/capability ordering and survives a canonical JSON round trip', () => {
    const first = adaptCompiledMicroMvpL1Root(fighter, compiled.ruleset);
    const reordered = withActor({
      ...fighter,
      rulesActions: [...fighter.rulesActions].reverse(),
    }, {
      ...fighter.actor,
      capabilities: {
        ...fighter.actor.capabilities,
        actionIds: [...fighter.actor.capabilities.actionIds].reverse(),
      },
      runtime: {
        ...fighter.actor.runtime,
        resources: Object.fromEntries(Object.entries(fighter.actor.runtime.resources).reverse()),
        maxResources: Object.fromEntries(Object.entries(fighter.actor.runtime.maxResources).reverse()),
      },
    });
    const second = adaptCompiledMicroMvpL1Root(reordered, compiled.ruleset);

    expect(canonicalStringify(second)).toBe(canonicalStringify(first));
    const encoded = canonicalStringify(first);
    const decoded = JSON.parse(encoded) as typeof first;
    expect(decoded).toEqual(first);
    expect(canonicalStringify(decoded)).toBe(encoded);
  });

  it('builds an isolated provider whose catalog contains the exact real compiled actions', () => {
    const provider = createCompiledMicroMvpScenarioFixtureProvider(compiled);
    const first = provider.getFixture(fighter.fixtureId);
    const second = provider.getFixture(fighter.fixtureId);

    expect(provider.ruleset).toEqual(compiled.ruleset);
    expect(provider.fixtureIds).toHaveLength(compiled.roots.length);
    expect(first).toBeDefined();
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second?.actor).not.toBe(first?.actor);
    expect(second?.actions[0]).not.toBe(first?.actions[0]);
    expect(provider.getActor('missing-fixture')).toBeUndefined();
    expect(provider.catalog.getAction('missing-action')).toBeUndefined();

    for (const action of fighter.rulesActions) {
      expect(provider.catalog.getAction(action.id)).toEqual(action);
    }

    if (!first || !second) throw new Error('Expected isolated compiled fixtures');
    first.actor.runtime.hp.current = 0;
    first.actor.choices[0].optionIds[0] = 'mutated-choice';
    (first.actions[0].mechanics as Record<string, unknown>).mutated = true;
    expect(provider.getFixture(fighter.fixtureId)).toEqual(second);
  });

  it('runs two canonical compiled actors through a full scenario round, checkpoint, and replay', () => {
    const provider = createCompiledMicroMvpScenarioFixtureProvider(compiled, {
      fixtureIds: [fighter.fixtureId, wizard.fixtureId],
    });
    const scenario: ScenarioSpec = {
      schemaVersion: 1,
      id: 'compiled-adapter.full-round',
      ruleset: provider.ruleset,
      actors: {
        fighter: { fixtureId: fighter.fixtureId },
        wizard: { fixtureId: wizard.fixtureId },
      },
      initiative: ['fighter', 'wizard'],
      rollTape: [
        { label: 'compiled fighter Strength check', sides: 20, value: 10 },
        { label: 'compiled wizard Intelligence check', sides: 20, value: 11 },
      ],
      steps: [
        {
          do: 'startTurn', actor: 'fighter', assertions: [{
            id: 'ADAPTER-FIGHTER-SOURCE', type: 'equals',
            path: 'actors.fighter.compiledSource.stableKey', value: fighter.stableKey,
          }],
        },
        {
          do: 'abilityCheck', actor: 'fighter', ability: 'str', dc: 1, assertions: [{
            id: 'ADAPTER-FIGHTER-CHECK', type: 'event',
            match: { engineEventType: 'roll', actorId: 'fighter', roll: { kind: 'check', outcome: 'success' } },
            exactly: 1,
          }],
        },
        {
          do: 'endTurn', actor: 'fighter', assertions: [{
            id: 'ADAPTER-FIGHTER-END', type: 'event', eventType: 'turn_ended', exactly: 1,
          }],
        },
        {
          do: 'checkpointReload', assertions: [{
            id: 'ADAPTER-CHOICES-ROUNDTRIP', type: 'equals',
            path: 'actors.wizard.choices.0.provenance', value: 'overlay-policy',
          }],
        },
        {
          do: 'startTurn', actor: 'wizard', assertions: [{
            id: 'ADAPTER-WIZARD-RULESTATE', type: 'equals',
            path: 'actors.wizard.ruleState.version', value: 1,
          }],
        },
        {
          do: 'abilityCheck', actor: 'wizard', ability: 'int', dc: 1, assertions: [{
            id: 'ADAPTER-WIZARD-CHECK', type: 'event',
            match: { engineEventType: 'roll', actorId: 'wizard', roll: { kind: 'check', outcome: 'success' } },
            exactly: 1,
          }],
        },
        {
          do: 'endTurn', actor: 'wizard', assertions: [{
            id: 'ADAPTER-WIZARD-END', type: 'event', eventType: 'turn_ended', exactly: 1,
          }],
        },
      ],
      requiredTrace: ['abilityCheck'],
    };

    const run = runScenario(scenario, provider, {
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('compiled-adapter'),
    });

    expect(run.rngConsumed).toBe(2);
    expect(run.checkpoints).toHaveLength(1);
    expect(run.finalState).toEqual(run.replayState);
    const finalFighter = run.finalState.actors.fighter as CompiledMicroMvpScenarioActorState;
    expect(finalFighter.ruleState).toEqual(fighter.ruleState);
    expect(run.finalState.actors.wizard.spellcastingAccess).toEqual(wizard.actor.spellcastingAccess);
  });

  it('fails closed on incomplete ownership, runtime, choices, provenance, and catalog data', () => {
    const firstAction = fighter.rulesActions[0];
    if (!firstAction) throw new Error('Fighter root unexpectedly owns no actions');
    const missingOwnedAction = {
      ...fighter,
      rulesActions: fighter.rulesActions.slice(1),
    };
    const invalidResources = copy(fighter.actor);
    delete invalidResources.runtime.maxResources[Object.keys(invalidResources.runtime.resources)[0]];
    const unresolved = {
      ...fighter,
      unresolvedAcquireChoiceIds: ['unresolved:test-choice'],
    };
    const duplicateProvenance = {
      ...fighter,
      rulesActions: [
        {
          ...firstAction,
          sourceEntityIds: [firstAction.sourceEntityIds[0], firstAction.sourceEntityIds[0]],
        } as RuleActionDefinition,
        ...fighter.rulesActions.slice(1),
      ],
    };
    const mismatchedFeatureSources = withActor(fighter, {
      ...fighter.actor,
      capabilities: {
        ...fighter.actor.capabilities,
        featureSources: {
          ...fighter.actor.capabilities.featureSources,
          [firstAction.id]: ['wrong-source'],
        },
      },
    });
    const missingSpellAccessActor = copy(wizard.actor);
    delete missingSpellAccessActor.spellcastingAccess;
    const incompleteSpellGrantActor = copy(wizard.actor);
    if (!incompleteSpellGrantActor.spellcastingAccess) {
      throw new Error('Wizard root unexpectedly has no spellcasting access');
    }
    incompleteSpellGrantActor.spellcastingAccess.grants =
      incompleteSpellGrantActor.spellcastingAccess.grants.slice(1);
    const missingRestProvenanceActor = copy(wizard.actor);
    const restCapabilityId = wizard.rulesActions.find((action) => action.restDecision)
      ?.restDecision?.capabilityId;
    if (!restCapabilityId) throw new Error('Wizard root unexpectedly has no rest decision policy');
    delete missingRestProvenanceActor.capabilities.featureSources?.[restCapabilityId];
    const arbitraryOrphanAction = {
      ...firstAction,
      id: `${firstAction.id}:orphan`,
    } as RuleActionDefinition;
    const tomeInvocation = pactTomeWarlock.actor.warlockPacts?.tome;
    if (!tomeInvocation) throw new Error('Focused Warlock root unexpectedly has no Pact Tome state');
    const tomeAlternative = pactTomeWarlock.rulesActions.find((action) => (
      action.sourceEntityIds.includes(tomeInvocation.sourceEntityId)
        && !pactTomeWarlock.actor.capabilities.actionIds.includes(action.id)
    ));
    if (!tomeAlternative) throw new Error('Pact Tome root unexpectedly has no catalog-only alternative');
    const malformedTomeAlternative = {
      ...tomeAlternative,
      id: `${tomeAlternative.id}:forged`,
    } as RuleActionDefinition;
    const ownsUnselectedTomeAction = copy(pactTomeWarlock.actor);
    ownsUnselectedTomeAction.capabilities.actionIds.push(tomeAlternative.id);

    const cases: Array<[string, CompiledMicroMvpL1Root, RegExp]> = [
      ['ownership', missingOwnedAction, /ownership must exactly equal/],
      ['arbitrary orphan action', {
        ...fighter,
        rulesActions: [...fighter.rulesActions, arbitraryOrphanAction],
      }, /orphan direct action/],
      ['resources', withActor(fighter, invalidResources), /identical keys/],
      ['choices', unresolved, /unresolved choices/],
      ['action provenance', duplicateProvenance, /sourceEntityIds must not contain duplicates/],
      ['capability provenance', mismatchedFeatureSources, /provenance .* disagrees/],
      ['missing spell access', withActor(wizard, missingSpellAccessActor), /no spellcastingAccess state/],
      ['incomplete spell grants', withActor(wizard, incompleteSpellGrantActor), /has no actor-owned spellcasting grant/],
      ['missing rest provenance', withActor(wizard, missingRestProvenanceActor), /missing rest:arcane-recovery provenance/],
      ['malformed Tome-scoped orphan', {
        ...pactTomeWarlock,
        rulesActions: pactTomeWarlock.rulesActions.map((action) => (
          action.id === tomeAlternative.id ? malformedTomeAlternative : action
        )),
      }, /orphan direct action|malformed actions/],
      ['unselected Tome action promoted to actor ownership', withActor(
        pactTomeWarlock,
        ownsUnselectedTomeAction,
      ), /actor-owned Pact Tome actions must exactly equal|has no actor-owned spellcasting grant/],
    ];
    for (const [label, root, expected] of cases) {
      expect(
        () => adaptCompiledMicroMvpL1Root(root, compiled.ruleset),
        label,
      ).toThrow(expected);
    }

    expect(() => createCompiledMicroMvpScenarioFixtureProvider({
      ...compiled,
      roots: [fighter],
      catalog: { getAction: () => undefined },
    })).toThrow(/catalog does not exactly contain compiled action/);

    if (tomeAlternative.kind !== 'spell') throw new Error('Pact Tome alternative must be a spell');
    const forgedSpellEntityId = 'forged-immutable-tome-spell';
    const structurallyTomeScopedButUncatalogued = {
      ...copy(tomeAlternative),
      id: `${forgedSpellEntityId}@${tomeInvocation.sourceEntityId}`,
      sourceEntityIds: [
        forgedSpellEntityId,
        tomeInvocation.sourceEntityId,
        pactTomeWarlock.matrixCase.klass.id,
      ],
    } as RuleActionDefinition;
    expect(() => createCompiledMicroMvpScenarioFixtureProvider({
      ...compiled,
      catalog: catalogIncludingRoot(compiled.catalog, pactTomeWarlock),
      roots: [{
        ...pactTomeWarlock,
        rulesActions: [...pactTomeWarlock.rulesActions, structurallyTomeScopedButUncatalogued],
      }],
    })).toThrow(/catalog does not exactly contain compiled action/);
    expect(() => createCompiledMicroMvpScenarioFixtureProvider({
      ...compiled,
      roots: [fighter],
      ruleset: { ...compiled.ruleset, contentHash: 'sha256:wrong' },
    })).toThrow(CompiledMicroMvpScenarioAdapterError);
  });

  it('copies equipment, inventory, resources, mastery effects, and generic future actor fields verbatim', () => {
    const actor = {
      ...copy(fighter.actor),
      futureTraitChannel: [{ id: 'future-trait', sourceEntityIds: [fighter.matrixCase.klass.id] }],
    } as CompiledMicroMvpL1Root['actor'] & { futureTraitChannel: unknown[] };
    actor.runtime.equipment = { body: 'armor.fixture', main_hand: 'weapon.fixture' };
    actor.runtime.inventory = [{ cardId: 'item.fixture', qty: 2 }];
    const root = withActor(fighter, actor);
    const fixture = adaptCompiledMicroMvpL1Root(root, compiled.ruleset);

    expect(fixture.actor.runtime.equipment).toEqual(actor.runtime.equipment);
    expect(fixture.actor.runtime.inventory).toEqual(actor.runtime.inventory);
    expect(fixture.actor.runtime.resources).toEqual(actor.runtime.resources);
    expect(fixture.actor.runtime.maxResources).toEqual(actor.runtime.maxResources);
    expect(fixture.actor.masteryEffects).toEqual(actor.masteryEffects);
    expect(fixture.actor.futureTraitChannel).toEqual(actor.futureTraitChannel);
  });
});
