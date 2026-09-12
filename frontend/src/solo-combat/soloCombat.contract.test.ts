import { describe, expect, it } from 'vitest';
import type { Action, PassiveEffect } from '../types';
import type { ActorState } from '../rules-core/domain';
import type { Monster } from '../monsters/types';
import { compileMonsterInstance } from './monsterCompiler';
import { planMonsterTurn } from './monsterAi';
import { areaPositionsForAction, effectiveActorSpeedFt, gridDistanceFt, pathToward, pullToward, pushAway, reachablePositions, reachableRoutes } from './tacticalGrid';
import { spatialFacts, type SoloCombatState } from './types';

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
  const worldActor = (id: string) => id === monster.id ? monster : {...structuredClone(monster), id};
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

  it('pushes along the attack ray for distant off-axis targets in either direction', () => {
    expect(pushAway({source: {x: 0, y: 0}, target: {x: 4, y: 1}, distanceFt: 15})).toEqual({x: 7, y: 2});
    expect(pushAway({source: {x: 10, y: 6}, target: {x: 6, y: 5}, distanceFt: 15})).toEqual({x: 3, y: 4});
    expect(pushAway({source: {x: 0, y: 0}, target: {x: 4, y: 1}, distanceFt: 15, occupied: new Set(['6:2'])})).toEqual({x: 5, y: 1});
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
    expect(compiled.actor.passives).toEqual(expect.arrayContaining([
      passive.mechanics,
      expect.objectContaining({ kind: 'monster_ai' }),
    ]));
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

  it('keeps a ranged monster in place when its target is already in weapon range', () => {
    const ranged = aiState({ x: 0, y: 0 }, { x: 8, y: 0 }, 20);
    expect(planMonsterTurn(ranged.state, ranged.monster, 'player', 60)).toEqual({
      firstMove: [], dashMove: [], usesDash: false, attacks: true,
    });
  });

  it('respects spent movement and does not spend Dash while grappled', () => {
    const partial = aiState({ x: 0, y: 0 }, { x: 8, y: 0 }, 30);
    partial.state.movementRemainingFt = { monster: 5 };
    const plan = planMonsterTurn(partial.state, partial.monster, 'player');
    expect(gridDistanceFt({ x: 0, y: 0 }, plan.firstMove.at(-1)!)).toBe(5);
    partial.state.world.grapples = {
      hold: { targetActorId: 'monster' },
    } as unknown as SoloCombatState['world']['grapples'];
    expect(planMonsterTurn(partial.state, partial.monster, 'player')).toEqual({
      firstMove: [], dashMove: [], usesDash: false, attacks: false,
    });
  });

  it('uses a saved extra movement allotment without paying for another Dash', () => {
    const extra = aiState({ x: 0, y: 0 }, { x: 10, y: 0 }, 30);
    extra.state.movementRemainingFt = { monster: 50 };
    const restored = JSON.parse(JSON.stringify(extra.state)) as SoloCombatState;
    const plan = planMonsterTurn(restored, JSON.parse(JSON.stringify(extra.monster)), 'player');
    expect(plan).toMatchObject({ attacks: true, usesDash: false, dashMove: [] });
    expect(plan.firstMove).toHaveLength(9);
  });

  it('budgets difficult terrain for both normal movement and Dash', () => {
    const difficult = aiState({ x: 0, y: 0 }, { x: 11, y: 9 }, 20);
    difficult.state.combatAreas = {
      mud: { difficultTerrain: true, cells: Array.from({ length: 120 }, (_, i) => ({ x: i % 12, y: Math.floor(i / 12) })) },
    } as unknown as SoloCombatState['combatAreas'];
    const plan = planMonsterTurn(difficult.state, difficult.monster, 'player');
    expect(gridDistanceFt({ x: 0, y: 0 }, plan.firstMove.at(-1)!)).toBe(10);
    expect(gridDistanceFt(plan.firstMove.at(-1)!, plan.dashMove.at(-1)!)).toBe(10);
  });

  it('moves out of obscurity before a ranged attack and remains deterministic', () => {
    const obscured = aiState({ x: 1, y: 1 }, { x: 8, y: 1 }, 20);
    obscured.state.combatAreas = {
      fog: { heavilyObscured: true, cells: [{ x: 1, y: 1 }] },
    } as unknown as SoloCombatState['combatAreas'];
    const plan = planMonsterTurn(obscured.state, obscured.monster, 'player', 60);
    expect(plan.firstMove.length).toBeGreaterThan(0);
    expect(plan.attacks).toBe(true);
    expect(plan.usesDash).toBe(false);
    expect(planMonsterTurn(obscured.state, obscured.monster, 'player', 60)).toEqual(plan);
    expect(obscured.state.tokens.monster.position).toEqual({ x: 1, y: 1 });
  });

  it('derives directed hearing independently of fog and deafness of the speaker', () => {
    const { state, monster } = aiState({ x: 0, y: 0 }, { x: 2, y: 0 });
    state.combatAreas = { fog: { heavilyObscured: true, cells: [{ x: 1, y: 0 }] } } as unknown as SoloCombatState['combatAreas'];
    expect(spatialFacts(state, 'monster', 'player')).toMatchObject({ targetCanSeeSource: false, targetCanHearSource: true });
    monster.runtime.activeEffects = [{ id: 'deaf', name: 'Deafened', source: 'test', mechanics: { kind: 'condition', value: 'deafened' } }];
    expect(spatialFacts(state, 'monster', 'player').targetCanHearSource).toBe(true);
    expect(spatialFacts(state, 'player', 'monster').targetCanHearSource).toBe(false);
  });

  it('projects directed Blindsight through fog and invisibility within its declared range', () => {
    const setup = aiState({x: 0, y: 0}, {x: 2, y: 0}, 30);
    const {state, monster} = setup;
    monster.passives = [{kind: 'grant_sense', sense: 'blindsight', range: 10}];
    monster.runtime.activeEffects = [{id: 'blind', name: 'Blind', source: 'test', mechanics: {kind: 'condition', value: 'blinded'}}];
    state.world.actors.player.runtime.activeEffects = [{id: 'invisible', name: 'Invisible', source: 'test', mechanics: {kind: 'condition', value: 'invisible'}}];
    state.combatAreas = {fog: {heavilyObscured: true, cells: [{x: 1, y: 0}]}} as unknown as SoloCombatState['combatAreas'];
    expect(spatialFacts(state, 'monster', 'player')).toMatchObject({lineOfSight: true, canSeeTarget: true, targetCanSeeSource: false});
    expect(planMonsterTurn(state, monster, 'player', 60)).toMatchObject({firstMove: [], attacks: true});
    state.tokens.player.position = {x: 3, y: 0};
    expect(spatialFacts(state, 'monster', 'player')).toMatchObject({lineOfSight: false, canSeeTarget: false});
    monster.passives = [{kind: 'grant_sense', sense: 'darkvision', range: 60}];
    expect(spatialFacts(state, 'monster', 'player').canSeeTarget).toBe(false);
    state.combatAreas = {};
    monster.runtime.activeEffects = [];
    expect(spatialFacts(state, 'monster', 'player')).toMatchObject({lineOfSight: true, canSeeTarget: false, targetCanSeeSource: true});
  });

  it('closes to the preferred range without spending an action on Dash', () => {
    const ranged = aiState({ x: 0, y: 0 }, { x: 8, y: 0 }, 20);
    const plan = planMonsterTurn(ranged.state, ranged.monster, 'player', 60, 20);
    expect(gridDistanceFt(plan.firstMove.at(-1)!, { x: 8, y: 0 })).toBe(20);
    expect(plan).toMatchObject({ attacks: true, usesDash: false });
  });

  it('backs away to the declared range but favors an attack without provoking', () => {
    const ranged = aiState({x: 4, y: 4}, {x: 5, y: 4}, 30);
    const retreat = planMonsterTurn(ranged.state, ranged.monster, 'player', 60, 20);
    expect(gridDistanceFt(retreat.firstMove.at(-1)!, {x: 5, y: 4})).toBe(20);
    expect(retreat).toMatchObject({attacks: true, usesDash: false});
    const threatened = planMonsterTurn(ranged.state, ranged.monster, 'player', 60, 20,
      (_origin, path) => path.some(cell => gridDistanceFt(cell, {x: 5, y: 4}) > 5) ? 1 : 0);
    expect(threatened).toEqual({firstMove: [], dashMove: [], usesDash: false, attacks: true});
    expect(ranged.state.tokens.monster.position).toEqual({x: 4, y: 4});
  });

  it('compiles reach and damage adjustments from the monster contract', () => {
    const template = {
      ...goblin(),
      ai: {
        strategy: 'tactical' as const,
        reach_ft: 10,
        damage_immunities: ['poison'],
        damage_vulnerabilities: ['bludgeoning'],
      },
    };
    const compiled = compileMonsterInstance({
      monster: template, instanceId: 'armored-monster', actions: [meleeAction()], effects: [],
    });
    expect(compiled.actor.attackProfile?.reachFt).toBe(10);
    expect(compiled.actor.passives).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'resistance', damage_type: 'poison', value: 'immunity' }),
      expect.objectContaining({ kind: 'resistance', damage_type: 'bludgeoning', value: 'vulnerability' }),
    ]));
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


