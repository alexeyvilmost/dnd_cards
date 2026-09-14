import {describe,it,expect} from 'vitest';
import {actionUsagePreview} from './actionUsagePreview';
describe('action usage preview',()=>{
  const action={id:'breath',card_number:'ACT-breath',mechanics:{activation:{cost:[{resource:'action'},{resource:'self_uses'}]}}};
  it('reads remaining charges and spent charges without hiding exhausted abilities',()=>{
    expect(actionUsagePreview(action,{resources:{'uses_ACT-breath':1},maxResources:{'uses_ACT-breath':3}})).toEqual([{key:'uses_ACT-breath',remaining:1,maximum:3,spent:2}]);
    expect(actionUsagePreview(action,{resources:{},maxResources:{'uses_ACT-breath':3}})[0].remaining).toBe(0);
  });
  it('supports bound pools and named class resources without reporting turn economy as charges',()=>{
    const bound={...action,mechanics:{activation:{cost:[{resource:'bonus_action'},{resource:'second_wind'}]}}};
    expect(actionUsagePreview(bound,{resources:{bonus_action:1,second_wind:1},maxResources:{bonus_action:1,second_wind:2}})).toEqual([{key:'second_wind',remaining:1,maximum:2,spent:1}]);
  });
  it('does not invent a live resource count outside a character context',()=>expect(actionUsagePreview(action)).toEqual([]));
});
