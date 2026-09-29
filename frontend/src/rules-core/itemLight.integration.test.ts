import { describe, expect, it } from 'vitest';
import { createWorld, type ActorState, type GameCommand, type RuleActionDefinition } from './domain';
import { createLogicalClock, createSequentialIdFactory, createStrictRngTape } from './determinism';
import { InMemoryRulesSession } from './session';
import { advanceWorldObjectRounds } from './worldObjects';
import { illuminationAt } from '../solo-combat/combatIllumination';
import { spatialFacts, type SoloCombatState } from '../solo-combat/types';
import { projectCombatAuras } from '../solo-combat/combatAuras';
import { evaluateCondition } from '../engine/circumstances';
const ruleset = { systemId: 'dnd5e-2024' as const, releaseId: 'light', contentHash: 'light', errataVersion: '2024' };
const actor = (id = 'owner'): ActorState => ({ id, name: id, kind: 'playerCharacter', controllerId: id, ac: 10, capabilities: { actionIds: ['ignite'] }, passives: [],
  character: { level: 1, profBonus: 2, abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } },
  runtime: { hp: { current: 10, max: 10, temp: 0 }, resources: { action: 1 }, maxResources: { action: 1 }, inventory: [{ cardId: 'lamp', qty: 1 }, { cardId: 'oil', qty: 2 }], equipment: {}, activeEffects: [] } });
describe('canonical item illumination', () => {
  it.each([{ bright: 0, dim: 5, duration: 600 }, { bright: 20, dim: 20, duration: 2 }])('persists and expires $bright/$dim item light, spending canonical fuel exactly once', ({ bright, dim, duration }) => {
    const action: RuleActionDefinition = { id: 'ignite', name: 'Зажечь', kind: 'nonSpell', sourceEntityIds: ['lamp'], mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }, { resource: 'item', card_id: 'oil', amount: 1 }] },
      primitive: { type: 'item_light', policy: { item_card_id: 'lamp', bright_radius_ft: bright, dim_additional_radius_ft: dim, duration_rounds: duration } }, effects: [],
    } };
    const tape = createStrictRngTape([]), env = { rng: tape.rng, clock: createLogicalClock(), nextId: createSequentialIdFactory('light') };
    const catalog = { getAction: (id: string) => id === action.id ? action : undefined };
    const session = new InMemoryRulesSession(createWorld({ id: 'light', ruleset, actors: [actor()] }), catalog, env);
    const command = { schemaVersion: 1, expectedRevision: 0, rulesetContentHash: 'light', actorId: 'owner', type: 'UseAction', commandId: 'ignite', actionId: 'ignite', targetIds: [] } as GameCommand;
    const result = session.dispatch(command); if (result.status === 'rejected') throw Error(`${result.code}: ${result.message}`);
    const persisted = JSON.parse(JSON.stringify(session.getState())), reload = new InMemoryRulesSession(persisted, catalog, env);
    expect(persisted.actors.owner.runtime.inventory.find((x: {cardId: string}) => x.cardId === 'oil').qty).toBe(1);
    const object = Object.values(reload.getState().objects)[0];
    expect(object).toMatchObject({ itemCardId: 'lamp', carriedByActorId: 'owner', illumination: { brightRadiusFt: bright, dimAdditionalRadiusFt: dim, roundsLeft: duration } });
    expect(reload.dispatch(command).status).toBe('rejected'); expect(reload.getState()).toEqual(persisted); tape.assertExhausted();
    expect(advanceWorldObjectRounds({ objects: persisted.objects, rounds: duration }).objects[object.id].illumination).toBeUndefined();
  });
  it('projects constant daylight and magical darkness into actual sight, current predicates and reload', () => {
    const owner = actor(), target = actor('target');
    const world = createWorld({ id: 'light', ruleset, actors: [owner, target] });
    const state = { world, tokens: { owner: { actorId: 'owner', position: { x: 0, y: 0 } }, target: { actorId: 'target', position: { x: 2, y: 0 } } }, boardRevision: 4,
      combatAreas: {}, sideByActorId: {}, battleMap: { id: 'dark', features: [], ambientLight: 'dark' }, worldObjectPositions: {} } as unknown as SoloCombatState;
    expect(spatialFacts(state, 'owner', 'target').canSeeTarget).toBe(false);
    world.actors.owner.passives = [{ effects: [{ resolution: 'auto', result: [{ kind: 'illumination', bright_radius_ft: 15, dim_additional_radius_ft: 15, daylight: true }] }] }];
    const projected = projectCombatAuras(state);
    expect(spatialFacts(projected, 'owner', 'target').canSeeTarget).toBe(true);
    expect(projected.world.actors.target.character.illumination).toMatchObject({ level: 'bright', daylight: true });
    expect(evaluateCondition({ kind: 'target_illuminated' }, { target: { characterContext: projected.world.actors.target.character } as never })).toBe(true);
    expect(projectCombatAuras(JSON.parse(JSON.stringify(projected)))).toEqual(projected);
    world.actors.target.passives = [{ effects: [{ resolution: 'auto', result: [{ kind: 'illumination', darkness_radius_ft: 15, magical: true }] }] }];
    expect(spatialFacts(state, 'owner', 'target').canSeeTarget).toBe(false);
    expect(illuminationAt(state, { x: 2, y: 0 })).toMatchObject({ level: 'dark', magicalDarkness: true });
  });
  it('uses the dropped lamp position, opaque covers and saved cone direction', () => {
    const world = createWorld({ id: 'light', ruleset, actors: [actor()] });
    world.objects.lamp = { id: 'lamp', name: 'Lamp', kind: 'item', size: 'tiny', illumination: { id: 'light', sourceActorId: 'owner', sourceActionId: 'lamp', brightRadiusFt: 30, dimAdditionalRadiusFt: 30, roundsLeft: null, shape: 'cone', facing: 'e' } };
    const state = { world, tokens: { owner: { actorId: 'owner', position: { x: 10, y: 10 } } }, worldObjectPositions: { lamp: { x: 0, y: 0 } }, boardRevision: 1, battleMap: { features: [], ambientLight: 'dark' } } as unknown as SoloCombatState;
    expect(illuminationAt(state, { x: 3, y: 0 }).level).toBe('bright');
    expect(illuminationAt(state, { x: 0, y: 3 }).level).toBe('dark');
    world.objects.lamp.coveredByOpaqueObject = true;
    expect(illuminationAt(state, { x: 3, y: 0 }).level).toBe('dark');
  });
});
