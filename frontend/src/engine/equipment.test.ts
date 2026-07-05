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
});

describe('weapon', () => {
  it('main hand longsword', () => {
    const w = weaponContext(FIGHTER_CTX_EQUIPPED, 'main');
    expect(w?.dice).toBe('1d8');
    expect(w?.ability).toBe('str');
  });
});
