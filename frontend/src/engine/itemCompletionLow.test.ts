import related from '../../../scripts/content/data/item-completion-low-related-20260929.json';
import {parseWeaponProfile} from '../rules-core/weaponProfile';
import {isWeaponProficient} from './weapon';
import {describe,expect,it} from 'vitest';
import data from '../../../scripts/content/data/item-completion-low-20260929.json';
import {validateMechanics} from './validateMechanics';
import {executeAction,emitEvent} from './execute';
import {startTurn,endTurn,shortRest} from './turn';
import {FIGHTER_CTX_EQUIPPED,equippedFighterState} from '../mvp/fixtures';
import type {ExecuteContext,RuntimeState} from '../mvp/contracts';
type Dict=Record<string,unknown>;
const rows=data as unknown as Record<string,{id:string;name:string;mechanics:Dict;patch:Dict;clauses:unknown[]}>;
const item=(n:number):Dict=>{const row=rows[`CARD-${String(n).padStart(4,'0')}`];return {id:row.id,name:row.name,...row.mechanics};};
const state=():RuntimeState=>({...equippedFighterState(),hp:{current:20,max:20,temp:0}});
const ctx=(items:number[],target?:RuntimeState):ExecuteContext=>({selfId:'owner',character:FIGHTER_CTX_EQUIPPED,passives:items.map(item),rng:()=>.5,...(target?{target:{id:'enemy',actorKind:'monster',ac:5,runtimeState:target,characterContext:FIGHTER_CTX_EQUIPPED}}:{})});
const attack={effects:[{resolution:'attack_roll',attack_kind:'weapon_melee',ability:'auto',on_hit:[{kind:'damage',amount:1,type:'slashing'}]}]};
describe('item completion low-range declarations',()=>{
 it('validates all new related entity declarations',()=>{
  const failures:string[]=[];
  for(const row of related.entities){const mechanics=(row.patch as Record<string,unknown>).mechanics as Dict;if(!mechanics)continue;const validation=validateMechanics(mechanics,{id:row.id,name:row.name,kind:'passive_effect'});if(!validation.valid)failures.push(`${row.card_number}: ${JSON.stringify(validation.errors)}`);}
  expect(failures).toEqual([]);
 });
 it.each([2,64,150])('custom weapon%s has executable dice without inventing proficiency/mastery',n=>{
  const row=rows[`CARD-${String(n).padStart(4,'0')}`],parsed=parseWeaponProfile({id:row.id,mechanics:row.mechanics});
  expect(parsed.valid).toBe(true);if(!parsed.valid)throw Error(parsed.issue);
  expect(parsed.profile.masteryEffectId).toBe('');expect(isWeaponProficient({...FIGHTER_CTX_EQUIPPED,weaponProficiencies:['simple','martial','all']},parsed.profile.weaponType,parsed.profile.proficiencyCategory)).toBe(false);
  expect(isWeaponProficient({...FIGHTER_CTX_EQUIPPED,weaponProficiencies:[parsed.profile.weaponType]},parsed.profile.weaponType,parsed.profile.proficiencyCategory)).toBe(true);
 });
 it('covers every active scoped row and schema-checks every changed complete declaration',()=>{
  expect(Object.keys(rows)).toHaveLength(279);
  const failures:string[]=[];
  for(const [number,row] of Object.entries(rows)){
   expect(row.clauses.length,number).toBeGreaterThan(0);
   if(!row.patch.mechanics)continue;
   const result=validateMechanics(row.mechanics,{id:row.id,name:row.name,kind:'passive_effect'});
   if(!result.valid)failures.push(`${number}: ${JSON.stringify(result.errors)}`);
  }
  expect(failures).toEqual([]);
 });
 it('third hit on the same target grants focus and paralysis once per turn across reload',()=>{
  let owner=state(),enemy=state();owner.resources.focus=0;owner.maxResources.focus=5;
  for(let hit=1;hit<=4;hit++){
   const result=executeAction(owner,attack,ctx([128],enemy));
   owner=JSON.parse(JSON.stringify(result.state));enemy=result.targetState!;
   expect(owner.resources.focus).toBe(hit>=3?1:0);
   expect(enemy.activeEffects.some(entry=>entry.mechanics.kind==='condition'&&entry.mechanics.value==='paralyzed')).toBe(hit>=3);
  }
  expect(startTurn(owner,undefined,{advanceRoundDurations:false}).state.eventOccurrences).toEqual({});
 });
 it('movement-conditioned rider applies only after 25 actual feet and stationary defense expires next turn',()=>{
  for(const [movement,extra] of [[24,false],[25,true]] as const){
   const owner=state();owner.turnMovementFt=movement;
   const result=executeAction(owner,attack,ctx([127],state()));
   expect(result.events.filter(event=>event.type==='damage').length).toBe(extra?2:1);
  }
  const owner=state();owner.turnMovementFt=0;
  const result=endTurn(owner,{...FIGHTER_CTX_EQUIPPED,passives:[item(129)]} as typeof FIGHTER_CTX_EQUIPPED);
  expect(result.state.activeEffects.some(entry=>entry.mechanics.stack_id==='item-stillness-129')).toBe(true);
  expect(startTurn(result.state).state.activeEffects.some(entry=>entry.mechanics.stack_id==='item-stillness-129')).toBe(false);
 });
 it('kill reward belongs to the killer, and ordinary hits cannot award it',()=>{
  const fatal={effects:[{resolution:'attack_roll',attack_kind:'weapon_melee',ability:'auto',on_hit:[{kind:'damage',amount:25,type:'slashing'}]}]};
  const result=executeAction(state(),fatal,ctx([178],{...state(),hp:{current:1,max:20,temp:0}}));
  expect(result.state.hp.temp).toBe(5);
  expect(executeAction(state(),attack,ctx([178],state())).state.hp.temp).toBe(0);
  expect(emitEvent({kind:'kill',source:'someone-else'},state(),ctx([178]),[],[]).hp.temp).toBe(0);
 });
 it('short-rest restore refills only an existing first-level slot pool',()=>{
  const owner=state();owner.resources.spell_slot_1=0;owner.maxResources.spell_slot_1=4;
  owner.resources.spell_slot_2=0;owner.maxResources.spell_slot_2=2;
  const context={...FIGHTER_CTX_EQUIPPED,resourceRecharge:{spell_slot_1:'long_rest',spell_slot_2:'long_rest'},passives:[item(116)]};
  const result=shortRest(owner,context);
  expect(result.state.resources.spell_slot_1).toBe(4);expect(result.state.resources.spell_slot_2).toBe(0);
  expect(shortRest(state(),context).state.resources.spell_slot_1).toBeUndefined();
 });
});
