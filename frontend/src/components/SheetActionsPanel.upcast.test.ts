/**
 * D1 (слайс 2): апкаст-доступность заклинания. Заклинание со стоимостью spell_slot уровня
 * N доступно, если есть ЛЮБОЙ слот уровня ≥ N (не только базового) — иначе кастер со
 * свободным старшим слотом, но потраченным базовым, не смог бы кастовать.
 */
import { describe, expect, it } from 'vitest';
import {
  characterInteractionTargetOption,
  payableWithUpcast,
  replaceCachedInteractionTarget,
} from './SheetActionsPanel';
import { applyIncomingDamage } from '../engine/execute';
import { forgeToRuntimeState, writeRulesEngineRuntimeTurnState } from '../character/runtime';
import type { CharacterContext, ExecuteContext, RuntimeState } from '../mvp/contracts';
import type { ForgeCharacter } from '../character/types';

function rt(resources: Record<string, number>): RuntimeState {
  return {
    hp: { current: 10, max: 10, temp: 0 },
    resources, maxResources: resources,
    equipment: {}, inventory: [], activeEffects: [],
  };
}

const spell = (level: number) => [{ resource: 'spell_slot', level }];

describe('D1 — payableWithUpcast', () => {
  it('доступно при наличии базового слота', () => {
    expect(payableWithUpcast(rt({ spell_slot_1: 2 }), spell(1))).toBe(true);
  });

  it('НЕдоступно, если ни базового, ни старшего слота нет', () => {
    expect(payableWithUpcast(rt({ spell_slot_1: 0, spell_slot_2: 0 }), spell(1))).toBe(false);
  });

  it('доступно при пустом базовом, но свободном СТАРШЕМ слоте (апкаст)', () => {
    // spell_slot_1 потрачены, spell_slot_2 свободен → заклинание 1 круга кастуемо апкастом
    expect(payableWithUpcast(rt({ spell_slot_1: 0, spell_slot_2: 1 }), spell(1))).toBe(true);
  });

  it('заклинание 3 круга недоступно, если старших нет', () => {
    expect(payableWithUpcast(rt({ spell_slot_1: 4, spell_slot_2: 3 }), spell(3))).toBe(false);
  });

  it('прочие ресурсы стоимости проверяются обычной проверкой', () => {
    const cost = [{ resource: 'action' }, { resource: 'spell_slot', level: 1 }];
    expect(payableWithUpcast(rt({ action: 1, spell_slot_1: 1 }), cost)).toBe(true);
    expect(payableWithUpcast(rt({ action: 0, spell_slot_1: 1 }), cost)).toBe(false); // нет действия
  });

  it('не-слотовая стоимость: как обычный canPay', () => {
    expect(payableWithUpcast(rt({ bonus_action: 1 }), [{ resource: 'bonus_action' }])).toBe(true);
    expect(payableWithUpcast(rt({ bonus_action: 0 }), [{ resource: 'bonus_action' }])).toBe(false);
  });

  describe('freeuse снимает ТОЛЬКО требование ячейки, не действия', () => {
    // Туманный шаг: бонусное действие + слот 2 круга. Обнаружение магии: действие + слот 1 круга.
    const mistyStep = [{ resource: 'bonus_action' }, { resource: 'spell_slot', level: 2 }];

    it('freeuse делает каст доступным БЕЗ ячейки, если действие есть', () => {
      expect(payableWithUpcast(rt({ bonus_action: 1, spell_slot_2: 0 }), mistyStep, true)).toBe(true);
    });

    it('БЕЗ freeuse и без ячейки — недоступно (даже с действием)', () => {
      expect(payableWithUpcast(rt({ bonus_action: 1, spell_slot_2: 0 }), mistyStep, false)).toBe(false);
    });

    it('РЕГРЕСС: freeuse НЕ обходит нехватку бонусного действия', () => {
      // баг: freeuse-заклинание показывалось доступным при потраченном бонусном действии
      expect(payableWithUpcast(rt({ bonus_action: 0, spell_slot_2: 0 }), mistyStep, true)).toBe(false);
      expect(payableWithUpcast(rt({ bonus_action: 0, spell_slot_2: 3 }), mistyStep, true)).toBe(false);
    });

    it('РЕГРЕСС: freeuse НЕ обходит нехватку основного действия (Обнаружение магии)', () => {
      const detectMagic = [{ resource: 'action' }, { resource: 'spell_slot', level: 1 }];
      expect(payableWithUpcast(rt({ action: 0, spell_slot_1: 0 }), detectMagic, true)).toBe(false);
      expect(payableWithUpcast(rt({ action: 1, spell_slot_1: 0 }), detectMagic, true)).toBe(true);
    });
  });
});

describe('CharacterV3 interaction targets', () => {
  it('disables a legacy public target before any runtime mutation is attempted', () => {
    expect(characterInteractionTargetOption({
      id: 'legacy-public',
      name: 'Архивный герой',
      access_mode: 'legacy_public_readonly',
    }, new Set())).toEqual({
      id: 'legacy-public',
      name: 'Архивный герой',
      disabled: true,
      reason: 'архивный публичный лист доступен только для чтения',
    });
  });

  it('keeps an owned non-charmer target writable', () => {
    expect(characterInteractionTargetOption({
      id: 'owned-target',
      name: 'Союзник',
      access_mode: 'owner',
    }, new Set())).toEqual({ id: 'owned-target', name: 'Союзник' });
  });

  it('uses the committed target ledger for a second interaction without a page reload', () => {
    const target = {
      id: 'owned-target',
      name: 'Полуорк',
      access_mode: 'owner',
      current_hp: 5,
      max_hp: 20,
      resources: {},
      max_resources: {},
      equipment: {},
      inventory_items: [],
      active_effects: [],
      turn_state: null,
    } as unknown as ForgeCharacter;
    const character: CharacterContext = {
      abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
    };
    const relentless = {
      id: 'relentless-endurance',
      name: 'Relentless Endurance',
      uses: { per: 'long_rest' },
      activation: { mode: 'triggered', trigger: { event: 'reduced_to_0_hp' } },
      effects: [{
        resolution: 'auto',
        result: [{ kind: 'set_value', target: 'hp', value: '1' }],
      }],
    };
    const context = {
      character,
      rng: () => 0.5,
      passives: [relentless],
    } as unknown as ExecuteContext;

    const first = applyIncomingDamage(forgeToRuntimeState(target), 10, context, {
      damageType: 'slashing',
    }).state;
    expect(first.hp.current).toBe(1);
    expect(first.firedThisRest).toContain('relentless-endurance');
    const committed = {
      ...target,
      current_hp: first.hp.current,
      turn_state: writeRulesEngineRuntimeTurnState(target.turn_state, first),
    };
    const cached = replaceCachedInteractionTarget([target], committed);

    const second = applyIncomingDamage(forgeToRuntimeState(cached[0]), 10, context, {
      damageType: 'slashing',
    }).state;
    expect(second.hp.current).toBe(0);
    expect(second.firedThisRest).toEqual(['relentless-endurance']);
  });
});
