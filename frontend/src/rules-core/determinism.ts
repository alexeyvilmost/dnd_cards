/** Strict deterministic inputs shared by scenario tests and runtime adapters. */

export interface DieTapeEntry {
  label: string;
  sides: number;
  value: number;
}

export interface StrictDieAwareRng {
  /** A strict tape cannot be consumed without declaring the requested die. */
  (): never;
  rollDie: (sides: number) => number;
}

export interface StrictRngTape {
  rng: StrictDieAwareRng;
  consumed: () => number;
  remaining: () => number;
  assertExhausted: () => void;
}

/**
 * Adapts explicit die results to the legacy callable RNG boundary while also
 * exposing a die-aware method. Each engine draw must declare its requested
 * sides. Missing, extra, mismatched and invalid results are errors; tests never
 * fall back to Math.random.
 */
export function createStrictRngTape(entries: readonly DieTapeEntry[]): StrictRngTape {
  const tape = entries.map((entry) => ({ ...entry }));
  let index = 0;

  const readEntry = (requestedSides: number): number => {
    if (!Number.isInteger(requestedSides) || requestedSides < 2) {
      throw new Error(`Invalid requested die sides: ${requestedSides}`);
    }
    const entry = tape[index];
    if (!entry) throw new Error(`RNG tape exhausted after ${index} draws`);
    if (!Number.isInteger(entry.sides) || entry.sides < 2) {
      throw new Error(`Invalid die sides at ${entry.label}: ${entry.sides}`);
    }
    if (!Number.isInteger(entry.value) || entry.value < 1 || entry.value > entry.sides) {
      throw new Error(`Invalid d${entry.sides} result at ${entry.label}: ${entry.value}`);
    }
    if (entry.sides !== requestedSides) {
      throw new Error(
        `RNG die mismatch at ${entry.label}: engine requested d${requestedSides}, tape declares d${entry.sides}`,
      );
    }
    index += 1;
    return entry.value;
  };

  const rng = Object.assign(
    (): never => {
      const entry = tape[index];
      if (!entry) throw new Error(`RNG tape exhausted after ${index} draws`);
      throw new Error(`RNG draw at ${entry.label} did not declare requested die sides`);
    },
    { rollDie: readEntry },
  );

  return {
    rng,
    consumed: () => index,
    remaining: () => tape.length - index,
    assertExhausted: () => {
      if (index !== tape.length) {
        const unused = tape.slice(index).map((entry) => entry.label).join(', ');
        throw new Error(`RNG tape has ${tape.length - index} unused draws: ${unused}`);
      }
    },
  };
}

export function createLogicalClock(start = 0): () => number {
  let value = start;
  return () => {
    value += 1;
    return value;
  };
}

export function createSequentialIdFactory(prefix = 'id', start = 0): () => string {
  let value = start;
  return () => {
    value += 1;
    return `${prefix}-${value}`;
  };
}

function normalizeCanonical(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON cannot contain a non-finite number');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((item) => normalizeCanonical(item, seen));
  if (typeof value !== 'object') {
    throw new Error(`Canonical JSON cannot contain ${typeof value}`);
  }
  if (seen.has(value)) throw new Error('Canonical JSON cannot contain cycles');
  seen.add(value);
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    const item = source[key];
    if (item === undefined) continue;
    result[key] = normalizeCanonical(item, seen);
  }
  seen.delete(value);
  return result;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(normalizeCanonical(value, new Set()));
}

export async function canonicalSha256(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable');
  const bytes = new TextEncoder().encode(canonicalStringify(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
