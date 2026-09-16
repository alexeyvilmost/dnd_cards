import { describe, expect, it } from 'vitest';
import compiled from '../pages/rulesLabFixture.generated.json';
import pinned from '../roguelike/pinnedFighter.fixture.json';
import type { RuleActionDefinition } from '../rules-core/domain';
import type { SoloCombatState } from './types';
import {
  combatActionIsAttack,
  combatActionRangeFt,
  combatApproachRoute,
  combatMovementRoute,
  defaultCombatAttackAction,
} from './defaultInteraction';
import { combatIdentity } from './combatIdentity';

const actor = compiled.roots.magicInitiateFighter.actor;
const weapon = {id: 'weapon', name: 'Атака оружием', kind: 'nonSpell', sourceEntityIds: ['weapon'],
  mechanics: {primitive: {type: 'weapon_attack'}},
  targeting: {minTargets: 1, maxTargets: 1, rangeFt: 5, requiresLineOfSight: true, allowedRelations: ['enemy']},
} as RuleActionDefinition;
const unarmed = {id: 'unarmed', name: 'Безоружный удар', kind: 'nonSpell', sourceEntityIds: ['unarmed'],
  mechanics: {}, targeting: weapon.targeting,
} as RuleActionDefinition;

function state(): SoloCombatState {
  const hero = {...actor,
    id: 'hero', name: 'Герой',
    character: {...actor.character, knownCards: [{id: 'blade', name: 'Клинок', type: 'weapon'}]},
    runtime: {...actor.runtime, equipment: {main_hand: 'blade'}},
  };
  return {
    characterId: 'hero',
    sideByActorId: {hero: 'party', ally: 'party', enemy1: 'enemy', enemy2: 'enemy'},
    world: {actors: {
      hero,
      ally: {...actor, id: 'ally', name: 'Союзник'},
      enemy1: {...actor, id: 'enemy1', name: 'Гоблин'},
      enemy2: {...actor, id: 'enemy2', name: 'Гоблин'},
    }},
    tokens: {
      hero: {actorId: 'hero', color: '#fff', position: {x: 0, y: 0}},
      ally: {actorId: 'ally', color: '#fff', position: {x: 0, y: 2}},
      enemy1: {actorId: 'enemy1', templateId: 'goblin', color: '#fff', position: {x: 4, y: 0}},
      enemy2: {actorId: 'enemy2', templateId: 'goblin', color: '#fff', position: {x: 8, y: 0}},
    },
    catalogActions: [weapon, unarmed],
    playerActionIds: ['weapon', 'unarmed'],
    actionPresentation: {unarmed: {actionRef: {card_number: 'action_basic_unarmed'}}},
    movementRemainingFt: {hero: 30},
    combatAreas: {}, movementModeByActor: {},
  } as unknown as SoloCombatState;
}

describe('contextual combat interaction', () => {
  it.each([5,10])('binds %i ft weapon reach instead of the shared template ceiling',reach=>{
    const value=state();const card=structuredClone(pinned.catalog.entities.card[0]);
    const mechanics=card.mechanics as any;mechanics.weapon_profile.attack_modes.find((m:any)=>m.kind==='melee').reach_ft=reach;
    const source=pinned.catalog.entities.action.find(a=>a.id==='ae7b59a2-2eee-412f-aee6-6323b4c1fb4d')!;
    const action={...weapon,mechanics:source.mechanics,targeting:{...weapon.targeting,rangeFt:600}} as RuleActionDefinition;
    value.world.actors.hero.character.knownCards=[card as any];value.world.actors.hero.character.equippedCards=[];
    value.world.actors.hero.runtime.equipment={main_hand:card.id};
    expect(combatActionRangeFt(value,'hero',action)).toBe(reach);
  });
  it('does not return to the diagonal after rounding the blocker in the reported screenshot',()=>{
    const value=state();
    value.tokens.hero.position={x:9,y:1}; value.tokens.enemy1.position={x:8,y:1};
    value.tokens.enemy2.position={x:0,y:0}; value.tokens.ally.position={x:0,y:1};
    const route=combatMovementRoute(value,'hero',{x:1,y:0})!;
    expect(route.costFt).toBe(40);
    expect(route.path).toEqual(Array.from({length:8},(_,i)=>({x:8-i,y:0})));
  });
  it('follows the direct ray in the reported guard layout instead of detouring upward', () => {
    const value = state();
    value.tokens.hero.position = {x: 1, y: 2};
    value.tokens.enemy1.position = {x: 1, y: 1};
    value.tokens.enemy2.position = {x: 5, y: 0};
    const route = combatMovementRoute(value, 'hero', {x: 7, y: 3})!;
    expect(route.costFt).toBe(30);
    expect(route.path).toHaveLength(6);
    expect(route.path.every(p => p.y === 2 || p.y === 3)).toBe(true);
    expect(route.path.map(p => p.x)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it('uses a straight horizontal route and still detours around an occupied cell', () => {
    const value=state();
    value.tokens.hero.position={x:1,y:4};
    expect(combatMovementRoute(value,'hero',{x:7,y:4})!.path.every(p=>p.y===4)).toBe(true);
    value.tokens.enemy1.position={x:4,y:4};
    const route=combatMovementRoute(value,'hero',{x:7,y:4})!;
    expect(route.path).not.toContainEqual({x:4,y:4});
    expect(route.costFt).toBe(30);
    expect(route.path.every(p=>Math.abs(p.y-4)<=1)).toBe(true);
  });
  it('prefers the equipped weapon contract and recognizes explicit attacks', () => {
    const value = state();
    expect(defaultCombatAttackAction(value, 'hero')?.id).toBe('weapon');
    expect(combatActionIsAttack(value, weapon)).toBe(true);
  });

  it('finds the cheapest attack position and reports movement remaining', () => {
    const route = combatApproachRoute(state(), 'hero', 'enemy1', 5);
    expect(route).toMatchObject({destination: {x: 3, y: 0}, costFt: 15, available: true, availableFt: 30, remainingFt: 15});
  });

  it('assigns matching duplicate numbers and distinct enemy accents', () => {
    const value = state();
    const first = combatIdentity(value, 'enemy1');
    const second = combatIdentity(value, 'enemy2');
    expect(first).toMatchObject({side: 'enemy', duplicateIndex: 1, duplicateCount: 2});
    expect(second).toMatchObject({side: 'enemy', duplicateIndex: 2, duplicateCount: 2});
    expect(first.accent).not.toBe(second.accent);
    expect(combatIdentity(value, 'ally').side).toBe('ally');
  });
});
