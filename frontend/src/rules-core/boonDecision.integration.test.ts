import { describe, expect, it } from 'vitest';
import type { ActorState, GameCommand, UncommittedRuleEvent } from './domain';
import { createWorld } from './domain';
import { createLogicalClock, createSequentialIdFactory, createStrictRngTape } from './determinism';
import { InMemoryRulesSession } from './session';
import {
  instantiateMicroMvpScenarioActor,
  MICRO_MVP_SCENARIO_ACTION_IDS,
  MICRO_MVP_SCENARIO_CATALOG,
  MICRO_MVP_SCENARIO_FACTS,
  MICRO_MVP_SCENARIO_FIXTURE_IDS,
  MICRO_MVP_SCENARIO_RULESET,
} from './testing/microMvpScenarioCorpus';

function command<T extends GameCommand>(value: T): T { return value; }

function engineEvents(events: readonly UncommittedRuleEvent[]) {
  return events.flatMap((entry) => entry.payload.type === 'EngineEventRecorded'
    ? [entry.payload.event]
    : []);
}

function bardicBoon(actor: ActorState): ActorState {
  actor.runtime.activeEffects.push({
    id: 'boon:bardic',
    name: 'Вдохновение барда',
    source: 'Вдохновение барда',
    mechanics: {
      kind: 'boon', id: 'bardic_inspiration', die: '1d6',
      applies_to: ['ability_check', 'attack_roll', 'saving_throw'],
      timing: ['before_roll', 'after_failure'],
    },
    entityRef: { kind: 'effect', id: '14000000-0000-4000-8000-000000000001' },
  });
  return actor;
}

describe('data-driven boon decision', () => {
  it('offers Bardic Inspiration after a failed target save and consumes it only when used', () => {
    const sorcerer = instantiateMicroMvpScenarioActor(
      MICRO_MVP_SCENARIO_FIXTURE_IDS.sc03Sorcerer,
      'sorcerer',
    );
    const druid = bardicBoon(instantiateMicroMvpScenarioActor(
      MICRO_MVP_SCENARIO_FIXTURE_IDS.sc03Druid,
      'druid',
    ));
    const tape = createStrictRngTape([
      { label: 'failed Acid Splash save', sides: 20, value: 9 },
      { label: 'Bardic Inspiration recovery', sides: 6, value: 6 },
    ]);
    const session = new InMemoryRulesSession(createWorld({
      id: 'boon-after-save', ruleset: MICRO_MVP_SCENARIO_RULESET, actors: [sorcerer, druid],
    }), MICRO_MVP_SCENARIO_CATALOG, {
      rng: tape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('boon'),
    });
    const dispatch = (make: (revision: number) => GameCommand) => {
      const result = session.dispatch(make(session.getState().revision));
      expect(result.status).toBe('accepted');
      return result;
    };
    dispatch((revision) => command({
      schemaVersion: 1, type: 'StartEncounter', commandId: 'start', expectedRevision: revision,
      rulesetContentHash: MICRO_MVP_SCENARIO_RULESET.contentHash, actorId: 'sorcerer',
      initiative: ['sorcerer', 'druid'],
    }));
    dispatch((revision) => command({
      schemaVersion: 1, type: 'StartTurn', commandId: 'turn', expectedRevision: revision,
      rulesetContentHash: MICRO_MVP_SCENARIO_RULESET.contentHash, actorId: 'sorcerer',
    }));
    dispatch((revision) => command({
      schemaVersion: 1, type: 'UseAction', commandId: 'acid', expectedRevision: revision,
      rulesetContentHash: MICRO_MVP_SCENARIO_RULESET.contentHash, actorId: 'sorcerer',
      actionId: MICRO_MVP_SCENARIO_ACTION_IDS.acidSplash,
      targetIds: ['druid'], factsByTarget: { druid: MICRO_MVP_SCENARIO_FACTS.enemy(60) },
      spell: { baseLevel: 0 },
    }));
    const pending = session.getState().pendingResolution;
    if (!pending || pending.type !== 'target_save') throw new Error('Target save was not opened');
    dispatch((revision) => command({
      schemaVersion: 1, type: 'ResolveDecision', commandId: 'save', expectedRevision: revision,
      rulesetContentHash: MICRO_MVP_SCENARIO_RULESET.contentHash, actorId: 'druid',
      resolutionId: pending.id, requestId: pending.request.id,
      response: { kind: 'roll', roll: { mode: 'system' }, boonEffectId: 'boon:bardic' },
    }));
    tape.assertExhausted();
    expect(session.getState().actors.druid.runtime.activeEffects)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'boon:bardic' })]));
    expect(engineEvents(session.getEvents())).toContainEqual(expect.objectContaining({
      type: 'roll',
      roll: expect.objectContaining({
        total: 16,
        outcome: 'success',
        dice: expect.arrayContaining([
          { sides: 6, result: 6, source: 'Вдохновение барда', sign: 1 },
        ]),
      }),
    }));
  });
});
