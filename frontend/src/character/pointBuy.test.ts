import { describe, expect, it } from 'vitest';
import { bonusIssues, reconcileBonusesForBackground } from './pointBuy';
import { emptyBonuses } from './types';
import type { AbilityBonuses } from './types';

const bonuses = (over: Partial<AbilityBonuses>): AbilityBonuses => ({ ...emptyBonuses(), ...over });

describe('bonusIssues — обязательность бонусов при предыстории (KB-112)', () => {
  it('пустое распределение БЕЗ предыстории — валидно', () => {
    expect(bonusIssues(emptyBonuses(), false)).toEqual([]);
    expect(bonusIssues(undefined, false)).toEqual([]);
  });

  it('пустое распределение С предысторией — ошибка (нельзя молча создать на −2/−3)', () => {
    expect(bonusIssues(emptyBonuses(), true).length).toBeGreaterThan(0);
    expect(bonusIssues(undefined, true).length).toBeGreaterThan(0);
  });

  it('корректное +2/+1 — валидно', () => {
    expect(bonusIssues(bonuses({ mode: 'two_one', assignments: { str: 2, dex: 1 } }), true)).toEqual([]);
  });

  it('неполное +2 без +1 — ошибка даже без required', () => {
    expect(bonusIssues(bonuses({ mode: 'two_one', assignments: { str: 2 } }), false).length).toBeGreaterThan(0);
  });
});

describe('reconcileBonusesForBackground — смена предыстории (KB-113)', () => {
  it('снимает назначения на чужие характеристики новой предыстории и авто-дефолтит +2/+1', () => {
    // Солдат str+2/dex+1 → Мудрец (con/int/wis): str/dex недействительны → +2 con, +1 int.
    const prev = bonuses({ mode: 'two_one', assignments: { str: 2, dex: 1 } });
    const next = reconcileBonusesForBackground(prev, ['con', 'int', 'wis']);
    expect(next.assignments).toEqual({ con: 2, int: 1 });
  });

  it('валидные назначения (входят в новую предысторию) сохраняются', () => {
    const prev = bonuses({ mode: 'two_one', assignments: { con: 2, int: 1 } });
    const next = reconcileBonusesForBackground(prev, ['con', 'int', 'wis']);
    expect(next.assignments).toEqual({ con: 2, int: 1 });
  });

  it('пустые → авто-дефолт +2/+1 на первые две характеристики', () => {
    const next = reconcileBonusesForBackground(emptyBonuses(), ['wis', 'cha', 'con']);
    expect(next.assignments).toEqual({ wis: 2, cha: 1 });
  });

  it('anyAbilities — не трогаем (бонусы разрешены на любые характеристики)', () => {
    const prev = bonuses({ mode: 'two_one', anyAbilities: true, assignments: { str: 2, dex: 1 } });
    expect(reconcileBonusesForBackground(prev, ['con', 'int', 'wis'])).toEqual(prev);
  });

  it('частично валидные в режиме one_one_one: чужие сняты, свои оставлены (без авто-дефолта)', () => {
    const prev = bonuses({ mode: 'one_one_one', assignments: { str: 1, con: 1, int: 1 } });
    const next = reconcileBonusesForBackground(prev, ['con', 'int', 'wis']);
    expect(next.assignments).toEqual({ con: 1, int: 1 });
  });
});
