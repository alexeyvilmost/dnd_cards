import {rollFormula,type FormulaContext,type FormulaModifier,type FormulaRollResult} from './formula';
import type {AdvantageState} from '../mvp/contracts';

/** Compare complete damage expressions; keep the discarded dice as replay evidence. */
export function rollDamageFormulaWithAdvantage(
  expression:string,
  context:FormulaContext,
  options:{rng:()=>number;diceMultiplier?:1|2;modifiers?:FormulaModifier[];advantage?:AdvantageState},
):FormulaRollResult {
  const first=rollFormula(expression,context,options);
  if(!first.dice.length||!options.advantage||options.advantage==='none')return first;
  const second=rollFormula(expression,context,options);
  const secondWins=options.advantage==='advantage'?second.total>first.total:second.total<first.total;
  const kept=secondWins?second:first,discarded=secondWins?first:second;
  return {...kept,dice:[...kept.dice,...discarded.dice.map(die=>({...die,discarded:true}))],
    text:`${kept.text} (${options.advantage==='advantage'?'преимущество':'помеха'}; отброшено ${discarded.total})`};
}
