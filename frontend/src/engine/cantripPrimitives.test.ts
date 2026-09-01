import { describe, expect, it } from 'vitest';
import { executeAction, projectedAgainst } from './execute';
import {
  equippedFighterState,
  FIGHTER_CTX,
  FIGHTER_CTX_EQUIPPED,
  freshFighterState,
} from '../mvp/fixtures';
import type { ActiveEffectEntry, EngineEvent } from '../mvp/contracts';

type Dict = Record<string, unknown>;

const face = (value: number, sides = 20) => (value - 0.5) / sides;
const sequence = (values: number[]) => {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0.5;
};

const effect = (name: string, mechanics: Dict): ActiveEffectEntry => ({
  id: name,
  name,
  source: name,
  mechanics,
});

const rollEvents = (events: EngineEvent[]) => events.filter((event) => event.type === 'roll');

describe('универсальные примитивы заговоров', () => {
  it.each([
    ['enemy', 'humanoid'],
    ['ally', 'fey'],
  ] as const)('Дружба даёт автоуспех цели при отношении %s и типе %s', (relation, creatureType) => {
    const targetState = freshFighterState();
    const result = executeAction(freshFighterState(), {
      name: 'Дружба',
      effects: [{
        resolution: 'save', ability: 'wis', dc: '13',
        automatic_success: {
          if_target_relation: 'enemy',
          if_target_creature_type_not: 'humanoid',
        },
        on_fail: [{ kind: 'condition', value: 'charmed', op: 'apply' }],
        on_success: [],
      }],
    }, {
      character: FIGHTER_CTX,
      target: {
        id: 'target', runtimeState: targetState, relationToSource: relation,
        characterContext: { ...FIGHTER_CTX, creatureType },
      },
      rng: () => { throw new Error('automatic success must not roll'); },
    });
    expect(result.targetState).toBeUndefined();
    expect(result.events.some((event) => event.type === 'condition_applied')).toBe(false);
    expect(result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'narrative', text: expect.stringContaining('автоуспех') }),
    ]));
  });

  it('проецирует штрафную кость Защиты от оружия на входящую атаку', () => {
    const state = freshFighterState();
    state.activeEffects = [effect('Защита от оружия', {
      kind: 'modifier',
      applies_to: { roll: 'attack' },
      scope: 'target',
      op: 'bonus_die',
      faces: 4,
      sign: -1,
    })];
    expect(projectedAgainst({ runtimeState: state }, 'attack').rules).toMatchObject([{
      op: 'bonus_die',
      faces: 4,
      sign: -1,
    }]);
  });

  it('consume:next снимает помеху после первой подходящей атаки', () => {
    const state = freshFighterState();
    state.activeEffects = [effect('Злая насмешка', {
      kind: 'modifier',
      applies_to: { roll: 'attack' },
      op: 'disadvantage',
      consume: 'next',
    })];
    const result = executeAction(state, {
      name: 'Тестовая атака',
      effects: [{ resolution: 'attack_roll', ability: 'str', on_hit: [] }],
    }, {
      character: FIGHTER_CTX,
      target: { ac: 10 },
      rng: sequence([face(15), face(4)]),
    });
    expect(result.state.activeEffects).toHaveLength(0);
    expect(result.events).toContainEqual({ type: 'effect_expired', name: 'Злая насмешка' });
  });

  it('запрет лечения блокирует healing payload', () => {
    const state = freshFighterState();
    state.hp.current = 3;
    state.activeEffects = [effect('Леденящее прикосновение', {
      kind: 'modifier',
      applies_to: { roll: 'healing' },
      op: 'deny',
    })];
    const result = executeAction(state, {
      name: 'Лечение',
      effects: [{ resolution: 'auto', result: [{ kind: 'healing', amount: '1d8' }] }],
    }, { character: FIGHTER_CTX, rng: sequence([face(8, 8)]) });
    expect(result.state.hp.current).toBe(3);
    expect(result.events.some((event) => event.type === 'healing')).toBe(false);
  });

  it('урон оружия может использовать характеристику заклинаний для Меткого удара', () => {
    const state = equippedFighterState();
    const result = executeAction(state, {
      name: 'Меткий удар',
      effects: [{
        resolution: 'attack_roll',
        attack_kind: 'weapon_melee',
        ability: 'spellcasting',
        on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon', ability: 'spellcasting' }],
      }],
    }, {
      character: { ...FIGHTER_CTX_EQUIPPED, spellcastingMod: 4 },
      target: { ac: 1 },
      rng: sequence([face(15), face(5, 8)]),
    });
    const damage = result.events.find((event) => event.type === 'damage');
    expect(damage?.type === 'damage' ? damage.roll?.modifiers : []).toContainEqual({
      value: 4,
      source: 'Базовая характеристика заклинаний',
    });
    expect(rollEvents(result.events)).toHaveLength(1);
  });
});
