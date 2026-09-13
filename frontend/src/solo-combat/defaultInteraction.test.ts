import { describe, expect, it } from 'vitest';
import compiled from '../pages/rulesLabFixture.generated.json';
import type { RuleActionDefinition } from '../rules-core/domain';
import type { SoloCombatState } from './types';
import {
  combatActionIsAttack,
  combatApproachRoute,
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
