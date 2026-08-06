import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileMicroMvpL1Overlay,
  type CompiledMicroMvpL1Provider,
  type CompiledMicroMvpL1Root,
} from '../canon/microMvpL1Overlay';
import { resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import { actionUsesKey } from '../engine/actionUses';
import { applyIncomingDamage } from '../engine/execute';
import { payloadsOf } from '../engine/mechanicsView';
import { endTurn, startTurn } from '../engine/turn';
import type { RuntimeState } from '../mvp/contracts';
import {
  createWorld,
  type ActorState,
  type GameCommand,
  type RuleActionDefinition,
  type RulesCatalog,
  type SpatialFacts,
} from './domain';
import {
  DWARF_SPECIES_CARD,
  DWARVEN_RESILIENCE_CARD,
  DWARVEN_TOUGHNESS_CARD,
  effectiveSenses,
  STONECUNNING_CARD,
} from './dwarfTraits';
import {
  createLogicalClock,
  createSequentialIdFactory,
  createStrictRngTape,
} from './determinism';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';
import { migrateWorldState } from './worldMigration';

const STONECUNNING_DURATION_ROUNDS = 100;
const STONECUNNING_SENSE_SCOPE = {
  kind: 'stonework',
  stoneForms: ['natural', 'worked'],
  ownerContact: ['on_surface', 'touching_surface'],
  sameSurfaceOnly: true,
  detectsAirborne: false,
  grantsSight: false,
} as const;

type JsonRecord = Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`Missing Dwarf fixture: ${label}`);
  return value;
}

function effect(root: CompiledMicroMvpL1Root, cardNumber: string) {
  return required(
    root.assembled.effects.find((candidate) => candidate.effect.card_number === cardNumber),
    `${root.stableKey}/${cardNumber}`,
  ).effect;
}

function passive(root: CompiledMicroMvpL1Root, cardNumber: string): JsonRecord {
  return required(
    root.actor.passives?.find((candidate) => candidate.id === cardNumber),
    `${root.stableKey}/passive/${cardNumber}`,
  );
}

function actorFrom(root: CompiledMicroMvpL1Root, id: string): ActorState {
  const actor = clone(root.actor) as ActorState;
  actor.id = id;
  actor.name = id;
  actor.controllerId = `${id}-controller`;
  return actor;
}

function environment(rng: () => number = () => {
  throw new Error('This Dwarf path must not roll');
}) {
  return {
    rng,
    clock: createLogicalClock(),
    nextId: createSequentialIdFactory('dwarf'),
  };
}

function command<T extends GameCommand>(value: T): T {
  return value;
}

function selfFacts(stonework?: SpatialFacts['stonework']): SpatialFacts {
  return {
    factsSource: 'scenario',
    boardRevision: 1,
    distanceFt: 0,
    lineOfSight: true,
    cover: 'none',
    relation: 'self',
    ...(stonework ? { stonework } : {}),
  };
}

function enemyFacts(): SpatialFacts {
  return {
    factsSource: 'scenario',
    boardRevision: 1,
    distanceFt: 30,
    lineOfSight: true,
    cover: 'none',
    relation: 'enemy',
  };
}

const POISON_SAVE: RuleActionDefinition = {
  id: 'test.dwarf-poison-save',
  name: 'Dwarf poison-save probe',
  kind: 'nonSpell',
  sourceEntityIds: ['test.dwarf-poison-save'],
  targeting: {
    minTargets: 1,
    maxTargets: 1,
    rangeFt: 30,
    requiresLineOfSight: true,
    allowedRelations: ['enemy'],
  },
  mechanics: {
    activation: { mode: 'active' },
    effects: [{
      resolution: 'save',
      who: 'target',
      ability: 'con',
      dc: '20',
      on_fail: [
        { kind: 'damage', dice: '1d6', type: 'poison', ability: 'none' },
        {
          kind: 'condition',
          value: 'poisoned',
          op: 'apply',
          duration: { type: 'rounds', amount: 10 },
          save_ends: { timing: 'end_of_turn', ability: 'con', dc: '10' },
        },
      ],
      on_success: [],
    }],
  },
};

