import type {RollLog} from '../mvp/contracts';

/** Legacy logs have no role. Their first die is the base test (also supports set_die). */
export function splitD20Dice(roll: RollLog) {
  const faces = roll.dice.find(die => die.role !== 'bonus')?.sides ?? 20;
  const indexed = roll.dice.map((die, index) => ({die, index}));
  const isBonus = (die: RollLog['dice'][number]) => die.role === 'bonus' || die.sides !== faces;
  return {primary: indexed.filter(({die}) => !isBonus(die)), bonus: indexed.filter(({die}) => isBonus(die))};
}
