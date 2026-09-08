import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {executeAction} from './execute';
import {validateMechanics} from './validateMechanics';
import {freshFighterState,FIGHTER_CTX_EQUIPPED} from '../mvp/fixtures';
import type {ExecuteContext} from '../mvp/contracts';
const source=readFileSync(new URL('../../../backend/migrations/battle_master_lunging_223.go',import.meta.url),'utf8');
const mechanics=JSON.parse(source.match(/const battleMasterLunging223 = `([^`]+)`/)![1]);
const character={...FIGHTER_CTX_EQUIPPED,variables:{...FIGHTER_CTX_EQUIPPED.variables,superiority_die:{count:1,sides:8}}};
function prepare(){
 const initial=freshFighterState();initial.resources.superiority_die=4;initial.maxResources.superiority_die=4;
 const result=executeAction(initial,mechanics,{character,selfId:'hero',rng:()=>{throw Error('Dash preparation has no RNG');}});
 expect(initial.resources.superiority_die).toBe(4);
 expect(result.state.resources.superiority_die).toBe(3);
 return result.state;
}
function attack(kind='unarmed') {return {effects:[{resolution:'attack_roll',attack_kind:kind,ability:'str',attack_bonus_override:5,vs:'ac',
 on_hit:[{kind:'damage',amount:2,type:'bludgeoning'}]}]};}
describe('Lunging Attack damage rider',()=>{
 it('validates the catalog mechanics',()=>{const result=validateMechanics(mechanics,{id:'lunge',name:'Lunge',kind:'action'});expect(result.valid,result.errors.join('; ')).toBe(true);});
 it.each([
  ['eligible',5,'attack','unarmed',false,7],['no movement',0,'attack','unarmed',false,2],
  ['short movement',4,'attack','unarmed',false,2],['reaction',5,undefined,'unarmed',false,2],
  ['ranged',5,'attack','weapon_ranged',false,2],['critical',5,'attack','unarmed',true,18],
 ])('%s',(_name,movement,attackActionId,kind,critical,damage)=>{
  const state=prepare();const target=freshFighterState();target.hp={current:100,max:100,temp:0};
  const result=executeAction(state,attack(String(kind)),{character,selfId:'hero',target:{id:'enemy',ac:10,runtimeState:target},
   attackActionId:attackActionId as string|undefined,attackFacts:{immediateStraightMovementFt:Number(movement)},rng:()=>critical?0.99:0.5});
  expect(result.targetState?.hp.current).toBe(100-Number(damage));
  const roll=result.events.find(event=>event.type==='roll'&&event.roll.kind==='d20');
  expect(roll?.type==='roll'&&Boolean(roll.roll.attackManeuverActionId)).toBe(Number(damage)>2);
 });
 it.each([true,false])('respects the generated Light attack economy: %s',partOfAttackAction=>{
  const state=prepare(); const target=freshFighterState(); target.hp={current:100,max:100,temp:0};
  const definition=attack();definition.effects[0]={...definition.effects[0],part_of_attack_action:partOfAttackAction} as typeof definition.effects[number];
  const result=executeAction(state,definition,{character,selfId:'hero',attackActionId:partOfAttackAction?undefined:'qualifying-attack',
   attackFacts:{immediateStraightMovementFt:5},target:{id:'enemy',ac:10,runtimeState:target},rng:()=>0.5});
  expect(result.targetState?.hp.current).toBe(partOfAttackAction?93:98);
 });
 it('does not stack with the target maneuver whose advantage has already been used',()=>{
  const state=prepare();const target=freshFighterState();target.hp={current:100,max:100,temp:0};
  target.activeEffects=[{id:'feint',name:'Feint',source:'Feint',sourceId:'hero',mechanics:{kind:'damage_rider',trigger:'hit_by_attack_roll',scope:'target',source_actor_only:true,
   attack_maneuver:true,consume:'next_attack',dice:'1d8',type:'triggering_attack',duration:{type:'until_end_of_source_turn'}}}];
  const result=executeAction(state,attack(),{character,selfId:'hero',attackActionId:'attack',attackFacts:{immediateStraightMovementFt:5},target:{id:'enemy',ac:10,runtimeState:target},rng:()=>0.5});
  expect(result.targetState?.hp.current).toBe(93);
 });
 it('retains the prepared bonus for another qualifying attack this turn, but never stacks with Precision',()=>{
  const state=prepare(); const target=freshFighterState();target.hp={current:100,max:100,temp:0};
  const ctx:ExecuteContext={character,selfId:'hero',attackActionId:'attack',attackFacts:{immediateStraightMovementFt:5},target:{id:'enemy',ac:10,runtimeState:target},rng:()=>0.5};
  const first=executeAction(state,attack(),ctx);
  const second=executeAction(first.state,attack(),ctx);
  expect(first.targetState?.hp.current).toBe(93);expect(second.targetState?.hp.current).toBe(93);
  const roll=first.events.find(event=>event.type==='roll'&&event.roll.kind==='d20');
  if(roll?.type!=='roll')throw Error('missing roll');
  const precision=executeAction(state,attack(),{...ctx,forcedAttackRoll:{...roll.roll,attackManeuverActionId:'precision'}});
  expect(precision.targetState?.hp.current).toBe(98);
 });
});
