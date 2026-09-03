import { describe, expect, it } from 'vitest';
import type { Action, PassiveEffect } from '../types';
import type { ActorState } from '../rules-core/domain';
import type { Monster } from '../monsters/types';
import { compileMonsterInstance } from './monsterCompiler';
import { planMonsterTurn } from './monsterAi';
import { areaPositionsForAction, effectiveActorSpeedFt, gridDistanceFt, pathToward, pullToward, pushAway, reachablePositions } from './tacticalGrid';
import type { SoloCombatState } from './types';

const MONSTER_ID = 'c1000000-0000-4000-8000-000000000001';
const ACTION_ID = 'b1000000-0000-4000-8000-000000000001';

function meleeAction(): Action {
  return {
    id: ACTION_ID,
    name: 'Скимитар',
    description: 'Рукопашная атака.',
    rarity: 'common',
    card_number: 'MONSTER-ACTION-GOBLIN-SCIMITAR',
    resource: 'action',
    action_type: 'base_action',
    type: 'monster',
    mechanics: {
      interaction: { intent: 'harmful' },
      activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
      targeting: {
        domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1,
        max_targets: 1, range_ft: 5, requires_line_of_sight: true,
        allowed_relations: ['enemy'],
      },
      effects: [{
        resolution: 'attack_roll', ability: 'dex', attack_kind: 'weapon_melee', vs: 'ac',
        on_hit: [{ kind: 'damage', dice: '1d6', ability: 'dex', type: 'slashing' }],
      }],
    },
    created_at: '', updated_at: '',
  } as Action;
}

function goblin(): Monster {
  return {
    id: MONSTER_ID, slug: 'goblin-warrior', name: 'Гоблин-воин', description: '',
    size: 'small', creature_type: 'fey (goblinoid)', alignment: 'neutral evil',
    challenge_rating: '1/4', armor_class: 15, max_hp: 10, speed: 30,
    initiative_bonus: 2, proficiency_bonus: 2,
    abilities: { str: 8, dex: 15, con: 10, int: 10, wis: 8, cha: 8 },
    action_ids: [ACTION_ID], effect_ids: [], ai: { strategy: 'melee_chase' },
    token_url: '', source: 'SRD 5.2.1', created_at: '', updated_at: '',
  };
}

function aiState(monsterPosition: { x: number; y: number }, playerPosition: { x: number; y: number }, speed = 30) {
  const monster = {
    id: 'monster',
    character: { characterSpeed: speed },
    runtime: {
      hp: { current: 10, max: 10, temp: 0 },
      resources: {}, maxResources: {}, activeEffects: [],
      concentration: null, inventory: [], equipment: {}, turn: 0,
    },
    passives: [],
  } as unknown as ActorState;
  const worldActor = (id: string) => ({ id, runtime: { hp: { current: 10 } } });
  const state = {
    tokens: {
      monster: { actorId: 'monster', position: monsterPosition },
      player: { actorId: 'player', position: playerPosition },
    },
    world: { actors: { monster: worldActor('monster'), player: worldActor('player') } },
  } as unknown as SoloCombatState;
  return { state, monster };
}

