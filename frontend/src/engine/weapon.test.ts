import { describe, expect, it } from 'vitest';
import { collectRollModifiers, executeAction } from '../mvp/contracts';
import { CARD_DAGGER, CARD_LONGSWORD, FIGHTER_CTX, freshFighterState, MECH_DODGE, seededRng } from '../mvp/fixtures';
import { weaponContext } from './weapon';

describe('weaponContext slots (R3)', () => {
  it('основная рука по слоту, не по порядку карточек в массиве', () => {
    const ctx = {
      ...FIGHTER_CTX,
      equippedCards: [CARD_DAGGER, CARD_LONGSWORD],
    };
    const equipment = { main_hand: CARD_LONGSWORD.id, off_hand: CARD_DAGGER.id };
    expect(weaponContext(ctx, 'main', equipment)?.dice).toBe('1d8');
    expect(weaponContext(ctx, 'off', equipment)?.dice).toBe('1d4');
  });
});

describe('matchFilter dodge (R2)', () => {
  it('после Уклонения: свой бросок атаки без помехи, входящий — с помехой', () => {
    const { state } = executeAction(freshFighterState(), MECH_DODGE, {
      character: FIGHTER_CTX,
      rng: seededRng(1),
    });
    const own = collectRollModifiers(state, [], { roll: 'attack' });
    expect(own.advantage).toBe('none');

    const incoming = collectRollModifiers(state, [], { roll: 'attack', filter: { against: 'self' } });
    expect(incoming.advantage).toBe('disadvantage');
  });
});
