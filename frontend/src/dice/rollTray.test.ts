import {describe, expect, it} from 'vitest';
import {rollD20} from '../engine/roll';
import {splitD20Dice} from './rollTray';
describe('data-owned additional dice presentation', () => {
  it('separates Bless and a differently-sized negative boon without altering results', () => {
    const roll = rollD20({rng:()=>.5, target:{type:'dc',value:14}, rules:[
      {op:'bonus_die',faces:4,source:'Благословение'}, {op:'bonus_die',faces:6,sign:-1,source:'Проклятие'},
    ]});
    const before = JSON.stringify(roll);
    expect(roll.total).toBe(11 + 3 - 4);
    expect(splitD20Dice(roll).bonus.map(({die})=>die.source)).toEqual(['Благословение','Проклятие']);
    expect(splitD20Dice(roll).primary).toHaveLength(1);
    expect(JSON.stringify(roll)).toBe(before);
  });
  it('does not mistake a bonus d20 for an advantage candidate, even with a reroll', () => {
    const roll=rollD20({rng:()=>.25,advantage:'advantage',rules:[{op:'reroll',natural:{max:7}},{op:'bonus_die',faces:20,source:'Кольцо'}]});
    expect(splitD20Dice(roll).primary).toHaveLength(3);
    expect(splitD20Dice(roll).bonus).toHaveLength(1);
    expect(splitD20Dice(roll).bonus[0].die.role).toBe('bonus');
  });
  it('reads historical logs and replacement base die sizes without rewriting them',()=>{
    const roll=rollD20({rng:()=>.5,rules:[{op:'set_die',faces:24},{op:'bonus_die',faces:4}]});
    const legacy={...roll,dice:roll.dice.map(({role:_,...die})=>die)};
    expect(splitD20Dice(legacy).primary[0].die.sides).toBe(24);
    expect(splitD20Dice(legacy).bonus[0].die.sides).toBe(4);
  });
});
