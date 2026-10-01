import {describe, expect, it} from 'vitest';
import {lostHealthFraction} from './tokenHealth';

describe('portrait shading represents lost hits', () => {
  it.each([[10, 20], [7, 14]])('shades the lower half for %i / %i hits', (hp, maxHp) => {
    expect(lostHealthFraction(hp, maxHp)).toBe(.5);
  });
  it('leaves a healthy portrait clear, fills a fallen portrait and clamps stale values', () => {
    expect(lostHealthFraction(20, 20)).toBe(0);
    expect(lostHealthFraction(0, 20)).toBe(1);
    expect(lostHealthFraction(-5, 20)).toBe(1);
    expect(lostHealthFraction(25, 20)).toBe(0);
    expect(lostHealthFraction(1, 0)).toBe(0);
  });
});
