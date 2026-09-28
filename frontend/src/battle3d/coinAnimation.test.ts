import {describe,expect,it} from 'vitest';
import {coinMotionAt,shotPhaseAt} from './coinAnimation';

describe('coin attack presentation',()=>{
  it('winds up, lunges toward the target, then returns to its cell',()=>{
    const attack={attack:'melee' as const,hit:false,hitDelay:.4,reach:.5};
    expect(coinMotionAt(attack,.1).travel).toBeLessThan(0);
    expect(coinMotionAt(attack,.36).travel).toBeGreaterThan(.35);
    expect(coinMotionAt(attack,.36).hop).toBeGreaterThan(0);
    expect(coinMotionAt(attack,1).travel).toBe(0);
  });

  it('wobbles only when the committed beat includes damage',()=>{
    const received={attack:'none' as const,hit:true,hitDelay:.4,reach:0};
    expect(coinMotionAt(received,.2).wobble).toBe(0);
    expect(Math.abs(coinMotionAt(received,.45).wobble)).toBeGreaterThan(.05);
    expect(coinMotionAt({...received,hit:false},.45).wobble).toBe(0);
    expect(coinMotionAt(received,1.2).wobble).toBe(0);
  });

  it('a shot recoils in place rather than lunging into melee',()=>{
    const shot=coinMotionAt({attack:'shot',hit:false,hitDelay:.53,reach:.5},.24);
    expect(shot.travel).toBe(0);
    expect(shot.tilt).not.toBe(0);
  });

  it('the projectile crosses the board before its impact ring appears',()=>{
    expect(shotPhaseAt(.08).visible).toBe(false);
    expect(shotPhaseAt(.3)).toMatchObject({visible:true,impact:false});
    expect(shotPhaseAt(.3).progress).toBeGreaterThan(0);
    expect(shotPhaseAt(.6)).toMatchObject({visible:false,impact:true});
    expect(shotPhaseAt(.9).impact).toBe(false);
  });
});
