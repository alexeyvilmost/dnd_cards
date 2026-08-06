/**
 * Optional die-aware extension of the historical `() => number` RNG boundary.
 * Plain seeded RNG functions remain valid. Strict scenario tapes implement
 * `rollDie` so the requested die size is checked before a draw is consumed.
 */
export interface DieAwareRandomSource {
  (): number;
  rollDie?: (sides: number) => number;
}

export function drawDie(rng: () => number, sides: number): number {
  if (!Number.isInteger(sides) || sides < 2) {
    throw new Error(`Invalid requested die sides: ${sides}`);
  }

  const dieAware = rng as DieAwareRandomSource;
  if (typeof dieAware.rollDie === 'function') {
    const result = dieAware.rollDie(sides);
    if (!Number.isInteger(result) || result < 1 || result > sides) {
      throw new Error(`Die-aware RNG returned invalid d${sides} result: ${result}`);
    }
    return result;
  }

  const unit = rng();
  if (!Number.isFinite(unit) || unit < 0 || unit >= 1) {
    throw new Error(`RNG must return a finite value in [0, 1), got ${unit}`);
  }
  return Math.floor(unit * sides) + 1;
}
