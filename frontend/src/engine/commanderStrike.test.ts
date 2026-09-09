import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {executeAction} from './execute';
import {validateMechanics} from './validateMechanics';
import {freshFighterState,FIGHTER_CTX_EQUIPPED} from '../mvp/fixtures';
const mechanics=JSON.parse(readFileSync(new URL('../../../backend/migrations/battle_master_commander_227.go',import.meta.url),'utf8').match(/const battleMasterCommander227 = `([^`]+)`/)![1]);
it('validates Commander Strike and rejects an off-board use without an ally reaction',()=>{
 const check=validateMechanics(mechanics,{id:'commander',name:'Commander',kind:'action'});
 expect(check.valid,check.errors.join('; ')).toBe(true);
 const state=freshFighterState();state.resources.superiority_die=4;state.maxResources.superiority_die=4;
 expect(()=>executeAction(state,mechanics,{character:FIGHTER_CTX_EQUIPPED,rng:()=>{throw Error('No RNG');}})).toThrow(/Удар командующего/);
 expect(state.resources.superiority_die).toBe(4);
});
