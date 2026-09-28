import { describe, expect, it } from 'vitest';
import { finiteDurationRounds } from './duration';

describe('finite effect duration', () => {
  it.each([
    [{ type: 'rounds', amount: 3 }, 3],
    [{ type: 'minutes', amount: 10 }, 100],
    [{ type: 'hours', amount: 8 }, 4800],
    [{ type: 'minutes', amount: 0 }, 1],
    [{ type: 'rounds', amount: '1d4' }, 1],
    [{ type: 'hours', amount: Infinity }, 1],
  ])('resolves %j into %i rounds', (duration, rounds) => {
    expect(finiteDurationRounds(duration)).toBe(rounds);
  });

  it('keeps event-based and unbounded durations separate from finite time', () => {
    expect(finiteDurationRounds({ type: 'until_long_rest' })).toBeUndefined();
    expect(finiteDurationRounds({ type: 'concentration' })).toBeUndefined();
    expect(finiteDurationRounds(undefined)).toBeUndefined();
  });
});
