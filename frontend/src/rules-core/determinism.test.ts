import { describe, expect, it } from 'vitest';
import {
  canonicalSha256,
  canonicalSha256Sync,
  canonicalStringify,
  createLogicalClock,
  createSequentialIdFactory,
  createStrictRngTape,
  sha256String,
} from './determinism';

describe('deterministic runtime inputs', () => {
  it('strict RNG consumes declared die results without random fallback', () => {
    const tape = createStrictRngTape([
      { label: 'attack', sides: 20, value: 17 },
      { label: 'damage', sides: 8, value: 6 },
    ]);
    expect(tape.rng.rollDie(20)).toBe(17);
    expect(tape.rng.rollDie(8)).toBe(6);
    expect(tape.consumed()).toBe(2);
    tape.assertExhausted();
    expect(() => tape.rng.rollDie(6)).toThrow(/exhausted/);
  });

  it('strict RNG rejects invalid and unused entries', () => {
    const invalid = createStrictRngTape([{ label: 'bad', sides: 6, value: 7 }]);
    expect(() => invalid.rng.rollDie(6)).toThrow(/Invalid d6 result/);

    const unused = createStrictRngTape([{ label: 'save', sides: 20, value: 10 }]);
    expect(() => unused.assertExhausted()).toThrow(/unused draws: save/);
  });

  it('binds each tape entry to the die size requested by the engine', () => {
    const wrongDie = createStrictRngTape([{ label: 'attack mislabeled as damage', sides: 6, value: 4 }]);
    expect(() => wrongDie.rng.rollDie(20)).toThrow(
      /engine requested d20, tape declares d6/,
    );
    expect(wrongDie.consumed()).toBe(0);

    const undeclared = createStrictRngTape([{ label: 'attack', sides: 20, value: 12 }]);
    expect(() => undeclared.rng()).toThrow(/did not declare requested die sides/);
    expect(undeclared.consumed()).toBe(0);
  });

  it('clock and ID factory are monotonic and injected', () => {
    const clock = createLogicalClock(40);
    const nextId = createSequentialIdFactory('event', 8);
    expect([clock(), clock()]).toEqual([41, 42]);
    expect([nextId(), nextId()]).toEqual(['event-9', 'event-10']);
  });
});

describe('canonical serialization', () => {
  it('sorts object keys recursively while preserving array order', () => {
    const a = { z: [{ b: 2, a: 1 }], a: true };
    const b = { a: true, z: [{ a: 1, b: 2 }] };
    expect(canonicalStringify(a)).toBe('{"a":true,"z":[{"a":1,"b":2}]}');
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it('produces the same SHA-256 for semantically identical JSON', async () => {
    await expect(canonicalSha256({ b: 2, a: 1 })).resolves.toBe(
      await canonicalSha256({ a: 1, b: 2 }),
    );
    expect(await canonicalSha256({ a: 2 })).not.toBe(await canonicalSha256({ a: 1 }));
  });

  it('constructs synchronous browser SHA-256 identities without shortening the digest', async () => {
    expect(sha256String('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256String('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    const value = { unicode: 'Рука мага', nested: [{ b: 2, a: 1 }] };
    expect(canonicalSha256Sync(value)).toBe(await canonicalSha256(value));
    expect(canonicalSha256Sync(value)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('rejects cycles and non-finite values', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => canonicalStringify(cyclic)).toThrow(/cycles/);
    expect(() => canonicalStringify({ value: Number.NaN })).toThrow(/non-finite/);
  });
});
