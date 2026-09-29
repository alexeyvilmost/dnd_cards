import {sourceWeaponMechanics} from './sourceWeaponMechanics';
import {dropHeldItem} from './heldItemDrop';
import {describe,it,expect,vi} from 'vitest';
import {executeAction,applyIncomingDamage} from './execute';
import {startConcentration,dropConcentration,concentrationEntry} from './concentration';
import {FIGHTER_CTX_EQUIPPED,equippedFighterState,MECH_WEAPON_ATTACK} from '../mvp/fixtures';
import type {ExecuteContext,RuntimeState} from '../mvp/contracts';
type Dict=Record<string,unknown>;
const state=():RuntimeState=>({...equippedFighterState(),hp:{current:50,max:50,temp:0},resources:{action:1,movement:15},maxResources:{action:1,movement:30}});
const passives=(movement:number)=>[{kind:'weapon_attack_policy',weapon_id:state().equipment.main_hand,movement_cost_ft:movement}];
const ctx=(policies:Dict[],rng=()=>.5):ExecuteContext=>({selfId:'owner',character:FIGHTER_CTX_EQUIPPED,passives:policies,rng,target:{id:'enemy',ac:10,runtimeState:state(),characterContext:FIGHTER_CTX_EQUIPPED}});
describe('data-owned weapon cost, miss damage and concentration',()=>{
 it.each(['main_hand','off_hand'] as const)('binds a granted item attack to its own weapon in %s',hand=>{
  const initial=state(),weaponId=initial.equipment[hand]!;
  const declaration={...MECH_WEAPON_ATTACK,weapon_source_id:weaponId};
  const bound=sourceWeaponMechanics(declaration,initial);
  expect(((bound.effects as Dict[])[0].tags as string[]).includes('off_hand')).toBe(hand==='off_hand');
  expect(()=>sourceWeaponMechanics(declaration,{...initial,equipment:{}})).toThrow();
  expect((MECH_WEAPON_ATTACK.effects as Dict[])[0].tags).toBeUndefined();
 });
 it.each([2,4])('restores only an existing highest short-rest slot at level %s',level=>{
  const initial=state();initial.resources={spell_slot_1:0,[`spell_slot_${level}`]:0};initial.maxResources={spell_slot_1:2,[`spell_slot_${level}`]:2};
  const context={...ctx([]),character:{...FIGHTER_CTX_EQUIPPED,resourceRecharge:{spell_slot_1:'long_rest',[`spell_slot_${level}`]:'short_rest'}}};
  const result=executeAction(initial,{effects:[{resolution:'auto',who:'self',result:[{kind:'resource',op:'restore',id:'selected_pool',amount:1,select_pool:{prefix:'spell_slot_',recharge:'short_rest',take:'highest_level'}}]}]},context);
  expect(result.state.resources[`spell_slot_${level}`]).toBe(1);expect(result.state.resources.spell_slot_1).toBe(0);expect(result.state.resources.selected_pool).toBeUndefined();
 });

 it.each(['item','effect'])('prevents forced disarming from an independent %s source while allowing voluntary release',source=>{
  const initial=state(),policy={kind:'equipment_policy',cannot_be_disarmed:true};
  if(source==='effect')initial.activeEffects=[{id:'grip',name:'Grip',source:'Effect',mechanics:policy}];
  const passives=source==='item'?[policy]:[];
  expect(dropHeldItem(initial,'main_hand','owner',FIGHTER_CTX_EQUIPPED,{forced:true,passives}).state.equipment.main_hand).toBe(initial.equipment.main_hand);
  expect(dropHeldItem(initial,'main_hand','owner',FIGHTER_CTX_EQUIPPED,{passives}).state.equipment.main_hand).toBeNull();
 });
 it.each([5,10])('pays %s movement exactly once across a persisted held roll; rejects before dice when unavailable',movement=>{
  const initial=state(),context=ctx(passives(movement));
  const held=executeAction(initial,MECH_WEAPON_ATTACK,{...context,pauseAfterAttackRoll:true});
  const roll=held.events.find(e=>e.type==='roll');if(roll?.type!=='roll')throw new Error('missing roll');
  expect(held.state.resources.movement).toBe(15-movement);
  const continuation=executeAction(JSON.parse(JSON.stringify(held.state)),{...MECH_WEAPON_ATTACK,activation:{mode:'active'}},{...context,forcedAttackRoll:roll.roll});
  expect(continuation.state.resources.movement).toBe(15-movement);
  expect(continuation.events.some(e=>e.type==='resource_spent'&&e.resource==='movement')).toBe(false);
  const rng=vi.fn(()=>.5);initial.resources.movement=movement-1;
  expect(()=>executeAction(initial,MECH_WEAPON_ATTACK,ctx(passives(movement),rng))).toThrow();expect(rng).not.toHaveBeenCalled();
  expect(initial.resources.action).toBe(1);
 });
 it.each([6,10])('deals half of %s on miss only for the declared weapon, with no hit condition or rider',amount=>{
  const action={effects:[{resolution:'attack_roll',ability:'auto',attack_kind:'weapon_melee',on_hit:[{kind:'damage',amount,type:'slashing'},{kind:'condition',value:'prone'}]}]};
  const context=ctx([{kind:'weapon_attack_policy',weapon_id:state().equipment.main_hand,miss_damage:'half'},
   {kind:'damage_rider',dice:'1d6',type:'fire',duration:{type:'permanent'}}],()=>0);
  const result=executeAction(state(),action,context);
  expect(result.targetState?.hp.current).toBe(50-amount/2);expect(result.targetState?.activeEffects).toHaveLength(0);
  expect(result.events.filter(e=>e.type==='damage')).toHaveLength(1);
  expect(executeAction(state(),action,{...context,passives:[{kind:'weapon_attack_policy',weapon_id:'other',miss_damage:'half'}]}).targetState?.hp.current).toBe(50);
 });
 it.each(['item-source','temporary-source'])('protects concentration from damage, manual loss and replacement for %s, but ends it at death',source=>{
  const policy={kind:'concentration_policy',loss_only_on_death:true};
  const initial=state();if(source==='temporary-source')initial.activeEffects.push({id:'protection',name:'Protection',source,mechanics:policy});
  const passives=source==='item-source'?[policy]:[];
  const concentrated=startConcentration(initial,'Spell').state;
  const rng=vi.fn(()=>0);const damage=applyIncomingDamage(concentrated,5,ctx(passives,rng),{damageType:'fire'});
  expect(concentrationEntry(damage.state)).not.toBeNull();expect(rng).not.toHaveBeenCalled();
  expect(dropConcentration(damage.state,'manual',passives).state).toBe(damage.state);
  expect(()=>startConcentration(damage.state,'Other',[],passives)).toThrow();
  damage.state.deathSaves={successes:0,failures:3,stable:false,dead:true};
  expect(concentrationEntry(dropConcentration(damage.state,'death',passives).state)).toBeNull();
 });
});
