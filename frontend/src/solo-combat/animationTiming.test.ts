import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {readFileSync} from 'node:fs';
import CombatAnimationLayer from '../components/CombatAnimationLayer';
import {combatAnimationTiming, combatAnimationTimingStyle, combatBeatSoundMarkers} from './animationTiming';
import type {CombatAnimationPrimitive, CombatAnimationProfile} from './animationProfiles';
import type {CombatBeat} from './presentation';

const baseCss = readFileSync(new URL('../components/CombatAnimations.css', import.meta.url), 'utf8');
const advancedCss = readFileSync(new URL('../components/CombatAdvancedAnimations.css', import.meta.url), 'utf8');

const profile = (primitive: CombatAnimationPrimitive, durationMs = 1000): CombatAnimationProfile => ({
  key: 'test.entity-provided-profile', primitive, motion: {durationMs, scale: 1}, palette: {primary: '#fff', secondary: '#aaa'}, casterCircle: false,
});
const beat = (animation = profile('ranged_arrow')): CombatBeat => ({id: 'entry', sourceId: 'source', targetId: 'target', sourceName: '', actionName: '', cues: [], animation});

describe('shared combat animation phases', () => {
  it.each([
    {primitive: 'melee_slash' as const, duration: 1450, launch: .25, contact: .48},
    {primitive: 'ranged_arrow' as const, duration: 1350, launch: .30, contact: .48},
    {primitive: 'charged_beam' as const, duration: 1550, launch: .40, contact: .54},
    {primitive: 'projectile' as const, duration: 1450, launch: .24, contact: .50},
    {primitive: 'beam' as const, duration: 1250, launch: .24, contact: .44},
  ])('uses $primitive authored critical timing for both CSS and audio markers', data => {
    const animation: CombatAnimationProfile = {...profile(data.primitive, data.duration), strikeStyle: 'critical',
      motion: {durationMs: data.duration, scale: 1.4, launchRatio: data.launch, contactRatio: data.contact}};
    const markers = combatBeatSoundMarkers(beat(animation))!;
    expect(markers.launchMs).toBeCloseTo(data.duration * data.launch);
    expect(markers.contactMs).toBeCloseTo(data.duration * data.contact);
    expect(markers.flightMs).toBeCloseTo(data.duration * (data.contact - data.launch));
    expect(combatAnimationTimingStyle(animation)['--fx-contact-delay']).toBe(`${markers.contactMs}ms`);
    expect(combatBeatSoundMarkers(beat(animation), true)).toMatchObject({launchMs: 0, contactMs: 0, flightMs: 0});
  });
  it('keeps invalid profile timings bounded and never schedules contact before release', () => {
    const invalid = {...profile('ranged_arrow'), motion: {durationMs: 1000, scale: 1, launchRatio: -1, contactRatio: 2}};
    expect(combatAnimationTiming(invalid)).toMatchObject({launchMs: 96.8, contactMs: 496.8});
    expect(combatAnimationTiming({...invalid, motion: {...invalid.motion, launchRatio: .7, contactRatio: .2}}))
      .toMatchObject({launchMs: 700, contactMs: 700, flightMs: 0});
  });
  it.each([['ranged_arrow', 96.8, 496.8], ['firearm', 110, 360], ['charged_beam', 340, 530]] as const)(
    '%s reaches its target when impact and miss audio start', (primitive, launch, contact) => {
      const animation = profile(primitive);
      const timing = combatBeatSoundMarkers(beat(animation))!;
      expect(timing.launchMs).toBeCloseTo(launch);
      expect(timing.contactMs).toBeCloseTo(contact);
      expect(timing.launchMs + timing.flightMs).toBeCloseTo(timing.contactMs);
      expect(timing.missMs).toBe(timing.contactMs);
      const css = combatAnimationTimingStyle(animation);
      const html = renderToStaticMarkup(createElement('svg', null,
        createElement(CombatAnimationLayer, {beat: beat(animation), profile: animation, from: {x: 0, y: 0}, to: {x: 4, y: 0}})));
      for (const [key, value] of Object.entries(css)) expect(html).toContain(`${key}:${value}`);
    });
  it('scales a different entity duration and shares variables with delivery and impact CSS', () => {
    const timing = combatAnimationTiming({...profile('projectile', 1850), key: 'another-entity'});
    expect(timing.contactMs).toBeCloseTo(1850 * .4968);
    expect(baseCss).toContain('combat-fx-flight var(--fx-flight-duration)');
    expect(baseCss).toContain('--impact-delay:var(--fx-contact-delay)');
    expect(baseCss).toContain('ease-out var(--fx-miss-delay)');
    expect(advancedCss).toContain('combat-ray-shoot var(--fx-flight-duration)');
    expect(advancedCss).toContain('combat-area-pour var(--fx-flight-duration)');
    expect(advancedCss).toContain('combat-area-bloom-grow var(--fx-contact-delay)');
    expect(advancedCss).not.toContain('--impact-delay:calc');
  });
  it('has no sound markers before a reaction or for a suppressed duplicate', () => {
    expect(combatBeatSoundMarkers({...beat(), rollPhase: 'before-reaction'})).toBeUndefined();
    expect(combatBeatSoundMarkers({...beat(), suppressAnimation: true})).toBeUndefined();
    expect(combatBeatSoundMarkers({...beat(), rollPhase: 'after-reaction'})?.contactMs).toBeGreaterThan(0);
  });
  it('does not leave delayed audio for reduced motion', () => {
    expect(combatBeatSoundMarkers(beat(profile('charged_beam')), true)).toMatchObject({chargeMs: 0, launchMs: 0, contactMs: 0, missMs: 0, flightMs: 0});
  });
});
