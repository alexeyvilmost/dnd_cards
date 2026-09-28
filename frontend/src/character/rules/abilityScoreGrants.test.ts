import {describe, expect, it} from 'vitest';
import {applyAbilityScoreGrants} from './abilityScoreGrants';

describe('data-owned ability increase ceilings', () => {
  it('honors the ordinary cap and a second independent higher-cap grant', () => {
    expect(applyAbilityScoreGrants(19, [{amount: 2, cap: 20}])).toBe(20);
    expect(applyAbilityScoreGrants(20, [{amount: 1, cap: 30}])).toBe(21);
    expect(applyAbilityScoreGrants(29, [{amount: 2, cap: 30}])).toBe(30);
    expect(applyAbilityScoreGrants(21, [{amount: 3, cap: 22}])).toBe(22);
  });

  it('does not let capped increases borrow another source maximum or depend on traversal order', () => {
    const ordinary = {amount: 2, cap: 20};
    const exceptional = {amount: 1, cap: 30};
    expect(applyAbilityScoreGrants(19, [ordinary, exceptional])).toBe(21);
    expect(applyAbilityScoreGrants(19, [exceptional, ordinary])).toBe(21);
    expect(applyAbilityScoreGrants(20, [ordinary, exceptional])).toBe(21);
  });

  it('preserves high starting values, negative deltas, and the legacy default limit', () => {
    expect(applyAbilityScoreGrants(25, [{amount: 1}])).toBe(25);
    expect(applyAbilityScoreGrants(25, [{amount: 1}, {amount: -4}])).toBe(22);
    expect(applyAbilityScoreGrants(14, [{amount: 10}, {amount: -3}])).toBe(20);
    expect(applyAbilityScoreGrants(19, [{amount: 4}])).toBe(20);
    expect(applyAbilityScoreGrants(8, [{amount: -2, cap: 20}])).toBe(6);
  });
});
