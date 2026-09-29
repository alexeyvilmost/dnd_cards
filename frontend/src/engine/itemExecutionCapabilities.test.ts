import {describe,expect,it} from 'vitest';
import {applyItemActionTargetLimit,hasRitualCasting,weaponHandlingPassives} from './itemExecutionCapabilities';
import {weaponContext,weaponActionAvailability} from './weapon';
import {CARD_LONGSWORD,CARD_SHIELD,FIGHTER_CTX,MECH_WEAPON_ATTACK,freshFighterState} from '../mvp/fixtures';
import type {Card} from '../types';
const passive=(payload:Record<string,unknown>)=>({activation:{mode:'passive'},effects:[{resolution:'auto',result:[payload]}]});
const weapon=(id:string,type:string):Card=>{
 const card=structuredClone(CARD_LONGSWORD);card.id=id;
 const profile=card.mechanics!.weapon_profile as Record<string,unknown>;
 profile.weapon_type=type;profile.properties=['two_handed'];return card;
};
describe('data-owned item execution capabilities',()=>{
 it('spell-level limit is matched exactly and combined selectors are conjunctive',()=>{
  const mechanics={targeting:{shape:'single',max_targets:1},effects:[{resolution:'auto',result:[{kind:'damage',amount:2}]}]};
  const grants=[passive({kind:'action_target_limit',spell_level:0,add:1})];
  expect(applyItemActionTargetLimit(mechanics,[],grants,true,0).targeting).toMatchObject({max_targets:2});
  expect(applyItemActionTargetLimit(mechanics,[],grants,true,1)).toBe(mechanics);
  expect(applyItemActionTargetLimit(mechanics,[],grants,false,0)).toBe(mechanics);
  expect(applyItemActionTargetLimit(mechanics,[],grants,true)).toBe(mechanics);
  expect(applyItemActionTargetLimit(mechanics,[],[passive({kind:'action_target_limit',spell_level:0,healing_spells:true,add:1})],true,0)).toBe(mechanics);
 });
 it.each([['greatsword','grant-one',1],['pike','grant-two',2]])('one-hand policy permits %s beside a shield and retains equipment authority',(type,id,count)=>{
  const card=weapon(type,type),grant={...CARD_SHIELD,id,type:'gloves',mechanics:passive({kind:'weapon_handling',required_hands:1,max_weapons:count})} as Card;
  const cards=new Map([card,CARD_SHIELD,grant].map(row=>[row.id,row]));
  const state=freshFighterState();state.equipment={main_hand:card.id,off_hand:CARD_SHIELD.id,gloves:id};
  const ctx={...FIGHTER_CTX,knownCards:[...cards.values()],equippedCards:[...cards.values()]};
  const grants=weaponHandlingPassives(ctx,state,[]);
  expect(weaponActionAvailability(MECH_WEAPON_ATTACK,state.equipment,cards,grants).available).toBe(true);
  expect(weaponContext(ctx,'main',state.equipment,state)).not.toBeNull();
  const removed={...state,equipment:{...state.equipment,gloves:null}};
  expect(weaponContext(ctx,'main',removed.equipment,removed)).toBeNull();
 });
 it('one permitted two-handed weapon cannot authorize two distinct two-handed weapons',()=>{
  const a=weapon('a','greatsword'),b=weapon('b','pike'),cards=new Map([a,b].map(c=>[c.id,c]));
  const grants=[passive({kind:'weapon_handling',required_hands:1,max_weapons:1})];
  expect(weaponActionAvailability(MECH_WEAPON_ATTACK,{main_hand:a.id,off_hand:b.id},cards,grants).available).toBe(false);
 });
 it('target expansions match immutable references without touching unrelated actions or range',()=>{
  const mechanics={targeting:{shape:'single',min_targets:1,max_targets:1,range_ft:30}};
  for(const [ref,add] of [['vow',1],['blessing',2]] as const){
   const grants=[passive({kind:'action_target_limit',action_refs:[ref],add})];
   expect(applyItemActionTargetLimit(mechanics,[ref],grants)).toMatchObject({targeting:{shape:'multi',max_targets:1+add,range_ft:30}});
   expect(applyItemActionTargetLimit(mechanics,['unrelated'],grants)).toBe(mechanics);
  }
  expect(mechanics.targeting.max_targets).toBe(1);
 });
 it('ritual permission is a passive capability and cannot come from an unused active action',()=>{
  expect(hasRitualCasting([passive({kind:'ritual_casting'})])).toBe(true);
  expect(hasRitualCasting([{...passive({kind:'ritual_casting'}),activation:{mode:'active'}}])).toBe(false);
  expect(hasRitualCasting([])).toBe(false);
 });
 it('healing-spell target bonus follows nested payloads and excludes healing items and unrelated spells',()=>{
  const grants=[passive({kind:'action_target_limit',healing_spells:true,add:1})];
  const mechanics={targeting:{shape:'single',max_targets:1},effects:[{resolution:'auto',result:[{kind:'healing',amount:4}]}]};
  expect(applyItemActionTargetLimit(mechanics,['cure'],grants,true).targeting).toMatchObject({max_targets:2});
  expect(applyItemActionTargetLimit(mechanics,['potion'],grants,false)).toBe(mechanics);
  const attack={...mechanics,effects:[{resolution:'auto',result:[{kind:'damage',amount:4}]}]};
  expect(applyItemActionTargetLimit(attack,['bolt'],grants,true)).toBe(attack);
 });
});
