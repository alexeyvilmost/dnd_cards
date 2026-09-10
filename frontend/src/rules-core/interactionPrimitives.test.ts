import { describe, expect, it } from 'vitest';
import type {
  ActorState,
  GameCommand,
  RuleHazardDefinition,
  RuleActionDefinition,
  RulesCatalog,
  UncommittedRuleEvent,
} from './domain';
import { createWorld } from './domain';
import { createLogicalClock, createSequentialIdFactory, createStrictRngTape } from './determinism';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'interaction-primitives@1',
  contentHash: 'sha256:interaction-primitives',
  errataVersion: 'test-1',
};

function actor(id: string, overrides: Partial<ActorState> = {}): ActorState {
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `${id}-controller`,
    ac: 13,
    capabilities: { actionIds: [] },
    character: {
      abilityMods: { str: 0, dex: 3, con: 1, int: 1, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
      skillProficiencies: ['stealth'],
      saveProficiencies: [],
    },
    runtime: {
      hp: { current: 10, max: 10, temp: 0 },
      resources: { action: 1, bonus_action: 1, reaction: 1 },
      maxResources: { action: 1, bonus_action: 1, reaction: 1 },
      equipment: {},
      inventory: [],
      activeEffects: [],
    },
    ...overrides,
  };
}

function command<T extends GameCommand>(value: T): T {
  return value;
}

function engineEvents(events: readonly UncommittedRuleEvent[]) {
  return events.flatMap((entry) => (
    entry.payload.type === 'EngineEventRecorded' ? [entry.payload.event] : []
  ));
}

const noActions: RulesCatalog = { getAction: () => undefined };

