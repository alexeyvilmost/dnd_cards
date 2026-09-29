import {describe,expect,it} from 'vitest';
import {withDieReplacement} from './dieReplacement';
import {drawDie} from './random';

describe('die transcript replacement',()=>{
  it('changes exactly one non-d20 die and consumes its old draw',()=>{
    const values=[.25,.5,.75];let cursor=0;
    const rng=withDieReplacement(()=>values[cursor++],{ordinal:1,sides:6,result:1});
    expect([drawDie(rng,20),drawDie(rng,6),drawDie(rng,8)]).toEqual([6,1,7]);
    expect(cursor).toBe(3);
  });
  it('rejects a changed die size rather than replacing another roll',()=>{
    const rng=withDieReplacement(()=>.5,{ordinal:1,sides:8,result:3});
    expect(drawDie(rng,20)).toBe(11);
    expect(()=>drawDie(rng,6)).toThrow(/no longer matches/);
  });
});
