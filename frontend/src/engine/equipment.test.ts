import { describe, expect, it, beforeEach } from 'vitest';
import { equipItem, totalWeight } from './equipment';
import { computeAC } from './ac';
import { weaponContext } from './weapon';
import { clearCardRegistry } from './cardRegistry';
import {
  ALL_CARDS, CARD_CHAIN_MAIL,
  CARD_LONGSWORD, CARD_SHIELD,
  FIGHTER_CTX, FIGHTER_CTX_EQUIPPED, freshFighterState,
} from '../mvp/fixtures';
import type { Card } from '../types';

beforeEach(() => clearCardRegistry());

describe('equipment', () => {
  it('equips sword and shield', () => {
    let { state } = equipItem(freshFighterState(), CARD_LONGSWORD);
    ({ state } = equipItem(state, CARD_SHIELD));
    expect(state.equipment.main_hand).toBe(CARD_LONGSWORD.id);
    expect(state.equipment.off_hand).toBe(CARD_SHIELD.id);
  });

  it('totalWeight from inventory', () => {
    expect(totalWeight(freshFighterState(), ALL_CARDS)).toBeCloseTo(10);
  });
});

describe('ac', () => {
  it('unarmored 10+dex', () => {
    expect(computeAC(FIGHTER_CTX, freshFighterState(), []).value).toBe(12);
  });

  it('chain mail + shield', () => {
    let { state } = equipItem(freshFighterState(), CARD_CHAIN_MAIL);
    ({ state } = equipItem(state, CARD_SHIELD));
    expect(computeAC(FIGHTER_CTX, state, []).value).toBe(18);
  });

  it('KB-004: битая (кириллическая) формула КЗ не роняет расчёт — метод в rejected', () => {
    // До фикса formula.ts бросал FormulaError на «12 + ЛВК», computeAC не ловил → без
    // ErrorBoundary весь лист уходил в белый экран, и снять предмет было нельзя.
    const broken = {
      id: 'test-broken-ac-formula',
      name: 'Одежды с битой формулой',
      type: 'chest',
      defense_type: 'light',
      bonus_type: 'defense',
      bonus_value: '12 + ЛВК',
      rarity: 'common',
    } as unknown as Card;
    const { state } = equipItem(freshFighterState(), broken);

    const ac = computeAC(FIGHTER_CTX, state, []);
    // Не бросил; откат на безоружную базу 10 + ЛВК (FIGHTER_CTX: ЛВК +2 → 12).
    expect(ac.value).toBe(12);
    expect(ac.rejected?.some((r) => r.name.includes('не распознана'))).toBe(true);
  });
});

describe('weapon', () => {
  it('main hand longsword', () => {
    const w = weaponContext(FIGHTER_CTX_EQUIPPED, 'main');
    expect(w?.dice).toBe('1d8');
    expect(w?.ability).toBe('str');
  });
});
