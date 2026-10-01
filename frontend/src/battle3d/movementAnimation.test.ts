import {describe,expect,it} from 'vitest';
import {continueMovementPath,movementDurationForTransition,positionOnMovementPath} from './movementAnimation';
import type {SoloCombatState} from '../solo-combat/types';

describe('token movement follows each tactical step',()=>{
  const path=[{x:1,y:1},{x:1,y:2},{x:2,y:2},{x:3,y:1}];
  it('visits the route corners rather than crossing directly to the destination',()=>{
    expect(positionOnMovementPath(path,0).position).toEqual(path[0]);
    expect(positionOnMovementPath(path,.19).position).toEqual(path[1]);
    expect(positionOnMovementPath(path,.38).position).toEqual(path[2]);
    expect(positionOnMovementPath(path,.57).position).toEqual(path[3]);
  });
  it('settles exactly at the final cell and handles a missing route',()=>{
    expect(positionOnMovementPath(path,3)).toEqual({position:path[3],moving:false});
    expect(positionOnMovementPath([],1)).toEqual({position:{x:0,y:0},moving:false});
  });
  it('continues from the visible point and preserves unfinished route corners',()=>{
    const visible=positionOnMovementPath(path,.095).position;
    const continued=continueMovementPath(path,.095,[path[3],{x:4,y:1}]);
    expect(continued[0]).toEqual(visible);
    expect(continued.slice(1)).toEqual([...path.slice(1),{x:4,y:1}]);
    expect(continueMovementPath(path,2,[path[3],{x:4,y:1}])).toEqual([path[3],{x:4,y:1}]);
  });
  it('holds a movement beat for its real detour, not the straight endpoint distance',()=>{
    const steps=[{x:0,y:1},{x:0,y:2},{x:1,y:2},{x:2,y:2},{x:2,y:1},{x:2,y:0}];
    const before={tokens:{actor:{actorId:'actor',position:{x:0,y:0}}},monsterMovement:{actorId:'actor',steps}} as unknown as SoloCombatState;
    const after={...before,tokens:{actor:{...before.tokens.actor,position:steps.at(-1)!}}};
    expect(movementDurationForTransition(before,after,'actor')).toBeCloseTo(1140);
    expect(movementDurationForTransition(before,after,'actor')).toBeGreaterThan(2*190);
    expect(movementDurationForTransition(after,after,'actor')).toBe(0);
  });
  it.each(['playerMovement','monsterMovement'] as const)('does not replay a held %s route prefix between visible steps',key=>{
    const steps=[{x:1,y:1},{x:2,y:1},{x:2,y:2}];
    const before={tokens:{actor:{actorId:'actor',position:steps[1]}},[key]:{actorId:'actor',steps}} as unknown as SoloCombatState;
    const after={...before,tokens:{actor:{...before.tokens.actor,position:steps[2]}}};
    expect(movementDurationForTransition(before,after,'actor')).toBe(190);
  });
});
