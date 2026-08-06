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
import type {
  ActorState,
  RuleActionDefinition,
  UncommittedRuleEvent,
} from './domain';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';
import { migrateWorldState } from './worldMigration';

const MAGICAL_SLEEP: RuleActionDefinition = {
  id: 'test.rule.magical-sleep',
  name: 'Magical Sleep',
  kind: 'nonSpell',
  sourceEntityIds: ['test:magical-sleep'],
  mechanics: {
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    effects: [{
      resolution: 'auto',
      who: 'target',
      result: [{
        kind: 'condition',
        value: 'unconscious',
        causeTags: ['spell', 'magical', 'sleep'],
        duration: { type: 'rounds', amount: 10 },
      }],
    }],
  },
  targeting: {
    minTargets: 1,
    maxTargets: 1,
    rangeFt: 60,
    requiresLineOfSight: true,
    allowedRelations: ['enemy'],
  },
};

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function required<T>(value: T | undefined, description: string): T {
  if (value === undefined) throw new Error(`Missing Elf trait fixture: ${description}`);
  return value;
}

function engineEvents(events: readonly UncommittedRuleEvent[]) {
  return events.flatMap((entry) => (
    entry.payload.type === 'EngineEventRecorded' ? [entry.payload.event] : []
  ));
}

describe('compiled Elf Trance and magical-sleep immunity', () => {
  let provider: CompiledMicroMvpL1Provider;
  let elfRoot: CompiledMicroMvpL1Root;
  let humanRoot: CompiledMicroMvpL1Root;

  beforeAll(async () => {
    provider = await compileMicroMvpL1Overlay();
    elfRoot = required(provider.roots.find((root) => (
      root.matrixCase.species.card_number === 'RACE-0004'
    )), 'Elf root');
    humanRoot = required(provider.roots.find((root) => (
      root.matrixCase.species.card_number === 'RACE-0002'
    )), 'Human root');
  }, 60_000);

  function actor(root: CompiledMicroMvpL1Root, id: string): ActorState {
    const value = copy(root.actor);
    value.id = id;
    value.controllerId = `${id}:controller`;
    value.runtime.resources.action = 1;
    value.runtime.maxResources.action = 1;
    return value;
  }

  function session(actors: ActorState[]) {
    const initial = createWorld({
      id: 'elf-traits-world', ruleset: provider.ruleset, actors,
    });
    return {
      initial,
      session: new InMemoryRulesSession(initial, {
        getAction: (id) => id === MAGICAL_SLEEP.id ? MAGICAL_SLEEP : undefined,
      }, {
        rng: () => 0.5,
        clock: createLogicalClock(50_000),
        nextId: createSequentialIdFactory('elf-traits'),
      }),
    };
  }

  it('projects exact source-owned traits into every compiled Elf and no non-Elf', () => {
    const elves = provider.roots.filter((root) => (
      root.matrixCase.species.card_number === 'RACE-0004'
    ));
    expect(elves).toHaveLength(112);
    for (const root of elves) {
      expect(root.actor.traits).toEqual({
        conditionImmunities: [{
          condition: 'unconscious',
          requiredCauseTags: ['magical', 'sleep'],
          sourceEntityIds: expect.arrayContaining([
            root.matrixCase.species.id,
            root.matrixCase.species.card_number,
          ]),
        }],
        restProfile: {
          longRestHours: 4,
          sleepRequired: false,
          sourceEntityIds: [root.matrixCase.species.id, root.matrixCase.species.card_number],
        },
      });
    }
    expect(provider.roots.filter((root) => (
      root.matrixCase.species.card_number !== 'RACE-0004'
    )).every((root) => root.actor.traits === undefined)).toBe(true);
  });

  it('preserves valid Elf traits through migration and rejects forged trait state', () => {
    const elf = actor(elfRoot, 'elf');
    const world = createWorld({ id: 'elf-traits-migration', ruleset: provider.ruleset, actors: [elf] });
    const migrated = migrateWorldState(copy(world));
    expect(migrated.actors.elf.traits).toEqual({
      conditionImmunities: [{
        condition: 'unconscious',
        requiredCauseTags: ['magical', 'sleep'],
        sourceEntityIds: [...elf.traits!.conditionImmunities![0].sourceEntityIds].sort(),
      }],
      restProfile: {
        longRestHours: 4,
        sleepRequired: false,
        sourceEntityIds: [...elf.traits!.restProfile!.sourceEntityIds].sort(),
      },
    });

    const corrupt = [
      { conditionImmunities: [{ condition: '', sourceEntityIds: ['RACE-0004'] }] },
      { conditionImmunities: [{ condition: 'unconscious', sourceEntityIds: [] }] },
      { restProfile: { longRestHours: 0, sleepRequired: false, sourceEntityIds: ['RACE-0004'] } },
      { restProfile: { longRestHours: 4, sleepRequired: 'no', sourceEntityIds: ['RACE-0004'] } },
    ];
    for (const traits of corrupt) {
      const value = copy(world) as unknown as {
        actors: Record<string, { traits: unknown }>;
      };
      value.actors.elf.traits = traits;
      expect(() => migrateWorldState(value)).toThrow();
    }
  });

  it('blocks only tagged magical sleep on an Elf and applies the same condition to a Human', () => {
    for (const targetKind of ['elf', 'human'] as const) {
      const caster = actor(humanRoot, `caster-${targetKind}`);
      caster.capabilities.actionIds.push(MAGICAL_SLEEP.id);
      const target = actor(targetKind === 'elf' ? elfRoot : humanRoot, targetKind);
      const test = session([caster, target]);
      const result = test.session.dispatch({
        schemaVersion: 1,
        type: 'UseAction',
        commandId: `elf-traits:sleep:${targetKind}`,
        expectedRevision: 0,
        rulesetContentHash: provider.ruleset.contentHash,
        actorId: caster.id,
        actionId: MAGICAL_SLEEP.id,
        targetIds: [target.id],
        factsByTarget: {
          [target.id]: {
            factsSource: 'scenario', boardRevision: 1, distanceFt: 30,
            lineOfSight: true, cover: 'none', relation: 'enemy',
          },
        },
      });

      if (result.status !== 'accepted') throw new Error(`${result.code}: ${result.message}`);
      const effects = test.session.getState().actors[target.id].runtime.activeEffects;
      if (targetKind === 'elf') {
        expect(effects.some((effect) => (
          (effect.mechanics as { value?: string }).value === 'unconscious'
        ))).toBe(false);
        expect(engineEvents(result.events)).toContainEqual({
          type: 'condition_immune',
          condition: 'unconscious',
          sourceEntityIds: target.traits!.conditionImmunities![0].sourceEntityIds,
        });
      } else {
        expect(effects).toContainEqual(expect.objectContaining({
          mechanics: expect.objectContaining({ kind: 'condition', value: 'unconscious' }),
        }));
        expect(engineEvents(result.events)).toContainEqual({
          type: 'condition_applied', condition: 'unconscious',
        });
      }
      expect(foldEvents(copy(test.initial), copy(test.session.getEvents())))
        .toEqual(test.session.getState());
    }
  });

  it('accepts a four-hour Elf Trance without shortening the Human Long Rest', () => {
    const elf = actor(elfRoot, 'elf');
    const human = actor(humanRoot, 'human');
    elf.runtime.resources.reaction = 0;
    human.runtime.resources.reaction = 0;
    const test = session([elf, human]);

    const trance = test.session.dispatch({
      schemaVersion: 1,
      type: 'TakeLongRest',
      commandId: 'elf-traits:trance',
      expectedRevision: 0,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: elf.id,
      durationHours: 4,
    });
    if (trance.status !== 'accepted') throw new Error(`${trance.code}: ${trance.message}`);
    expect(test.session.getState().actors.elf.runtime.resources.reaction).toBe(1);
    expect(trance.events.some((event) => (
      event.obligationIds.includes('system:rest-duration')
        && event.obligationIds.includes(`entity:${elfRoot.matrixCase.species.id}`)
    ))).toBe(true);

    const beforeHumanAttempt = copy(test.session.getState());
    const ordinary = test.session.dispatch({
      schemaVersion: 1,
      type: 'TakeLongRest',
      commandId: 'elf-traits:human-four-hours',
      expectedRevision: test.session.getState().revision,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: human.id,
      durationHours: 4,
    });
    expect(ordinary).toMatchObject({ status: 'rejected', code: 'InvalidFacts' });
    expect(test.session.getState()).toEqual(beforeHumanAttempt);
    expect(test.session.getState().actors.human.runtime.resources.reaction).toBe(0);
    expect(foldEvents(copy(test.initial), copy(test.session.getEvents())))
      .toEqual(test.session.getState());
  });
});
