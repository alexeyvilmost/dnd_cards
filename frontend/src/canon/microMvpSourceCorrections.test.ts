import { describe, expect, it } from 'vitest';
import { excludesMicroMvpL1SourceEffect } from './microMvpSourceCorrections';

describe('micro-MVP source corrections shared by compiler and Forge', () => {
  it.each([
    ['RACE-0002', undefined, 'RE-elf-3'],
    ['RACE-0008', undefined, 'RE-dragonborn-4'],
    [undefined, 'CLASS-warlock', 'EFF-pact-boon'],
  ])('removes the foreign L1 source relation %s/%s/%s', (
    raceCardNumber,
    classCardNumber,
    effectCardNumber,
  ) => {
    expect(excludesMicroMvpL1SourceEffect({
      characterLevel: 1,
      raceCardNumber,
      classCardNumber,
      effectCardNumber,
    })).toBe(true);
  });

  it('does not silently apply the milestone correction outside level 1 or to another owner', () => {
    expect(excludesMicroMvpL1SourceEffect({
      characterLevel: 5,
      raceCardNumber: 'RACE-0008',
      effectCardNumber: 'RE-dragonborn-4',
    })).toBe(false);
    expect(excludesMicroMvpL1SourceEffect({
      characterLevel: 1,
      raceCardNumber: 'RACE-0002',
      effectCardNumber: 'RE-human-2',
    })).toBe(false);
  });
});
