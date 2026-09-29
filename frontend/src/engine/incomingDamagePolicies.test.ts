import {describe,expect,it} from 'vitest';
import {incomingDamagePolicies} from './incomingDamagePolicies';
import {staticDamageReductions} from './staticDamageReduction';
import {freshFighterState,FIGHTER_CTX_EQUIPPED} from '../mvp/fixtures';
type Dict=Record<string,unknown>;
const state=freshFighterState();
const item=(id:string,payload:Dict)=>({id,name:id,activation:{mode:'passive'},effects:[{resolution:'auto',result:[payload]}]});
const input=(mechanics:Dict[],rng=()=>.99)=>({amount:8,damageType:'slashing',delivery:'attack' as const,state,mechanics,conditions:{state},formula:{},rng});
describe('generic incoming damage policies',()=>{
 it.each([18,19])('negates equal-to-AC attack damage for КД%s and fails closed for missing or stale facts',ac=>{
  const armor=item(`armor-${ac}`,{kind:'modifier',op:'multiply',value:0,applies_to:{roll:'damage_received',filter:{attack_total_equals_ac:true}}});
  expect(incomingDamagePolicies({...input([armor]),attackTotal:ac,targetAC:ac}).amount).toBe(0);
  expect(incomingDamagePolicies({...input([armor]),attackTotal:ac+1,targetAC:ac}).amount).toBe(8);
  expect(incomingDamagePolicies({...input([armor]),attackTotal:ac}).amount).toBe(8);
  expect(incomingDamagePolicies({...input([armor]),attackTotal:ac,targetAC:ac,delivery:'other'}).amount).toBe(8);
 });
 it.each([['ward',1],['greater-ward',2]])('%s reduces only the declared self-inflicted source kinds',(id,amount)=>{
  const ward=item(String(id),{kind:'reduce_damage',amount,filter:{source_actor:'self',source_kinds:['item','spell','ability']}});
  const base={...input([ward]),sourceActorId:'owner',recipientActorId:'owner',sourceKind:'spell' as const};
  expect(incomingDamagePolicies(base).amount).toBe(8-Number(amount));
  expect(incomingDamagePolicies({...base,sourceActorId:'enemy'}).amount).toBe(8);
  expect(incomingDamagePolicies({...base,sourceKind:undefined}).amount).toBe(8);
  expect(incomingDamagePolicies({...base,recipientActorId:undefined}).amount).toBe(8);
  expect(staticDamageReductions({...input([ward]),character:FIGHTER_CTX_EQUIPPED})).toEqual([]);
 });
 it('rolls an attack reduction chance visibly and reuses it across differently typed packets',()=>{
  const helmet=item('helmet',{kind:'reduce_damage',amount:1,filter:{source:'attack'},chance:{die:4,equals:[4]}});
  let calls=0;const first=incomingDamagePolicies(input([helmet],()=>{calls++;return .99;}));
  expect(first.amount).toBe(7);expect(first.events).toContainEqual(expect.objectContaining({type:'roll',roll:expect.objectContaining({dice:[{sides:4,result:4}]})}));
  const second=incomingDamagePolicies({...input([helmet],()=>{calls++;return 0;}),damageType:'fire',rollCache:first.rollCache});
  expect(second.amount).toBe(7);expect(calls).toBe(1);expect(second.events.some(event=>event.type==='roll')).toBe(false);
  expect(incomingDamagePolicies(input([helmet],()=>0)).amount).toBe(8);
  expect(staticDamageReductions({...input([helmet]),character:FIGHTER_CTX_EQUIPPED})).toEqual([]);
 });
 it('a distinct 1% negation rule excludes non-attacks and records success/failure',()=>{
  const armor=item('armor',{kind:'modifier',op:'multiply',value:0,applies_to:{roll:'damage_received',filter:{source:'attack'}},chance:{die:100,equals:[1]}});
  expect(incomingDamagePolicies(input([armor],()=>0)).amount).toBe(0);
  expect(incomingDamagePolicies(input([armor],()=>.01)).amount).toBe(8);
  const nonAttack=incomingDamagePolicies({...input([armor],()=>{throw new Error('wrong source rolled');}),delivery:'other'});
  expect(nonAttack.amount).toBe(8);expect(nonAttack.events).toEqual([]);
 });
 it('applies source creature filters and harmful incoming bonuses without leaking to other attackers',()=>{
  const amulet=item('amulet',{kind:'reduce_damage',amount:1,filter:{source:'attack',creature_types:['undead','humanoid:shapechanger']}});
  const bracers=item('bracers',{kind:'modifier',op:'add',value:1,applies_to:{roll:'damage_received',filter:{source:'attack'}}});
  expect(incomingDamagePolicies({...input([amulet]),attackerCreatureType:'undead:skeleton'}).amount).toBe(7);
  expect(incomingDamagePolicies({...input([amulet]),attackerCreatureType:'humanoid'}).amount).toBe(8);
  expect(incomingDamagePolicies(input([amulet])).amount).toBe(8);
  expect(incomingDamagePolicies(input([bracers])).amount).toBe(9);
  expect(incomingDamagePolicies({...input([bracers]),delivery:'other'}).amount).toBe(8);
 });
});
