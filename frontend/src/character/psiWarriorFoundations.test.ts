import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {initResources,buildResourceRecharge,buildResourceRecovery} from '../engine/resources';
import {shortRest,longRest} from '../engine/turn';
import {collectVariablesFromEffects} from './variables';
import {validateMechanics} from '../engine/validateMechanics';
import type {CharacterContext,RuntimeState} from '../mvp/contracts';
const migration=readFileSync(new URL('../../../backend/migrations/psi_warrior_foundations_230.go',import.meta.url),'utf8');
const resources=JSON.parse(migration.match(/const psiWarriorResources230 = `([^`]+)`/)![1]);
const upgrade=JSON.parse(migration.match(/const psiWarriorDie230 = `([^`]+)`/)![1]);
const base={activation:{mode:'passive'},effects:[{resolution:'auto',result:[{kind:'variable',op:'set',id:'psi_warrior_energy_die',value:'1d6'}]}]};
const context=(level:number):CharacterContext=>({level,classLevels:{warrior:level},profBonus:2,abilityMods:{str:3,dex:2,con:2,int:1,wis:0,cha:0},resourceRecharge:buildResourceRecharge(resources),resourceRecovery:buildResourceRecovery(resources)});
describe('Psi Warrior owned dice',()=>{
 it.each([[3,4],[4,4],[5,6]])('level %s owns %s dice and recovers one on short rest', (level,count)=>{
  const ctx=context(level);const initialized=initResources(ctx,resources,[]);
  expect(initialized.maxResources.psi_warrior_energy_die).toBe(count);
  const spent:RuntimeState={hp:{current:10,max:10,temp:0},...initialized,resources:{...initialized.resources,psi_warrior_energy_die:0,psionic_energy_die:2},maxResources:{...initialized.maxResources,psionic_energy_die:4},equipment:{},inventory:[],activeEffects:[],turn:{}};
  const rested=shortRest(spent,ctx).state;
  expect(rested.resources.psi_warrior_energy_die).toBe(1);
  expect(rested.resources.psionic_energy_die).toBe(2);
  expect(shortRest(rested,ctx).state.resources.psi_warrior_energy_die).toBe(2);
  expect(longRest(spent,ctx).state.resources.psi_warrior_energy_die).toBe(count);
  const full={...spent,resources:{...spent.resources,psi_warrior_energy_die:count}};
  expect(shortRest(full,ctx).state.resources.psi_warrior_energy_die).toBe(count);
  expect(spent.resources.psi_warrior_energy_die).toBe(0);
 });
 it('scales by warrior level and grants no dice before level three',()=>{
  expect(initResources({...context(3),level:10,classLevels:{warrior:3,wizard:7}},resources,[]).maxResources.psi_warrior_energy_die).toBe(4);
  expect(initResources(context(2),resources,[]).maxResources.psi_warrior_energy_die).toBeUndefined();
 });
 it('uses d6 then d8 and preserves a separate Soulknife variable',()=>{
  expect(collectVariablesFromEffects([base])).toEqual({psi_warrior_energy_die:{count:1,sides:6}});
  expect(collectVariablesFromEffects([base,upgrade])).toEqual({psi_warrior_energy_die:{count:1,sides:8}});
  expect(validateMechanics(upgrade,{id:'psi-d8',name:'Psi die',kind:'passive_effect'}).valid).toBe(true);
 });
});
