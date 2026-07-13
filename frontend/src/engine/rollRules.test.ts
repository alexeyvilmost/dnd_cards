/**
 * Правила бросков (data-driven) — расширяемый интерпретатор вмешательств в бросок.
 * Проверяем все примеры-кейсы: переброс (Везение), взрывные кости (Чародейский выброс),
 * крит-промах по диапазону, триггер по значению (парализ на 15), +бонус к кости, смещение
 * диапазона крита (складывается), замена кости (к24 вместо к20).
 */
import { describe, expect, it } from 'vitest';
import { rollD20 } from './roll';
import { applyDamageDieRules, matchesNatural } from './rollRules';
import { executeAction } from './execute';
import type { CharacterContext, DieRoll, ExecuteContext, RuntimeState } from '../mvp/contracts';

/** rng, отдающий заданную последовательность (по одному значению на бросок кости). */
const seq = (vals: number[]) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)] ?? 0.5; };
/** rng, дающий натуральное значение d на кости N граней. */
const face = (d: number, sides = 20) => (d - 0.5) / sides;

describe('matchesNatural — предикат по значению кости', () => {
  it('{eq}, {min,max}, пустой', () => {
    expect(matchesNatural(15, { eq: 15 })).toBe(true);
    expect(matchesNatural(14, { eq: 15 })).toBe(false);
    expect(matchesNatural(12, { min: 11, max: 14 })).toBe(true);
    expect(matchesNatural(15, { min: 11, max: 14 })).toBe(false);
    expect(matchesNatural(1, { max: 1 })).toBe(true);
    expect(matchesNatural(5, {})).toBe(false);
  });
});

describe('D20-правила (roll.ts)', () => {
  it('reroll — Везение полурослика: перебрасывает натуральную 1, берёт новую', () => {
    const rules = [{ op: 'reroll', applies_to: { roll: 'd20' }, natural: { max: 1 } }];
    const roll = rollD20({ rng: seq([face(1), face(17)]), rules });
    expect(roll.total).toBe(17);
    expect(roll.dice.filter((d) => !d.discarded)[0].result).toBe(17);
    expect(roll.dice.some((d) => d.discarded && d.result === 1)).toBe(true);
  });
  it('reroll не трогает не-единицу; без правила единица остаётся', () => {
    const rules = [{ op: 'reroll', applies_to: { roll: 'd20' }, natural: { max: 1 } }];
    expect(rollD20({ rng: seq([face(12), face(1)]), rules }).total).toBe(12);
    expect(rollD20({ rng: seq([face(1)]), rules: [] }).total).toBe(1);
  });

  it('outcome — крит-промах при натуральных 11–14', () => {
    const rules = [{ op: 'outcome', applies_to: { roll: 'attack' }, natural: { min: 11, max: 14 }, value: 'crit_miss' }];
    expect(rollD20({ rng: seq([face(12)]), target: { type: 'ac', value: 5 }, rules }).outcome).toBe('crit_miss');
    expect(rollD20({ rng: seq([face(15)]), target: { type: 'ac', value: 5 }, rules }).outcome).toBe('hit');
  });

  it('crit_range — складывается: два по -1 → крит с натуральной 18', () => {
    const rules = [
      { op: 'crit_range', applies_to: { roll: 'attack' }, value: -1 },
      { op: 'crit_range', applies_to: { roll: 'attack' }, value: -1 },
    ];
    expect(rollD20({ rng: seq([face(18)]), target: { type: 'ac', value: 5 }, rules }).outcome).toBe('crit');
    expect(rollD20({ rng: seq([face(17)]), target: { type: 'ac', value: 5 }, rules }).outcome).toBe('hit');
  });

  it('set_die — к24 вместо к20 при проверке', () => {
    const rules = [{ op: 'set_die', applies_to: { roll: 'ability_check' }, faces: 24 }];
    const roll = rollD20({ rng: seq([face(22, 24)]), rules });
    expect(roll.dice[0].sides).toBe(24);
    expect(roll.total).toBe(22);
  });

  it('on_roll — на натуральной 15 отдаёт triggered payload', () => {
    const rules = [{ op: 'on_roll', applies_to: { roll: 'attack' }, natural: { eq: 15 }, then: [{ kind: 'condition', value: 'paralyzed' }] }];
    const roll = rollD20({ rng: seq([face(15)]), target: { type: 'ac', value: 5 }, rules });
    expect(roll.triggered?.length).toBe(1);
    expect((roll.triggered![0] as { value?: string }).value).toBe('paralyzed');
    expect(rollD20({ rng: seq([face(14)]), target: { type: 'ac', value: 5 }, rules }).triggered).toBeUndefined();
  });

  it('die_bonus к самой d20-кости идёт в total, не в детекцию крита', () => {
    const rules = [{ op: 'die_bonus', applies_to: { roll: 'd20', die: 20 }, value: 1 }];
    const roll = rollD20({ rng: seq([face(19)]), target: { type: 'ac', value: 5 }, rules });
    expect(roll.total).toBe(20);        // 19 + 1
    expect(roll.outcome).toBe('hit');   // натуральная 19 — не крит (крит по натуралу, не по total)
  });
});

