import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';
import { computeAC } from './ac';

const mediumArmor = {
  id: 'test-half-plate', name: 'Полулаты', type: 'chest', slot: 'body',
  defense_type: 'medium', bonus_type: 'defense', bonus_value: '15 + min(dex, 2)',
  rarity: 'common',
} as unknown as Card;

const state: RuntimeState = {
  hp: { current: 20, max: 20, temp: 0 },
  resources: {}, maxResources: {}, activeEffects: [], firedThisTurn: [],
  inventory: [{ cardId: mediumArmor.id, qty: 1 }], equipment: { body: mediumArmor.id },
};

const character = (dex: number): CharacterContext => ({
  abilityScores: { str: 10, dex, con: 10, int: 10, wis: 10, cha: 10 },
  abilityMods: { str: 0, dex: Math.floor((dex - 10) / 2), con: 0, int: 0, wis: 0, cha: 0 },
  profBonus: 2, level: 4, classLevels: { fighter: 4 }, equippedCards: [mediumArmor],
});

const mediumArmorMaster = {
  activation: { mode: 'passive' },
  effects: [{ resolution: 'auto', result: [{
    kind: 'modifier', op: 'set', value: 3,
    applies_to: { stat: 'medium_armor_dex_cap', requirement: { dex: 16 } },
  }] }],
};

describe('Medium Armor Master data-owned AC cap', () => {
  it('raises the cap to +3 only in medium armor at Dexterity 16+', () => {
    expect(computeAC(character(16), state, []).value).toBe(17);
    expect(computeAC(character(16), state, [mediumArmorMaster]).value).toBe(18);
    expect(computeAC(character(14), state, [mediumArmorMaster]).value).toBe(17);
  });

  it('does not treat active payloads as permanent build modifiers', () => {
    const active = { ...mediumArmorMaster, activation: { mode: 'active' } };
    expect(computeAC(character(16), state, [active]).value).toBe(17);
  });
});
