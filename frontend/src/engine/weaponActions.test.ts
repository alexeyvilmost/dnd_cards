import { describe, expect, it } from 'vitest';
import type { CharacterContext } from '../mvp/contracts';
import {
  CARD_DAGGER, CARD_FROST_HAMMER, CARD_LONGSWORD, CARD_SHIELD, FIGHTER_CTX,
  MECH_OFFHAND_ATTACK, MECH_UNARMED_STRIKE, MECH_WEAPON_ATTACK, ALL_CARDS,
} from '../mvp/fixtures';
import {
  weaponContext, weaponEnchant, weaponActionAvailability, weaponAttackPreview,
} from './weapon';

const CTX: CharacterContext = {
  ...FIGHTER_CTX,
  equippedCards: [CARD_LONGSWORD, CARD_DAGGER, CARD_FROST_HAMMER, CARD_SHIELD],
};

describe('weaponContext: многострочный урон + зачарование', () => {
  it('Молот мороза +1: основной 2d6 дробящий + стихийный 1d6 холод, enchant=1', () => {
    const w = weaponContext(CTX, 'main', { main_hand: CARD_FROST_HAMMER.id, off_hand: CARD_FROST_HAMMER.id });
    expect(w).toBeTruthy();
    expect(w!.dice).toBe('2d6');
    expect(w!.damageType).toBe('bludgeoning');
    expect(w!.enchant).toBe(1);
    expect(w!.damages).toEqual([
      { dice: '2d6', type: 'bludgeoning' },
      { dice: '1d6', type: 'cold' },
    ]);
  });

  it('обычный меч: одна строка урона, enchant=0', () => {
    const w = weaponContext(CTX, 'main', { main_hand: CARD_LONGSWORD.id });
    expect(w!.damages).toEqual([{ dice: '1d8', type: 'slashing' }]);
    expect(w!.enchant).toBe(0);
  });
});

describe('weaponEnchant: поле важнее имени, имя — запасной путь', () => {
  it('поле enchant_bonus имеет приоритет над именем', () => {
    expect(weaponEnchant({ ...CARD_LONGSWORD, name: 'Меч', enchant_bonus: 2 })).toBe(2);
  });
  it('без поля — разбор «+N» из имени', () => {
    expect(weaponEnchant({ ...CARD_LONGSWORD, name: 'Меч +3', enchant_bonus: null })).toBe(3);
  });
  it('нет ни поля, ни «+N» — 0', () => {
    expect(weaponEnchant({ ...CARD_LONGSWORD, name: 'Меч', enchant_bonus: null })).toBe(0);
  });
});

describe('weaponActionAvailability: доступность по экипировке', () => {
  it('Атака оружием: нужно оружие в правой руке', () => {
    expect(weaponActionAvailability(MECH_WEAPON_ATTACK, { main_hand: CARD_LONGSWORD.id }, ALL_CARDS).available).toBe(true);
    const empty = weaponActionAvailability(MECH_WEAPON_ATTACK, {}, ALL_CARDS);
    expect(empty.available).toBe(false);
    expect(empty.reason).toBe('Нет оружия в правой руке');
  });

  it('Атака оружием: щит в правой руке — недоступно', () => {
    const r = weaponActionAvailability(MECH_WEAPON_ATTACK, { main_hand: CARD_SHIELD.id }, ALL_CARDS);
    expect(r.available).toBe(false);
  });

  it('Атака второй рукой: нужно отдельное оружие во второй руке', () => {
    const dual = weaponActionAvailability(
      MECH_OFFHAND_ATTACK, { main_hand: CARD_LONGSWORD.id, off_hand: CARD_DAGGER.id }, ALL_CARDS);
    expect(dual.available).toBe(true);
  });

  it('Атака второй рукой: двуручный хват (та же карта в обеих руках) — недоступно', () => {
    const twoH = weaponActionAvailability(
      MECH_OFFHAND_ATTACK, { main_hand: CARD_FROST_HAMMER.id, off_hand: CARD_FROST_HAMMER.id }, ALL_CARDS);
    expect(twoH.available).toBe(false);
    expect(twoH.reason).toBe('Нет оружия во второй руке');
  });

  it('Безоружная атака: доступна только при свободной от оружия правой руке', () => {
    expect(weaponActionAvailability(MECH_UNARMED_STRIKE, {}, ALL_CARDS).available).toBe(true);
    const busy = weaponActionAvailability(MECH_UNARMED_STRIKE, { main_hand: CARD_LONGSWORD.id }, ALL_CARDS);
    expect(busy.available).toBe(false);
    expect(busy.reason).toBe('Правая рука занята оружием');
    // Щит — не оружие: безоружная доступна.
    expect(weaponActionAvailability(MECH_UNARMED_STRIKE, { main_hand: CARD_SHIELD.id }, ALL_CARDS).available).toBe(true);
  });

  it('не-оружейное действие не гейтится', () => {
    expect(weaponActionAvailability({ effects: [{ resolution: 'auto', result: [] }] }, {}, ALL_CARDS).available).toBe(true);
  });
});

