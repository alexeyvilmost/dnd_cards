import { describe, expect, it } from 'vitest';
import { dicePresentation, diceThrowConfig, groupDiceResults } from './dicePresentation';
import { getSettings } from '../settings';

describe('визуальная семантика 3D-кубов', () => {
  it.each([
    ['Проверка Силы', 'str', '#8f2f2b'],
    ['Проверка Ловкости', 'dex', '#315f42'],
    ['Спасбросок Телосложения', 'con', '#555b5d'],
    ['Проверка Интеллекта', 'int', '#294f78'],
    ['Проверка Мудрости', 'wis', '#a47a20'],
    ['Проверка Харизмы', 'cha', '#663d78'],
  ])('%s получает закреплённый цвет характеристики', (label, key, color) => {
    expect(dicePresentation({ sides: 20, label })).toMatchObject({ key, color });
  });

  it('атака — тёмный d20 с пергаментным контрастом', () => {
    expect(dicePresentation({ sides: 20, label: 'Бросок атаки' })).toEqual({
      key: 'attack',
      label: 'Атака',
      color: '#27231f',
      textColor: '#e5c98f',
    });
  });

  it('урон различает типы и не принимает силовое поле за проверку Силы', () => {
    expect(dicePresentation({ sides: 8, label: 'Урон (огонь)' }).key).toBe('fire');
    expect(dicePresentation({ sides: 10, label: 'Урон (холод)' }).key).toBe('cold');
    expect(dicePresentation({ sides: 6, label: 'Урон (силовое поле)' }).key).toBe('force');
    expect(dicePresentation({ sides: 8, label: 'Лечение' }).key).toBe('healing');
  });

  it('собирает соседние одинаковые кости в читаемую детализацию результата', () => {
    expect(groupDiceResults([
      { sides: 20, label: 'Бросок атаки' },
      { sides: 8, label: 'Урон (огонь)' },
      { sides: 8, label: 'Урон (огонь)' },
    ], [17, 4, 7])).toMatchObject([
      { label: 'Бросок атаки', sides: 20, values: [17] },
      { label: 'Урон (огонь)', sides: 8, values: [4, 7] },
    ]);
  });

  it('3D включён по умолчанию и остаётся отдельным от общего диалога бросков', () => {
    expect(getSettings()).toMatchObject({ diceDialog: true, dice3d: true });
  });

  it('сила и высота физического броска растут вместе с длиной жеста', () => {
    const weak = diceThrowConfig(0.2);
    const strong = diceThrowConfig(0.95);
    expect(strong.throwForce).toBeGreaterThan(weak.throwForce);
    expect(strong.spinForce).toBeGreaterThan(weak.spinForce);
    expect(strong.startingHeight).toBeGreaterThan(weak.startingHeight);
  });

  it('ограничивает слишком слабый и слишком сильный жест безопасным диапазоном', () => {
    expect(diceThrowConfig(-10).strength).toBe(0.15);
    expect(diceThrowConfig(10).strength).toBe(1);
  });
});
