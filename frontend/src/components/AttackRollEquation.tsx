import {Shield} from 'lucide-react';
import type {RollLog} from '../mvp/contracts';

/** The same saved attack arithmetic in roll presentation and reaction windows. */
export default function AttackRollEquation({roll}: {roll: RollLog}) {
  const natural = roll.dice.find(die => die.sides === 20 && !die.discarded)?.result;
  return <div className="combat-roll-equation">
    {natural !== undefined && <span>{natural} {roll.total-natural < 0 ? '−' : '+'} {Math.abs(roll.total-natural)} =</span>}
    <strong>{roll.total}</strong>
    {roll.target && <span>{roll.total >= roll.target.value ? '≥' : '<'} <Shield size={18}/> КД {roll.target.value}</span>}
  </div>;
}
