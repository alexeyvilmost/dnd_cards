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
    ['weapon', 'slashing'],
    ['radiant', 'radiant'],
  ] as const)('Меткий удар наносит оружейный урон выбранного типа %s', (choice, damageType) => {
    const targetState = freshFighterState();
    const state = equippedFighterState();
    const result = executeAction(state, {
      name: 'Меткий удар',
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      effects: [{
        resolution: 'attack_roll', attack_kind: 'weapon_melee', ability: 'spellcasting',
        on_hit: [{
          kind: 'choice', id: 'true_strike_damage_type', context: 'in_play', count: 1,
          options: { source: 'explicit', items: [
            { id: 'weapon', grants: [
              { kind: 'damage', dice: 'weapon', type: 'weapon', ability: 'spellcasting' },
              {
                kind: 'damage', dice: '0', type: 'radiant',
                scaling: { dice: '1d6', per: 'character_level' },
                suppress_damage_modifiers: true, omit_if_zero: true,
              },
            ] },
            { id: 'radiant', grants: [
              { kind: 'damage', dice: 'weapon', type: 'radiant', ability: 'spellcasting' },
              {
                kind: 'damage', dice: '0', type: 'radiant',
                scaling: { dice: '1d6', per: 'character_level' },
                suppress_damage_modifiers: true, omit_if_zero: true,
              },
            ] },
          ] },
        }],
      }],
    }, {
      character: { ...FIGHTER_CTX_EQUIPPED, spellcastingMod: 3 },
      selfId: 'caster',
      target: { id: 'target', ac: 10, runtimeState: targetState, characterContext: FIGHTER_CTX },
      choices: { true_strike_damage_type: choice },
      rng: sequence([face(15), face(4, 8)]),
    });

    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'damage', damageType, amount: 7,
    }));
    expect(result.targetState?.hp.current).toBe(targetState.hp.current - 7);
    expect(result.events.filter((event) => event.type === 'damage')).toHaveLength(1);
  });

  it('Меткий удар добавляет отдельную кость излучения с 5-го уровня', () => {
    const targetState = { ...freshFighterState(), hp: { current: 30, max: 30, temp: 0 } };
    const result = executeAction(equippedFighterState(), {
      name: 'Меткий удар',
      effects: [{
        resolution: 'attack_roll', attack_kind: 'weapon_melee', ability: 'spellcasting',
        on_hit: [{
          kind: 'choice', id: 'true_strike_damage_type', context: 'in_play', count: 1,
          options: { source: 'explicit', items: [{ id: 'radiant', grants: [
            { kind: 'damage', dice: 'weapon', type: 'radiant', ability: 'spellcasting' },
            {
              kind: 'damage', dice: '0', type: 'radiant',
              scaling: { dice: '1d6', per: 'character_level' },
              suppress_damage_modifiers: true, omit_if_zero: true,
            },
          ] }] },
        }],
      }],
    }, {
      character: { ...FIGHTER_CTX_EQUIPPED, level: 5, spellcastingMod: 3 },
      target: { id: 'target', ac: 10, runtimeState: targetState, characterContext: FIGHTER_CTX },
      choices: { true_strike_damage_type: 'radiant' },
      rng: sequence([face(15), face(4, 8), face(5, 6)]),
    });

    expect(result.events.filter((event) => event.type === 'damage')).toEqual([
      expect.objectContaining({ damageType: 'radiant', amount: 7 }),
      expect.objectContaining({ damageType: 'radiant', amount: 5 }),
    ]);
  });

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

  it('supports creature-type allow-lists for restricted item saves', () => {
    const action = {
      name: 'Святая вода',
      effects: [{
        resolution: 'save', ability: 'dex', dc: '12',
        automatic_success: { if_target_creature_type_not_in: ['fiend', 'undead'] },
        on_fail: [{ kind: 'damage', dice: '2d8', type: 'radiant' }],
        on_success: [],
      }],
    };
    const humanoid = executeAction(freshFighterState(), action, {
      character: FIGHTER_CTX,
      target: {
        id: 'target', runtimeState: freshFighterState(),
        characterContext: { ...FIGHTER_CTX, creatureType: 'humanoid' },
      },
      rng: () => { throw new Error('automatic success must not roll'); },
    });
    expect(humanoid.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'narrative', text: expect.stringContaining('автоуспех') }),
    ]));

    const fiend = executeAction(freshFighterState(), action, {
      character: FIGHTER_CTX,
      target: {
        id: 'target', runtimeState: freshFighterState(),
        characterContext: { ...FIGHTER_CTX, creatureType: 'fiend' },
      },
      rng: () => face(20),
    });
    expect(fiend.events.some((event) => event.type === 'roll')).toBe(true);
  });

  it('keeps the declared Mind Sliver name on the target-owned penalty', () => {
    const targetState = freshFighterState();
    const result = executeAction(freshFighterState(), {
      name: 'действие',
      effects: [{
        resolution: 'save', ability: 'int', dc: '13', who: 'target',
        on_fail: [{
          kind: 'modifier', applies_to: { roll: 'saving_throw' },
          op: 'bonus_die', faces: 4, sign: -1, source: 'Расщепление разума',
          consume: 'next', duration: { type: 'until_end_of_source_next_turn' },
        }],
        on_success: [],
      }],
    }, {
      character: FIGHTER_CTX,
      selfId: 'caster',
      target: { id: 'target', runtimeState: targetState, characterContext: FIGHTER_CTX },
      rng: () => face(1),
    });

    expect(result.targetState?.activeEffects).toEqual([
      expect.objectContaining({
        name: 'Расщепление разума',
        source: 'Расщепление разума',
      }),
    ]);
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'effect_applied',
      name: 'Расщепление разума · спасбросок',
      sourceAction: 'Расщепление разума',
    }));
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