describe('solo combat tactical contract', () => {
  it('uses five-foot squares, including diagonals, and never enters an occupied target cell', () => {
    expect(gridDistanceFt({ x: 1, y: 1 }, { x: 4, y: 3 })).toBe(15);
    expect(pathToward({ start: { x: 0, y: 0 }, target: { x: 4, y: 4 }, maxFeet: 10 }))
      .toEqual([{ x: 1, y: 1 }, { x: 2, y: 2 }]);
    expect(pathToward({
      start: { x: 0, y: 0 }, target: { x: 2, y: 0 }, maxFeet: 30,
      occupied: new Set(['2:0']),
    }).at(-1)).toEqual({ x: 1, y: 0 });
  });

  it('stops forced movement at blocking tokens and board edges', () => {
    expect(pushAway({
      source: { x: 0, y: 0 }, target: { x: 1, y: 0 }, distanceFt: 15,
      occupied: new Set(['3:0']),
    })).toEqual({ x: 2, y: 0 });
    expect(pushAway({ source: { x: 9, y: 0 }, target: { x: 10, y: 0 }, distanceFt: 20 }))
      .toEqual({ x: 11, y: 0 });
    expect(pullToward({
      source: { x: 1, y: 0 }, target: { x: 4, y: 0 }, distanceFt: 5,
      occupied: new Set(['1:0']),
    })).toEqual({ x: 3, y: 0 });
    expect(pullToward({
      source: { x: 1, y: 0 }, target: { x: 2, y: 0 }, distanceFt: 5,
      occupied: new Set(['1:0']),
    })).toEqual({ x: 2, y: 0 });
  });

  it('projects exactly the free destinations accepted by remaining movement', () => {
    const { state } = aiState({ x: 2, y: 2 }, { x: 4, y: 2 });
    const cells = reachablePositions(state, 'monster', 10);
    expect(cells).toContainEqual({ x: 0, y: 0 });
    expect(cells).toContainEqual({ x: 3, y: 3 });
    expect(cells).not.toContainEqual({ x: 4, y: 2 });
    expect(cells).not.toContainEqual({ x: 5, y: 2 });
    expect(reachablePositions(state, 'monster', 0)).toEqual([]);
  });

  it('projects a 15-foot cube as the same three-by-three target area shown on hover', () => {
    const cells = areaPositionsForAction({
      action: {
        mechanics: { targeting: { shape: 'area', area: { kind: 'cube', size_ft: 15 } } },
        targeting: { rangeFt: 15 },
      },
      sourcePosition: { x: 5, y: 8 },
      aimPosition: { x: 5, y: 5 },
    });
    expect(cells).toHaveLength(9);
    expect(cells).toContainEqual({ x: 4, y: 4 });
    expect(cells).toContainEqual({ x: 6, y: 6 });
  });

  it('projects spheres by radius and keeps them distinct from cubes', () => {
    const cells = areaPositionsForAction({
      action: {
        mechanics: { targeting: { shape: 'area', area: { kind: 'sphere', radius_ft: 5 } } },
        targeting: { rangeFt: 30 },
      },
      sourcePosition: { x: 5, y: 8 },
      aimPosition: { x: 5, y: 5 },
    });
    expect(cells).toHaveLength(5);
    expect(cells).toContainEqual({ x: 5, y: 5 });
    expect(cells).toContainEqual({ x: 5, y: 4 });
    expect(cells).not.toContainEqual({ x: 4, y: 4 });
  });

  it('projects a cylinder as its circular two-dimensional footprint', () => {
    const cells = areaPositionsForAction({
      action: {
        mechanics: { targeting: { shape: 'area', area: { kind: 'cylinder', radius_ft: 5 } } },
        targeting: { rangeFt: 30 },
      },
      sourcePosition: { x: 5, y: 8 },
      aimPosition: { x: 5, y: 5 },
    });
    expect(cells).toHaveLength(5);
    expect(cells).toContainEqual({ x: 5, y: 5 });
    expect(cells).toContainEqual({ x: 5, y: 4 });
    expect(cells).not.toContainEqual({ x: 4, y: 4 });
  });

  it('anchors emanations on the source instead of the clicked aim cell', () => {
    const cells = areaPositionsForAction({
      action: {
        mechanics: { targeting: { shape: 'area', area: { kind: 'emanation', size_ft: 5 } } },
        targeting: { rangeFt: 0 },
      },
      sourcePosition: { x: 5, y: 5 },
      aimPosition: { x: 10, y: 10 },
    });
    expect(cells).toHaveLength(9);
    expect(cells).toContainEqual({ x: 5, y: 5 });
    expect(cells).toContainEqual({ x: 5, y: 4 });
    expect(cells).toContainEqual({ x: 4, y: 4 });
    expect(cells).not.toContainEqual({ x: 10, y: 10 });
  });

  it('anchors cones at the source and rotates them toward the aim cell', () => {
    const action = {
      mechanics: { targeting: { shape: 'area', area: { kind: 'cone', size_ft: 15 } } },
      targeting: { rangeFt: 15 },
    };
    const north = areaPositionsForAction({
      action, sourcePosition: { x: 5, y: 5 }, aimPosition: { x: 5, y: 2 },
    });
    const east = areaPositionsForAction({
      action, sourcePosition: { x: 5, y: 5 }, aimPosition: { x: 8, y: 5 },
    });
    expect(north).toContainEqual({ x: 5, y: 2 });
    expect(north).toContainEqual({ x: 4, y: 3 });
    expect(north).not.toContainEqual({ x: 8, y: 5 });
    expect(east).toContainEqual({ x: 8, y: 5 });
    expect(east).toContainEqual({ x: 7, y: 4 });
    expect(east).not.toContainEqual({ x: 5, y: 2 });
  });

  it('projects a fixed-width line from the caster toward the aim cell', () => {
    const cells = areaPositionsForAction({
      action: {
        mechanics: { targeting: { shape: 'area', area: { kind: 'line', length_ft: 30, width_ft: 5 } } },
      },
      sourcePosition: { x: 2, y: 2 },
      aimPosition: { x: 5, y: 2 },
    });
    expect(cells).toEqual([
      { x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 },
      { x: 6, y: 2 }, { x: 7, y: 2 }, { x: 8, y: 2 },
    ]);
  });

  it('compiles a monster entirely from referenced Action and Effect entities', () => {
    const passive = { id: 'e1000000-0000-4000-8000-000000000001', mechanics: { kind: 'modifier', op: 'add', value: 1 } } as unknown as PassiveEffect;
    const template = { ...goblin(), effect_ids: [passive.id] };
    const compiled = compileMonsterInstance({
      monster: template, instanceId: 'goblin-instance', actions: [meleeAction()], effects: [passive],
    });
    expect(compiled.actor.ac).toBe(15);
    expect(compiled.actor.character.abilityMods.dex).toBe(2);
    expect(compiled.actor.runtime.resources.action).toBe(1);
    expect(compiled.actor.passives).toEqual([passive.mechanics]);
    expect(compiled.actions[0].targeting?.rangeFt).toBe(5);
    expect(compiled.actions[0].mechanics.effects).toEqual(meleeAction().mechanics?.effects);
  });

  it('chooses attack, move-and-attack, or reusable Dash from geometry and speed', () => {
    const adjacent = aiState({ x: 1, y: 1 }, { x: 2, y: 2 });
    expect(planMonsterTurn(adjacent.state, adjacent.monster, 'player'))
      .toMatchObject({ attacks: true, usesDash: false, firstMove: [] });

    const reachable = aiState({ x: 0, y: 0 }, { x: 5, y: 0 }, 20);
    expect(planMonsterTurn(reachable.state, reachable.monster, 'player'))
      .toMatchObject({ attacks: true, usesDash: false });

    const far = aiState({ x: 0, y: 0 }, { x: 11, y: 9 }, 20);
    const plan = planMonsterTurn(far.state, far.monster, 'player');
    expect(plan.attacks).toBe(false);
    expect(plan.usesDash).toBe(true);
    expect(plan.firstMove).toHaveLength(4);
    expect(plan.dashMove).toHaveLength(4);
  });

  it('uses active speed modifiers for both movement and monster planning', () => {
    const slowed = aiState({ x: 0, y: 0 }, { x: 11, y: 9 }, 30);
    slowed.monster.runtime.activeEffects = [{
      id: 'effect:slow', name: 'Slow', source: 'test',
      ownerId: slowed.monster.id, sourceId: 'caster',
      roundsLeft: 1, expiry: 'source_turn',
      mechanics: { kind: 'modifier', applies_to: { roll: 'speed' }, op: 'add', value: '-10' },
    }];
    expect(effectiveActorSpeedFt(slowed.monster)).toBe(20);
    const plan = planMonsterTurn(slowed.state, slowed.monster, 'player');
    expect(plan.firstMove).toHaveLength(4);
    expect(plan.dashMove).toHaveLength(4);
  });
});
