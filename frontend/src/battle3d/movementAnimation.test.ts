import {describe,expect,it} from 'vitest';
import {positionOnMovementPath} from './movementAnimation';

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
});
