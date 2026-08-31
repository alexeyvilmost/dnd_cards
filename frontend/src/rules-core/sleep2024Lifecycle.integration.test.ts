import { describe, expect, it } from 'vitest';
import type {
  AcceptedCommand,
  ActorState,
  GameCommand,
  RuleActionDefinition,
  RulesCatalog,
  UncommittedRuleEvent,
} from './domain';
import { createWorld } from './domain';
import { createLogicalClock, createSequentialIdFactory } from './determinism';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';

type Dict = Record<string, unknown>;

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'sleep-2024-lifecycle@1',
  contentHash: 'sha256:sleep-2024-lifecycle',
  errataVersion: 'phb-2024-errata-v1',
};

const SLEEP: RuleActionDefinition = {
  id: 'SPELL-0311',
  name: 'Усыпление',
  kind: 'nonSpell',
  concentration: true,
  sourceEntityIds: ['0f81f3e2-ff95-4629-9292-e81332a57282'],
  mechanics: {
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    effects: [{
      resolution: 'save',
      who: 'target',
      ability: 'wis',
      dc: '8+prof+spellcasting',
      automatic_success: {
        if_sleep_not_required: true,
        if_condition_immunity: 'exhaustion',
      },
      on_fail: [{
        kind: 'condition',
        value: 'incapacitated',
        op: 'apply',
        duration: { type: 'rounds', amount: 10, concentration: true },
        causeTags: ['spell', 'magical', 'sleep'],
        end_triggers: ['actor_takes_damage', 'wake_action_within_5_ft'],
        save_ends: {
          timing: 'end_of_turn',
          ability: 'wis',
          dc: '8+prof+spellcasting',
          on_failure_condition: 'unconscious',
        },
      }],
      on_success: [],
    }],
  },
  targeting: {
    minTargets: 1,
    maxTargets: 4,
    rangeFt: 60,
    requiresLineOfSight: true,
    allowedRelations: ['enemy'],
  },
};

const catalog: RulesCatalog = {
  getAction: (id) => id === SLEEP.id ? SLEEP : undefined,
};

