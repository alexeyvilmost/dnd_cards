/**
 * Фаза B — броски и лог. Реализация: engine/roll.ts (шаги B1–B2).
 * Зелёный набор = «визуализация бросков» и «лог с разбивкой» имеют данные.
 */
import { describe, expect, it } from 'vitest';
import { rollD20, rollFormula } from './contracts';
import { seededRng } from './fixtures';

describe('B2: rollD20', () => {
  it('обычный бросок: одна кость, сумма с модификаторами, текст разбивки', () => {
    const log = rollD20({
      modifiers: [
        { value: 2, source: 'ЛВК', reason: 'модификатор характеристики' },
        { value: 2, source: 'БМ', reason: 'владение' },
      ],
      rng: seededRng(42),
    });
    expect(log.kind).toBe('d20');
    expect(log.dice).toHaveLength(1);
    expect(log.dice[0].sides).toBe(20);
    expect(log.dice[0].result).toBeGreaterThanOrEqual(1);
    expect(log.dice[0].result).toBeLessThanOrEqual(20);
    expect(log.total).toBe(log.dice[0].result + 4);
    // Разбивка должна упоминать и кость, и оба источника
    expect(log.text).toContain('ЛВК');
    expect(log.text).toContain('БМ');
  });

  it('преимущество: две кости, отброшенная помечена discarded, берётся большая', () => {
    const log = rollD20({ advantage: 'advantage', rng: seededRng(7) });
    expect(log.dice).toHaveLength(2);
    const kept = log.dice.filter((d) => !d.discarded);
    const discarded = log.dice.filter((d) => d.discarded);
    expect(kept).toHaveLength(1);
    expect(discarded).toHaveLength(1);
    expect(kept[0].result).toBeGreaterThanOrEqual(discarded[0].result);
    expect(log.total).toBe(kept[0].result);
    expect(log.advantage).toBe('advantage');
  });

  it('помеха: берётся меньшая кость', () => {
    const log = rollD20({ advantage: 'disadvantage', rng: seededRng(7) });
    const kept = log.dice.find((d) => !d.discarded)!;
    const discarded = log.dice.find((d) => d.discarded)!;
    expect(kept.result).toBeLessThanOrEqual(discarded.result);
  });

  it('цель КЗ: outcome hit/miss; чистая 20 — crit', () => {
    // Подбираем сиды: фиксируем поведение, а не конкретные числа
    const log = rollD20({ target: { type: 'ac', value: 10 }, modifiers: [{ value: 5, source: 'тест' }], rng: seededRng(1) });
    expect(log.target).toEqual({ type: 'ac', value: 10 });
    expect(['hit', 'miss', 'crit']).toContain(log.outcome);
    if (log.dice[0].result === 20) expect(log.outcome).toBe('crit');
    else expect(log.outcome).toBe(log.total >= 10 ? 'hit' : 'miss');
  });

  it('детерминированность: одинаковый сид — одинаковый результат', () => {
    const a = rollD20({ rng: seededRng(99) });
    const b = rollD20({ rng: seededRng(99) });
    expect(a.dice[0].result).toBe(b.dice[0].result);
  });
});

describe('B2: rollFormula (урон/лечение с разбивкой по костям)', () => {
  it('1d10 + self_level: кости видны отдельно, модификатор с источником', () => {
    const res = rollFormula('1d10 + self_level', { selfLevel: 1 }, { rng: seededRng(5) });
    expect(res.dice).toHaveLength(1);
    expect(res.dice[0].sides).toBe(10);
    expect(res.total).toBe(res.dice[0].result + 1);
    expect(res.modifiers.some((m) => m.value === 1)).toBe(true);
    expect(res.text.length).toBeGreaterThan(0);
  });

  it('2d6 + str: обе кости в логе', () => {
    const res = rollFormula('2d6 + str', { abilityMods: { str: 3 } }, { rng: seededRng(11) });
    expect(res.dice).toHaveLength(2);
    expect(res.dice.every((d) => d.sides === 6 && d.result >= 1 && d.result <= 6)).toBe(true);
    expect(res.total).toBe(res.dice[0].result + res.dice[1].result + 3);
  });

  it('плоская формула без костей: 1 + str', () => {
    const res = rollFormula('1 + str', { abilityMods: { str: 2 } }, { rng: seededRng(1) });
    expect(res.dice).toHaveLength(0);
    expect(res.total).toBe(3);
  });
});
