import { describe, expect, it, vi } from 'vitest';
import { createWorld, type ActorState } from '../rules-core/domain';
import { emptyDeathSaves } from '../engine/deathSaves';
import { actorHasConsciousVitality } from '../engine/lifePolicies';
import { executeCombatAction, finalizeCombatOutcome, moveActorAlongRoute, prepareCombatDeathSave, resolveCombatDeathSave } from './engine';
import { occupiedPositions } from './tacticalGrid';
import type { SoloCombatState } from './types';

function setup(source = 'staff'): SoloCombatState {
  const actors = ['hero', 'enemy'].map((id): ActorState => ({ id, name: id, kind: id === 'hero' ? 'playerCharacter' : 'monster', controllerId: id, ac: 5,
    capabilities: { actionIds: id === 'hero' ? ['attack'] : [] },
    character: { baseSpeed: 30, abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, profBonus: 2, level: 1 },
    passives: id === 'hero' ? [{ id: source, effects: [{ resolution: 'auto', result: [{ kind: 'life_policy', remain_conscious_at_zero: true }] }] }] : [],
    runtime: { hp: { current: id === 'hero' ? 0 : 10, max: 10, temp: 0 }, resources: { action: 1, reaction: 1 }, maxResources: { action: 1, reaction: 1 },
      inventory: [], equipment: {}, activeEffects: [], deathSaves: emptyDeathSaves(), firedThisTurn: [] },
  }));
  const world = createWorld({ id: 'life-policy', ruleset: { systemId: 'dnd5e-2024', releaseId: 'test', contentHash: 'test', errataVersion: 'test' }, actors });
  world.scene = { mode: 'encounter', round: 1, activeIndex: 0, initiative: ['hero', 'enemy'], turnStarted: true };
  return { schemaVersion: 1, deathSavesVersion: 1, routeCommandVersion: 1, characterId: 'hero', controlledCharacterIds: ['hero'], runtimeRevision: 0, world,
    tokens: { hero: { actorId: 'hero', position: { x: 0, y: 0 } }, enemy: { actorId: 'enemy', position: { x: 4, y: 0 } } },
    sideByActorId: { hero: 'party', enemy: 'enemy' }, combatAreas: {}, boardRevision: 0,
    catalogActions: [{ id: 'attack', name: 'Attack', kind: 'nonSpell', sourceEntityIds: ['attack'],
      targeting: { rangeFt: 30, minTargets: 1, maxTargets: 1, allowedRelations: ['enemy'], requiresLineOfSight: true },
      mechanics: { activation: { mode: 'active', cost: [{ resource: 'action' }] }, effects: [{ resolution: 'attack_roll', attack_kind: 'spell_ranged', ability: 'str',
        on_hit: [{ kind: 'damage', amount: 3, type: 'force' }] }] } }],
    playerActionIds: ['attack'], certifiedPlayerActionIds: [], opportunityActionIds: {}, movementRemainingFt: { hero: 30, enemy: 30 }, log: [], outcome: 'active', actionPresentation: {},
  } as unknown as SoloCombatState;
}

describe('conscious zero-HP combat participant', () => {
  it.each(['staff', 'different-content-effect'])('%s can move and attack after serialization at zero HP', source => {
    const initial = JSON.parse(JSON.stringify(setup(source))) as SoloCombatState;
    expect(occupiedPositions(initial).has('0:0')).toBe(true);
    const moved = moveActorAlongRoute({ state: initial, actorId: 'hero', destination: { x: 1, y: 0 }, rng: () => 0.7 });
    expect(moved.tokens.hero.position).toEqual({ x: 1, y: 0 });
    expect(moved.movementRemainingFt.hero).toBe(25);
    const attacked = executeCombatAction({ state: moved, actorId: 'hero', actionId: 'attack', targetIds: ['enemy'], rng: () => 0.7 });
    expect(attacked.world.actors.enemy.runtime.hp.current).toBe(7);
    expect(attacked.world.actors.hero.runtime.resources.action).toBe(0);
    expect(attacked.outcome).toBe('active');
  });

  it('rolls the normal death save once, then preserves the conscious character turn', () => {
    const initial = setup();
    initial.world.actors.hero.runtime.firedThisTurn = ['system:death-save-due'];
    const random = vi.fn(() => 0.7);
    const held = prepareCombatDeathSave(initial, random);
    expect(held.pendingDeathSave?.actorId).toBe('hero');
    const resolved = resolveCombatDeathSave(JSON.parse(JSON.stringify(held)), undefined, () => { throw Error('must replay'); });
    const closed = resolveCombatDeathSave(JSON.parse(JSON.stringify(resolved)));
    expect(random).toHaveBeenCalledTimes(1);
    expect(closed.world.scene).toMatchObject({ activeIndex: 0 });
    expect(closed.world.actors.hero.runtime.deathSaves?.successes).toBe(1);
    expect(closed.world.actors.hero.runtime.hp.current).toBe(0);
    expect(prepareCombatDeathSave(closed)).toEqual(closed);
  });

  it('revocation immediately removes occupancy and actions; explicit death still wins', () => {
    const initial = setup();
    initial.world.actors.hero.passives = [];
    expect(occupiedPositions(initial).has('0:0')).toBe(false);
    expect(actorHasConsciousVitality(initial.world.actors.hero)).toBe(false);
    const dead = setup();
    dead.world.actors.hero.runtime.deathSaves!.dead = true;
    expect(actorHasConsciousVitality(dead.world.actors.hero)).toBe(false);
    expect(finalizeCombatOutcome(dead).outcome).toBe('defeat');
  });

  it('does not declare a still-protected participant dead just for three stored failures', () => {
    const initial = setup();
    initial.world.actors.hero.runtime.deathSaves!.failures = 3;
    initial.world.actors.hero.passives!.push({ effects: [{ resolution: 'auto', result: [{ kind: 'life_policy', cannot_die: true }] }] });
    expect(finalizeCombatOutcome(initial).outcome).toBe('active');
    initial.world.actors.hero.passives!.pop();
    expect(finalizeCombatOutcome(initial).outcome).toBe('defeat');
  });
});