describe('pack tactics ally eligibility', () => {
  it.each(['incapacitated', 'stunned', 'paralyzed', 'unconscious', 'petrified', 'prone', 'poisoned'])('%s ally', (condition) => {
    const { state, monster } = aiState({ x: 0, y: 0 }, { x: 2, y: 2 });
    state.sideByActorId = { monster: 'enemy', ally: 'enemy', player: 'player' };
    state.world.actors.ally = { ...monster, id: 'ally', runtime: { ...monster.runtime,
      activeEffects: [{ id: 'condition', name: condition, source: 'test', mechanics: { kind: 'condition', value: condition } }],
    } };
    state.tokens.ally = { actorId: 'ally', color: '#fff', position: { x: 2, y: 1 } };
    expect(spatialFacts(state, 'monster', 'player').nearbyEligibleAllyToTarget)
      .toBe(['prone', 'poisoned'].includes(condition));
  });
});


it('compiles monster proficiencies, expertise, senses and condition immunities as shared actor rules', () => {
  const monster = goblin();
  monster.ai = { skill_proficiencies: ['perception', 'stealth'], skill_expertise: ['perception'],
    save_proficiencies: ['wis'], darkvision_ft: 60, blindsight_ft: 10, condition_immunities: ['poisoned'] };
  const { actor } = compileMonsterInstance({ monster, instanceId: 'test:wolf', actions: [meleeAction()], effects: [] });
  expect(actor.character).toMatchObject({ skillProficiencies: ['perception', 'stealth'],
    skillExpertise: ['perception'], saveProficiencies: ['wis'] });
  expect(actor.passives).toContainEqual(expect.objectContaining({ kind: 'grant_sense', sense: 'darkvision', range: 60 }));
  expect(actor.passives).toContainEqual(expect.objectContaining({kind: 'grant_sense', sense: 'blindsight', range: 10}));
  expect(actor.traits?.conditionImmunities).toEqual([{ condition: 'poisoned', sourceEntityIds: [monster.id] }]);
});

