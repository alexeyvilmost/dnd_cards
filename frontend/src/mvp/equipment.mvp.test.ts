/**
 * Фаза C — предметы: экипировка, вес, КЗ, оружейный контекст (шаги C2–C5).
 * Зелёный набор = «оружие/щиты/доспехи функциональны, надеть/снять работает».
 */
import { describe, expect, it } from 'vitest';
import { computeAC, equipItem, totalWeight, unequipSlot, weaponContext } from './contracts';
import {
  ALL_CARDS, CARD_CHAIN_MAIL, CARD_GREATAXE, CARD_LEATHER_ARMOR,
  CARD_LONGSWORD, CARD_SHIELD, FIGHTER_CTX, FIGHTER_CTX_EQUIPPED, freshFighterState,
} from './fixtures';

describe('C3: надеть/снять', () => {
  it('меч в основную руку, щит во вторую', () => {
    let { state } = equipItem(freshFighterState(), CARD_LONGSWORD);
    ({ state } = equipItem(state, CARD_SHIELD));
    expect(state.equipment.main_hand).toBe(CARD_LONGSWORD.id);
    expect(state.equipment.off_hand).toBe(CARD_SHIELD.id);
  });

  it('двуручное занимает обе руки; конфликт с занятой рукой — ошибка', () => {
    const { state: withSword } = equipItem(freshFighterState(), CARD_LONGSWORD);
    const res = equipItem(withSword, CARD_GREATAXE);
    expect(res.error).toBeTruthy(); // руки заняты — сначала снять
    const empty = freshFighterState();
    const { state, error } = equipItem(empty, CARD_GREATAXE);
    expect(error).toBeUndefined();
    // обе руки заняты секирой
    expect(state.equipment.main_hand).toBe(CARD_GREATAXE.id);
    expect(state.equipment.off_hand).toBe(CARD_GREATAXE.id);
  });

  it('снятие освобождает слот (двуручное — оба)', () => {
    const { state } = equipItem(freshFighterState(), CARD_GREATAXE);
    const after = unequipSlot(state, 'main_hand');
    expect(after.equipment.main_hand ?? null).toBeNull();
    expect(after.equipment.off_hand ?? null).toBeNull();
  });

  it('доспех в слот тела; второй доспех заменяет первый', () => {
    let { state } = equipItem(freshFighterState(), CARD_LEATHER_ARMOR);
    ({ state } = equipItem(state, CARD_CHAIN_MAIL));
    expect(state.equipment.body).toBe(CARD_CHAIN_MAIL.id);
  });
});

describe('C2: вес инвентаря', () => {
  it('суммарный вес: инвентарь + экипированное', () => {
    const state = freshFighterState(); // меч 1.5 + кинжал 0.5 + щит 3 + кожаный 5 = 10
    expect(totalWeight(state, ALL_CARDS)).toBeCloseTo(10);
  });
});

describe('C4: КЗ-конвейер с разбивкой', () => {
  it('без доспеха: 10 + ЛВК', () => {
    const bd = computeAC(FIGHTER_CTX, freshFighterState(), []);
    expect(bd.value).toBe(12);
    expect(bd.parts.some((p) => p.value === 10)).toBe(true); // база — видна в разбивке
  });

  it('кожаный доспех: 11 + ЛВК', () => {
    const { state } = equipItem(freshFighterState(), CARD_LEATHER_ARMOR);
    const bd = computeAC(FIGHTER_CTX_EQUIPPED, state, []);
    expect(bd.value).toBe(13);
  });

  it('кольчуга: фикс 16, ЛВК не добавляется; щит +2 поверх', () => {
    let { state } = equipItem(freshFighterState(), CARD_CHAIN_MAIL);
    expect(computeAC(FIGHTER_CTX, state, []).value).toBe(16);
    ({ state } = equipItem(state, CARD_SHIELD));
    const bd = computeAC(FIGHTER_CTX, state, []);
    expect(bd.value).toBe(18);
    expect(bd.parts.some((p) => p.source.toLowerCase().includes('щит') && p.value === 2)).toBe(true);
  });

  it('set_value из пассивки (Защита без доспехов 10+dex+con) применяется без брони', () => {
    const unarmoredDefense = {
      activation: { mode: 'passive' },
      effects: [{ resolution: 'auto', result: [{ kind: 'set_value', target: 'ac_base', formula: '10+dex+con' }] }],
    };
    const bd = computeAC(FIGHTER_CTX, freshFighterState(), [unarmoredDefense]);
    expect(bd.value).toBe(13); // 10 + 2 (ЛВК) + 1 (ТЕЛ)
  });
});

describe('C5: оружейный контекст (dice:"weapon", ability:"auto")', () => {
  it('основная рука: длинный меч → 1d8, СИЛ (не фехтовальное)', () => {
    const w = weaponContext(FIGHTER_CTX_EQUIPPED, 'main');
    expect(w).not.toBeNull();
    expect(w!.dice).toBe('1d8');
    expect(w!.ability).toBe('str');
    expect(w!.damageType).toBe('slashing');
  });

  it('вторая рука: кинжал → 1d4, ЛВК или СИЛ по большему (finesse)', () => {
    const w = weaponContext(FIGHTER_CTX_EQUIPPED, 'off');
    expect(w!.dice).toBe('1d4');
    // finesse: str=+2, dex=+2 — допустимы оба; главное, что выбран больший
    expect(['str', 'dex']).toContain(w!.ability);
  });

  it('пустая рука → null', () => {
    const ctx = { ...FIGHTER_CTX, equippedCards: [] };
    expect(weaponContext(ctx, 'main')).toBeNull();
  });
});
