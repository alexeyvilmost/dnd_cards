import {describe,it,expect} from 'vitest';
import {executeAction} from './execute';
import {startTurn,endTurn} from './turn';
import {deniedCapabilities,collectModifiers} from './modifiers';
import {FIGHTER_CTX_EQUIPPED,equippedFighterState,MECH_WEAPON_ATTACK} from '../mvp/fixtures';
import related from '../../../scripts/content/data/item-completion-middle-related-20260929.json';
import type {ExecuteContext,RuntimeState} from '../mvp/contracts';
type Dict=Record<string,unknown>;
describe('item named effects use canonical runtime lifecycle',()=>{
 it.each([4,6])('retains actual Hide on the declared d%s face only after a committed attack',die=>{
  const before=equippedFighterState();before.activeEffects=[{id:'hide',name:'Hide',source:'action',mechanics:{kind:'condition',value:'invisible',hidden_end_triggers:['actor_makes_attack_roll','enemy_finds_actor']}}];
  const policy={kind:'effect_end_policy',trigger:'actor_makes_attack_roll',scope:'hidden',retain_chance:{die,equals:[die]}};
  let draws=0;const ctx:ExecuteContext={character:FIGHTER_CTX_EQUIPPED,selfId:'owner',passives:[policy],rng:()=>{draws++;return .99;},target:{id:'enemy',ac:100,runtimeState:equippedFighterState(),characterContext:FIGHTER_CTX_EQUIPPED}};
  const attack={...MECH_WEAPON_ATTACK,activation:{mode:'active',cost:[]},effects:[{resolution:'attack_roll',attack_kind:'weapon_melee',ability:'auto',on_hit:[]}]};
  const held=executeAction(before,attack,{...ctx,pauseAfterAttackRoll:true});
  expect(held.events.filter(event=>event.type==='roll'&&event.roll.dice.some(d=>d.sides===die))).toHaveLength(0);
  expect(held.state.activeEffects.some(effect=>effect.id==='hide')).toBe(true);
  const result=executeAction(before,attack,ctx);expect(result.state.activeEffects.some(effect=>effect.id==='hide')).toBe(true);
  expect(result.events.filter(event=>event.type==='roll'&&event.roll.dice.some(d=>d.sides===die))).toHaveLength(1);
  const failure=executeAction(JSON.parse(JSON.stringify(result.state)),attack,{...ctx,rng:()=>0});expect(failure.state.activeEffects.some(effect=>effect.id==='hide')).toBe(false);expect(draws).toBeGreaterThan(0);
 });
 it('runs the authored time-acceleration and lethargy effects across source turn boundaries',()=>{
  const entities=related.entities.map(entry=>entry.patch as Dict),action=entities.find(entry=>entry.card_number==='ACT-item-completion-0379')!;
  const grantedEffects=Object.fromEntries(entities.filter(entry=>entry.effect_type).map(entry=>[entry.card_number as string,entry]));
  const before:RuntimeState=equippedFighterState();before.inventory.push({cardId:(action.mechanics as Dict).requires_item_source as string,qty:1});
  // Data source availability comes from the actual item snapshot in production;
  // this test isolates the duration and inherited resource-capacity policy.
  const {requires_item_source:_,...mechanics}=action.mechanics as Dict;
  const ctx:ExecuteContext={character:FIGHTER_CTX_EQUIPPED,selfId:'owner',grantedEffects,rng:()=>.5};
  const active=executeAction(before,mechanics,ctx);expect(active.state.resources.haste_action).toBe(1);
  expect(collectModifiers(active.state,[],{roll:'ac'}).modifiers.some(modifier=>modifier.value===2)).toBe(true);
  const ended=endTurn(active.state,{...FIGHTER_CTX_EQUIPPED,rng:()=>.5,selfId:'owner',grantedEffects} as typeof FIGHTER_CTX_EQUIPPED);
  expect(ended.state.activeEffects.some(effect=>effect.entityRef?.cardNumber==='EFFECT-item-completion-0379-lethargy')).toBe(true);
  expect(deniedCapabilities(ended.state).has('action')).toBe(true);
  const next=startTurn(JSON.parse(JSON.stringify(ended.state)),{...FIGHTER_CTX_EQUIPPED,selfId:'owner',grantedEffects} as typeof FIGHTER_CTX_EQUIPPED);expect(next.state.resources.haste_action??0).toBe(0);
 });
});