it('retains declared monster movement modes and Spider Climb without changing flat-arena walking speed', () => {
  const monster = goblin();
  monster.speed = 40;
  monster.ai = {
    movement_speeds: {walk: 40, climb: 40},
    movement_traits: [{id: 'spider_climb', name: 'Паучье лазание', mechanics: {
      kind: 'movement_trait', mode: 'climb', ignores_ability_checks_on: [
        'difficult_surfaces', 'vertical_surfaces', 'ceilings',
      ],
    }}],
  };
  const {actor} = compileMonsterInstance({monster, instanceId: 'test:spider', actions: [meleeAction()], effects: []});
  expect(actor.character.characterSpeed).toBe(40);
  expect(actor.passives).toEqual(expect.arrayContaining([
    expect.objectContaining({id: 'monster-speed:climb', kind: 'grant_speed', mode: 'climb', value: 40}),
    expect.objectContaining({id: 'spider_climb', kind: 'movement_trait', mode: 'climb'}),
  ]));
  const malformed = {...monster, ai: {...monster.ai, movement_speeds: {walk: 30, climb: 40}}};
  expect(() => compileMonsterInstance({monster: malformed, instanceId: 'bad:spider', actions: [meleeAction()], effects: []}))
    .toThrow('расходится со стат-блоком');
});


describe('AI path search', () => {
  it('routes around occupied intermediate cells rather than crossing them', () => {
    const {state, monster} = aiState({x: 0, y: 1}, {x: 5, y: 1}, 30);
    for (let y=0; y<3; y++) {
      const id=`blocker-${y}`;
      state.world.actors[id]={...state.world.actors.player,id};
      state.tokens[id]={...state.tokens.player,actorId:id,position:{x:2,y}};
    }
    const plan=planMonsterTurn(state,monster,'player');
    expect(plan.attacks).toBe(true);
    expect(plan.firstMove.some(p=>p.y>=3)).toBe(true);
    let previous={x:0,y:1};
    for (const step of plan.firstMove) {
      expect(gridDistanceFt(previous,step)).toBe(5);
      expect(step.x!==2 || step.y>=3).toBe(true);
      previous=step;
    }
    expect(gridDistanceFt(previous,{x:5,y:1})).toBeLessThanOrEqual(5);
  });
  it('does not report cells behind a full occupied barrier', () => {
    const {state}=aiState({x:0,y:0},{x:4,y:0},60);
    for(let y=0;y<10;y++) {
      const id=`blocker-${y}`;
      state.world.actors[id]={...state.world.actors.player,id};
      state.tokens[id]={...state.tokens.player,actorId:id,position:{x:2,y}};
    }
    expect(reachableRoutes(state,'monster',60).every(route=>route.destination.x<2)).toBe(true);
  });
});
