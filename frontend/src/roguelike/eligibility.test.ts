import {describe,expect,it} from 'vitest';
import {isRunEligible} from './eligibility';
import type {ForgeCharacter} from '../character/types';

describe('start a run from a personal sheet',()=>{
 const fighter={class_id:'fighter',class_levels:{fighter:1},level:1,character_type:'free',access_mode:'owner'} as unknown as ForgeCharacter;
 it('accepts a pure level-one fighter and legacy class-level representation',()=>{
  expect(isRunEligible(fighter,'fighter')).toBe(true);
  expect(isRunEligible({...fighter,class_levels:null},'fighter')).toBe(true);
 });
 it.each([
  {level:2},{class_id:'wizard'},{access_mode:'read_only'},{character_type:'dungeon_crawl'},
  {class_levels:{fighter:1,wizard:1}},{class_levels:{}},{class_levels:{fighter:2}},
 ])('rejects unsuitable sheet %o',patch=>expect(isRunEligible({...fighter,...patch} as ForgeCharacter,'fighter')).toBe(false));
 it('requires the canonical fighter class',()=>expect(isRunEligible(fighter,undefined)).toBe(false));
});
