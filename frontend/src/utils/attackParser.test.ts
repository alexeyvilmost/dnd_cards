import { describe, expect, it } from 'vitest';
import { parseAttacks, rollAttack } from './attackParser';

const MUMMY = [
  'Мультиатака',
  'Мумия совершает две атаки Разлагающим кулаком.',
  '',
  'Разлагающий кулак',
  'Бросок рукопашной атаки: +5, досягаемость 5 фт. Попадание: 8 (1к10 + 3) дробящего урона + 10 (3к6) урона некротической энергией.',
].join('\n');

const SKELETON = [
  'Короткий меч',
  'Бросок рукопашной атаки: +5, досягаемость 5 фт. Попадание: 6 (1к6 + 3) колющего урона.',
  '',
  'Короткий лук',
  'Бросок дальнобойной атаки: +5, дистанция 80/320 фт. Попадание: 6 (1к6 + 3) колющего урона.',
].join('\n');

describe('parseAttacks', () => {
  it('parses melee with multiple damage types (#4)', () => {
    const { melee } = parseAttacks(MUMMY);
    expect(melee).toBeTruthy();
    expect(melee!.name).toBe('Разлагающий кулак');
    expect(melee!.bonus).toBe(5);
    expect(melee!.damages).toHaveLength(2);
    expect(melee!.damages[0]).toMatchObject({ count: 1, sides: 10, bonus: 3, type: 'дробящего урона' });
    expect(melee!.damages[1]).toMatchObject({ count: 3, sides: 6, bonus: 0, type: 'урона некротической энергией' });
  });

  it('parses both melee and ranged', () => {
    const { melee, ranged } = parseAttacks(SKELETON);
    expect(melee?.name).toBe('Короткий меч');
    expect(ranged?.name).toBe('Короткий лук');
    expect(ranged?.bonus).toBe(5);
    expect(ranged?.damages[0]).toMatchObject({ count: 1, sides: 6, bonus: 3 });
  });

  it('returns empty for description without attacks', () => {
    expect(parseAttacks('Аура живучести\nСущества рядом восстанавливают хиты.')).toEqual({});
  });
});

describe('rollAttack', () => {
  it('always rolls two d20 and all damage dice', () => {
    const { melee } = parseAttacks(MUMMY);
    const res = rollAttack(melee!);
    expect(res.attackRolls).toHaveLength(2);
    for (const r of res.attackRolls) {
      expect(r.die).toBeGreaterThanOrEqual(1);
      expect(r.die).toBeLessThanOrEqual(20);
      expect(r.total).toBe(r.die + 5);
    }
    expect(res.damageRolls).toHaveLength(2);
    expect(res.damageRolls[0].dice).toHaveLength(1); // 1к10
    expect(res.damageRolls[1].dice).toHaveLength(3); // 3к6
    // total = сумма костей + бонус
    const d1 = res.damageRolls[0];
    expect(d1.total).toBe(d1.dice.reduce((a, b) => a + b, 0) + 3);
  });
});
