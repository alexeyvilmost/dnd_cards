/**
 * D1 (слайс 2): апкаст-доступность заклинания. Заклинание со стоимостью spell_slot уровня
 * N доступно, если есть ЛЮБОЙ слот уровня ≥ N (не только базового) — иначе кастер со
 * свободным старшим слотом, но потраченным базовым, не смог бы кастовать.
 */
import { describe, expect, it } from 'vitest';
import { payableWithUpcast } from './SheetActionsPanel';
import type { RuntimeState } from '../mvp/contracts';

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
});
