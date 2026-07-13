/**
 * C5: алгебра модификаторов значения (Foundry-модель) — set/multiply/upgrade/downgrade + priority.
 * foldModifiers сводит значение; breakdown применяет её к скорости/инициативе/… (напр. «скорость 0»
 * у Схвачен, «×2 скорость» Ускорения). d20-броски остаются аддитивными (здесь не проверяются).
 */
import { describe, expect, it } from 'vitest';
import { collectModifiers, foldModifiers, collectRollModifiers, type CollectResult } from './modifiers';
import { breakdownValue } from './breakdown';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';

type Dict = Record<string, unknown>;
const fresh = (): RuntimeState => ({ hp: { current: 20, max: 20, temp: 0 }, resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects: [] });
const character: CharacterContext = { abilityMods: { str: 0, dex: 2, con: 0, int: 0, wis: 0, cha: 0 }, profBonus: 2, level: 5, characterSpeed: 30, baseSpeed: 30 };

/** RuntimeState с наложенным состоянием (kind:'condition') — как на листе/в бою. */
const withCondition = (value: string): RuntimeState => ({
  ...fresh(),
  activeEffects: [{ id: `c-${value}`, name: value, mechanics: { kind: 'condition', value } } as never],
});

// Пассивка-механика с одним modifier-пейлоадом.
const mod = (op: string, value: number, roll = 'speed', extra: Dict = {}): Dict =>
  ({ effects: [{ resolution: 'auto', result: [{ kind: 'modifier', applies_to: { roll }, op, value, ...extra }] }] });
const collect = (passives: Dict[], roll: string): CollectResult => collectModifiers(fresh(), passives, { roll });

describe('C5 — foldModifiers', () => {
  it('set перекрывает базу и аддитивы', () => {
    expect(foldModifiers(30, collect([mod('add', 5), mod('set', 0)], 'speed')).value).toBe(0);
  });
  it('multiply умножает (после аддитивов)', () => {
    expect(foldModifiers(30, collect([mod('add', 10), mod('multiply', 2)], 'speed')).value).toBe(80); // (30+10)×2
  });
  it('upgrade = не ниже (max), downgrade = не выше (min)', () => {
    expect(foldModifiers(10, collect([mod('upgrade', 30)], 'speed')).value).toBe(30);
    expect(foldModifiers(50, collect([mod('upgrade', 30)], 'speed')).value).toBe(50);
    expect(foldModifiers(50, collect([mod('downgrade', 30)], 'speed')).value).toBe(30);
  });
  it('порядок применения: add → multiply → downgrade → upgrade → set', () => {
    // 10 +5=15 ×2=30 downgrade20→20 upgrade25→25 set40→40
    const r = collect([mod('add', 5), mod('multiply', 2), mod('downgrade', 20), mod('upgrade', 25), mod('set', 40)], 'speed');
    expect(foldModifiers(10, r).value).toBe(40);
  });
  it('priority: больший priority среди set применяется последним и перекрывает', () => {
    const r = collect([mod('set', 10, 'speed', { priority: 1 }), mod('set', 99, 'speed', { priority: 5 })], 'speed');
    expect(foldModifiers(30, r).value).toBe(99);
  });
  it('без ops — чистая сумма (обратная совместимость)', () => {
    expect(foldModifiers(30, collect([mod('add', 5)], 'speed')).value).toBe(35);
    expect(collect([mod('add', 5)], 'speed').ops).toEqual([]);
  });
  it('op-часть попадает в parts для popover (дельта до итога)', () => {
    const { parts } = foldModifiers(30, collect([mod('set', 0)], 'speed'));
    expect(parts.some((p) => p.value === -30 && p.reason === 'установлено')).toBe(true);
  });
});

