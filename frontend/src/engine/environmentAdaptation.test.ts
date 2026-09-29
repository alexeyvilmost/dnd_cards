import {describe,it,expect} from 'vitest';
import {executeAction} from './execute';
import {environmentAdaptation} from './environmentAdaptation';
import {equippedFighterState,FIGHTER_CTX_EQUIPPED,MECH_WEAPON_ATTACK} from '../mvp/fixtures';
describe('temporary environmental adaptation restrictions',()=>{
 it.each([{kind:'environment_adaptation',cannot_attack:true},{kind:'environment_adaptation',cannot_cast:true}])('rejects the prohibited action before payment or RNG: %j',payload=>{
  const state=equippedFighterState();state.activeEffects=[{id:'form',name:'Form',source:'Potion',roundsLeft:600,mechanics:payload}];
  const mechanics=payload.cannot_attack?MECH_WEAPON_ATTACK:{activation:{mode:'active',cost:[{resource:'action'}]},effects:[{resolution:'auto',result:[{kind:'healing',amount:1}]}]};
  const ctx={character:FIGHTER_CTX_EQUIPPED,rng:()=>{throw Error('No RNG expected');},...(payload.cannot_cast?{spell:{spellId:'spell',baseLevel:1,slotLevel:1}}:{})};
  expect(()=>executeAction(state,mechanics,ctx)).toThrow(/форма запрещает/);expect(state.resources.action).toBe(1);
  const restored=JSON.parse(JSON.stringify(state));restored.activeEffects[0].roundsLeft=0;
  expect(environmentAdaptation(restored)).toMatchObject({cannotAttack:false,cannotCast:false});
 });
});
