import {describe,expect,it} from 'vitest';
import {coinMotionAt,shotPhaseAt} from './coinAnimation';
import {combatAnimationTiming} from '../solo-combat/animationTiming';
import type {CombatAnimationPrimitive,CombatAnimationProfile} from '../solo-combat/animationProfiles';

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

  it.each([['ranged_arrow',720],['charged_beam',2600]] as const)('uses %s authored delivery markers for projectile arrival and impact', (primitive,durationMs)=>{
    const profile:CombatAnimationProfile={key:`entity:${primitive}`,primitive,motion:{durationMs,scale:1},palette:{primary:'#fff',secondary:'#aaa'},casterCircle:false};
    const marker=combatAnimationTiming(profile);
    const timing={launch:marker.launchMs/1000,contact:marker.contactMs/1000,duration:marker.durationMs/1000};
    expect(shotPhaseAt(timing.launch-.001,timing).visible).toBe(false);
    expect(shotPhaseAt((timing.launch+timing.contact)/2,timing)).toMatchObject({progress:.5,visible:true,impact:false});
    expect(shotPhaseAt(timing.contact,timing)).toMatchObject({progress:1,visible:false,impact:true});
  });

  it.each([['melee_slash',920],['melee_pierce',1450]] as const)('reaches the defender at %s contact and begins its recoil then', (primitive:CombatAnimationPrimitive,durationMs)=>{
    const profile:CombatAnimationProfile={key:`entity:${primitive}`,primitive,motion:{durationMs,scale:1},palette:{primary:'#fff',secondary:'#aaa'},casterCircle:false};
    const marker=combatAnimationTiming(profile);
    const timing={launch:marker.launchMs/1000,contact:marker.contactMs/1000,duration:marker.durationMs/1000};
    const animation={attack:'melee' as const,hit:true,hitDelay:timing.contact,reach:.5,timing};
    expect(coinMotionAt(animation,timing.contact-.001).travel).toBeCloseTo(.5,3);
    expect(coinMotionAt(animation,timing.contact-.001).wobble).toBe(0);
    expect(coinMotionAt(animation,timing.contact).travel).toBe(.5);
    expect(Math.abs(coinMotionAt(animation,timing.contact+.045).wobble)).toBeGreaterThan(.05);
    expect(coinMotionAt(animation,timing.duration+.68).travel).toBe(0);
  });
});
