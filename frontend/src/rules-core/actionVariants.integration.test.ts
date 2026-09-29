import { describe, expect, it } from 'vitest';
import { createWorld, type ActorState, type GameCommand, type RuleActionDefinition } from './domain';
import { createSequentialIdFactory, createStrictRngTape } from './determinism';
import { handleCommand } from './handler';
import { foldEvents } from './reducer';

const ruleset = { systemId: 'dnd5e-2024' as const, releaseId: 'action-variants', contentHash: 'action-variants', errataVersion: '2024' };
const activation = { mode: 'active', cost: [{ resource: 'action', amount: 1 }] };
const targeting = { domain: 'actor', shape: 'self', actor_targets: false, range_ft: 0, min_targets: 0, max_targets: 0, allowed_relations: ['self'], requires_line_of_sight: false };
const parent: RuleActionDefinition = {
  id: 'parent-action', name: 'Choose an action', kind: 'nonSpell', sourceEntityIds: ['parent-action'],
  mechanics: { activation, targeting, action_variant_ids: ['heal-small', 'heal-large'], effects: [] },
};
function variant(id: string, amount: number): RuleActionDefinition {
  return {
    id, name: id, kind: 'nonSpell', sourceEntityIds: [id],
    mechanics: { activation, targeting, variant_of_action_id: parent.id,
      effects: [{ resolution: 'auto', who: 'self', result: [{ kind: 'healing', amount }] }] },
  };
}
const small = variant('heal-small', 2);
const large = variant('heal-large', 4);
const catalog = { getAction: (id: string) => [parent, small, large].find(action => action.id === id) };
function hero(): ActorState {
  return {
    id: 'hero', name: 'Hero', kind: 'playerCharacter', controllerId: 'hero', ac: 10,
    capabilities: { actionIds: [parent.id] },
    character: { level: 3, profBonus: 2, abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } },
    runtime: { hp: { current: 5, max: 10, temp: 0 }, resources: { action: 1 }, maxResources: { action: 1 }, inventory: [], equipment: {}, activeEffects: [] },
  };
}
function use(id: string): GameCommand {
  return { schemaVersion: 1, type: 'UseAction', commandId: `use:${id}`, actorId: 'hero', expectedRevision: 0, rulesetContentHash: ruleset.contentHash, actionId: id, targetIds: [] };
}

describe('action variants require the owned parent', () => {
  it.each([[small, 2], [large, 4]] as const)('executes %s through its parent once', (child, healing) => {
    const world = createWorld({ id: child.id, ruleset, actors: [hero()] });
    const tape = createStrictRngTape([]);
    const env = { rng: tape.rng, nextId: createSequentialIdFactory('variant'), clock: () => 1 };
    expect(handleCommand(world, use(parent.id), catalog, env)).toMatchObject({ status: 'rejected', code: 'InvalidDecision' });
    const result = handleCommand(world, use(child.id), catalog, env);
    if (result.status !== 'accepted') throw Error(`${result.code}: ${result.message}`);
    expect(foldEvents(world, result.events)).toEqual(result.nextState);
    expect(result.nextState.actors.hero.runtime.hp.current).toBe(5 + healing);
    expect(result.nextState.actors.hero.runtime.resources.action).toBe(0);
    expect(handleCommand(result.nextState, use(child.id), catalog, env).status).toBe('rejected');
    tape.assertExhausted();
  });

  it('rejects unlisted children and direct child ownership without the parent', () => {
    const foreign = variant('heal-foreign', 3);
    const world = createWorld({ id: 'foreign', ruleset, actors: [hero()] });
    const env = { rng: () => { throw Error('No RNG'); }, nextId: createSequentialIdFactory('foreign'), clock: () => 1 };
    expect(handleCommand(world, use(foreign.id), { getAction: (id: string) => id === foreign.id ? foreign : catalog.getAction(id) }, env))
      .toMatchObject({ status: 'rejected', code: 'InvalidActionDefinition' });
    world.actors.hero.capabilities.actionIds = [small.id];
    expect(handleCommand(world, use(small.id), catalog, env)).toMatchObject({ status: 'rejected', code: 'ActionNotGranted' });
  });
});
