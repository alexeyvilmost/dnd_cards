import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {executeAction} from './execute';
import {rollD20} from './roll';
import {validateMechanics} from './validateMechanics';
import {freshFighterState,FIGHTER_CTX_EQUIPPED} from '../mvp/fixtures';
const mechanics=JSON.parse(readFileSync(new URL('../../../backend/migrations/battle_master_sweeping_224.go',import.meta.url),'utf8').match(/const battleMasterSweeping224 = `([^`]+)`/)![1]);
const character={...FIGHTER_CTX_EQUIPPED,variables:{...FIGHTER_CTX_EQUIPPED.variables,superiority_die:{count:1,sides:8}}};
describe('Sweeping Attack reuses a committed roll',()=>{
 it('validates the catalog mechanics',()=>{const result=validateMechanics(mechanics,{id:'sweep',name:'Sweep',kind:'action'});expect(result.valid,result.errors.join('; ')).toBe(true);});
 it.each([[false,10,5],[false,30,0],[true,30,5]])('compares original roll and never doubles the die: critical %s, AC %s', (critical,ac,damage)=>{
  const state=freshFighterState();state.resources.superiority_die=4;state.maxResources.superiority_die=4;
  const target=freshFighterState();target.hp={current:100,max:100,temp:0};
  const original=rollD20({modifiers:[{source:'STR',value:5}],target:{type:'ac',value:10},rng:()=>critical?0.99:0.5});
  let draws=0;
  const result=executeAction(state,mechanics,{character,selfId:'hero',
   target:{id:'other',ac:Number(ac),runtimeState:target},
   triggeringAttack:{targetActorId:'other',damageType:'slashing',critical:Boolean(critical),roll:original},rng:()=>{draws++;return 0.5;}});
  expect(result.state.resources.superiority_die).toBe(3);
  expect(result.targetState?.hp.current??target.hp.current).toBe(100-Number(damage));
  expect(draws).toBe(Number(damage)>0?1:0);
  expect(result.events.some(event=>event.type==='roll'&&event.roll.kind==='d20')).toBe(false);
  expect(state.resources.superiority_die).toBe(4);
 });
});
