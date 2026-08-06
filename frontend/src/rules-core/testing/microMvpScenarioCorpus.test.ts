import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileMicroMvpL1ChoiceVariants,
  compileMicroMvpL1Overlay,
} from '../../canon/microMvpL1Overlay';
import type {
  CompiledMicroMvpL1Provider,
  CompiledMicroMvpL1Root,
} from '../../canon/microMvpL1Overlay';
import type {
  ActorState,
  GameCommand,
  UncommittedRuleEvent,
  WorldState,
} from '../domain';
import { createWorld } from '../domain';
import {
  createLogicalClock,
  createSequentialIdFactory,
  createStrictRngTape,
} from '../determinism';
import { foldEvents } from '../reducer';
import { InMemoryRulesSession } from '../session';
import type { ScenarioSpec } from './scenario';
import {
  assertMicroMvpScenarioCorpusReady,
  instantiateMicroMvpScenarioActor,
  MICRO_MVP_PROJECT_RULE_CAPABILITY_IDS,
  MICRO_MVP_SCENARIO_ACTION_IDS,
  MICRO_MVP_SCENARIO_CAPABILITY_GAPS,
  MICRO_MVP_SCENARIO_CATALOG,
  MICRO_MVP_SCENARIO_CATALOG_ENTRIES,
  MICRO_MVP_SCENARIO_CORPUS,
  MICRO_MVP_SCENARIO_FACTS,
  MICRO_MVP_SCENARIO_FIXTURE_IDS,
  MICRO_MVP_SCENARIO_HAZARD_IDS,
  MICRO_MVP_SCENARIO_RULESET,
  runMicroMvpScenarioCase,
  validateMicroMvpScenarioActionKinds,
} from './microMvpScenarioCorpus';

type Dict = Record<string, unknown>;

function engineEvents(events: readonly UncommittedRuleEvent[]) {
  return events.flatMap((entry) => entry.payload.type === 'EngineEventRecorded'
    ? [{ entry, event: entry.payload.event }]
    : []);
}

function command<T extends GameCommand>(value: T): T {
  return value;
}

function sessionActor(fixtureId: string, actorId: string): ActorState {
  return instantiateMicroMvpScenarioActor(fixtureId, actorId);
}

function mechanicPayloads(value: unknown): Dict[] {
  const result: Dict[] = [];
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;
    const record = candidate as Dict;
    if (typeof record.kind === 'string') result.push(record);
    Object.values(record).forEach(visit);
  };
  visit(value);
  return result;
}

