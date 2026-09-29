/**
 * Optional die-aware extension of the historical `() => number` RNG boundary.
 * Plain seeded RNG functions remain valid. Strict scenario tapes implement
 * `rollDie` so the requested die size is checked before a draw is consumed.
 */
import type { RollD20Options, DieRoll } from '../mvp/contracts';

export interface DieAwareRandomSource {
  (): number;
  rollDie?: (sides: number) => number;
  /** Observation only: records the exact draw ordinal for a saved continuation. */
  onDieDraw?: (sides: number, result: number) => void;
  /** Last die ordinal assigned by a recording continuation, if present. */
  lastDieDrawOrdinal?: number;
  /** Read-only simulations can stop at the fully derived roll, before any draw. */
  inspectD20?: (options: RollD20Options) => void;
  transformD20?: (options: RollD20Options) => RollD20Options;
  /** Trusted continuation may replace one kept d20, never the whole action. */
  rerollD20?: (dice: readonly DieRoll[]) => number | undefined;
  rerollD20Source?: string;
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
    dieAware.onDieDraw?.(sides,result);
    return result;
  }

  const unit = rng();
  if (!Number.isFinite(unit) || unit < 0 || unit >= 1) {
    throw new Error(`RNG must return a finite value in [0, 1), got ${unit}`);
  }
  const result = Math.floor(unit * sides) + 1;
  dieAware.onDieDraw?.(sides,result);
  return result;
}