// Скорость (breakdown листа) и КЗ (armorClassValue) применяют алгебру C5 (set/multiply/…):
// состояния «Схвачен/Опутан/…» задают Скорость 0 через op:'set'. Хиты/спасброски остаются
// аддитивными (отдельный расчёт в resolveCharacterRules) — обобщение вместе с C8.
describe('C5 — КЗ применяет алгебру (armorClassValue)', () => {
  const acMod = (op: string, value: number): Dict => mod(op, value, 'ac');
  it('база КЗ без модификаторов: 10 + ЛВК (без доспеха)', () => {
    expect(breakdownValue('ac', character, fresh(), []).value).toBe(12);
  });
  it('upgrade: «КЗ не ниже 16» (Барскин) → 16 при базовых 12', () => {
    expect(breakdownValue('ac', character, fresh(), [acMod('upgrade', 16)]).value).toBe(16);
  });
  it('set: «КЗ = 13» (Доспех мага) перекрывает базу', () => {
    expect(breakdownValue('ac', character, fresh(), [acMod('set', 13)]).value).toBe(13);
  });
  it('аддитивный модификатор КЗ (Кольцо защиты +2) по-прежнему работает', () => {
    expect(breakdownValue('ac', character, fresh(), [acMod('add', 2)]).value).toBe(14); // 12 + 2
  });
  it('add + upgrade вместе: +1 (13), затем не ниже 16 → 16', () => {
    expect(breakdownValue('ac', character, fresh(), [acMod('add', 1), acMod('upgrade', 16)]).value).toBe(16);
  });
});

// Состояния PHB 2024 как ДАННЫЕ (BUILTIN_CONDITION_RULES): движок применяет их из активного
// эффекта kind:'condition'. Здесь — представимая движком часть (скорость / инициатива / броски).
describe('Состояния 2024 — механика через движок', () => {
  it('Схвачен → Скорость 0 (op:set)', () => {
    expect(breakdownValue('speed', character, withCondition('grappled'), []).value).toBe(0);
  });
  it('Опутан / Парализован / Без сознания → Скорость 0', () => {
    for (const c of ['restrained', 'paralyzed', 'unconscious']) {
      expect(breakdownValue('speed', character, withCondition(c), []).value).toBe(0);
    }
  });
  it('Скорость 0 виден в разбивке (parts) как «установлено»', () => {
    const bd = breakdownValue('speed', character, withCondition('grappled'), []);
    expect(bd.parts.some((p) => p.reason === 'установлено')).toBe(true);
  });
  it('Невидимый → преимущество на Инициативу', () => {
    expect(collectRollModifiers(withCondition('invisible'), [], { roll: 'initiative' }).advantage).toBe('advantage');
  });
  it('Недееспособный → помеха на Инициативу', () => {
    expect(collectRollModifiers(withCondition('incapacitated'), [], { roll: 'initiative' }).advantage).toBe('disadvantage');
  });
  it('Отравлен → помеха на атаку и проверку (без изменений)', () => {
    expect(collectRollModifiers(withCondition('poisoned'), [], { roll: 'attack' }).advantage).toBe('disadvantage');
    expect(collectRollModifiers(withCondition('poisoned'), [], { roll: 'ability_check' }).advantage).toBe('disadvantage');
  });
  it('Опутан → помеха на спасбросок Ловкости (фильтр по характеристике)', () => {
    expect(collectRollModifiers(withCondition('restrained'), [], { roll: 'saving_throw', filter: { ability: 'dex' } }).advantage).toBe('disadvantage');
    // спас Силы — без помехи (фильтр не совпал)
    expect(collectRollModifiers(withCondition('restrained'), [], { roll: 'saving_throw', filter: { ability: 'str' } }).advantage).toBe('none');
  });
  it('Скорость 0 НЕ влияет на d20-броски (роль speed ≠ attack)', () => {
    expect(collectRollModifiers(withCondition('grappled'), [], { roll: 'attack' }).advantage).toBe('disadvantage'); // только помеха атаки
    expect(breakdownValue('speed', character, withCondition('poisoned'), []).value).toBe(30); // Отравлен скорость не режет
  });
});
