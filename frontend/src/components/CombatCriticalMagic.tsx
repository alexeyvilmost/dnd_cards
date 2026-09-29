import type {CSSProperties} from 'react';
import type {CombatAnimationProfile} from '../solo-combat/animationProfiles';
import CombatAnimationGlyph from './CombatAnimationGlyph';
import './CombatCriticalMagic.css';

/** Geometry is chosen by the presentation profile; the caller gates it on a
 * committed critical outcome. All phases share the delivery/contact markers. */
export function CriticalMagicFocus() {
  return <g className="combat-critical-magic-focus">
    <ellipse className="combat-critical-focus-disc" rx="14" ry="44"/>
    <g className="combat-critical-focus-orbits"><path d="M-12 -47Q-39 -12 -12 30M12 47Q39 12 12 -30"/><ellipse rx="24" ry="52"/><path d="M-8 -59L0 -66L8 -59M-8 59L0 66L8 59"/></g>
    <path className="combat-critical-focus-spikes" d="M-54 -30L-26 -12M-65 0H-28M-54 30L-26 12M31 -25L16 -12M31 25L16 12"/>
  </g>;
}

export function CriticalMagicBeamTrail({distance}: {distance:number}) {
  return <g className="combat-critical-magic-beam-trail">
    {[-1,1].map(side=><path key={side} pathLength="1" d={`M0 0Q${distance*.16} ${side*30} ${distance*.33} 0T${distance*.66} 0T${distance} 0`}/>)}
    <path className="combat-critical-beam-pressure" pathLength="1" d={`M0 -13L${distance*.45} -6L${distance} 0L${distance*.45} 6L0 13`}/>
  </g>;
}

export function CriticalMagicProjectile({profile,weapon=false}: {profile:CombatAnimationProfile;weapon?:boolean}) {
  return <g className="combat-critical-magic-projectile">
    <path className="combat-critical-magic-wake" d="M-151 -2Q-91 -34 -22 -13M-164 8Q-89 32 -22 13M-144 0H-37"/>
    <ellipse className="combat-critical-projectile-envelope" rx="42" ry="27"/>
    <g className="combat-critical-projectile-orbit"><ellipse rx="33" ry="19"/><path d="M-28 -20L-18 -27L-9 -18M28 20L18 27L9 18"/></g>
    {!weapon&&<><circle className="combat-critical-projectile-core" r="19"/><g className="combat-critical-projectile-glyph" transform="scale(.6)"><CombatAnimationGlyph motif={profile.motif}/></g></>}
  </g>;
}

export function CriticalMagicImpact({profile}: {profile:CombatAnimationProfile}) {
  return <g className="combat-critical-magic-impact" data-critical-impact="magic">
    <circle className="combat-critical-magic-shock" r="73"/>
    <g className="combat-critical-magic-seal"><path d="M0 -58L50 -29V29L0 58L-50 29V-29Z"/><path d="M0 -38L33 19H-33Z M0 38L-33 -19H33Z"/></g>
    <path className="combat-critical-magic-fracture" d="M-8 -8L-32 -37L-30 -57L-46 -75M9 -9L29 -28L50 -30L65 -53M14 3L43 11L56 32L83 36M-3 15L6 45L-9 61L-4 83M-15 8L-43 32L-70 25L-83 43"/>
    <circle className="combat-critical-magic-flare" r="34"/>
    {Array.from({length:10},(_,i)=><g key={i} transform={`rotate(${i*36+18})`}>
      <g className="combat-critical-magic-shard" style={{'--magic-shard-distance':`${64+i%3*20}px`,'--magic-shard-turn':`${(i%2?1:-1)*(70+i*17)}deg`} as CSSProperties}><path d="M18 -4L32 0L22 9L24 1Z"/></g>
      <path className="combat-critical-magic-ray" d={`M20 0H${65+i%3*12}`} pathLength="1"/>
    </g>)}
    <g className="combat-critical-magic-mark"><CombatAnimationGlyph motif={profile.motif}/></g>
  </g>;
}
