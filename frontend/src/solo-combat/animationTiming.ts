import type {CombatAnimationPrimitive, CombatAnimationProfile} from './animationProfiles';
import type {CombatBeat} from './presentation';

export interface CombatAnimationTiming {
  durationMs: number;
  chargeMs?: number;
  launchMs: number;
  contactMs: number;
  missMs: number;
  flightMs: number;
}

// Primitive phases remain the compatibility default. A data-owned profile may
// declare different release/contact ratios (e.g. a longer critical wind-up).
// CSS and audio consume these same markers; neither looks up an entity name.
// Contact is also the start of the visible impact/miss effect.
const delivery: Partial<Record<CombatAnimationPrimitive, {launch: number; contact: number; charge?: boolean}>> = {
  projectile: {launch: .0968, contact: .4968},
  ranged_arrow: {launch: .0968, contact: .4968},
  weapon_throw: {launch: .0968, contact: .4968},
  firearm: {launch: .11, contact: .36},
  charged_beam: {launch: .34, contact: .53, charge: true},
  beam: {launch: .0774, contact: .206425},
  melee_slash: {launch: .0839, contact: .33554},
  melee_pierce: {launch: .0774, contact: .2774},
  melee_bash: {launch: .0774, contact: .3334},
  bite: {launch: 0, contact: .286824},
  claws: {launch: 0, contact: .4556},
  tail: {launch: 0, contact: .465},
  tentacle: {launch: 0, contact: .52},
  sting: {launch: 0, contact: .325},
  natural_slam: {launch: 0, contact: .408},
  area_cone: {launch: .08, contact: .43},
  area_line: {launch: .08, contact: .43},
  area_wave: {launch: 0, contact: .76},
  area_burst: {launch: 0, contact: .67},
};

export function combatAnimationTiming(profile?: CombatAnimationProfile, reducedMotion = false): CombatAnimationTiming {
  const durationMs = Math.max(0, profile?.motion.durationMs ?? 0);
  const phase = profile && delivery[profile.primitive];
  const validRatio = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value) && value >= 0 && value <= 1;
  const launchRatio = validRatio(profile?.motion.launchRatio) ? profile.motion.launchRatio : phase?.launch ?? 0;
  const declaredContact = profile?.motion.contactRatio;
  const contactRatio = Math.max(launchRatio, validRatio(declaredContact) ? declaredContact : phase?.contact ?? launchRatio);
  const scale = reducedMotion ? 0 : durationMs;
  const launchMs = scale * launchRatio;
  const contactMs = scale * contactRatio;
  return {durationMs, ...(phase?.charge ? {chargeMs: 0} : {}), launchMs, contactMs, missMs: contactMs, flightMs: contactMs - launchMs};
}

/** An uncommitted roll and suppressed duplicate visuals have no sound phases. */
export function combatBeatSoundMarkers(beat: CombatBeat, reducedMotion = false): CombatAnimationTiming | undefined {
  if (beat.rollPhase === 'before-reaction' || beat.suppressAnimation) return undefined;
  return combatAnimationTiming(beat.animation, reducedMotion);
}

export function combatAnimationTimingStyle(profile: CombatAnimationProfile): Record<string, string> {
  const timing = combatAnimationTiming(profile);
  const ms = (value: number) => `${Number(value.toFixed(4))}ms`;
  return {
    '--fx-duration': ms(timing.durationMs),
    '--fx-launch-delay': ms(timing.launchMs),
    '--fx-contact-delay': ms(timing.contactMs),
    '--fx-miss-delay': ms(timing.missMs),
    '--fx-flight-duration': ms(timing.flightMs),
    '--fx-release-duration': ms(timing.durationMs - timing.launchMs),
  };
}
