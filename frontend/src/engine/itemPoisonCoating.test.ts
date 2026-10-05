import {describe,expect,it} from 'vitest';
import completion from '../../../scripts/content/data/item-completion-high-20260929.json';
import cards from '../testing/fixtures/item-catalog.cards.json';
import {bindSelfItemCost} from './cost';
import {executeAction} from './execute';
import {equippedFighterState,FIGHTER_CTX_EQUIPPED,freshFighterState} from '../mvp/fixtures';
import type {Card} from '../types';

const card=cards.find(row=>row.card_number==='CARD-0832')!;
const mechanics=bindSelfItemCost(completion['CARD-0832'].mechanics as Record<string,unknown>,card.id);
const weaponId=equippedFighterState().equipment.main_hand!;
const character={...FIGHTER_CTX_EQUIPPED,knownCards:[...(FIGHTER_CTX_EQUIPPED.knownCards??[]),
 {...card,mechanics:completion['CARD-0832'].mechanics} as unknown as Card]};
const face=(value:number,sides=20)=>(value-0.5)/sides;
const rng=(values:number[])=>{let index=0;return()=>values[Math.min(index++,values.length-1)];};
const attack={effects:[{resolution:'attack_roll',attack_kind:'weapon_melee',ability:'auto',on_hit:[{kind:'damage',dice:'weapon',type:'weapon'}]}]};

describe('weapon-bound basic poison',()=>{
 it('spends a vial and bonus action, then saves CON after a damaging hit and expires the coating',()=>{
  const before=equippedFighterState();before.inventory.push({cardId:card.id,qty:1});
  const coated=executeAction(before,mechanics,{selfId:'hero',character,choices:{'poisoned-weapon':weaponId},rng:()=>{throw Error('No die when coating');}});
  expect(coated.state.inventory.some(entry=>entry.cardId===card.id)).toBe(false);
  expect(coated.state.resources.bonus_action).toBe(0);
  expect(coated.state.activeEffects).toEqual(expect.arrayContaining([expect.objectContaining({mechanics:expect.objectContaining({bound_weapon_id:weaponId,target_save:{ability:'con',dc:10}})})]));
  const target=freshFighterState();target.hp={current:40,max:40,temp:0};
  const hit=executeAction(coated.state,attack,{selfId:'hero',character,target:{id:'enemy',ac:10,runtimeState:target,characterContext:FIGHTER_CTX_EQUIPPED},
   rng:rng([face(15),face(5,8),face(1),face(3,4)])});
  expect(hit.events.some(event=>event.type==='roll'&&event.roll.kind==='save')).toBe(true);
  expect(hit.events.filter(event=>event.type==='damage').map(event=>event.type==='damage'?event.damageType:'')).toEqual(['slashing','poison']);
  expect(hit.state.activeEffects.some(effect=>(effect.mechanics as Record<string,unknown>).bound_weapon_id===weaponId)).toBe(false);
  expect(hit.targetState?.hp.current).toBe(30);
 });
 it('a successful save prevents poison damage, and a different weapon cannot borrow the coating',()=>{
  const state=equippedFighterState();state.activeEffects.push({id:'poison',name:'Poison',source:'Poison',sourceId:'hero',
   mechanics:{kind:'damage_rider',trigger:'hit_by_attack_roll',dice:'1d6',type:'poison',duration:{type:'minutes',amount:1},
    bound_weapon_id:'another-weapon',filter:{attackKind:'weapon'},target_save:{ability:'con',dc:14},requires_damage_dealt:true,consume:'next'}});
  const target=freshFighterState();target.hp={current:40,max:40,temp:0};
  const unmatched=executeAction(state,attack,{selfId:'hero',character,target:{id:'enemy',ac:10,runtimeState:target,characterContext:FIGHTER_CTX_EQUIPPED},rng:rng([face(15),face(5,8)])});
  expect(unmatched.events.some(event=>event.type==='roll'&&event.roll.kind==='save')).toBe(false);
  expect(unmatched.state.activeEffects.some(effect=>effect.id==='poison')).toBe(true);
  const matched={...state,equipment:{...state.equipment,main_hand:weaponId},activeEffects:state.activeEffects.map(effect=>effect.id==='poison'
   ?{...effect,mechanics:{...(effect.mechanics as Record<string,unknown>),bound_weapon_id:weaponId}}:effect)};
  const saved=executeAction(matched,attack,{selfId:'hero',character,target:{id:'enemy',ac:10,runtimeState:target,characterContext:FIGHTER_CTX_EQUIPPED},
   rng:rng([face(15),face(5,8),face(20)])});
  expect(saved.events.some(event=>event.type==='roll'&&event.roll.kind==='save')).toBe(true);
  expect(saved.events.filter(event=>event.type==='damage')).toHaveLength(1);
 });
});
