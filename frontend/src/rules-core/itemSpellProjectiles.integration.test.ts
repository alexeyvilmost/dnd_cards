import { describe, expect, it } from 'vitest';
import { createWorld, type ActorState, type GameCommand, type RuleActionDefinition } from './domain';
import { createLogicalClock, createSequentialIdFactory, createStrictRngTape } from './determinism';
import { InMemoryRulesSession } from './session';
import { managedWorldSpellMechanics } from './testing/worldSpellPolicyFixtures';
import { applyItemSpellProjectiles } from '../engine/itemSpellProjectiles';
const ruleset = { systemId: 'dnd5e-2024' as const, releaseId: 'darts', contentHash: 'darts', errataVersion: '2024' };
function actor(id: string): ActorState { return { id, name: id, kind: 'playerCharacter', controllerId: id, ac: 10, capabilities: { actionIds: id === 'caster' ? ['spell'] : [] },
  character: { level: 5, profBonus: 3, abilityMods: { str: 0, dex: 0, con: 0, int: 3, wis: 0, cha: 0 } },
  runtime: { hp: { current: 100, max: 100, temp: 0 }, resources: { action: 1, spell_slot_1: 1 }, maxResources: { action: 1, spell_slot_1: 1 }, inventory: [], equipment: {}, activeEffects: [] } }; }
describe('item projectile counts use the canonical cast', () => {
  it.each([1, 2])('adds %i projectiles to the picker and execution, preserving one slot and canonical per-dart rolls', bonus => {
    const source = actor('caster'); source.passives = [{ effects: [{ resolution: 'auto', result: [{ kind: 'spell_projectiles', spell_refs: ['spell'], add: bonus }] }] }];
    const mechanics = { ...managedWorldSpellMechanics('magic_missile'), activation: { mode: 'active', cost: [{ resource: 'action' }, { resource: 'spell_slot', level: 1, amount: 1 }] }, effects: [] };
    const action: RuleActionDefinition = { id: 'spell', name: 'Missiles', kind: 'spell', sourceEntityIds: ['spell'], spell: { level: 1, sourceClass: 'wizard', components: { verbal: true, somatic: true, material: false } }, mechanics,
      targeting: { rangeFt: 120, minTargets: 1, maxTargets: 11, allowedRelations: ['enemy'], requiresLineOfSight: true } };
    const projected = applyItemSpellProjectiles(mechanics, ['spell'], source.passives);
    expect((projected.primitive as {policy: {base_dart_count: number}}).policy.base_dart_count).toBe(3 + bonus);
    expect(applyItemSpellProjectiles(mechanics, ['other'], source.passives)).toBe(mechanics);
    const tape = createStrictRngTape(Array.from({length:3+bonus},(_,index)=>({sides:4,value:2,label:`dart-${index}`})));
    const env = { rng: tape.rng, clock: createLogicalClock(), nextId: createSequentialIdFactory('darts') }, catalog = { getAction: (id: string) => id === action.id ? action : undefined };
    const session = new InMemoryRulesSession(createWorld({ id: 'darts', ruleset, actors: [source, actor('target')] }), catalog, env);
    const command = { schemaVersion: 1, type: 'UseAction', commandId: 'cast', expectedRevision: 0, rulesetContentHash: ruleset.contentHash, actorId: 'caster', actionId: 'spell', targetIds: ['target'],
      choices: { magic_missile_dart_targets: Array(3 + bonus).fill('target') }, spell: { baseLevel: 1, castLevel: 1, sourceClass: 'wizard' },
      factsByTarget: { target: { factsSource: 'board', boardRevision: 1, distanceFt: 30, lineOfSight: true, canSeeTarget: true, cover: 'none', relation: 'enemy' } } } as GameCommand;
    const result = session.dispatch(command); if (result.status === 'rejected') throw Error(`${result.code}: ${result.message}`);
    expect(session.getState().actors.target.runtime.hp.current).toBe(100 - (3 + bonus) * 3);
    expect(session.getState().actors.caster.runtime.resources).toMatchObject({ action: 0, spell_slot_1: 0 });
    const reloaded = new InMemoryRulesSession(JSON.parse(JSON.stringify(session.getState())), catalog, env), before = reloaded.getState();
    expect(reloaded.dispatch(command).status).toBe('rejected'); expect(reloaded.getState()).toEqual(before); tape.assertExhausted();
  });
});
