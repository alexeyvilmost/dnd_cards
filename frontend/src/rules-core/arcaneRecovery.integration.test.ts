import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileMicroMvpL1Overlay,
  type CompiledMicroMvpL1Provider,
  type CompiledMicroMvpL1Root,
} from '../canon/microMvpL1Overlay';
import {
  createLogicalClock,
  createSequentialIdFactory,
} from './determinism';
import { createWorld } from './domain';
import type { ActorState, UncommittedRuleEvent } from './domain';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function engineEvents(events: readonly UncommittedRuleEvent[]) {
  return events.flatMap((entry) => (
    entry.payload.type === 'EngineEventRecorded' ? [entry.payload.event] : []
  ));
}

describe('compiled Wizard Arcane Recovery at the Short-Rest boundary', () => {
  let provider: CompiledMicroMvpL1Provider;
  let wizardRoot: CompiledMicroMvpL1Root;
  let recoveryAction: NonNullable<ReturnType<CompiledMicroMvpL1Provider['catalog']['getAction']>>;

  beforeAll(async () => {
    provider = await compileMicroMvpL1Overlay();
    wizardRoot = provider.roots.find((root) => (
      root.matrixCase.klass.card_number === 'CLASS-wizard'
    ))!;
    recoveryAction = wizardRoot.rulesActions.find((action) => action.restDecision !== undefined)!;
  }, 60_000);

  function wizard(id = 'wizard'): ActorState {
    const actor = copy(wizardRoot.actor);
    actor.id = id;
    actor.controllerId = `${id}:controller`;
    actor.runtime.resources.spell_slot_1 = actor.runtime.maxResources.spell_slot_1 - 1;
    actor.runtime.resources.magic_recovery_charge = 1;
    return actor;
  }

  function session(actor: ActorState) {
    const initial = createWorld({ id: 'arcane-recovery-world', ruleset: provider.ruleset, actors: [actor] });
    return {
      initial,
      session: new InMemoryRulesSession(initial, provider.catalog, {
        rng: () => 0.5,
        clock: createLogicalClock(10_000),
        nextId: createSequentialIdFactory('arcane-recovery'),
      }),
    };
  }

  it('recovers one level-1 slot after the rest, spends its Long-Rest charge, and replays exactly', () => {
    const actor = wizard();
    expect(recoveryAction.restDecision).toMatchObject({
      kind: 'slot_recovery',
      decisionType: 'arcane_recovery',
      levelSource: { classId: 'wizard' },
      charge: { resource: 'magic_recovery_charge', amount: 1 },
      slotResource: { prefix: 'spell_slot_', minimumLevel: 1, maximumLevel: 5 },
    });
    expect(actor.capabilities.featureSources?.[recoveryAction.restDecision!.capabilityId])
      .toEqual(expect.arrayContaining([...recoveryAction.sourceEntityIds]));
    const test = session(actor);
    const beforeSlot = actor.runtime.resources.spell_slot_1;
    const result = test.session.dispatch({
      schemaVersion: 1,
      type: 'TakeShortRest',
      commandId: 'arcane-recovery:rest:1',
      expectedRevision: 0,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: actor.id,
      decisions: [{ type: 'arcane_recovery', slotLevels: [1] }],
    });

    if (result.status !== 'accepted') throw new Error(`${result.code}: ${result.message}`);
    expect(test.session.getState().actors[actor.id].runtime.resources).toMatchObject({
      spell_slot_1: beforeSlot + 1,
      magic_recovery_charge: 0,
    });
    expect(engineEvents(result.events)).toEqual(expect.arrayContaining([
      { type: 'resource_spent', resource: 'magic_recovery_charge', amount: 1, remaining: 0 },
      {
        type: 'resource_restored',
        resource: 'spell_slot_1',
        amount: 1,
        current: beforeSlot + 1,
      },
    ]));
    expect(result.events.some((event) => (
      event.obligationIds.includes(`capability:${recoveryAction.restDecision!.capabilityId}`)
    )))
      .toBe(true);
    expect(foldEvents(copy(test.initial), copy(test.session.getEvents())))
      .toEqual(test.session.getState());
  });

  it('rejects an over-budget, duplicate, unavailable, or ungranted decision before committing the rest', () => {
    const cases: Array<{ id: string; actor: ActorState; decisions: Array<{ type: 'arcane_recovery'; slotLevels: number[] }> }> = [
      { id: 'budget', actor: wizard('budget'), decisions: [{ type: 'arcane_recovery', slotLevels: [2] }] },
      {
        id: 'duplicate',
        actor: wizard('duplicate'),
        decisions: [
          { type: 'arcane_recovery', slotLevels: [1] },
          { type: 'arcane_recovery', slotLevels: [1] },
        ],
      },
      { id: 'used', actor: wizard('used'), decisions: [{ type: 'arcane_recovery', slotLevels: [1] }] },
      { id: 'ungranted', actor: wizard('ungranted'), decisions: [{ type: 'arcane_recovery', slotLevels: [1] }] },
    ];
    cases[2].actor.runtime.resources.magic_recovery_charge = 0;
    delete cases[3].actor.capabilities.featureSources?.[recoveryAction.restDecision!.capabilityId];

    for (const input of cases) {
      const test = session(input.actor);
      const before = copy(test.session.getState());
      const result = test.session.dispatch({
        schemaVersion: 1,
        type: 'TakeShortRest',
        commandId: `arcane-recovery:reject:${input.id}`,
        expectedRevision: 0,
        rulesetContentHash: provider.ruleset.contentHash,
        actorId: input.actor.id,
        decisions: input.decisions,
      });
      expect(result.status, input.id).toBe('rejected');
      expect(test.session.getState(), input.id).toEqual(before);
      expect(test.session.getEvents(), input.id).toEqual([]);
    }
  });
});