describe('micro-MVP deterministic scenario corpus', () => {
  let overlay: CompiledMicroMvpL1Provider;
  let magicianVariant: CompiledMicroMvpL1Root;
  let pactBladeVariant: CompiledMicroMvpL1Root;

  beforeAll(async () => {
    overlay = await compileMicroMvpL1Overlay();
    const druid = overlay.roots.find((root) => root.matrixCase.klass.card_number === 'CLASS-druid')!;
    const warlock = overlay.roots.find((root) => root.matrixCase.klass.card_number === 'CLASS-warlock')!;
    [magicianVariant, pactBladeVariant] = await compileMicroMvpL1ChoiceVariants([
      {
        stableKey: druid.stableKey,
        overrides: { druid_primal_order: ['magician'] },
      },
      {
        stableKey: warlock.stableKey,
        overrides: { warlock_invocation_l1: ['EFF-pact-blade'] },
      },
    ]);
  }, 60_000);

  it('runs SC-01..SC-07 with two player characters, a full round, checkpoints and exact replay', () => {
    expect(Object.keys(MICRO_MVP_SCENARIO_CORPUS))
      .toEqual(['SC-01', 'SC-02', 'SC-03', 'SC-04', 'SC-05', 'SC-06', 'SC-07']);

    for (const scenario of Object.values(MICRO_MVP_SCENARIO_CORPUS)) {
      const run = runMicroMvpScenarioCase(scenario);
      expect(Object.values(run.initialState.actors)).toHaveLength(2);
      expect(Object.values(run.initialState.actors).every((actor) => actor.kind === 'playerCharacter')).toBe(true);
      expect(run.finalState.scene).toMatchObject({ mode: 'encounter' });
      expect(run.finalState.scene.mode === 'encounter' && run.finalState.scene.round).toBeGreaterThanOrEqual(2);
      expect(run.checkpoints.length).toBeGreaterThan(0);
      expect(run.finalState).toEqual(run.replayState);
      expect(run.rngConsumed).toBe(scenario.rngTape.length);
      expect(scenario.spec.rollTape).toEqual(scenario.rngTape);
      expect(run.observedTrace).toEqual([
        'abilityCheck', 'applyCondition', 'castSpell', 'nonSpellAction', 'savingThrow',
      ]);
      const declarations = run.events.flatMap((entry) => (
        entry.payload.type === 'ActionDeclared' ? [entry.payload] : []
      ));
      for (const step of scenario.spec.steps) {
        if (step.do !== 'use') continue;
        expect(declarations).toContainEqual(expect.objectContaining({
          actorId: step.actor,
          actionId: step.actionId,
          actionKind: MICRO_MVP_SCENARIO_CATALOG_ENTRIES[step.actionId].actionKind,
          sourceEntityIds: [...MICRO_MVP_SCENARIO_CATALOG_ENTRIES[step.actionId].action.sourceEntityIds],
          timing: 'active',
        }));
      }
      expect(run.assertionIds).toEqual(
        scenario.spec.steps.flatMap((step) => step.assertions.map((assertion) => assertion.id)),
      );
      expect(new Set(run.assertionIds).size).toBe(run.assertionIds.length);
    }
  });

  it('binds corpus trace classification to authoritative catalog metadata', () => {
    for (const scenario of Object.values(MICRO_MVP_SCENARIO_CORPUS)) {
      expect(() => validateMicroMvpScenarioActionKinds(scenario.spec)).not.toThrow();
    }
    for (const id of MICRO_MVP_PROJECT_RULE_CAPABILITY_IDS) {
      expect(MICRO_MVP_SCENARIO_CATALOG_ENTRIES[id]).toMatchObject({
        idSource: 'project_rule',
        certification: 'scenario_slice',
      });
    }
    for (const [id, entry] of Object.entries(MICRO_MVP_SCENARIO_CATALOG_ENTRIES)) {
      expect(entry.action.id).toBe(id);
      if (entry.idSource === 'snapshot_card_number') expect(id.startsWith('project-rule:')).toBe(false);
    }

    const source = MICRO_MVP_SCENARIO_CORPUS['SC-01'].spec;
    const tampered = JSON.parse(JSON.stringify(source)) as ScenarioSpec;
    const spell = tampered.steps.find((step) => step.do === 'use' && step.actionKind === 'spell');
    if (!spell || spell.do !== 'use') throw new Error('SC-01 spell step disappeared');
    spell.actionKind = 'nonSpell';
    expect(() => validateMicroMvpScenarioActionKinds(tampered)).toThrow(
      /declares nonSpell for SPELL-0171; catalog says spell/,
    );
  });

  it('SC-01 focused decline lane applies suspended damage once and spends no Shield resources', () => {
    const fighter = sessionActor(MICRO_MVP_SCENARIO_FIXTURE_IDS.sc01Fighter, 'fighter');
    const wizard = sessionActor(MICRO_MVP_SCENARIO_FIXTURE_IDS.sc01Wizard, 'wizard');
    const initial = createWorld({
      id: 'SC-01-DECLINE', ruleset: MICRO_MVP_SCENARIO_RULESET, actors: [fighter, wizard],
    });
    const tape = createStrictRngTape([
      { label: 'SC-01 decline attack', sides: 20, value: 10 },
      { label: 'SC-01 decline damage', sides: 8, value: 4 },
    ]);
    const env = {
      rng: tape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('unused-decline'),
    };
    const opening = new InMemoryRulesSession(initial, MICRO_MVP_SCENARIO_CATALOG, env);
    const dispatch = (make: (revision: number) => GameCommand) => {
      const result = opening.dispatch(make(opening.getState().revision));
      expect(result.status).toBe('accepted');
      return result;
    };
    dispatch((revision) => command({
      schemaVersion: 1, type: 'StartEncounter', commandId: 'SC-01-D:start', expectedRevision: revision,
      rulesetContentHash: MICRO_MVP_SCENARIO_RULESET.contentHash, actorId: 'fighter',
      initiative: ['fighter', 'wizard'],
    }));
    dispatch((revision) => command({
      schemaVersion: 1, type: 'StartTurn', commandId: 'SC-01-D:turn', expectedRevision: revision,
      rulesetContentHash: MICRO_MVP_SCENARIO_RULESET.contentHash, actorId: 'fighter',
    }));
    dispatch((revision) => command({
      schemaVersion: 1, type: 'UseAction', commandId: 'SC-01-D:attack', expectedRevision: revision,
      rulesetContentHash: MICRO_MVP_SCENARIO_RULESET.contentHash, actorId: 'fighter',
      actionId: MICRO_MVP_SCENARIO_ACTION_IDS.weaponAttack, targetIds: ['wizard'],
      factsByTarget: { wizard: MICRO_MVP_SCENARIO_FACTS.enemy(5) },
    }));
    expect(opening.getState().pendingResolution?.type).toBe('attack_reaction');
    expect(opening.getState().actors.wizard.runtime.hp.current).toBe(12);
    expect(engineEvents(opening.getEvents()).filter(({ event }) => event.type === 'damage')).toEqual([]);

    const paused = JSON.parse(JSON.stringify(opening.getState())) as WorldState;
    const resumed = new InMemoryRulesSession(paused, MICRO_MVP_SCENARIO_CATALOG, env);
    const pending = resumed.getState().pendingResolution;
    if (!pending || pending.type !== 'attack_reaction') throw new Error('Shield window disappeared');
    const decline = resumed.dispatch(command({
      schemaVersion: 1, type: 'ResolveDecision', commandId: 'SC-01-D:decline',
      expectedRevision: resumed.getState().revision,
      rulesetContentHash: MICRO_MVP_SCENARIO_RULESET.contentHash, actorId: 'wizard',
      resolutionId: pending.id, requestId: pending.request.id,
      response: { kind: 'reaction', actionId: null },
    }));
    expect(decline.status).toBe('accepted');

    const masteryPending = resumed.getState().pendingResolution;
    expect(masteryPending?.type).toBe('mastery_save');
    expect(resumed.getState().actors.wizard.runtime.hp.current).toBe(5);
    if (!masteryPending || masteryPending.type !== 'mastery_save') {
      throw new Error('Topple save window disappeared after declining Shield');
    }
    const mastery = resumed.dispatch(command({
      schemaVersion: 1, type: 'ResolveDecision', commandId: 'SC-01-D:mastery',
      expectedRevision: resumed.getState().revision,
      rulesetContentHash: MICRO_MVP_SCENARIO_RULESET.contentHash, actorId: 'wizard',
      resolutionId: masteryPending.id, requestId: masteryPending.request.id,
      response: { kind: 'roll', roll: { mode: 'manual', dice: [{ sides: 20, value: 20 }] } },
    }));
    expect(mastery.status).toBe('accepted');
    tape.assertExhausted();

    const final = resumed.getState();
    expect(final.pendingResolution).toBeNull();
    expect(final.actors.wizard.runtime.hp.current).toBe(5);
    expect(final.actors.wizard.runtime.activeEffects.some((effect) => (
      (effect.mechanics as { value?: string }).value === 'prone'
    ))).toBe(false);
    expect(final.actors.wizard.runtime.resources).toMatchObject({ reaction: 1, spell_slot_1: 2 });
    const combined = [...opening.getEvents(), ...resumed.getEvents()];
    expect(engineEvents(combined).filter(({ event }) => event.type === 'damage')).toHaveLength(1);
    expect(combined.some((entry) => entry.payload.type === 'DecisionRecorded'
      && entry.payload.response.kind === 'reaction'
      && entry.payload.response.actionId === null)).toBe(true);
    expect(foldEvents(initial, combined)).toEqual(final);
  });

  it('SC-02 proves Sneak Attack positive, no-eligibility and once-per-turn slices', () => {
    const positive = runMicroMvpScenarioCase(MICRO_MVP_SCENARIO_CORPUS['SC-02']);
    expect(positive.rejections).toContainEqual(expect.objectContaining({
      action: 'hide', code: 'HideNotEligible',
    }));
    expect(positive.events).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({ type: 'ActionDeclared', actionId: 'core.action.hide' }),
    }));
    const triggered = engineEvents(positive.events).filter(({ event }) => (
      event.type === 'narrative' && event.text === 'Сработало: Скрытая атака (L1 executable overlay)'
    ));
    expect(triggered).toHaveLength(1);
    const nickAttackRolls = engineEvents(positive.events).flatMap(({ entry, event }) => (
      entry.obligationIds.includes(`entity:${MICRO_MVP_SCENARIO_ACTION_IDS.rogueNickAttack}`)
        && event.type === 'roll'
        && event.roll.kind === 'd20'
        ? [event.roll]
        : []
    ));
    expect(nickAttackRolls).toHaveLength(2);
    expect(nickAttackRolls.map((roll) => roll.advantage)).toEqual(['advantage', 'none']);
    expect(positive.finalState.actors.rogue.runtime.firedThisTurn).toEqual([]);

    const rogue = sessionActor(MICRO_MVP_SCENARIO_FIXTURE_IDS.sc02Rogue, 'rogue');
    rogue.runtime.activeEffects = [];
    const cleric = sessionActor(MICRO_MVP_SCENARIO_FIXTURE_IDS.sc02Cleric, 'cleric');
    const initial = createWorld({
      id: 'SC-02-NO-ELIGIBILITY', ruleset: MICRO_MVP_SCENARIO_RULESET, actors: [rogue, cleric],
    });
    const tape = createStrictRngTape([
      { label: 'SC-02 no eligibility first attack', sides: 20, value: 14 },
      { label: 'SC-02 no eligibility first damage', sides: 4, value: 3 },
      { label: 'SC-02 no eligibility second attack', sides: 20, value: 13 },
      { label: 'SC-02 no eligibility second damage', sides: 4, value: 2 },
    ]);
    const session = new InMemoryRulesSession(initial, MICRO_MVP_SCENARIO_CATALOG, {
      rng: tape.rng, clock: createLogicalClock(), nextId: createSequentialIdFactory('unused-sneak'),
    });
    const dispatch = (value: GameCommand) => {
      const result = session.dispatch(value);
      expect(result.status).toBe('accepted');
    };
    dispatch(command({
      schemaVersion: 1, type: 'StartEncounter', commandId: 'SC-02-N:start', expectedRevision: 0,
      rulesetContentHash: MICRO_MVP_SCENARIO_RULESET.contentHash, actorId: 'rogue',
      initiative: ['rogue', 'cleric'],
    }));
    dispatch(command({
      schemaVersion: 1, type: 'StartTurn', commandId: 'SC-02-N:turn', expectedRevision: 1,
      rulesetContentHash: MICRO_MVP_SCENARIO_RULESET.contentHash, actorId: 'rogue',
    }));
    dispatch(command({
      schemaVersion: 1, type: 'UseAction', commandId: 'SC-02-N:attack', expectedRevision: 2,
      rulesetContentHash: MICRO_MVP_SCENARIO_RULESET.contentHash, actorId: 'rogue',
      actionId: MICRO_MVP_SCENARIO_ACTION_IDS.rogueNickAttack, targetIds: ['cleric'],
      factsByTarget: { cleric: MICRO_MVP_SCENARIO_FACTS.enemy(5) },
    }));
    tape.assertExhausted();
    expect(session.getState().actors.cleric.runtime.hp.current).toBe(9);
    expect(session.getState().actors.rogue.runtime.firedThisTurn).toEqual([]);
    expect(engineEvents(session.getEvents()).some(({ event }) => (
      event.type === 'narrative' && event.text.includes('Скрытая атака')
    ))).toBe(false);
  });

  it('SC-03 binds the Magician fixture slice to the compiled choice, source effect, formula, and cantrip decision', () => {
    const orderDecision = magicianVariant.decisions.find((decision) => (
      decision.choiceId.endsWith(':druid_primal_order')
    ));
    expect(orderDecision).toMatchObject({
      optionIds: ['magician'],
      stage: 'creation',
      provenance: 'overlay-policy',
    });
    const cantripDecision = magicianVariant.decisions.find((decision) => (
      decision.choiceId.endsWith(':druid_magician_cantrip')
    ));
    expect(cantripDecision).toMatchObject({
      optionIds: [expect.any(String)],
      stage: 'creation',
      provenance: 'overlay-policy',
    });
    expect(magicianVariant.selectedSpellIds).toContain(cantripDecision!.optionIds[0]);

    const source = magicianVariant.assembled.effects.find((item) => (
      item.effect.card_number === 'EFF-primal-order'
    ))!;
    expect(source).toMatchObject({
      effect: {
        id: 'ccaf0064-4564-4e2c-9f57-1d3efb8b47c2',
        card_number: 'EFF-primal-order',
      },
      origin: {
        kind: 'class',
        id: magicianVariant.matrixCase.klass.id,
        name: magicianVariant.matrixCase.klass.name,
      },
    });
    const compiledArcana = mechanicPayloads(source.effect.mechanics).find((payload) => (
      payload.kind === 'modifier'
      && (payload.applies_to as Dict | undefined)?.roll === 'ability_check'
      && (((payload.applies_to as Dict).filter as Dict | undefined)?.skill === 'arcana')
    ));
    expect(compiledArcana).toEqual({
      kind: 'modifier',
      applies_to: { roll: 'ability_check', filter: { skill: 'arcana' } },
      op: 'add',
      value: 'max(1,wis)',
      source: 'Маг',
    });

    const actor = instantiateMicroMvpScenarioActor(MICRO_MVP_SCENARIO_FIXTURE_IDS.sc03Druid);
    expect(actor.passives?.[0]).toMatchObject({
      id: source.effect.id,
      card_number: source.effect.card_number,
      sourceEntityIds: [source.effect.id, source.origin.id],
      sourceChoice: { id: 'druid_primal_order', optionId: 'magician' },
    });
    const fixtureArcana = mechanicPayloads(actor.passives?.[0]).find((payload) => (
      payload.kind === 'modifier'
    ));
    expect(fixtureArcana).toEqual(compiledArcana);

    const run = runMicroMvpScenarioCase(MICRO_MVP_SCENARIO_CORPUS['SC-03']);
    const arcanaRoll = engineEvents(run.events).find(({ entry, event }) => (
      entry.payload.type === 'EngineEventRecorded'
      && entry.payload.actorId === 'druid'
      && event.type === 'roll'
      && event.roll.kind === 'check'
      && event.label.includes('arcana')
    ))?.event;
    expect(arcanaRoll).toMatchObject({
      type: 'roll',
      roll: {
        total: 13,
        modifiers: expect.arrayContaining([{ value: 3, source: 'Маг' }]),
        outcome: 'success',
      },
    });
  });

  it('SC-03 keeps manual and system target-save state outcomes equivalent', () => {
    const manualCase = MICRO_MVP_SCENARIO_CORPUS['SC-03'];
    const manual = runMicroMvpScenarioCase(manualCase);
    const systemSpec = JSON.parse(JSON.stringify(manualCase.spec)) as ScenarioSpec;
    const entangleDecision = systemSpec.steps.find((step) => (
      step.do === 'resolveDecision' && step.actor === 'sorcerer'
    ));
    if (!entangleDecision || entangleDecision.do !== 'resolveDecision') {
      throw new Error('SC-03 Entangle decision disappeared');
    }
    entangleDecision.roll = { mode: 'system' };
    const systemTape = [
      ...manualCase.rngTape.slice(0, 4),
      { label: 'SC-03 system Entangle save', sides: 20, value: 5 },
      ...manualCase.rngTape.slice(4),
    ];
    const system = runMicroMvpScenarioCase({ ...manualCase, spec: systemSpec }, systemTape);
    expect(system.finalState.actors).toEqual(manual.finalState.actors);
    expect(system.finalState.concentrations).toEqual(manual.finalState.concentrations);
    expect(system.finalState.scene).toEqual(manual.finalState.scene);

    const saveRoll = (events: readonly UncommittedRuleEvent[]) => engineEvents(events)
      .find(({ entry, event }) => entry.payload.type === 'EngineEventRecorded'
        && entry.payload.actorId === 'sorcerer'
        && event.type === 'roll'
        && event.label.startsWith('Спасбросок СИЛ'))?.event;
    expect(saveRoll(system.events)).toEqual(saveRoll(manual.events));
  });

  it('SC-03 scopes Innate Sorcery to Sorcerer spell attacks and adds +1 to Sorcerer spell-save DC', () => {
    const sorcerer = sessionActor(MICRO_MVP_SCENARIO_FIXTURE_IDS.sc03Sorcerer, 'sorcerer');
    const druid = sessionActor(MICRO_MVP_SCENARIO_FIXTURE_IDS.sc03Druid, 'druid');
    const initial = createWorld({
      id: 'SC-03-INNATE-DC', ruleset: MICRO_MVP_SCENARIO_RULESET, actors: [sorcerer, druid],
    });
    const tape = createStrictRngTape([]);
    const session = new InMemoryRulesSession(initial, MICRO_MVP_SCENARIO_CATALOG, {
      rng: tape.rng, clock: createLogicalClock(), nextId: createSequentialIdFactory('unused-innate-dc'),
    });
    const dispatch = (make: (revision: number) => GameCommand) => {
      const result = session.dispatch(make(session.getState().revision));
      expect(result.status).toBe('accepted');
      return result;
    };
    dispatch((revision) => command({
      schemaVersion: 1, type: 'StartEncounter', commandId: 'SC-03-DC:start', expectedRevision: revision,
      rulesetContentHash: MICRO_MVP_SCENARIO_RULESET.contentHash, actorId: 'sorcerer',
      initiative: ['sorcerer', 'druid'],
    }));
    dispatch((revision) => command({
      schemaVersion: 1, type: 'StartTurn', commandId: 'SC-03-DC:turn', expectedRevision: revision,
      rulesetContentHash: MICRO_MVP_SCENARIO_RULESET.contentHash, actorId: 'sorcerer',
    }));
    dispatch((revision) => command({
      schemaVersion: 1, type: 'UseAction', commandId: 'SC-03-DC:innate', expectedRevision: revision,
      rulesetContentHash: MICRO_MVP_SCENARIO_RULESET.contentHash, actorId: 'sorcerer',
      actionId: MICRO_MVP_SCENARIO_ACTION_IDS.innateSorcery, targetIds: [], factsByTarget: {},
    }));
    dispatch((revision) => command({
      schemaVersion: 1, type: 'UseAction', commandId: 'SC-03-DC:acid-splash', expectedRevision: revision,
      rulesetContentHash: MICRO_MVP_SCENARIO_RULESET.contentHash, actorId: 'sorcerer',
      actionId: MICRO_MVP_SCENARIO_ACTION_IDS.acidSplash, targetIds: ['druid'],
      factsByTarget: { druid: MICRO_MVP_SCENARIO_FACTS.enemy(60) },
      spell: { baseLevel: 0 },
    }));
    tape.assertExhausted();

    const pending = session.getState().pendingResolution;
    expect(pending?.type).toBe('target_save');
    if (!pending || pending.type !== 'target_save') throw new Error('Acid Splash save window disappeared');
    expect(pending.request).toMatchObject({ actorId: 'druid', ability: 'dex', dc: 14 });

    const effects = session.getState().actors.sorcerer.runtime.activeEffects.flatMap((effect) => {
      const mechanics = effect.mechanics;
      return mechanics && mechanics.kind === 'modifier' ? [mechanics] : [];
    });
    expect(effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        op: 'advantage', applies_to: { roll: 'attack', filter: { spellClass: 'CLASS-sorcerer' } },
      }),
      expect.objectContaining({
        op: 'add', value: '1',
        applies_to: { roll: 'spell_save_dc', filter: { spellClass: 'CLASS-sorcerer' } },
      }),
    ]));
  });

  it('keeps canonical Pact Blade state out of the legacy SC-04 generic-action corpus', () => {
    expect(pactBladeVariant.decisions).toContainEqual(expect.objectContaining({
      choiceId: expect.stringMatching(/:warlock_invocation_l1$/),
      optionIds: ['EFF-pact-blade'],
      stage: 'creation',
      provenance: 'overlay-policy',
    }));
    const invocation = pactBladeVariant.assembled.effects.find((item) => (
      item.effect.card_number === 'EFF-pact-blade'
    ))!;
    expect(invocation).toMatchObject({
      effect: {
        id: 'd0988f8f-15b8-4b9a-b201-99841460be44',
        card_number: 'EFF-pact-blade',
      },
      origin: {
        kind: 'class',
        id: pactBladeVariant.matrixCase.klass.id,
        name: pactBladeVariant.matrixCase.klass.name,
      },
    });
    expect(pactBladeVariant.selectedInvocationEffectIds).toEqual([invocation.effect.id]);

    const compiledBond = pactBladeVariant.rulesActions.find((action) => (
      action.kind === 'nonSpell' && action.sourceEntityIds.includes(invocation.effect.id)
    ))!;
    expect(compiledBond).toBeDefined();
    expect(compiledBond.sourceEntityIds).toEqual([
      invocation.effect.id,
      pactBladeVariant.matrixCase.klass.id,
    ]);
    expect(compiledBond.mechanics.primitive).toMatchObject({
      type: 'pact_blade_bond',
      commandType: 'BondPactBlade',
      authority: 'rules-core',
    });
    expect(pactBladeVariant.actor.capabilities.actionIds).toContain(compiledBond.id);
    expect(pactBladeVariant.actor.warlockPacts?.blade).toMatchObject({
      sourceEntityId: invocation.effect.id,
      ownerActorId: pactBladeVariant.actor.id,
      bondActionId: compiledBond.id,
      activeBond: null,
    });
    expect(pactBladeVariant.decisions.filter(({ choiceId }) => (
      choiceId.includes('pact_blade_weapon') || choiceId.includes('pact_blade_damage_type')
    ))).toEqual([]);
    expect(MICRO_MVP_SCENARIO_RULESET).toEqual(overlay.ruleset);
    expect(Object.values(MICRO_MVP_SCENARIO_CATALOG_ENTRIES).some(({ action }) => (
      action.id === compiledBond.id || action.sourceEntityIds.includes(invocation.effect.id)
    ))).toBe(false);
    expect(overlay.capabilityGaps).toEqual([]);

    const actor = instantiateMicroMvpScenarioActor(MICRO_MVP_SCENARIO_FIXTURE_IDS.sc04Warlock);
    expect(actor.capabilities.actionIds).toEqual([MICRO_MVP_SCENARIO_ACTION_IDS.armsOfHadar]);
    const run = runMicroMvpScenarioCase(MICRO_MVP_SCENARIO_CORPUS['SC-04']);
    expect(run.finalState.actors.warlock.runtime.resources.pact_slot_1).toBe(1);
    expect(run.finalState.actors.fighter.runtime.hp.current).toBe(11);
    expect(JSON.stringify(run.finalState.actors.warlock.runtime.activeEffects))
      .not.toMatch(/pact_weapon|weaponType|damageType/);
  });

  it('SC-05 consumes Help but keeps Guidance for its concentration duration', () => {
    const run = runMicroMvpScenarioCase(MICRO_MVP_SCENARIO_CORPUS['SC-05']);
    const checks = engineEvents(run.events).flatMap(({ event }) => (
      event.type === 'roll' && event.roll.kind === 'check' ? [event.roll] : []
    ));
    expect(checks).toHaveLength(2);
    expect(checks[0]).toMatchObject({
      advantage: 'advantage',
      dice: [{ sides: 20, result: 13 }, { sides: 20, result: 5, discarded: true }],
      total: 16,
      outcome: 'success',
    });
    expect(checks[1]).toMatchObject({
      advantage: 'none',
      total: 15,
      outcome: 'success',
    });
    expect(checks[1].dice).toContainEqual(expect.objectContaining({ sides: 4, result: 2 }));

    const explorationCheckpoint = JSON.parse(run.checkpoints[0]) as WorldState;
    expect(explorationCheckpoint.scene.mode).toBe('exploration');
    expect(explorationCheckpoint.actors.cleric.runtime.activeEffects.map((effect) => effect.name)).not.toContain('Помощь');
    expect(explorationCheckpoint.actors.rogue.runtime.activeEffects.map((effect) => effect.name)).toContain('Наставление');
    expect(explorationCheckpoint.concentrations.cleric?.actionId)
      .toBe(MICRO_MVP_SCENARIO_ACTION_IDS.guidance);
    expect(explorationCheckpoint.pendingResolution?.type).toBe('hazard_save');
    const hazardRoll = engineEvents(run.events).find(({ entry, event }) => (
      event.type === 'roll' && event.roll.kind === 'save'
      && entry.obligationIds.includes(`hazard:${MICRO_MVP_SCENARIO_HAZARD_IDS.unstableRubble}`)
    ));
    expect(hazardRoll?.event).toMatchObject({ type: 'roll', roll: { outcome: 'fail' } });
    expect(engineEvents(run.events)).toContainEqual(expect.objectContaining({
      entry: expect.objectContaining({
        obligationIds: expect.arrayContaining([`hazard:${MICRO_MVP_SCENARIO_HAZARD_IDS.unstableRubble}`]),
      }),
      event: { type: 'condition_applied', condition: 'prone' },
    }));
  });

  it('has build evidence for every corpus slice and passes the acceptance-ready gate', () => {
    expect(MICRO_MVP_SCENARIO_CAPABILITY_GAPS).toEqual([]);
    expect(() => assertMicroMvpScenarioCorpusReady()).not.toThrow();
  });
});
