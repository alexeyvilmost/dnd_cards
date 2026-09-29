import {describe,expect,it} from 'vitest';
import {rollDamageFormulaWithAdvantage} from './damageAdvantage';
import {createStrictRngTape} from '../rules-core/determinism';
describe('data-owned damage advantage',()=>{
  it.each(['advantage','disadvantage'] as const)('keeps the whole %s roll and preserves every die',advantage=>{
    const tape=createStrictRngTape([1,6,4,4].map(value=>({label:'damage',sides:6,value})));
    const result=rollDamageFormulaWithAdvantage('2d6+3',{}, {rng:tape.rng,advantage});
    expect(result.total).toBe(advantage==='advantage'?11:10);
    expect(result.total-result.dice.filter(d=>!d.discarded).reduce((sum,d)=>sum+d.result,0)).toBe(3);
    expect(result.dice.filter(d=>!d.discarded).map(d=>d.result)).toEqual(advantage==='advantage'?[4,4]:[1,6]);
    expect(result.dice.filter(d=>d.discarded)).toHaveLength(2);tape.assertExhausted();
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
  it('rolls a second item’s critical dice twice without doubling its flat bonus',()=>{
    const tape=createStrictRngTape([2,3,8,7].map(value=>({label:'critical',sides:8,value})));
    const result=rollDamageFormulaWithAdvantage('1d8+2',{}, {rng:tape.rng,advantage:'advantage',diceMultiplier:2});
    expect(result.total).toBe(17);tape.assertExhausted();
  });
});