describe('Правила урона (applyDamageDieRules)', () => {
  it('die_bonus — +1 к каждой к8 (к6 не трогает)', () => {
    const dice: DieRoll[] = [{ sides: 8, result: 5 }, { sides: 8, result: 3 }, { sides: 6, result: 6 }];
    const { dice: out, delta } = applyDamageDieRules(dice, [{ op: 'die_bonus', applies_to: { die: 8 }, value: 1 }], { rng: seq([]) });
    expect(delta).toBe(2);
    expect(out.filter((d) => d.sides === 8).map((d) => d.result)).toEqual([6, 4]);
    expect(out.find((d) => d.sides === 6)!.result).toBe(6);
  });

  it('explode — Чародейский выброс: взрыв на максимуме, до limit раз (цепной)', () => {
    const dice: DieRoll[] = [{ sides: 8, result: 8 }];
    const { dice: out, delta } = applyDamageDieRules(dice, [], { explodeLimit: 2, rng: seq([face(8, 8), face(4, 8)]) });
    expect(delta).toBe(12); // добор 8 (макс) → добор 4
    expect(out.map((d) => d.result)).toEqual([8, 8, 4]);
  });
  it('explode не срабатывает без максимума', () => {
    expect(applyDamageDieRules([{ sides: 8, result: 5 }], [], { explodeLimit: 3, rng: seq([]) }).delta).toBe(0);
  });
});

describe('Интеграция через executeAction', () => {
  const char: CharacterContext = { abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, profBonus: 2, level: 1 };
  const fresh = (): RuntimeState => ({ hp: { current: 10, max: 10, temp: 0 }, resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects: [] });

  it('on_roll: атака на натуральной 15 парализует цель', () => {
    const passives = [{ effects: [{ resolution: 'auto', result: [{ kind: 'modifier', applies_to: { roll: 'attack' }, op: 'on_roll', natural: { eq: 15 }, then: [{ kind: 'condition', value: 'paralyzed' }] }] }] }];
    const mech = { name: 'Атака', effects: [{ resolution: 'attack_roll', on_hit: [{ kind: 'damage', dice: '1d6', type: 'slashing' }] }] };
    const res = executeAction(fresh(), mech, { character: char, passives, target: { ac: 5, runtimeState: fresh() }, rng: seq([face(15), 0.5]) } as ExecuteContext & { passives: unknown[] });
    const conds = (res.targetState?.activeEffects ?? []).filter((e) => (e.mechanics as { value?: string })?.value === 'paralyzed');
    expect(conds.length).toBe(1);
  });

  it('explode: урон заклинания «Чародейский выброс» (свойство payload.explode)', () => {
    const mech = { name: 'Чародейский выброс', effects: [{ resolution: 'auto', result: [{ kind: 'damage', dice: '1d8', type: 'force', explode: { limit: 2 } }] }] };
    const res = executeAction(fresh(), mech, { character: char, rng: seq([face(8, 8), face(8, 8), face(3, 8)]) });
    const dmg = res.events.filter((e) => e.type === 'damage').reduce((s, e) => s + ((e as { amount?: number }).amount ?? 0), 0);
    expect(dmg).toBe(19); // 8 → взрыв 8 → взрыв 3
  });

  it('die_bonus: пассив «+1 к каждой к8» усиливает урон 2d8', () => {
    const passives = [{ effects: [{ resolution: 'auto', result: [{ kind: 'modifier', applies_to: { roll: 'damage', die: 8 }, op: 'die_bonus', value: 1 }] }] }];
    const mech = { name: 'Удар', effects: [{ resolution: 'auto', result: [{ kind: 'damage', dice: '2d8', type: 'force' }] }] };
    const res = executeAction(fresh(), mech, { character: char, passives, rng: seq([face(5, 8), face(3, 8)]) } as ExecuteContext & { passives: unknown[] });
    const dmg = res.events.filter((e) => e.type === 'damage').reduce((s, e) => s + ((e as { amount?: number }).amount ?? 0), 0);
    expect(dmg).toBe(10); // (5+1)+(3+1)
  });
});
