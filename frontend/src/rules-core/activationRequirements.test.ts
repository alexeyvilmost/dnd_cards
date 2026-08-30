import { describe, expect, it } from 'vitest';
import type { ActorState, GameCommand, RuleActionDefinition, RulesCatalog } from './domain';
import { createWorld } from './domain';
import { createLogicalClock, createSequentialIdFactory, createStrictRngTape } from './determinism';
import { handleCommand } from './handler';
import {
  meetsActivationLevelRequirement,
  parseActivationLevelRequirement,
} from './activationRequirements';

const LEVEL_FIVE_ACTION: RuleActionDefinition = {
  id: 'test:level-five-action',
  name: 'Level Five Action',
  kind: 'nonSpell',
  sourceEntityIds: ['test:level-five-effect'],
  mechanics: {
    activation: {
      mode: 'active',
      cost: [{ resource: 'action', amount: 1 }],
      requirements: [{ type: 'level', min_level: 5 }],
    },
    effects: [{
      resolution: 'auto',
      result: [{ kind: 'narrative', description: 'Level-gated action executed.' }],
    }],
  },
};

function actor(level: number): ActorState {
  return {
    id: `actor:level-${level}`,
    name: `Level ${level}`,
    kind: 'playerCharacter',
    controllerId: 'test-controller',
    capabilities: { actionIds: [LEVEL_FIVE_ACTION.id] },
    character: {
      abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      profBonus: 2,
      level,
      characterSpeed: 30,
    },
    runtime: {
      hp: { current: 10, max: 10, temp: 0 },
      resources: { action: 1, bonus_action: 1, reaction: 1 },
      maxResources: { action: 1, bonus_action: 1, reaction: 1 },
      equipment: {},
      inventory: [],
      activeEffects: [],
      firedThisTurn: [],
      firedThisRest: [],
    },
    passives: [],
  };
}

describe('activation character-level requirements', () => {
  it('uses the strictest declared level gate and rejects malformed level rows', () => {
    expect(parseActivationLevelRequirement({
      activation: {
        requirements: [
          { type: 'level', min_level: 3 },
          { type: 'lineage', value: 'goliath' },
          { type: 'level', min_level: 5 },
        ],
      },
    })).toEqual({ status: 'required', minLevel: 5 });
    expect(meetsActivationLevelRequirement(LEVEL_FIVE_ACTION.mechanics, 1)).toBe(false);
    expect(meetsActivationLevelRequirement(LEVEL_FIVE_ACTION.mechanics, 5)).toBe(true);
    expect(parseActivationLevelRequirement({
      activation: { requirements: [{ type: 'level', min_level: '5' }] },
    })).toMatchObject({ status: 'invalid' });
  });

  it('rejects an owned level-5 action authoritatively for a persisted level-1 actor', () => {
    const levelOne = actor(1);
    const ruleset = {
      systemId: 'dnd5e-2024' as const,
      releaseId: 'test-release',
      contentHash: 'test:level-gate',
      errataVersion: '2024',
    };
    const world = createWorld({ id: 'test:level-gate-world', ruleset, actors: [levelOne] });
    const catalog: RulesCatalog = { getAction: (id) => id === LEVEL_FIVE_ACTION.id ? LEVEL_FIVE_ACTION : undefined };
    const tape = createStrictRngTape([]);
    const result = handleCommand(world, {
      schemaVersion: 1,
      type: 'UseAction',
      commandId: 'test:level-one-attempt',
      expectedRevision: world.revision,
      rulesetContentHash: ruleset.contentHash,
      actorId: levelOne.id,
      actionId: LEVEL_FIVE_ACTION.id,
      targetIds: [],
    } satisfies GameCommand, catalog, {
      rng: tape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('level-gate'),
    });

    expect(result).toMatchObject({
      status: 'rejected',
      code: 'InvalidActionTiming',
      message: `${LEVEL_FIVE_ACTION.id} requires character level 5`,
    });
    expect(world.actors[levelOne.id].runtime.resources.action).toBe(1);
    tape.assertExhausted();
  });
});
