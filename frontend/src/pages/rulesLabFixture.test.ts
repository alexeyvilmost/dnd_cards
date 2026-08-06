import { describe, expect, it, vi } from 'vitest';
import type { ActorState } from '../rules-core/domain';
import {
  RULES_LAB_BASELINE_SESSION_CONFIG,
  RULES_LAB_BLADE_SESSION_CONFIG,
  RULES_LAB_CHAIN_SESSION_CONFIG,
  RULES_LAB_FAMILIAR_SESSION_CONFIG,
  RULES_LAB_TOME_SESSION_CONFIG,
  assertRulesLabScenarioWorld,
  createRulesLabWorld,
  rulesLabDependenciesForScenario,
  type RulesLabScenarioSessionConfig,
  type RulesLabSessionAdapter,
} from './rulesLabFixture';
import {
  RULES_LAB_BASELINE_SCENARIO,
  RULES_LAB_BLADE_SCENARIO,
  findRulesLabScenario,
  rulesLabScenarioCommandIssue,
} from './rulesLabScenarioRegistry';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function familiarProjection(id: string, owner: ActorState): ActorState {
  const actor = clone(owner);
  actor.id = id;
  actor.name = 'Canonical familiar projection';
  actor.kind = 'summonedActor';
  actor.familiarState = {
    actorId: id,
    ownerActorId: owner.id,
  } as ActorState['familiarState'];
  actor.familiarMetadata = {
    summoningActionId: owner.capabilities.actionIds[0],
  } as ActorState['familiarMetadata'];
  return actor;
}

describe('Rules Lab scenario boundary', () => {
  it('registers every explicit path and fails closed for unknown ids', () => {
    expect(findRulesLabScenario(undefined)).toBe(RULES_LAB_BASELINE_SCENARIO);
    expect(findRulesLabScenario('baseline')).toBe(RULES_LAB_BASELINE_SCENARIO);
    expect(findRulesLabScenario('blade')).toBe(RULES_LAB_BLADE_SCENARIO);
    expect(findRulesLabScenario('not-registered')).toBeUndefined();
  });

  it('builds every scenario with exactly two PCs and no implicit summoned actor', () => {
    const scenarios = [
      RULES_LAB_BASELINE_SESSION_CONFIG,
      RULES_LAB_BLADE_SESSION_CONFIG,
      RULES_LAB_CHAIN_SESSION_CONFIG,
      RULES_LAB_TOME_SESSION_CONFIG,
      RULES_LAB_FAMILIAR_SESSION_CONFIG,
    ];
    for (const scenario of scenarios) {
      const world = scenario.createWorld();
      expect(() => assertRulesLabScenarioWorld(world, scenario)).not.toThrow();
      expect(Object.values(world.actors).filter((actor) => actor.kind === 'playerCharacter'))
        .toHaveLength(2);
      expect(Object.values(world.actors).filter((actor) => actor.kind === 'summonedActor'))
        .toHaveLength(0);
    }
    const tome = RULES_LAB_TOME_SESSION_CONFIG.createWorld();
    expect(tome.actors['tome-warlock'].warlockPacts?.tome?.tome.bookObjectId).toBeTruthy();
    expect(Object.values(tome.objects)).toHaveLength(1);
  });

  it('fails closed when a required immutable action or weapon Card is absent', () => {
    expect(rulesLabScenarioCommandIssue(RULES_LAB_BLADE_SCENARIO)).toBeNull();
    expect(rulesLabScenarioCommandIssue({
      ...RULES_LAB_BLADE_SCENARIO,
      catalog: { getAction: () => undefined, getCard: RULES_LAB_BLADE_SCENARIO.catalog.getCard },
    })).toMatch(/misses required action/);
    expect(rulesLabScenarioCommandIssue({
      ...RULES_LAB_BLADE_SCENARIO,
      catalog: { getAction: RULES_LAB_BLADE_SCENARIO.catalog.getAction },
    })).toMatch(/misses required weapon Card/);
  });

  it('requires exactly the two configured PCs and rejects arbitrary third actors', () => {
    const valid = createRulesLabWorld();
    expect(() => assertRulesLabScenarioWorld(
      valid,
      RULES_LAB_BASELINE_SESSION_CONFIG,
    )).not.toThrow();

    const thirdPc = clone(valid);
    thirdPc.actors.intruder = {
      ...clone(thirdPc.actors.fighter),
      id: 'intruder',
      controllerId: 'controller:intruder',
    };
    expect(() => assertRulesLabScenarioWorld(
      thirdPc,
      RULES_LAB_BASELINE_SESSION_CONFIG,
    )).toThrow(/ровно два playerCharacter/);

    const arbitrarySummon = clone(valid);
    arbitrarySummon.actors.pet = {
      ...clone(arbitrarySummon.actors.fighter),
      id: 'pet',
      kind: 'summonedActor',
    };
    expect(() => assertRulesLabScenarioWorld(
      arbitrarySummon,
      RULES_LAB_BASELINE_SESSION_CONFIG,
    )).toThrow(/канонического фамильяра/);
  });

  it('keeps one migration-validated familiar outside the configured PC pair', () => {
    const withFamiliar = createRulesLabWorld();
    withFamiliar.actors.familiar = familiarProjection('familiar', withFamiliar.actors.wizard);

    expect(() => assertRulesLabScenarioWorld(
      withFamiliar,
      RULES_LAB_BASELINE_SESSION_CONFIG,
    )).not.toThrow();

    withFamiliar.actors['second-familiar'] = familiarProjection(
      'second-familiar',
      withFamiliar.actors.wizard,
    );
    expect(() => assertRulesLabScenarioWorld(
      withFamiliar,
      RULES_LAB_BASELINE_SESSION_CONFIG,
    )).toThrow(/больше одного призванного/);
  });

  it('binds reset to the selected exact world and leaves a neighboring world untouched', async () => {
    const neighbor: RulesLabScenarioSessionConfig = {
      ...RULES_LAB_BASELINE_SESSION_CONFIG,
      worldId: 'rules-lab:neighbor-world',
    };
    const worlds = new Set([
      RULES_LAB_BASELINE_SESSION_CONFIG.worldId,
      neighbor.worldId,
    ]);
    const events = new Map([
      [RULES_LAB_BASELINE_SESSION_CONFIG.worldId, ['baseline:event']],
      [neighbor.worldId, ['neighbor:event']],
    ]);
    const reset = vi.fn(async (scenario: RulesLabScenarioSessionConfig) => {
      worlds.delete(scenario.worldId);
      events.delete(scenario.worldId);
    });
    const adapter: RulesLabSessionAdapter = {
      open: async () => {
        throw new Error('reset isolation does not open a session');
      },
      reset,
    };
    const dependencies = rulesLabDependenciesForScenario(
      RULES_LAB_BASELINE_SESSION_CONFIG,
      adapter,
    );

    await dependencies.reset();

    expect(reset).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledWith(RULES_LAB_BASELINE_SESSION_CONFIG);
    expect(worlds.has(RULES_LAB_BASELINE_SESSION_CONFIG.worldId)).toBe(false);
    expect(events.has(RULES_LAB_BASELINE_SESSION_CONFIG.worldId)).toBe(false);
    expect(worlds.has(neighbor.worldId)).toBe(true);
    expect(events.get(neighbor.worldId)).toEqual(['neighbor:event']);
  });
});
