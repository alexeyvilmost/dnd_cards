import {describe,it,expect} from 'vitest';
import {projectRuntimeCharacter} from './runtimeCharacterProjection';
import {FIGHTER_CTX_EQUIPPED,equippedFighterState} from '../mvp/fixtures';
import {executeAction} from './execute';
describe('data owned effective total level',()=>{
 it.each([{base:4,amount:1,result:5,pb:3},{base:8,amount:2,result:10,pb:4}])('projects $base+$amount without inventing class progression or accumulating after reload',({base,amount,result,pb})=>{
  const character={...FIGHTER_CTX_EQUIPPED,level:base,profBonus:Math.floor((base-1)/4)+2,classLevels:{fighter:base}};
  const source={kind:'effective_level',amount};const state=equippedFighterState();
  const projected=projectRuntimeCharacter(character,state,[source]);expect(projected.level).toBe(result);expect(projected.profBonus).toBe(pb);expect(projected.classLevels).toEqual({fighter:base});
  const restored=JSON.parse(JSON.stringify(projected));expect(projectRuntimeCharacter(restored,state,[source]).level).toBe(result);
  const revoked=projectRuntimeCharacter(restored,state,[]);expect(revoked.level).toBe(base);expect(revoked.profBonus).toBe(character.profBonus);
  const cast=executeAction(state,{effects:[{resolution:'auto',who:'self',result:[{kind:'temp_hp',amount:'self_level'}]}]},{character,rng:()=>{throw Error('no dice');},passives:[source]});
  expect(cast.state.hp.temp).toBe(result);
 });
});
