import { describe, expect, it } from 'vitest';
import { parseActivationCastTime } from './activationCastTime';

describe('parseActivationCastTime', () => {
  it.each([
    ['action', 1, 6, true],
    ['bonus_action', 1, 6, true],
    ['reaction', 1, 6, true],
    ['round', 1, 6, false],
    ['minute', 1, 60, false],
    ['hour', 2, 7_200, false],
  ] as const)('normalizes %s × %i from mechanics', (unit, amount, seconds, atomicInEncounter) => {
    expect(parseActivationCastTime({
      activation: { cast_time: { unit, amount } },
    })).toEqual({
      status: 'valid',
      policy: { unit, amount, seconds, atomicInEncounter },
    });
  });

  it('does not infer casting time from spell identity or display text', () => {
    expect(parseActivationCastTime({ id: 'mending', name: '1 минута' }))
      .toEqual({ status: 'none' });
  });

  it.each([
    { activation: 'action' },
    { activation: { cast_time: 'minute' } },
    { activation: { cast_time: { unit: 'turn', amount: 1 } } },
    { activation: { cast_time: { unit: 'minute', amount: 0 } } },
    { activation: { cast_time: { unit: 'minute', amount: 1.5 } } },
    { activation: { cast_time: { unit: 'minute', amount: Number.NaN } } },
    { activation: { cast_time: { unit: 'minute', amount: 1, seconds: 60 } } },
  ])('fails closed for malformed declaration %#', (mechanics) => {
    expect(parseActivationCastTime(mechanics)).toMatchObject({ status: 'invalid' });
  });
});
