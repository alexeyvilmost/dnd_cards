import type {RuntimeState} from '../mvp/contracts';
import {collectModifiers,foldModifiers} from './modifiers';

/** Push/drag/lift begins at twice carrying capacity; source-owned modifiers
 * affect this physical limit without changing inventory carrying capacity. */
export function liftingCapacity(carryingCapacity:number,state:RuntimeState,passives:readonly Record<string,unknown>[]):number {
  if(!Number.isFinite(carryingCapacity)||carryingCapacity<0)throw Error('Invalid carrying capacity');
  const base=Math.floor(carryingCapacity*2);
  const modifiers=collectModifiers(state,[...passives],{roll:'lift_capacity',evalCtx:{state}});
  return Math.max(0,Math.floor(foldModifiers(base,modifiers).value));
}
