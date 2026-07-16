import { describe, expect, it } from 'vitest';
import { computeMaxHP } from './derive';

// KB-114: максимум хитов не уходит в минус — на уровень не меньше 1 хита (RAW 2024).
describe('computeMaxHP — кламп «минимум 1 хит за уровень»', () => {
  it('обычный случай не меняется: d10, ТЕЛ 14 (+2), L5 → 10+2 + 4×(6+2) = 44', () => {
    expect(computeMaxHP('d10', 14, 5)).toBe(44);
  });

  it('d6, ТЕЛ 1 (−5), L5: без клампа было −3 → теперь 1 (уровень) + пол', () => {
    // L1: 6 + (−5) = 1. Уровни 2–5: каждый max(1, 4 + (−5)) = max(1, −1) = 1 → 4×1.
    // Итого 1 + 4 = 5, а не 6−5 + 4×(4−5) = 1 − 4 = −3.
    expect(computeMaxHP('d6', 1, 5)).toBe(5);
  });

  it('никогда не отрицательный и не ноль (минимум 1)', () => {
    expect(computeMaxHP('d6', 1, 1)).toBeGreaterThanOrEqual(1);
    expect(computeMaxHP('d6', 3, 20)).toBeGreaterThanOrEqual(20); // 20 уровней × ≥1
  });

  it('положительный модификатор ТЕЛ клампом не режется', () => {
    // d8, ТЕЛ 16 (+3), L3: 8+3 + 2×max(1, 5+3) = 11 + 16 = 27.
    expect(computeMaxHP('d8', 16, 3)).toBe(27);
  });
});
