import {describe,expect,it} from 'vitest';
import {isRunEligible} from './eligibility';
import type {ForgeCharacter} from '../character/types';

describe('start a run from a personal sheet',()=>{
 it.each(['warrior','barbarian','monk','wizard','cleric','rogue','druid'])('admits a level-one %s',name=>{
  const character={class_id:name,class_levels:{[name]:1},level:1,character_type:'free',access_mode:'owner'} as unknown as ForgeCharacter;
  expect(isRunEligible(character)).toBe(true);
  expect(isRunEligible({...character,level:2})).toBe(false);
 });
 const fighter={class_id:'fighter',class_levels:{fighter:1},level:1,character_type:'free',access_mode:'owner'} as unknown as ForgeCharacter;
 it('accepts a pure level-one fighter and legacy class-level representation',()=>{
  expect(isRunEligible(fighter)).toBe(true);
  expect(isRunEligible({...fighter,class_levels:null})).toBe(true);
 });
 it.each([
  {level:2},{class_id:null},{access_mode:'read_only'},{character_type:'dungeon_crawl'},
  {class_levels:{fighter:1,wizard:1}},{class_levels:{}},{class_levels:{fighter:2}},
 ])('rejects unsuitable sheet %o',patch=>expect(isRunEligible({...fighter,...patch} as ForgeCharacter)).toBe(false));
});
