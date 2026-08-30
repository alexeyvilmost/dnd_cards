import { beforeAll, describe, expect, it } from 'vitest';
import { actionUsesKey } from '../engine/actionUses';
import {
  compileMicroMvpL1Overlay,
  type CompiledMicroMvpL1Provider,
  type CompiledMicroMvpL1Root,
} from '../canon/microMvpL1Overlay';
import { createLogicalClock, createSequentialIdFactory } from './determinism';
import { createWorld } from './domain';
import type {
  ActorState,
  CommandResult,
  RuleActionDefinition,
  UncommittedRuleEvent,
  WorldState,
} from './domain';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';
import { migrateWorldState } from './worldMigration';

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function required<T>(value: T | undefined, description: string): T {
  if (value === undefined) throw new Error(`Missing Dragonborn fixture: ${description}`);
  return value;
}

function accepted(result: CommandResult) {
  if (result.status !== 'accepted') throw new Error(`${result.code}: ${result.message}`);
  return result;
}

function engineEvents(events: readonly UncommittedRuleEvent[]) {
  return events.flatMap((entry) => (
    entry.payload.type === 'EngineEventRecorded' ? [entry.payload.event] : []
  ));
}

describe('compiled Dragonborn Breath Weapon Attack-action replacement', () => {
  let provider: CompiledMicroMvpL1Provider;
  let root: CompiledMicroMvpL1Root;
  let breath: RuleActionDefinition;
  let breathUses: string;
  let resistanceEntityId: string;

  beforeAll(async () => {
    provider = await compileMicroMvpL1Overlay();
    root = required(provider.roots.find((candidate) => (
      candidate.matrixCase.species.card_number === 'RACE-0008'
        && candidate.speciesAudit.lineageCardNumber === 'sub-red'
    )), 'Red Dragonborn root');
    const actionEntityId = required(root.assembled.subrace?.related_actions?.[0], 'Breath action entity');
    const actionEntity = required(
      root.assembled.actions.find(({ action }) => action.id === actionEntityId)?.action,
      'assembled Breath action',
    );
    breath = required(
      root.rulesActions.find((action) => action.sourceEntityIds.includes(actionEntityId)),
      'compiled Breath action',
    );
    breathUses = actionUsesKey(actionEntity.card_number);
    resistanceEntityId = required(
      root.assembled.subrace?.related_effects?.[0],
      'ancestry resistance entity',
    );
  }, 60_000);

  function actor(id: string): ActorState {
    const result = copy(root.actor);
    result.id = id;
    result.name = id;
    result.controllerId = `${id}:controller`;
    result.runtime.resources.action = 1;
    result.runtime.maxResources.action = 1;
    return result;
  }

  function environment(seed: number) {
    return {
      rng: () => 0.9,
      clock: createLogicalClock(seed),
      nextId: createSequentialIdFactory(`dragonborn-${seed}`),
    };
  }

  function startedSession(input?: { exhausted?: boolean }) {
    const attacker = actor('dragonborn-attacker');
    const target = actor('dragonborn-target');
    if (input?.exhausted) attacker.runtime.resources[breathUses] = 0;
    const initial = createWorld({
      id: 'dragonborn-attack-world',
      ruleset: provider.ruleset,
      actors: [attacker, target],
    });
    const session = new InMemoryRulesSession(initial, provider.catalog, environment(10_000));
    accepted(session.dispatch({
      schemaVersion: 1,
      type: 'StartEncounter',
      commandId: 'dragonborn:start-encounter',
      expectedRevision: 0,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: attacker.id,
      initiative: [attacker.id, target.id],
    }));
    accepted(session.dispatch({
      schemaVersion: 1,
      type: 'StartTurn',
      commandId: 'dragonborn:start-turn:attacker',
      expectedRevision: 1,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: attacker.id,
    }));
    return { initial, session, attacker, target };
  }

  function replacementCommand(world: WorldState, commandId: string) {
    return {
      schemaVersion: 1 as const,
      type: 'UseAttackReplacement' as const,
      commandId,
      expectedRevision: world.revision,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: 'dragonborn-attacker',
      actionId: breath.id,
      targetIds: ['dragonborn-target'],
      factsByTarget: {
        'dragonborn-target': {
          factsSource: 'scenario' as const,
          boardRevision: world.revision,
          distanceFt: 10,
          lineOfSight: true,
          cover: 'none' as const,
          relation: 'enemy' as const,
        },
      },
    };
  }

  it('compiles every L1 Dragonborn Breath as one source-owned Attack replacement', () => {
    const roots = provider.roots.filter((candidate) => (
      candidate.matrixCase.species.card_number === 'RACE-0008'
    ));
    expect(roots).toHaveLength(112);
    for (const candidate of roots) {
      const actionEntityId = required(
        candidate.assembled.subrace?.related_actions?.[0],
        `${candidate.stableKey} Breath action`,
      );
      const actionEntity = required(
        candidate.assembled.actions.find(({ action }) => action.id === actionEntityId)?.action,
        `${candidate.stableKey} assembled Breath`,
      );
      const compiled = required(
        candidate.rulesActions.find((action) => action.sourceEntityIds.includes(actionEntityId)),
        `${candidate.stableKey} compiled Breath`,
      );
      expect(compiled.attackReplacement).toEqual({
        replacementKey: 'dragonborn:breath-weapon',
        replacesAttacks: 1,
        totalAttacks: 1,
        oncePerAttackAction: true,
      });
      expect(actionEntity.mechanics?.attack_replacement).toEqual({
        replacement_key: 'dragonborn:breath-weapon',
        replaces_attacks: 1,
        total_attacks: 1,
        once_per_attack_action: true,
      });
      expect(compiled.sourceEntityIds).toEqual(expect.arrayContaining([
        actionEntityId,
        candidate.assembled.subrace!.id,
        candidate.matrixCase.species.id,
      ]));
      expect(compiled.targeting?.rangeFt).toBe(15);
      expect(candidate.actor.runtime.maxResources[actionUsesKey(actionEntity.card_number)]).toBe(2);

      const save = required(
        Array.isArray(compiled.mechanics.effects)
          ? compiled.mechanics.effects.find((effect) => (
            effect && typeof effect === 'object'
              && (effect as Record<string, unknown>).resolution === 'save'
          )) as Record<string, unknown> | undefined
          : undefined,
        `${candidate.stableKey} Breath save`,
      );
      const failureDamage = required(
        Array.isArray(save.on_fail)
          ? save.on_fail.find((payload) => (
            payload && typeof payload === 'object'
              && (payload as Record<string, unknown>).kind === 'damage'
          )) as Record<string, unknown> | undefined
          : undefined,
        `${candidate.stableKey} failed-save damage`,
      );
      const successDamage = required(
        Array.isArray(save.on_success)
          ? save.on_success.find((payload) => (
            payload && typeof payload === 'object'
              && (payload as Record<string, unknown>).kind === 'damage'
          )) as Record<string, unknown> | undefined
          : undefined,
        `${candidate.stableKey} successful-save damage`,
      );
      const resistanceId = required(
        candidate.assembled.subrace?.related_effects?.[0],
        `${candidate.stableKey} resistance`,
      );
      const resistance = required(
        candidate.assembled.effects.find(({ effect }) => effect.id === resistanceId)?.effect,
        `${candidate.stableKey} resistance entity`,
      );
      const resistanceInteraction = required(
        Array.isArray(resistance.mechanics?.effects)
          ? (resistance.mechanics.effects as Record<string, unknown>[])[0]
          : undefined,
        `${candidate.stableKey} resistance interaction`,
      );
      const resistancePayload = required(
        Array.isArray(resistanceInteraction.result)
          ? resistanceInteraction.result[0] as Record<string, unknown> | undefined
          : undefined,
        `${candidate.stableKey} resistance payload`,
      );
      expect(save).toMatchObject({ ability: 'dex', dc: '8+prof+con' });
      expect(failureDamage.type).toBe(resistancePayload.damage_type);
      expect(successDamage).toMatchObject({
        type: resistancePayload.damage_type,
        on_success: 'half',
      });
    }
  });

  it('replaces exactly one attack, persists its save continuation, applies typed resistance, and replays after JSON checkpoint', () => {
    const test = startedSession();
    const beforeUses = test.session.getState().actors[test.attacker.id].runtime.resources[breathUses];
    const declared = accepted(test.session.dispatch(replacementCommand(
      test.session.getState(),
      'dragonborn:replace:fire',
    )));

    const pending = test.session.getState().pendingResolution;
    expect(pending?.type).toBe('target_save');
    if (!pending || pending.type !== 'target_save') throw new Error('Expected Breath save');
    expect(pending.request).toMatchObject({
      actorId: test.target.id,
      ability: 'dex',
      dc: 8 + root.actor.character.profBonus + root.actor.character.abilityMods.con,
    });
    expect(pending.attackSequence).toBeUndefined();
    expect(pending.attackActionId).toBe('dragonborn:replace:fire:id:1');
    expect(test.session.getState().attackActions[pending.attackActionId!]).toMatchObject({
      id: 'dragonborn:replace:fire:id:1',
      actorId: test.attacker.id,
      status: 'open',
      blockedByResolutionId: pending.id,
      sequence: {
      id: 'dragonborn:replace:fire:id:1',
      actorId: test.attacker.id,
      totalAttacks: 1,
      attacksRemaining: 0,
      entries: [{
        ordinal: 1,
        kind: 'replacement',
        actionId: breath.id,
        replacementKey: breath.attackReplacement!.replacementKey,
        sourceEntityIds: [...breath.sourceEntityIds],
      }],
      usedReplacementKeys: [breath.attackReplacement!.replacementKey],
      },
    });
    expect(test.session.getState().actors[test.attacker.id].runtime.resources).toMatchObject({
      action: 0,
      [breathUses]: beforeUses - 1,
    });
    expect(test.session.getState().actors[test.target.id].runtime.hp)
      .toEqual(test.target.runtime.hp);

    const actionDeclared = declared.events.find((event) => (
      event.payload.type === 'ActionDeclared' && event.payload.actionId === breath.id
    ));
    expect(actionDeclared?.payload).toMatchObject({
      type: 'ActionDeclared',
      actorId: test.attacker.id,
      actionId: breath.id,
      sourceEntityIds: expect.arrayContaining([
        root.matrixCase.species.id,
        root.assembled.subrace!.id,
      ]),
      facts: {
        attackActionId: pending.attackActionId,
        attackEntryOrdinal: 1,
        authoritativeAttacksPerAction: 1,
        replacementPolicy: {
          replacementKey: breath.attackReplacement?.replacementKey,
          replacesAttacks: 1,
          oncePerAttackAction: true,
        },
      },
    });
    expect(engineEvents(declared.events)).toContainEqual({
      type: 'resource_spent',
      resource: breathUses,
      amount: 1,
      remaining: beforeUses - 1,
    });
    const useTrace = declared.events.find((event) => (
      event.payload.type === 'EngineEventRecorded'
        && event.payload.event.type === 'resource_spent'
        && event.payload.event.resource === breathUses
    ));
    expect(useTrace?.obligationIds).toEqual(expect.arrayContaining(
      breath.sourceEntityIds.map((sourceId) => `entity:${sourceId}`),
    ));

    const checkpoint = migrateWorldState(copy(test.session.getState()));
    expect(JSON.parse(JSON.stringify(checkpoint)).pendingResolution).toEqual(checkpoint.pendingResolution);
    const restoredA = new InMemoryRulesSession(copy(checkpoint), provider.catalog, environment(20_000));
    const restoredB = new InMemoryRulesSession(copy(checkpoint), provider.catalog, environment(20_000));
    const response = {
      schemaVersion: 1 as const,
      type: 'ResolveDecision' as const,
      commandId: 'dragonborn:save:target',
      expectedRevision: checkpoint.revision,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: test.target.id,
      resolutionId: pending.id,
      requestId: pending.request.id,
      response: {
        kind: 'roll' as const,
        roll: { mode: 'manual' as const, dice: [{ sides: 20, value: 1 }] },
      },
    };
    const resolvedA = accepted(restoredA.dispatch(response));
    const resolvedB = accepted(restoredB.dispatch(copy(response)));
    expect(resolvedB.events).toEqual(resolvedA.events);
    expect(resolvedB.nextState).toEqual(resolvedA.nextState);
    expect(restoredA.getState().pendingResolution).toBeNull();
    expect(restoredA.getState().attackActions[pending.attackActionId!]).toMatchObject({
      status: 'completed',
      sequence: { attacksRemaining: 0 },
    });

    const targetAfter = restoredA.getState().actors[test.target.id];
    expect(targetAfter.runtime.hp.current).toBe(test.target.runtime.hp.current - 5);
    expect(engineEvents(resolvedA.events)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'roll', roll: expect.objectContaining({ kind: 'save', outcome: 'fail' }) }),
      expect.objectContaining({
        type: 'damage',
        amount: 5,
        damageType: 'fire',
        roll: expect.objectContaining({ total: 10 }),
      }),
      expect.objectContaining({
        type: 'narrative',
        text: 'сопротивление (огонь): 10 → 5',
      }),
    ]));
    const saveTrace = resolvedA.events.find((event) => (
      event.payload.type === 'EngineEventRecorded'
        && event.payload.event.type === 'roll'
        && event.payload.event.roll.kind === 'save'
    ));
    expect(saveTrace?.obligationIds).toEqual(expect.arrayContaining(
      breath.sourceEntityIds.map((sourceId) => `entity:${sourceId}`),
    ));
    const resistanceTrace = resolvedA.events.find((event) => (
      event.payload.type === 'EngineEventRecorded'
        && event.payload.facts?.damageAdjustments !== undefined
    ));
    expect(resistanceTrace).toMatchObject({
      obligationIds: expect.arrayContaining([`entity:${resistanceEntityId}`]),
      payload: {
        facts: {
          damageAdjustments: [{
            damageType: 'fire',
            adjustment: 'resistance',
            sourceEntityIds: expect.arrayContaining([resistanceEntityId]),
          }],
        },
      },
    });
    expect(foldEvents(copy(checkpoint), copy(resolvedA.events))).toEqual(restoredA.getState());

    const repeatedBaseline = copy(restoredA.getState());
    const repeatedEventCount = restoredA.getEvents().length;
    const afterCompletion = restoredA.dispatch(replacementCommand(
      repeatedBaseline,
      'dragonborn:repeat:after-completion',
    ));
    expect(afterCompletion).toMatchObject({ status: 'rejected', code: 'InsufficientResources' });
    expect(restoredA.getState()).toEqual(repeatedBaseline);
    expect(restoredA.getEvents()).toHaveLength(repeatedEventCount);

    accepted(restoredA.dispatch({
      schemaVersion: 1,
      type: 'EndTurn',
      commandId: 'dragonborn:end-turn:attacker',
      expectedRevision: restoredA.getState().revision,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: test.attacker.id,
    }));
    accepted(restoredA.dispatch({
      schemaVersion: 1,
      type: 'StartTurn',
      commandId: 'dragonborn:start-turn:target',
      expectedRevision: restoredA.getState().revision,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: test.target.id,
    }));
    expect(restoredA.getState().scene).toMatchObject({
      mode: 'encounter', activeIndex: 1, round: 1, turnStarted: true,
    });
    expect(foldEvents(
      copy(test.initial),
      copy([...test.session.getEvents(), ...restoredA.getEvents()]),
    )).toEqual(restoredA.getState());
  });

  it('rejects standalone, malformed, repeated, and exhausted attempts before their costs or events', () => {
    const standalone = startedSession();
    const standaloneBaseline = copy(standalone.session.getState());
    const standaloneEventCount = standalone.session.getEvents().length;
    const direct = standalone.session.dispatch({
      schemaVersion: 1,
      type: 'UseAction',
      commandId: 'dragonborn:invalid:standalone',
      expectedRevision: standaloneBaseline.revision,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: standalone.attacker.id,
      actionId: breath.id,
      targetIds: [standalone.target.id],
      factsByTarget: replacementCommand(standaloneBaseline, 'unused').factsByTarget,
    });
    expect(direct).toMatchObject({ status: 'rejected', code: 'InvalidActionTiming' });
    expect(standalone.session.getState()).toEqual(standaloneBaseline);
    expect(standalone.session.getEvents()).toHaveLength(standaloneEventCount);

    const malformed = startedSession();
    const malformedBaseline = copy(malformed.session.getState());
    const {
      factsByTarget: _omittedFacts,
      ...invalidFacts
    } = replacementCommand(malformedBaseline, 'dragonborn:invalid:facts');
    const missingFacts = malformed.session.dispatch(invalidFacts);
    expect(missingFacts).toMatchObject({ status: 'rejected', code: 'MissingSpatialFacts' });
    expect(malformed.session.getState()).toEqual(malformedBaseline);

    const exhausted = startedSession({ exhausted: true });
    const exhaustedBaseline = copy(exhausted.session.getState());
    const noUses = exhausted.session.dispatch(replacementCommand(
      exhaustedBaseline,
      'dragonborn:invalid:exhausted',
    ));
    expect(noUses).toMatchObject({ status: 'rejected', code: 'InsufficientResources' });
    expect(exhausted.session.getState()).toEqual(exhaustedBaseline);

    const repeated = startedSession();
    accepted(repeated.session.dispatch(replacementCommand(
      repeated.session.getState(),
      'dragonborn:repeat:first',
    )));
    const pendingBaseline = copy(repeated.session.getState());
    const eventCount = repeated.session.getEvents().length;
    const duringSave = repeated.session.dispatch(replacementCommand(
      pendingBaseline,
      'dragonborn:repeat:while-pending',
    ));
    expect(duringSave).toMatchObject({ status: 'rejected', code: 'ResolutionInProgress' });
    expect(repeated.session.getState()).toEqual(pendingBaseline);
    expect(repeated.session.getEvents()).toHaveLength(eventCount);

    const corrupt = copy(pendingBaseline);
    if (corrupt.pendingResolution?.type !== 'target_save'
      || !corrupt.pendingResolution.attackActionId) {
      throw new Error('Expected persisted Attack-action ledger reference');
    }
    corrupt.attackActions[corrupt.pendingResolution.attackActionId]
      .sequence.usedReplacementKeys = [];
    const corruptSession = new InMemoryRulesSession(corrupt, provider.catalog, environment(30_000));
    const corruptPending = corrupt.pendingResolution;
    const corruptResult = corruptSession.dispatch({
      schemaVersion: 1,
      type: 'ResolveDecision',
      commandId: 'dragonborn:invalid:corrupt-sequence',
      expectedRevision: corrupt.revision,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: repeated.target.id,
      resolutionId: corruptPending.id,
      requestId: corruptPending.request.id,
      response: {
        kind: 'roll',
        roll: { mode: 'manual', dice: [{ sides: 20, value: 1 }] },
      },
    });
    expect(corruptResult).toMatchObject({ status: 'rejected', code: 'InvalidDecision' });
    expect(corruptSession.getState()).toEqual(corrupt);
    expect(corruptSession.getEvents()).toEqual([]);
  });
});
