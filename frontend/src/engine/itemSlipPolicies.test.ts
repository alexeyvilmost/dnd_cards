import {describe,it,expect} from 'vitest';
import {executeAction} from './execute';
import {FIGHTER_CTX_EQUIPPED,equippedFighterState} from '../mvp/fixtures';
import {auraSurfacesAt} from '../solo-combat/auraTerrain';
import type {SoloCombatState} from '../solo-combat/types';
describe('cause-specific slipping protection and authored ice',()=>{
 it.each([true,['ice']])('blocks a matching slip with policy %s, but never a shove',slip_immune=>{
  const action=(tags:string[])=>({effects:[{resolution:'auto',who:'self',result:[{kind:'condition',value:'prone',cause_tags:tags}]}]});
  const ctx={character:FIGHTER_CTX_EQUIPPED,passives:[{kind:'movement_policy',slip_immune}],rng:()=>.5};
  expect(executeAction(equippedFighterState(),action(['slip','ice']),ctx).state.activeEffects).toHaveLength(0);
  expect(executeAction(equippedFighterState(),action(['shove']),ctx).state.activeEffects).toHaveLength(1);
  expect(executeAction(equippedFighterState(),action(['slip','oil']),ctx).state.activeEffects).toHaveLength(slip_immune===true?0:1);
 });
 it('moves the declared ice footprint with its source without inventing a save DC',()=>{
  const actor={id:'owner',character:FIGHTER_CTX_EQUIPPED,runtime:equippedFighterState(),passives:[{kind:'aura',radius_ft:5,recipients:'all',effects:[{kind:'terrain',material:'ice'}]}]};
  const state={world:{actors:{owner:actor}},tokens:{owner:{position:{x:2,y:2}}}} as unknown as SoloCombatState;
  expect(auraSurfacesAt(state,{x:3,y:2})).toEqual(['ice']);expect(auraSurfacesAt(state,{x:4,y:2})).toEqual([]);
  state.tokens.owner.position={x:5,y:5};expect(auraSurfacesAt(state,{x:3,y:2})).toEqual([]);
 });
});
