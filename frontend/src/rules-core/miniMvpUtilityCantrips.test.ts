import { describe, expect, it } from 'vitest';
import definitions from '../../../scripts/content/data/mini-mvp-utility-cantrips.v1.json';
import weaponDefinitions from '../../../scripts/content/data/mini-mvp-shillelagh-weapons.v1.json';
import {
  executeAction,
  executeRemoteManipulator,
  MechanicsExecutionError,
  resolveCommunicationLink,
} from '../engine/execute';
import { validateMechanics } from '../engine/validateMechanics';
import { weaponContext } from '../engine/weapon';
import { writeRulesEngineRuntimeTurnState } from '../character/runtime';
import { CARD_LONGSWORD, FIGHTER_CTX, freshFighterState } from '../mvp/fixtures';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';
import { withDeclaredTestWeaponProfile } from '../testing/weaponProfileFixtures';
import { parseWeaponProfile } from './weaponProfile';
import { compileDeclaredMechanicsTargeting } from './actionTargeting';
import type { Card } from '../types';

type Dict = Record<string, unknown>;

function spell(cardNumber: string) {
  const definition = definitions.find((candidate) => candidate.card_number === cardNumber);
  if (!definition) throw new Error(`Missing utility cantrip ${cardNumber}`);
  return definition as { card_number: string; name: string; mechanics: Dict };
}

const club = withDeclaredTestWeaponProfile({
  ...CARD_LONGSWORD,
  id: 'weapon:club',
  name: 'Дубинка',
}, {
  weaponType: 'club',
  proficiencyCategory: 'simple',
  attackAbility: 'str',
  damageLines: [{ dice: '1d4', type: 'bludgeoning' }],
  defaultAttackMode: 'melee',
  attackModes: [{ kind: 'melee', reach_ft: 5 }],
  properties: ['light'],
  masteryEffectId: 'mastery:slow',
});

const caster: CharacterContext = {
  ...FIGHTER_CTX,
  level: 1,
  spellcastingAbility: 'wis',
  spellcastingMod: 4,
  equippedCards: [club],
  knownCards: [club],
};

function casterState(): RuntimeState {
  const state = freshFighterState();
  state.equipment = { main_hand: club.id, off_hand: null };
  return state;
}

describe('mini-MVP: data-driven utility cantrips', () => {
  it('schema-validates all five declarations', () => {
    for (const definition of definitions) {
      expect(validateMechanics(definition.mechanics as Dict, {
        id: definition.card_number,
        name: definition.name,
        kind: 'spell',
      })).toEqual({ valid: true, errors: [] });
      expect(() => compileDeclaredMechanicsTargeting(definition.mechanics as Dict)).not.toThrow();
    }
    for (const definition of weaponDefinitions) {
      expect(parseWeaponProfile({
        ...CARD_LONGSWORD,
        id: definition.card_number,
        mechanics: definition.mechanics,
      } as Card)).toEqual(expect.objectContaining({ valid: true }));
    }
  });

  it('Mage Hand persists a constrained controller and spends an action per command', () => {
    const cast = executeAction(casterState(), spell('SPELL-0173').mechanics, {
      character: caster, selfId: 'caster', rng: () => 0.5,
    });
    expect(cast.state.activeEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ mechanics: expect.objectContaining({ kind: 'remote_manipulator' }) }),
    ]));
    const nextTurn = { ...cast.state, resources: { ...cast.state.resources, action: 1 } };
    const moved = executeRemoteManipulator(nextTurn, {
      operation: 'move_object', distanceFt: 20, objectWeightLb: 8, moveDistanceFt: 30,
      parameters: { object_id: 'scene-object:lever' },
    });
    expect(moved.state.resources.action).toBe(0);
    expect(moved.events).toContainEqual(expect.objectContaining({
      type: 'world_interaction', operation: 'move_object',
    }));
    expect(() => executeRemoteManipulator(nextTurn, {
      operation: 'attack', distanceFt: 5,
    })).toThrow(MechanicsExecutionError);
  });

  it('Shillelagh selects an equipped eligible card and changes its attack projection', () => {
    const cast = executeAction(casterState(), spell('SPELL-0194').mechanics, {
      character: caster,
      selfId: 'caster',
      spell: { baseLevel: 0, spellcastingAbility: 'wis' },
      choices: {
        shillelagh_weapon: club.id,
        shillelagh_damage_type: 'force',
      },
      rng: () => 0.5,
    });
    expect(weaponContext(caster, 'main', cast.state.equipment, cast.state)).toMatchObject({
      cardId: club.id,
      ability: 'wis',
      dice: '1d8',
      damageType: 'force',
      damages: [{ dice: '1d8', type: 'force' }],
    });
    expect(() => executeAction(casterState(), spell('SPELL-0194').mechanics, {
      character: caster,
      spell: { baseLevel: 0, spellcastingAbility: 'wis' },
      choices: { shillelagh_weapon: 'weapon:not-equipped', shillelagh_damage_type: 'force' },
      rng: () => 0.5,
    })).toThrow(MechanicsExecutionError);
  });

  it('Message persists a private reply link and enforces blockers', () => {
    const target = freshFighterState();
    const cast = executeAction(casterState(), spell('SPELL-0294').mechanics, {
      character: caster,
      selfId: 'caster',
      target: { id: 'target', ac: 10, runtimeState: target },
      rng: () => 0.5,
    });
    expect(cast.targetState).toBeDefined();
    expect(resolveCommunicationLink(cast.targetState!, { distanceFt: 100 }).events)
      .toContainEqual(expect.objectContaining({ type: 'communication', mode: 'reply' }));
    expect(() => resolveCommunicationLink(cast.targetState!, {
      distanceFt: 100, magicalSilence: true,
    })).toThrow(MechanicsExecutionError);
  });

  it('Elementalism emits only the selected structured world mutation', () => {
    const cast = executeAction(casterState(), spell('SPELL-0298').mechanics, {
      character: caster,
      choices: { elementalism_effect: 'water' },
      rng: () => 0.5,
    });
    expect(cast.events).toContainEqual(expect.objectContaining({
      type: 'world_interaction', operation: 'beckon_water',
      parameters: expect.objectContaining({ created_water_cups: 1 }),
    }));
    expect(cast.events.some((event) => (
      event.type === 'world_interaction' && event.operation === 'beckon_fire'
    ))).toBe(false);
  });

  it('Spare the Dying stabilizes persisted death-save state and rejects a healthy target', () => {
    const dying = freshFighterState();
    dying.hp.current = 0;
    dying.deathSaves = { successes: 1, failures: 2, stable: false, dead: false };
    const cast = executeAction(casterState(), spell('SPELL-0312').mechanics, {
      character: caster,
      target: { id: 'target', ac: 10, runtimeState: dying },
      rng: () => 0.5,
    });
    expect(cast.targetState?.deathSaves).toEqual({
      successes: 0, failures: 0, stable: true, dead: false,
    });
    expect(writeRulesEngineRuntimeTurnState({}, cast.targetState!)).toMatchObject({
      death_saves: { successes: 0, failures: 0, stable: true, dead: false },
    });
    expect(cast.events).toContainEqual({ type: 'stabilized' });

    expect(() => executeAction(casterState(), spell('SPELL-0312').mechanics, {
      character: caster,
      target: { id: 'healthy', ac: 10, runtimeState: freshFighterState() },
      rng: () => 0.5,
    })).toThrow(MechanicsExecutionError);
  });
});
