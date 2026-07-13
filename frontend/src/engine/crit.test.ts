/**
 * Критическое попадание (PHB 2024): кости урона бросаются ДВАЖДЫ, модификаторы — один раз.
 * Проверяем на атаке с фиксированной костью урона, форсируя натуральную 20 через rng.
 */
import { describe, expect, it } from 'vitest';
import { executeAction } from './execute';
import type { CharacterContext, EngineEvent, ExecuteContext, RuntimeState } from '../mvp/contracts';

const fresh = (): RuntimeState => ({
  hp: { current: 30, max: 30, temp: 0 }, resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects: [],
});
const char: CharacterContext = { abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, profBonus: 2, level: 1 };

/** rng: первый вызов (бросок к20) = first, остальные (кости урона) = rest. */
const seq = (first: number, rest: number) => { let n = 0; return () => (n++ === 0 ? first : rest); };

const ATTACK = { name: 'Тест-атака', effects: [{ resolution: 'attack_roll', on_hit: [{ kind: 'damage', dice: '2d6', type: 'fire' }] }] };
const damageTotal = (events: EngineEvent[]) =>
  events.filter((e) => e.type === 'damage').reduce((s, e) => s + ((e as { amount?: number }).amount ?? 0), 0);

const run = (rng: () => number, mech: Record<string, unknown> = ATTACK): EngineEvent[] =>
  executeAction(fresh(), mech, { character: char, target: { ac: 1 }, rng } as ExecuteContext).events;

describe('Критическое попадание — удвоение костей урона', () => {
  it('нат.20: 2d6 → 4d6 (кости дважды)', () => {
    // rng 0.96 → к20 = 20 (крит), каждая d6 = floor(0.96*6)+1 = 6 → 4d6 = 24.
    expect(damageTotal(run(() => 0.96))).toBe(24);
  });
  it('обычное попадание: 2d6 (кости один раз)', () => {
    // к20 = 11 (попадание, не крит), кости по 6 → 2d6 = 12.
    expect(damageTotal(run(seq(0.5, 0.96)))).toBe(12);
  });
  it('модификатор урона прибавляется ОДИН раз (не удваивается)', () => {
    // Кость + плоский бонус: 1d8+3, нат.20 → 2d8+3 (не 2d8+6). d8=8 → 16+3 = 19.
    const mech = { name: 'a', effects: [{ resolution: 'attack_roll', on_hit: [{ kind: 'damage', dice: '1d8+3', type: 'slashing' }] }] };
    expect(damageTotal(run(() => 0.96, mech))).toBe(19);
  });
  it('явный on_crit не удваивается движком (истина автора)', () => {
    const mech = {
      name: 'a',
      effects: [{
        resolution: 'attack_roll',
        on_hit: [{ kind: 'damage', dice: '2d6', type: 'fire' }],
        on_crit: [{ kind: 'damage', dice: '2d6', type: 'fire' }],
      }],
    };
    // Крит берёт on_crit как есть: 2d6 по 6 = 12 (а не 24).
    expect(damageTotal(run(() => 0.96, mech))).toBe(12);
  });
});