describe('weaponAttackPreview: числа из оружия в руке', () => {
  it('меч в правой: атака +4 (СИЛ+БМ), урон 1d8 +2', () => {
    const p = weaponAttackPreview(MECH_WEAPON_ATTACK, CTX, { main_hand: CARD_LONGSWORD.id })!;
    expect(p.attack).toBe(4);
    expect(p.damages).toEqual([{ dice: '1d8', bonus: 2, type: 'slashing' }]);
  });

  it('кинжал во второй руке: атака +4, урон 1d4 БЕЗ мода характеристики', () => {
    const p = weaponAttackPreview(
      MECH_OFFHAND_ATTACK, CTX, { main_hand: CARD_LONGSWORD.id, off_hand: CARD_DAGGER.id })!;
    expect(p.attack).toBe(4);
    expect(p.damages).toEqual([{ dice: '1d4', bonus: 0, type: 'piercing' }]);
  });

  it('Молот мороза +1: атака +5 (СИЛ+БМ+зач.), урон 2d6 +3 дробящий и 1d6 холод (без бонуса)', () => {
    const p = weaponAttackPreview(
      MECH_WEAPON_ATTACK, CTX, { main_hand: CARD_FROST_HAMMER.id, off_hand: CARD_FROST_HAMMER.id })!;
    expect(p.attack).toBe(5); // 2 СИЛ + 2 БМ + 1 зачарование
    expect(p.damages).toEqual([
      { dice: '2d6', bonus: 3, type: 'bludgeoning' }, // 2 СИЛ + 1 зачарование
      { dice: '1d6', bonus: 0, type: 'cold' },        // стихийный — без мода/зачарования
    ]);
  });

  it('безоружная: атака +4, урон 1 +2', () => {
    const p = weaponAttackPreview(MECH_UNARMED_STRIKE, CTX, {})!;
    expect(p.attack).toBe(4);
    expect(p.damages).toEqual([{ dice: '1', bonus: 2, type: 'bludgeoning' }]);
  });

  it('нет оружия в руке — превью null (нечего показывать)', () => {
    expect(weaponAttackPreview(MECH_WEAPON_ATTACK, CTX, {})).toBeNull();
  });

  it('явная характеристика (не auto): зачарование НЕ идёт в атаку (зеркало движка), но идёт в урон', () => {
    const mech = { effects: [{ resolution: 'attack_roll', ability: 'str', on_hit: [{ kind: 'damage', dice: 'weapon' }] }] };
    const p = weaponAttackPreview(mech, CTX, { main_hand: CARD_FROST_HAMMER.id, off_hand: CARD_FROST_HAMMER.id })!;
    expect(p.attack).toBe(4); // СИЛ(2)+БМ(2), без +1 к атаке
    expect(p.damages[0]).toEqual({ dice: '2d6', bonus: 3, type: 'bludgeoning' }); // урон: +СИЛ +зачарование
  });
});