describe('compiled Dwarf 2024 vertical', () => {
  let provider: CompiledMicroMvpL1Provider;
  let roots: CompiledMicroMvpL1Root[];
  let root: CompiledMicroMvpL1Root;
  let stonecunning: RuleActionDefinition;

  beforeAll(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('network is forbidden for Dwarf semantics');
    };
    try {
      provider = await compileMicroMvpL1Overlay();
    } finally {
      globalThis.fetch = originalFetch;
    }
    roots = provider.roots.filter((candidate) => (
      candidate.matrixCase.species.card_number === DWARF_SPECIES_CARD
    ));
    root = required(roots[0], 'one compiled Dwarf root');
    const source = effect(root, STONECUNNING_CARD);
    stonecunning = required(root.rulesActions.find((action) => (
      action.sourceEntityIds.includes(source.id)
    )), 'compiled Stonecunning action');
  }, 60_000);

  it('projects every PHB 2024 Dwarf trait and legal Stonecunning resource from compiled roots', () => {
    expect(roots.length).toBeGreaterThan(0);
    const usesKey = actionUsesKey(STONECUNNING_CARD);
    for (const candidate of roots) {
      expect(candidate.assembled.race).toMatchObject({
        card_number: DWARF_SPECIES_CARD,
        darkvision: 120,
      });
      expect(candidate.ruleState.senses).toContainEqual({ sense: 'darkvision', range: 120 });
      expect(candidate.ruleState.senses.some((sense) => sense.sense === 'tremorsense')).toBe(false);

      for (const cardNumber of [DWARVEN_RESILIENCE_CARD, DWARVEN_TOUGHNESS_CARD]) {
        const source = effect(candidate, cardNumber);
        expect(passive(candidate, cardNumber).sourceEntityIds).toEqual([
          source.id,
          source.card_number,
          candidate.matrixCase.species.id,
          candidate.matrixCase.species.card_number,
        ]);
      }

      const source = effect(candidate, STONECUNNING_CARD);
      const action = required(candidate.rulesActions.find((entry) => (
        entry.sourceEntityIds.includes(source.id)
      )), `${candidate.stableKey}/Stonecunning action`);
      expect(action.sourceEntityIds).toContain(source.id);
      expect(action.targeting).toEqual({
        minTargets: 0,
        maxTargets: 1,
        rangeFt: 0,
        requiresLineOfSight: false,
        allowedRelations: ['self'],
        requiresStoneworkContact: true,
      });
      expect(candidate.actor.capabilities.actionIds).toContain(action.id);
      expect(provider.catalog.getAction(action.id)).toEqual(action);
      expect((action.mechanics.activation as JsonRecord).cost).toEqual([
        { resource: 'bonus_action' },
        { resource: usesKey },
      ]);
      expect(action.mechanics.uses).toEqual({ count: 'prof_bonus', per: 'long_rest' });
      expect(candidate.actor.runtime.resources[usesKey]).toBe(candidate.actor.character.profBonus);
      expect(candidate.actor.runtime.maxResources[usesKey]).toBe(candidate.actor.character.profBonus);
      expect(candidate.actor.character.resourceRecharge?.[usesKey]).toBe('long_rest');
      const sense = payloadsOf(action.mechanics).find((payload) => payload.kind === 'grant_sense');
      expect(sense).toMatchObject({
        sense: 'tremorsense',
        range: 60,
        duration: { type: 'rounds', amount: STONECUNNING_DURATION_ROUNDS },
        senseScope: STONECUNNING_SENSE_SCOPE,
      });
      expect(sense?.sourceEntityIds).toEqual([source.id, source.card_number]);
    }

    expect(payloadsOf(passive(root, DWARVEN_RESILIENCE_CARD))).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'modifier',
        op: 'advantage',
        applies_to: { roll: 'saving_throw' },
        when: [{ kind: 'save_avoids_condition', value: 'poisoned' }],
      }),
      expect.objectContaining({
        kind: 'resistance', damage_type: 'poison', value: 'resistance',
      }),
    ]));
    expect(payloadsOf(passive(root, DWARVEN_TOUGHNESS_CARD))).toContainEqual(expect.objectContaining({
      kind: 'modifier', op: 'add', value: 'self_level', applies_to: { roll: 'max_hp' },
    }));
  });

  it('adds exactly one maximum HP per character level through Dwarven Toughness', () => {
    const withoutToughness = {
      ...root.assembled,
      effects: root.assembled.effects.filter(({ effect: source }) => (
        source.card_number !== DWARVEN_TOUGHNESS_CARD
      )),
    };
    for (const level of [1, 2, 5, 20]) {
      const draft = { ...root.draft, level };
      const withTrait = resolveCharacterRules({ draft, assembled: root.assembled });
      const withoutTrait = resolveCharacterRules({ draft, assembled: withoutToughness });
      expect(withTrait.maxHP - withoutTrait.maxHP, `level ${level}`).toBe(level);
    }
    expect(root.actor.runtime.hp.max).toBe(root.ruleState.maxHP);
  });

  it('executes Stonecunning only on natural/worked stone, persists 100 rounds, replays, and recharges on Long Rest', () => {
    const legalFacts = [
      { material: 'stone', stoneForm: 'natural', contact: 'on_surface' },
      { material: 'stone', stoneForm: 'natural', contact: 'touching_surface' },
      { material: 'stone', stoneForm: 'worked', contact: 'on_surface' },
      { material: 'stone', stoneForm: 'worked', contact: 'touching_surface' },
    ] as const;
    for (const [index, stonework] of legalFacts.entries()) {
      const dwarf = actorFrom(root, `legal-dwarf-${index}`);
      const initial = createWorld({
        id: `stone-legal-${index}`,
        ruleset: provider.ruleset,
        actors: [dwarf],
      });
      const session = new InMemoryRulesSession(initial, provider.catalog, environment());
      const result = session.dispatch(command({
        schemaVersion: 1,
        type: 'UseAction',
        commandId: `stone-legal-${index}`,
        expectedRevision: 0,
        rulesetContentHash: provider.ruleset.contentHash,
        actorId: dwarf.id,
        actionId: stonecunning.id,
        targetIds: [dwarf.id],
        factsByTarget: { [dwarf.id]: selfFacts(stonework) },
      }));
      expect(result.status, JSON.stringify(stonework)).toBe('accepted');
    }

    const invalidFacts: Array<SpatialFacts['stonework'] | undefined> = [
      undefined,
      { material: 'other', stoneForm: 'natural', contact: 'on_surface' },
      { material: 'stone', contact: 'on_surface' },
      { material: 'stone', stoneForm: 'worked', contact: 'none' },
    ];
    for (const [index, stonework] of invalidFacts.entries()) {
      const dwarf = actorFrom(root, `invalid-dwarf-${index}`);
      const initial = createWorld({
        id: `stone-invalid-${index}`,
        ruleset: provider.ruleset,
        actors: [dwarf],
      });
      const session = new InMemoryRulesSession(initial, provider.catalog, environment());
      const result = session.dispatch(command({
        schemaVersion: 1,
        type: 'UseAction',
        commandId: `stone-invalid-${index}`,
        expectedRevision: 0,
        rulesetContentHash: provider.ruleset.contentHash,
        actorId: dwarf.id,
        actionId: stonecunning.id,
        targetIds: [dwarf.id],
        factsByTarget: { [dwarf.id]: selfFacts(stonework) },
      }));
      expect(result).toMatchObject({ status: 'rejected', code: 'InvalidFacts' });
      expect(session.getState()).toBe(initial);
    }

    const dwarf = actorFrom(root, 'dwarf');
    const observer = actorFrom(root, 'observer');
    observer.capabilities = { actionIds: [] };
    observer.passives = [];
    const forgedInitial = createWorld({
      id: 'stone-forged-target', ruleset: provider.ruleset, actors: [dwarf, observer],
    });
    const forged = new InMemoryRulesSession(forgedInitial, provider.catalog, environment());
    expect(forged.dispatch(command({
      schemaVersion: 1,
      type: 'UseAction',
      commandId: 'stone-forged-target',
      expectedRevision: 0,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: dwarf.id,
      actionId: stonecunning.id,
      targetIds: [observer.id],
      factsByTarget: {
        [observer.id]: selfFacts({ material: 'stone', stoneForm: 'worked', contact: 'on_surface' }),
      },
    }))).toMatchObject({ status: 'rejected', code: 'InvalidTargets' });

    const clockActor = actorFrom(root, 'clock-observer');
    clockActor.capabilities = { actionIds: [] };
    clockActor.passives = [];
    const initial = createWorld({
      id: 'stone-checkpoint',
      ruleset: provider.ruleset,
      actors: [actorFrom(root, 'checkpoint-dwarf'), clockActor],
    });
    const opening = new InMemoryRulesSession(initial, provider.catalog, environment());
    expect(opening.dispatch(command({
      schemaVersion: 1,
      type: 'UseAction',
      commandId: 'stone-use',
      expectedRevision: 0,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: 'checkpoint-dwarf',
      actionId: stonecunning.id,
      targetIds: ['checkpoint-dwarf'],
      factsByTarget: {
        'checkpoint-dwarf': selfFacts({
          material: 'stone', stoneForm: 'worked', contact: 'touching_surface',
        }),
      },
    }))).toMatchObject({ status: 'accepted' });
    const afterUse = opening.getState();
    const usesKey = actionUsesKey(STONECUNNING_CARD);
    expect(afterUse.actors['checkpoint-dwarf'].runtime.resources).toMatchObject({
      bonus_action: 0,
      [usesKey]: 1,
    });
    const declaredSense = required(
      payloadsOf(stonecunning.mechanics).find((payload) => payload.kind === 'grant_sense'),
      'Stonecunning declared sense payload',
    );
    expect(afterUse.actors['checkpoint-dwarf'].runtime.activeEffects).toEqual([
      expect.objectContaining({
        id: 'stone-use:id:1',
        ownerId: 'checkpoint-dwarf',
        sourceId: 'checkpoint-dwarf',
        roundsLeft: 100,
        mechanics: expect.objectContaining({
          kind: 'grant_sense', sense: 'tremorsense', range: 60,
          sourceEntityIds: declaredSense.sourceEntityIds,
          senseScope: STONECUNNING_SENSE_SCOPE,
        }),
      }),
    ]);
    expect(effectiveSenses({
      build: root.ruleState.senses,
      runtime: afterUse.actors['checkpoint-dwarf'].runtime,
    }).map(({ sense, range }) => ({ sense, range }))).toEqual([
      { sense: 'darkvision', range: 120 },
      { sense: 'tremorsense', range: 60 },
    ]);
    let exactDuration: RuntimeState = clone(afterUse.actors['checkpoint-dwarf'].runtime);
    for (let elapsed = 1; elapsed < STONECUNNING_DURATION_ROUNDS; elapsed += 1) {
      exactDuration = startTurn(exactDuration, root.actor.character).state;
      exactDuration = endTurn(
        exactDuration,
        root.actor.character,
        { advanceRoundDurations: false },
      ).state;
      expect(exactDuration.activeEffects[0].roundsLeft).toBe(
        STONECUNNING_DURATION_ROUNDS - elapsed,
      );
    }
    exactDuration = startTurn(exactDuration, root.actor.character).state;
    expect(exactDuration.activeEffects).toEqual([]);
    const declaration = opening.getEvents().find((event) => event.payload.type === 'ActionDeclared');
    expect(declaration?.payload).toMatchObject({
      type: 'ActionDeclared',
      actionId: stonecunning.id,
      actorId: 'checkpoint-dwarf',
      sourceEntityIds: stonecunning.sourceEntityIds,
      targetIds: ['checkpoint-dwarf'],
      facts: {
        spatialByTarget: {
          'checkpoint-dwarf': {
            stonework: { material: 'stone', stoneForm: 'worked', contact: 'touching_surface' },
          },
        },
      },
    });
    expect(foldEvents(initial, opening.getEvents())).toEqual(afterUse);

    const migrated = migrateWorldState(clone(afterUse));
    expect(migrated.actors['checkpoint-dwarf'].runtime.activeEffects).toEqual(
      afterUse.actors['checkpoint-dwarf'].runtime.activeEffects,
    );
    const resumed = new InMemoryRulesSession(migrated, provider.catalog, environment());
    expect(resumed.dispatch(command({
      schemaVersion: 1,
      type: 'StartEncounter',
      commandId: 'stone-start-encounter',
      expectedRevision: migrated.revision,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: 'checkpoint-dwarf',
      initiative: ['checkpoint-dwarf', 'clock-observer'],
    }))).toMatchObject({ status: 'accepted' });
    expect(resumed.dispatch(command({
      schemaVersion: 1,
      type: 'StartTurn',
      commandId: 'stone-start-next',
      expectedRevision: resumed.getState().revision,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: 'checkpoint-dwarf',
    }))).toMatchObject({ status: 'accepted' });
    expect(resumed.getState().actors['checkpoint-dwarf'].runtime.activeEffects[0].roundsLeft).toBe(99);
    expect(resumed.dispatch(command({
      schemaVersion: 1,
      type: 'EndTurn',
      commandId: 'stone-end-next',
      expectedRevision: resumed.getState().revision,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: 'checkpoint-dwarf',
    }))).toMatchObject({ status: 'accepted' });
    expect(resumed.getState().actors['checkpoint-dwarf'].runtime.activeEffects[0].roundsLeft).toBe(99);
    expect(foldEvents(initial, [...opening.getEvents(), ...resumed.getEvents()]))
      .toEqual(resumed.getState());

    const rested = new InMemoryRulesSession(migrated, provider.catalog, environment());
    expect(rested.dispatch(command({
      schemaVersion: 1,
      type: 'TakeLongRest',
      commandId: 'stone-long-rest',
      expectedRevision: migrated.revision,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: 'checkpoint-dwarf',
      durationHours: 8,
    }))).toMatchObject({ status: 'accepted' });
    expect(rested.getState().actors['checkpoint-dwarf'].runtime.activeEffects).toEqual([]);
    expect(rested.getState().actors['checkpoint-dwarf'].runtime.resources[usesKey]).toBe(2);
    expect(foldEvents(initial, [...opening.getEvents(), ...rested.getEvents()]))
      .toEqual(rested.getState());
  });

  it('enforces exactly proficiency-bonus Stonecunning uses before the next Long Rest', () => {
    const dwarf = actorFrom(root, 'limited-dwarf');
    const observer = actorFrom(root, 'limited-observer');
    observer.capabilities = { actionIds: [] };
    observer.passives = [];
    const session = new InMemoryRulesSession(createWorld({
      id: 'stone-use-limit', ruleset: provider.ruleset, actors: [dwarf, observer],
    }), provider.catalog, environment());
    let ordinal = 0;
    const send = (actorId: string, payload: Record<string, unknown>) => session.dispatch({
      schemaVersion: 1,
      commandId: `stone-limit-${++ordinal}`,
      expectedRevision: session.getState().revision,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId,
      ...payload,
    } as unknown as GameCommand);

    expect(send(dwarf.id, {
      type: 'StartEncounter', initiative: [dwarf.id, observer.id],
    })).toMatchObject({ status: 'accepted' });
    for (let use = 0; use < dwarf.character.profBonus; use += 1) {
      expect(send(dwarf.id, { type: 'StartTurn' })).toMatchObject({ status: 'accepted' });
      expect(send(dwarf.id, {
        type: 'UseAction',
        actionId: stonecunning.id,
        targetIds: [dwarf.id],
        factsByTarget: {
          [dwarf.id]: selfFacts({
            material: 'stone', stoneForm: 'natural', contact: 'on_surface',
          }),
        },
      })).toMatchObject({ status: 'accepted' });
      expect(send(dwarf.id, { type: 'EndTurn' })).toMatchObject({ status: 'accepted' });
      expect(send(observer.id, { type: 'StartTurn' })).toMatchObject({ status: 'accepted' });
      expect(send(observer.id, { type: 'EndTurn' })).toMatchObject({ status: 'accepted' });
    }
    expect(session.getState().actors[dwarf.id].runtime.resources[actionUsesKey(STONECUNNING_CARD)])
      .toBe(0);
    expect(session.getState().actors[dwarf.id].runtime.activeEffects).toHaveLength(1);
    expect(send(dwarf.id, { type: 'StartTurn' })).toMatchObject({ status: 'accepted' });
    const beforeRejectedUse = session.getState();
    expect(send(dwarf.id, {
      type: 'UseAction',
      actionId: stonecunning.id,
      targetIds: [dwarf.id],
      factsByTarget: {
        [dwarf.id]: selfFacts({
          material: 'stone', stoneForm: 'worked', contact: 'touching_surface',
        }),
      },
    })).toMatchObject({ status: 'rejected', code: 'InsufficientResources' });
    expect(session.getState()).toBe(beforeRejectedUse);
  });

  it('applies Dwarven Resilience to poison damage and saves that avoid or end Poisoned after reload', () => {
    const dwarf = actorFrom(root, 'resilient-dwarf');
    dwarf.runtime = {
      ...dwarf.runtime,
      hp: { current: 20, max: 20, temp: 0 },
      activeEffects: [],
    };
    const resilience = passive(root, DWARVEN_RESILIENCE_CARD);
    const direct = applyIncomingDamage(dwarf.runtime, 7, {
      character: dwarf.character,
      passives: dwarf.passives,
      rng: () => { throw new Error('damage resistance does not roll'); },
    }, { damageType: 'poison' });
    expect(direct.state.hp.current).toBe(17);
    const adjustment = direct.events.find((event) => (
      event.type === 'narrative' && event.damageAdjustment
    ));
    expect(adjustment).toMatchObject({
      damageAdjustment: {
        damageType: 'poison', adjustment: 'resistance', before: 7, after: 3,
        sourceEntityIds: [...(resilience.sourceEntityIds as string[])].sort(),
      },
    });

    const caster = actorFrom(root, 'poison-caster');
    caster.capabilities = { actionIds: [POISON_SAVE.id] };
    caster.passives = [];
    caster.character = {
      ...caster.character,
      // This focused synthetic caster deliberately owns no bounded action
      // resources, so it must not retain the Fighter root's recovery policy.
      resourceRecovery: undefined,
    };
    caster.runtime = {
      ...caster.runtime,
      resources: {},
      maxResources: {},
      activeEffects: [],
    };
    const initial = createWorld({
      id: 'dwarf-resilience-checkpoint', ruleset: provider.ruleset, actors: [caster, dwarf],
    });
    const catalog: RulesCatalog = {
      getAction: (id) => id === POISON_SAVE.id ? POISON_SAVE : provider.catalog.getAction(id),
    };
    const opening = new InMemoryRulesSession(initial, catalog, environment());
    expect(opening.dispatch(command({
      schemaVersion: 1,
      type: 'UseAction',
      commandId: 'poison-open',
      expectedRevision: 0,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: caster.id,
      actionId: POISON_SAVE.id,
      targetIds: [dwarf.id],
      factsByTarget: { [dwarf.id]: enemyFacts() },
    }))).toMatchObject({ status: 'accepted' });
    const paused = opening.getState();
    expect(paused.pendingResolution).toMatchObject({
      type: 'target_save',
      targetActorId: dwarf.id,
      request: { ability: 'con', dc: 20, avoidsConditions: ['poisoned'] },
    });

    const migrated = migrateWorldState(clone(paused));
    const tape = createStrictRngTape([
      { label: 'resisted poison damage', sides: 6, value: 5 },
      { label: 'end poison save low', sides: 20, value: 1 },
      { label: 'end poison save high', sides: 20, value: 20 },
    ]);
    const resumed = new InMemoryRulesSession(migrated, catalog, environment(tape.rng));
    const pending = required(migrated.pendingResolution, 'poison pending resolution');
    expect(resumed.dispatch(command({
      schemaVersion: 1,
      type: 'ResolveDecision',
      commandId: 'poison-fail',
      expectedRevision: migrated.revision,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: dwarf.id,
      resolutionId: pending.id,
      requestId: pending.request.id,
      response: {
        kind: 'roll',
        roll: { mode: 'manual', dice: [{ sides: 20, value: 2 }, { sides: 20, value: 3 }] },
      },
    }))).toMatchObject({ status: 'accepted' });
    expect(resumed.getState().actors[dwarf.id].runtime.hp.current).toBe(18);
    expect(resumed.getState().actors[dwarf.id].runtime.activeEffects).toEqual([
      expect.objectContaining({ mechanics: expect.objectContaining({ kind: 'condition', value: 'poisoned' }) }),
    ]);
    const avoidedSave = resumed.getEvents().find((event) => (
      event.payload.type === 'EngineEventRecorded'
        && event.payload.event.type === 'roll'
        && event.payload.event.label.includes('Спасбросок')
    ));
    expect(avoidedSave?.payload).toMatchObject({
      type: 'EngineEventRecorded',
      event: { roll: { advantage: 'advantage' } },
    });
    expect(avoidedSave?.payload.type === 'EngineEventRecorded'
      && avoidedSave.payload.event.type === 'roll'
      ? avoidedSave.payload.event.roll.dice.map(({ result }) => result).sort((a, b) => a - b)
      : []).toEqual([2, 3]);
    const adjustmentTrace = resumed.getEvents().find((event) => (
      event.payload.type === 'EngineEventRecorded'
        && event.payload.event.type === 'narrative'
        && event.payload.event.damageAdjustment
    ));
    expect(adjustmentTrace).toMatchObject({
      obligationIds: expect.arrayContaining(
        (resilience.sourceEntityIds as string[]).map((id) => `entity:${id}`),
      ),
      payload: {
        facts: {
          damageAdjustments: [expect.objectContaining({
            damageType: 'poison', before: 5, after: 2,
            sourceEntityIds: [...(resilience.sourceEntityIds as string[])].sort(),
          })],
        },
      },
    });

    expect(resumed.dispatch(command({
      schemaVersion: 1,
      type: 'StartEncounter',
      commandId: 'poison-start-encounter',
      expectedRevision: resumed.getState().revision,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: dwarf.id,
      initiative: [dwarf.id, caster.id],
    }))).toMatchObject({ status: 'accepted' });
    expect(resumed.dispatch(command({
      schemaVersion: 1,
      type: 'StartTurn',
      commandId: 'poison-start-turn',
      expectedRevision: resumed.getState().revision,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: dwarf.id,
    }))).toMatchObject({ status: 'accepted' });
    expect(resumed.dispatch(command({
      schemaVersion: 1,
      type: 'EndTurn',
      commandId: 'poison-end-save',
      expectedRevision: resumed.getState().revision,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: dwarf.id,
    }))).toMatchObject({ status: 'accepted' });
    tape.assertExhausted();
    expect(resumed.getState().actors[dwarf.id].runtime.activeEffects).toEqual([]);
    const endSave = resumed.getEvents().find((event) => (
      event.payload.type === 'EngineEventRecorded'
        && event.payload.event.type === 'roll'
        && event.payload.event.label.includes('в конце хода')
    ));
    expect(endSave?.payload).toMatchObject({
      type: 'EngineEventRecorded',
      event: { roll: { advantage: 'advantage' } },
    });
    expect(endSave?.payload.type === 'EngineEventRecorded'
      && endSave.payload.event.type === 'roll'
      ? endSave.payload.event.roll.dice.map(({ result }) => result).sort((a, b) => a - b)
      : []).toEqual([1, 20]);
    expect(foldEvents(initial, [...opening.getEvents(), ...resumed.getEvents()]))
      .toEqual(resumed.getState());
  });
});