describe('rules-core interaction primitives', () => {
  it.each([10, 9])('uses an owned bonus Hide declaration with the canonical check and lifecycle (d20=%s)', roll => {
    const declaration: RuleActionDefinition = {id: 'bonus-hide', name: 'Bonus Hide', kind: 'nonSpell',
      sourceEntityIds: ['nimble-escape'], mechanics: {activation: {mode: 'active', counts_as: 'hide',
        cost: [{resource: 'bonus_action'}]}, effects: []}};
    const rogue = actor('rogue', {capabilities: {actionIds: [declaration.id]}});
    rogue.runtime.resources.action = 0;
    rogue.runtime.resources.action_surge_action = 1;
    const initial = createWorld({id: 'bonus-hide', ruleset: RULESET, actors: [rogue]});
    const tape = createStrictRngTape([{label: 'Hide', sides: 20, value: roll}]);
    const session = new InMemoryRulesSession(initial, {getAction: id => id === declaration.id ? declaration : undefined},
      {rng: tape.rng, clock: createLogicalClock(), nextId: createSequentialIdFactory('bonus-hide')});
    const result = session.dispatch({schemaVersion: 1, commandId: 'hide', expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash, type: 'AttemptHide', actorId: rogue.id, actionId: declaration.id,
      eligibility: {factsSource: 'board', boardRevision: 0, heavilyObscured: true, cover: 'none', visibleToAnyEnemy: false}});
    expect(result.status).toBe('accepted'); tape.assertExhausted();
    const runtime = session.getState().actors.rogue.runtime;
    expect(runtime.resources).toMatchObject({action: 0, bonus_action: 0, action_surge_action: 1});
    expect(runtime.activeEffects).toHaveLength(roll === 10 ? 1 : 0);
    if (roll === 10) expect(runtime.activeEffects[0].mechanics).toMatchObject({value: 'invisible',
      hidden_end_triggers: expect.arrayContaining(['actor_makes_attack_roll', 'noise_above_whisper'])});
    expect(engineEvents(result.status === 'accepted' ? result.events : [])).toContainEqual(expect.objectContaining({
      type: 'roll', roll: expect.objectContaining({total: roll + 5, target: {type: 'dc', value: 15}})}));
    expect(JSON.parse(JSON.stringify(foldEvents(initial, result.status === 'accepted' ? result.events : [])))).toEqual(JSON.parse(JSON.stringify(session.getState())));
  });

  it.each(['unowned', 'unknown', 'extra_effect', 'extra_requirement', 'no_bonus', 'visible', 'use_action', 'target_requirement'] as const)(
    'rejects invalid alternate Hide without spending or rolling: %s', invalid => {
      const declaration: RuleActionDefinition = {id: 'bonus-hide', name: 'Bonus Hide', kind: 'nonSpell',
        sourceEntityIds: ['nimble-escape'], mechanics: {activation: {mode: 'active', counts_as: 'hide',
          cost: [{resource: 'bonus_action'}]}, effects: []}};
      if (invalid === 'target_requirement') declaration.mechanics.targeting = {shape: 'self', requires_unarmored: true};
      if (invalid === 'extra_effect') declaration.mechanics.effects = [{resolution: 'auto', result: []}];
      if (invalid === 'extra_requirement') (declaration.mechanics.activation as Record<string, unknown>).min_level = 20;
      const rogue = actor('rogue', {capabilities: {actionIds: invalid === 'unowned' ? [] : [declaration.id]}});
      if (invalid === 'no_bonus') rogue.runtime.resources.bonus_action = 0;
      const initial = createWorld({id: 'invalid-hide', ruleset: RULESET, actors: [rogue]});
      const session = new InMemoryRulesSession(initial, {getAction: () => invalid === 'unknown' ? undefined : declaration},
        {rng: () => {throw new Error('Rejected Hide cannot roll');}, clock: createLogicalClock(), nextId: createSequentialIdFactory()});
      if (invalid === 'use_action') {
        const bypass = session.dispatch({schemaVersion: 1, commandId: 'bypass', expectedRevision: 0, rulesetContentHash: RULESET.contentHash, type: 'UseAction', actorId: rogue.id, actionId: declaration.id, targetIds: []});
        expect(bypass).toMatchObject({status: 'rejected', code: 'InvalidActionTiming'});
        expect(session.getState()).toBe(initial); return;
      }
      const result = session.dispatch({schemaVersion: 1, commandId: 'hide', expectedRevision: 0,
        rulesetContentHash: RULESET.contentHash, type: 'AttemptHide', actorId: rogue.id, actionId: declaration.id,
        eligibility: {factsSource: 'board', boardRevision: 0, heavilyObscured: true, cover: 'none', visibleToAnyEnemy: invalid === 'visible'}});
      expect(result.status).toBe('rejected'); expect(session.getState()).toBe(initial);
    });

  it('applies Help and a generic one-shot bonus to the matching check and consumes only matching next-check effects', {
    meta: { basicPrimitive: 'ability_check', evidenceKind: 'unit' },
  }, () => {
    const rogue = actor('rogue');
    rogue.runtime.activeEffects = [
      {
        id: 'help',
        name: 'Help',
        source: 'ally',
        expiry: 'manual',
        mechanics: {
          kind: 'modifier', applies_to: { roll: 'ability_check' }, op: 'advantage', consume: 'next',
        },
      },
      {
        id: 'one-shot-stealth',
        name: 'One-shot skill bonus (Stealth)',
        source: 'cleric',
        expiry: 'manual',
        mechanics: {
          kind: 'modifier', applies_to: { roll: 'ability_check', filter: { skill: 'stealth' } },
          op: 'bonus_die', faces: 4, source: 'One-shot skill bonus', consume: 'next',
        },
      },
      {
        id: 'one-shot-arcana',
        name: 'One-shot skill bonus (Arcana)',
        source: 'cleric',
        expiry: 'manual',
        mechanics: {
          kind: 'modifier', applies_to: { roll: 'ability_check', filter: { skill: 'arcana' } },
          op: 'bonus_die', faces: 4, source: 'One-shot skill bonus', consume: 'next',
        },
      },
    ];
    const initial = createWorld({ id: 'checks', ruleset: RULESET, actors: [rogue, actor('cleric')] });
    const tape = createStrictRngTape([
      { label: 'Help d20 low', sides: 20, value: 8 },
      { label: 'Help d20 high', sides: 20, value: 14 },
      { label: 'One-shot skill bonus d4', sides: 4, value: 3 },
    ]);
    const session = new InMemoryRulesSession(initial, noActions, {
      rng: tape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('check'),
    });

    const result = session.dispatch(command({
      schemaVersion: 1,
      type: 'AbilityCheck',
      commandId: 'check-stealth',
      expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'rogue',
      ability: 'dex',
      skill: 'stealth',
      dc: 20,
    }));

    expect(result.status).toBe('accepted');
    tape.assertExhausted();
    const roll = engineEvents(result.status === 'accepted' ? result.events : [])
      .find((event) => event.type === 'roll');
    expect(roll).toMatchObject({
      type: 'roll',
      roll: {
        advantage: 'advantage',
        total: 22,
        outcome: 'success',
        target: { type: 'dc', value: 20 },
        dice: expect.arrayContaining([
          expect.objectContaining({ sides: 4, result: 3, source: 'One-shot skill bonus' }),
        ]),
      },
    });
    expect(session.getState().actors.rogue.runtime.activeEffects.map(({ id }) => id)).toEqual([
      'one-shot-arcana',
    ]);
    expect(engineEvents(result.status === 'accepted' ? result.events : [])).toEqual(expect.arrayContaining([
      { type: 'effect_expired', name: 'Help' },
      { type: 'effect_expired', name: 'One-shot skill bonus (Stealth)' },
    ]));
    expect(result.status === 'accepted' ? result.events : []).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'ActorRuntimePatched',
        actorId: 'rogue',
        reason: 'ability_check',
      }),
    }));
    expect(foldEvents(initial, result.status === 'accepted' ? result.events : [])).toEqual(session.getState());
  });

  it('owns Hide eligibility and DC, applies Invisible only on success, and records the supplied facts', () => {
    const eligibility = {
      factsSource: 'board' as const,
      boardRevision: 7,
      heavilyObscured: false,
      cover: 'three_quarters' as const,
      visibleToAnyEnemy: false,
    };
    const initial = createWorld({ id: 'hide-success', ruleset: RULESET, actors: [actor('rogue'), actor('guard')] });
    const successTape = createStrictRngTape([{ label: 'Hide', sides: 20, value: 10 }]);
    const success = new InMemoryRulesSession(initial, noActions, {
      rng: successTape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('hide'),
    });
    const accepted = success.dispatch(command({
      schemaVersion: 1,
      type: 'AttemptHide',
      commandId: 'hide-success',
      expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'rogue',
      eligibility,
    }));

    expect(accepted.status).toBe('accepted');
    successTape.assertExhausted();
    expect(success.getState().actors.rogue.runtime.resources.action).toBe(0);
    expect(success.getState().actors.rogue.runtime.activeEffects).toEqual([
      expect.objectContaining({
        mechanics: expect.objectContaining({
          kind: 'condition',
          value: 'invisible',
          hidden_end_triggers: expect.arrayContaining(['actor_makes_attack_roll']),
        }),
      }),
    ]);
    expect(engineEvents(accepted.status === 'accepted' ? accepted.events : [])).toContainEqual(expect.objectContaining({
      type: 'roll',
      roll: expect.objectContaining({ outcome: 'success', target: { type: 'dc', value: 15 } }),
    }));
    expect(accepted.status === 'accepted' ? accepted.events : []).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'ActionDeclared',
        actionId: 'core.action.hide',
        facts: { hideEligibility: eligibility, dc: 15 },
      }),
    }));
    expect(foldEvents(initial, accepted.status === 'accepted' ? accepted.events : [])).toEqual(success.getState());

    const failWorld = createWorld({ id: 'hide-fail', ruleset: RULESET, actors: [actor('rogue'), actor('guard')] });
    const failTape = createStrictRngTape([{ label: 'Hide fail', sides: 20, value: 9 }]);
    const failure = new InMemoryRulesSession(failWorld, noActions, {
      rng: failTape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('hide-fail'),
    });
    const failed = failure.dispatch(command({
      schemaVersion: 1,
      type: 'AttemptHide',
      commandId: 'hide-fail',
      expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'rogue',
      eligibility,
    }));
    expect(failed.status).toBe('accepted');
    failTape.assertExhausted();
    expect(failure.getState().actors.rogue.runtime.resources.action).toBe(0);
    expect(failure.getState().actors.rogue.runtime.activeEffects).toEqual([]);
    expect(engineEvents(failed.status === 'accepted' ? failed.events : [])).toContainEqual(expect.objectContaining({
      type: 'roll', roll: expect.objectContaining({ outcome: 'fail' }),
    }));

    const ineligibleWorld = createWorld({ id: 'hide-denied', ruleset: RULESET, actors: [actor('rogue'), actor('guard')] });
    const denied = new InMemoryRulesSession(ineligibleWorld, noActions, {
      rng: () => { throw new Error('an ineligible Hide must not roll'); },
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('hide-denied'),
    });
    expect(denied.dispatch(command({
      schemaVersion: 1,
      type: 'AttemptHide',
      commandId: 'hide-denied',
      expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'rogue',
      eligibility: { ...eligibility, cover: 'half', visibleToAnyEnemy: true },
    }))).toMatchObject({ status: 'rejected', code: 'HideNotEligible' });
    expect(denied.getState()).toBe(ineligibleWorld);
  });

  it('opens a catalog-owned environment save and resumes its canonical consequence after JSON reload', {
    meta: { basicPrimitive: 'saving_throw', evidenceKind: 'unit' },
  }, () => {
    const hazard: RuleHazardDefinition = {
      id: 'hazard.poison-spores',
      name: 'Poison Spores',
      sourceKind: 'environment',
      sourceEntityIds: ['DMG:hazard:poison-spores'],
      resolution: 'save',
      save: { ability: 'con', dc: 13 },
      onFailure: [{
        kind: 'condition', value: 'poisoned', op: 'apply', duration: { type: 'rounds', amount: 1 },
      }],
      onSuccess: [],
    };
    const hazardCatalog: RulesCatalog = {
      getAction: () => undefined,
      getHazard: (id) => id === hazard.id ? hazard : undefined,
    };
    const initial = createWorld({ id: 'hazard', ruleset: RULESET, actors: [actor('rogue'), actor('cleric')] });
    const opening = new InMemoryRulesSession(initial, hazardCatalog, {
      rng: () => { throw new Error('opening a hazard save must not roll'); },
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('hazard'),
    });
    const opened = opening.dispatch(command({
      schemaVersion: 1,
      type: 'TriggerHazard',
      commandId: 'hazard-open',
      expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'rogue',
      hazardId: hazard.id,
      targetActorId: 'rogue',
    }));

    expect(opened.status).toBe('accepted');
    expect(opening.getState().pendingResolution).toMatchObject({
      type: 'hazard_save',
      id: 'hazard-open:id:1',
      targetActorId: 'rogue',
      hazard: {
        id: 'hazard.poison-spores',
        sourceKind: 'environment',
        sourceEntityIds: ['DMG:hazard:poison-spores'],
      },
      request: {
        id: 'hazard-open:id:2', ability: 'con', dc: 13, avoidsConditions: ['poisoned'],
      },
    });
    expect(opened.status === 'accepted' ? opened.events : []).toContainEqual(expect.objectContaining({
      sourceActorId: 'environment:hazard.poison-spores',
      obligationIds: expect.arrayContaining([
        'hazard:hazard.poison-spores',
        'entity:DMG:hazard:poison-spores',
        'system:pending-resolution',
      ]),
      payload: expect.objectContaining({ type: 'ResolutionOpened' }),
    }));

    const paused = JSON.parse(JSON.stringify(opening.getState())) as ReturnType<typeof opening.getState>;
    // The resolver must use the persisted canonical snapshot, not mutable
    // catalog process memory after a reload.
    (hazard.onFailure[0] as Record<string, unknown>).value = 'prone';
    const resumed = new InMemoryRulesSession(paused, hazardCatalog, {
      rng: () => { throw new Error('a condition-only failed save needs no consequence dice'); },
      clock: createLogicalClock(paused.logicalClock),
      nextId: createSequentialIdFactory('hazard-resume'),
    });
    const resolved = resumed.dispatch(command({
      schemaVersion: 1,
      type: 'ResolveDecision',
      commandId: 'hazard-resolve',
      expectedRevision: paused.revision,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'rogue',
      resolutionId: 'hazard-open:id:1',
      requestId: 'hazard-open:id:2',
      response: { kind: 'roll', roll: { mode: 'manual', dice: [{ sides: 20, value: 4 }] } },
    }));

    expect(resolved.status).toBe('accepted');
    expect(resumed.getState().pendingResolution).toBeNull();
    expect(resumed.getState().actors.rogue.runtime.activeEffects).toEqual([
      expect.objectContaining({
        sourceId: 'environment:hazard.poison-spores',
        mechanics: expect.objectContaining({ kind: 'condition', value: 'poisoned' }),
      }),
    ]);
    expect(engineEvents(resolved.status === 'accepted' ? resolved.events : [])).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'roll', roll: expect.objectContaining({ outcome: 'fail' }) }),
      { type: 'condition_applied', condition: 'poisoned' },
    ]));
    const combined = [
      ...(opened.status === 'accepted' ? opened.events : []),
      ...(resolved.status === 'accepted' ? resolved.events : []),
    ];
    expect(foldEvents(initial, combined)).toEqual(resumed.getState());
  });

  it('applies a no-save environment hazard immediately through canonical events', () => {
    const hazard: RuleHazardDefinition = {
      id: 'hazard.cloud-of-daggers',
      name: 'Cloud of Daggers',
      sourceKind: 'environment',
      sourceEntityIds: ['SPELL-0234'],
      resolution: 'automatic',
      effects: [{ kind: 'damage', dice: '2d4', type: 'force' }],
    };
    const catalog: RulesCatalog = {
      getAction: () => undefined,
      getHazard: (id) => id === hazard.id ? hazard : undefined,
    };
    const initial = createWorld({ id: 'automatic-hazard', ruleset: RULESET, actors: [actor('rogue')] });
    const session = new InMemoryRulesSession(initial, catalog, {
      rng: createStrictRngTape([
        { label: 'dagger-1', sides: 4, value: 3 },
        { label: 'dagger-2', sides: 4, value: 4 },
      ]).rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('automatic-hazard'),
    });
    const result = session.dispatch(command({
      schemaVersion: 1,
      type: 'TriggerHazard',
      commandId: 'automatic-hazard-trigger',
      expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'rogue',
      targetActorId: 'rogue',
      hazardId: hazard.id,
    }));

    expect(result.status).toBe('accepted');
    expect(session.getState().pendingResolution).toBeNull();
    expect(session.getState().actors.rogue.runtime.hp.current).toBe(3);
    expect(engineEvents(result.status === 'accepted' ? result.events : [])).toContainEqual(
      expect.objectContaining({ type: 'damage', amount: 7, damageType: 'force' }),
    );
    expect(foldEvents(initial, result.status === 'accepted' ? result.events : [])).toEqual(session.getState());
  });

  it('rejects malformed or non-catalog hazards before opening a resolution', () => {
    const malformed = {
      id: 'hazard.bad',
      name: 'Bad Hazard',
      sourceKind: 'environment',
      sourceEntityIds: [],
      save: { ability: 'dex', dc: 99 },
      onFailure: [],
    } as unknown as RuleHazardDefinition;
    const catalog: RulesCatalog = {
      getAction: () => undefined,
      getHazard: (id) => id === malformed.id ? malformed : undefined,
    };
    const world = createWorld({ id: 'hazard-invalid', ruleset: RULESET, actors: [actor('rogue'), actor('cleric')] });
    const session = new InMemoryRulesSession(world, catalog, {
      rng: () => { throw new Error('invalid hazards must not roll'); },
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('invalid-hazard'),
    });
    expect(session.dispatch(command({
      schemaVersion: 1,
      type: 'TriggerHazard',
      commandId: 'hazard-invalid',
      expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'rogue',
      targetActorId: 'rogue',
      hazardId: malformed.id,
    }))).toMatchObject({ status: 'rejected', code: 'InvalidHazardDefinition' });
    expect(session.dispatch(command({
      schemaVersion: 1,
      type: 'TriggerHazard',
      commandId: 'hazard-missing',
      expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'rogue',
      targetActorId: 'rogue',
      hazardId: 'hazard.missing',
    }))).toMatchObject({ status: 'rejected', code: 'HazardNotFound' });
    expect(session.getState()).toBe(world);
  });
});
