import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {executeAction} from './execute';
import {validateMechanics} from './validateMechanics';
import {freshFighterState,FIGHTER_CTX_EQUIPPED} from '../mvp/fixtures';
const mechanics=JSON.parse(readFileSync(new URL('../../../backend/migrations/battle_master_bait_switch_226.go',import.meta.url),'utf8').match(/const battleMasterBaitSwitch226 = `([^`]+)`/)![1]);
it('validates Bait and Switch and refuses AC without a board exchange',()=>{
 const check=validateMechanics(mechanics,{id:'bait',name:'Bait',kind:'action'});expect(check.valid,check.errors.join('; ')).toBe(true);
 const state=freshFighterState();state.resources.superiority_die=4;state.maxResources.superiority_die=4;
 expect(()=>executeAction(state,mechanics,{character:FIGHTER_CTX_EQUIPPED,choices:{bait_ac_recipient:['self']},rng:()=>{throw Error('Unexpected RNG');}})).toThrow(/Обмен позициями/);
 expect(state.resources.superiority_die).toBe(4);
});
