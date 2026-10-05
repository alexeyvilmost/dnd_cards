import {expect,it} from 'vitest';
import {combatDisplayState} from './displayState';
import type {SoloCombatState} from './types';
import type {ForgeCharacter} from '../character/types';

it('retains unchanged state/tokens and replaces only actual portrait changes without mutating authority',()=>{
  const state={tokens:{one:{actorId:'one',tokenUrl:'old-one',position:{x:0,y:0}},two:{actorId:'two',templateId:'monster-two',tokenUrl:'old-two',position:{x:1,y:0}}}} as unknown as SoloCombatState;
  expect(combatDisplayState(null,{},{})).toBeNull();expect(combatDisplayState(state,{},{})).toBe(state);
  const characters={one:{avatar_url:'new-one'} as ForgeCharacter};
  const changed=combatDisplayState(state,characters,{})!;
  expect(changed.tokens.one.tokenUrl).toBe('new-one');expect(changed.tokens.two).toBe(state.tokens.two);
  expect(combatDisplayState(changed,characters,{})).toBe(changed);expect(state.tokens.one.tokenUrl).toBe('old-one');
  const refreshed=combatDisplayState(changed,characters,{'monster-two':'new-two'})!;
  expect(refreshed.tokens.one).toBe(changed.tokens.one);expect(refreshed.tokens.two.tokenUrl).toBe('new-two');
});