function actor(id: string, kind: ActorState['kind']): ActorState {
  return {
    id,
    name: id,
    kind,
    controllerId: `${id}:controller`,
    ac: 12,
    capabilities: { actionIds: id === 'caster' ? [SLEEP.id] : [] },
    character: {
      abilityMods: { str: 0, dex: 0, con: 0, int: 3, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
      spellcastingMod: id === 'caster' ? 3 : 0,
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
  };
}

function harness(target: ActorState | ActorState[]) {
  const targets = Array.isArray(target) ? target : [target];
  const initial = createWorld({
    id: 'sleep-lifecycle',
    ruleset: RULESET,
    actors: [actor('caster', 'playerCharacter'), ...targets],
  });
  return {
    initial,
    session: new InMemoryRulesSession(initial, catalog, {
      rng: () => 0,
      clock: createLogicalClock(90_000),
      nextId: createSequentialIdFactory('sleep-lifecycle'),
    }),
  };
}

function accepted(
  session: InMemoryRulesSession,
  command: Record<string, unknown>,
): AcceptedCommand {
  const result = session.dispatch({
    schemaVersion: 1,
    expectedRevision: session.getState().revision,
    rulesetContentHash: RULESET.contentHash,
    ...command,
  } as GameCommand);
  if (result.status !== 'accepted') throw new Error(`${result.code}: ${result.message}`);
  return result;
}

function engineEvents(events: readonly UncommittedRuleEvent[]) {
  return events.flatMap((entry) => (
    entry.payload.type === 'EngineEventRecorded' ? [entry.payload.event] : []
  ));
}

function useSleep(
  session: InMemoryRulesSession,
  targetIds: string[] = ['target'],
): AcceptedCommand {
  return accepted(session, {
    type: 'UseAction',
    commandId: 'cast-sleep',
    actorId: 'caster',
    actionId: SLEEP.id,
    targetIds,
    factsByTarget: Object.fromEntries(targetIds.map((targetId) => [
      targetId,
      {
        factsSource: 'scenario', boardRevision: 1, distanceFt: 30,
        lineOfSight: true, cover: 'none', relation: 'enemy',
      },
    ])),
  });
}

describe('canonical Sleep 2024 encounter lifecycle', () => {
  it('survives the target start and transitions only after its failed end-turn repeat save', () => {
    const test = harness(actor('target', 'monster'));
    useSleep(test.session);
    const pending = test.session.getState().pendingResolution;
    if (!pending || pending.type !== 'target_save') throw new Error('Expected initial Sleep target save');
    accepted(test.session, {
      type: 'ResolveDecision',
      commandId: 'sleep-initial-fail',
      actorId: 'target',
      resolutionId: pending.id,
      requestId: pending.request.id,
      response: { kind: 'roll', roll: { mode: 'manual', dice: [{ sides: 20, value: 1 }] } },
    });
    expect(test.session.getState().actors.target.runtime.activeEffects[0]).toMatchObject({
      roundsLeft: 10,
      mechanics: { value: 'incapacitated', save_ends: { dc: 13 } },
    });

    accepted(test.session, {
      type: 'StartEncounter', commandId: 'start-encounter', actorId: 'caster',
      initiative: ['target', 'caster'],
    });
    accepted(test.session, { type: 'StartTurn', commandId: 'target-start', actorId: 'target' });
    expect(test.session.getState().actors.target.runtime.activeEffects[0]).toMatchObject({
      roundsLeft: 9,
      mechanics: { value: 'incapacitated' },
    });

    const ended = accepted(test.session, {
      type: 'EndTurn', commandId: 'target-end', actorId: 'target',
    });
    expect(test.session.getState().actors.target.runtime.activeEffects[0]).toMatchObject({
      roundsLeft: 9,
      mechanics: { value: 'unconscious' },
    });
    expect((test.session.getState().actors.target.runtime.activeEffects[0].mechanics as Dict).save_ends)
      .toBeUndefined();
    expect(engineEvents(ended.events)).toContainEqual({
      type: 'condition_applied', condition: 'unconscious',
    });
    expect(foldEvents(test.initial, test.session.getEvents())).toEqual(test.session.getState());
  });

  it('does not open a save decision for an Elf-style no-sleep target', () => {
    const target = actor('target', 'monster');
    target.traits = {
      conditionImmunities: [{
        condition: 'unconscious',
        requiredCauseTags: ['magical', 'sleep'],
        sourceEntityIds: ['RACE-0004'],
      }],
      restProfile: {
        longRestHours: 4,
        sleepRequired: false,
        sourceEntityIds: ['RACE-0004'],
      },
    };
    const test = harness(target);
    const result = useSleep(test.session);
    expect(test.session.getState().pendingResolution).toBeNull();
    expect(test.session.getState().actors.target.runtime.activeEffects).toHaveLength(0);
    expect(engineEvents(result.events)).toContainEqual(expect.objectContaining({
      type: 'narrative', text: expect.stringContaining('автоуспех'),
    }));
    expect(foldEvents(test.initial, test.session.getEvents())).toEqual(test.session.getState());
  });

  it('records an automatic success without asking that target to roll in a mixed area', () => {
    const elf = actor('elf', 'monster');
    elf.traits = {
      restProfile: {
        longRestHours: 4,
        sleepRequired: false,
        sourceEntityIds: ['RACE-0004'],
      },
    };
    const goblin = actor('goblin', 'monster');
    const test = harness([elf, goblin]);
    const result = useSleep(test.session, ['elf', 'goblin']);
    const pending = test.session.getState().pendingResolution;
    if (!pending || pending.type !== 'target_save') throw new Error('Expected Goblin save');
    expect(pending.targetActorId).toBe('goblin');
    expect(pending.resolvedTargetIds).toEqual(['elf']);
    expect(pending.remainingTargets).toEqual([]);
    expect(engineEvents(result.events)).toContainEqual(expect.objectContaining({
      type: 'narrative', text: expect.stringContaining('автоуспех'),
    }));

    accepted(test.session, {
      type: 'ResolveDecision', commandId: 'mixed-sleep-goblin-fail', actorId: 'goblin',
      resolutionId: pending.id, requestId: pending.request.id,
      response: { kind: 'roll', roll: { mode: 'manual', dice: [{ sides: 20, value: 1 }] } },
    });
    expect(test.session.getState().actors.elf.runtime.activeEffects).toHaveLength(0);
    expect(test.session.getState().actors.goblin.runtime.activeEffects[0]).toMatchObject({
      mechanics: { value: 'incapacitated' },
    });
    expect(foldEvents(test.initial, test.session.getEvents())).toEqual(test.session.getState());
  });
});
