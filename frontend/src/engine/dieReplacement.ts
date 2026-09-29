import {drawDie, type DieAwareRandomSource} from './random';

export interface DieReplacement {
  /** Zero-based index among all dice drawn by one authoritative command. */
  ordinal: number;
  sides: number;
  result: number;
}

/** Replay an already saved RNG transcript while replacing one selected die.
 * The original draw is still consumed, so every later die keeps its result. */
export function withDieReplacement(rng: () => number, replacement: DieReplacement | readonly DieReplacement[]): DieAwareRandomSource {
  const replacements=Array.isArray(replacement)?replacement:[replacement];
  const byOrdinal=new Map<number,DieReplacement>();
  for(const die of replacements){
    if (!Number.isSafeInteger(die.ordinal) || die.ordinal < 0
      || !Number.isSafeInteger(die.sides) || die.sides < 2
      || !Number.isSafeInteger(die.result) || die.result < 1
      || die.result > die.sides || byOrdinal.has(die.ordinal)) throw Error('Invalid die replacement');
    byOrdinal.set(die.ordinal,die);
  }
  let ordinal = 0;
  const wrapped: DieAwareRandomSource = () => rng();
  wrapped.rollDie = sides => {
    const original = drawDie(rng,sides);
    const current = ordinal++;
    const selected=byOrdinal.get(current);
    if (!selected) return original;
    if (sides !== selected.sides) throw Error('Replaced die no longer matches the saved continuation');
    return selected.result;
  };
  wrapped.inspectD20 = (rng as DieAwareRandomSource).inspectD20;
  wrapped.transformD20 = (rng as DieAwareRandomSource).transformD20;
  return wrapped;
}
