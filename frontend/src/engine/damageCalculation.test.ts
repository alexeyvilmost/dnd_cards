import { describe, expect, it } from 'vitest';
import { applyIncomingDamage } from './execute';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';
import { isDamageCalculation } from './damageCalculation';
const character: CharacterContext = { level: 3, profBonus: 2, abilityMods: { str: 3, dex: 2, con: 2, int: 0, wis: 0, cha: 0 } };
const state = (): RuntimeState => ({ hp: { current: 30, max: 30, temp: 0 }, resources: {}, maxResources: {},
  activeEffects: [], equipment: {}, inventory: [] });
const passive = (value: string) => ({ kind: 'resistance', damage_type: 'fire', value });
describe('ordered damage adjustments', () => {
  it('reduces before resistance, then applies vulnerability once', () => {
    const result = applyIncomingDamage(state(), 10, { character, rng: () => 0.5, passives: [passive('vulnerability'), passive('resistance'), passive('resistance')] },
      { damageType: 'fire', damageReduction: 3 });
    expect(result.state.hp.current).toBe(24); // floor((10 - 3) / 2) * 2
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'damage', amount: 6,
      calculation: { beforeResistance: 7, adjustments: [
        { level: 'resistance', sourceEntityIds: [] }, { level: 'vulnerability', sourceEntityIds: [] },
      ] } }));
  });
  it.each([['vulnerability', 10], ['immunity', 30]])('ignoring resistance preserves %s', (level, hp) => {
    const result = applyIncomingDamage(state(), 10, { character, rng: () => 0.5, passives: [passive(level as string), passive('resistance')] },
      { damageType: 'fire', ignoreResistance: true });
    expect(result.state.hp.current).toBe(hp);
  });
  it('rejects noncanonical saved calculation order and malformed values', () => {
    expect(isDamageCalculation({ beforeResistance: 8, adjustments: [] })).toBe(true);
    expect(isDamageCalculation({ beforeResistance: -1, adjustments: [] })).toBe(false);
    expect(isDamageCalculation({ beforeResistance: 8, adjustments: [{ level: 'vulnerability', sourceEntityIds: [] },
      { level: 'resistance', sourceEntityIds: [] }] })).toBe(false);
  });
});
