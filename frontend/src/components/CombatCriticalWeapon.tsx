import type {CSSProperties} from 'react';
import type {CombatAnimationProfile} from '../solo-combat/animationProfiles';
import CombatAnimationGlyph from './CombatAnimationGlyph';
import './CombatCriticalWeapon.css';

/** Extra weapon motion is authored by the critical profile. Contact uses the
 * same saved-result timing as the impact, token recoil and sound scheduler. */
export function CriticalWeaponStrike({primitive}: {primitive:CombatAnimationProfile['primitive']}) {
  if(primitive==='melee_slash')return <g className="combat-critical-slash">
    <g className="combat-critical-slash-hilt"><path d="M-73 61L48 -66L68 -88L60 -60L-65 69Z"/><path d="M-79 51L-53 76M-72 64L-88 82"/></g>
    <g className="combat-critical-slash-cut">
      <path className="combat-critical-cut-shadow" d="M-118 82C-140 -85 45 -129 117 -47C18 -91 -76 -23 -118 82Z"/>
      <path className="combat-critical-cut-edge" d="M-117 81C-121 -44 25 -114 117 -47"/>
      <path className="combat-critical-cut-core" d="M-94 89C-111 -5 -13 -94 105 -57"/>
      <path className="combat-critical-cut-splinter" d="M-77 99Q-25 -26 96 -42M-109 45Q-75 -66 50 -86"/>
    </g>
    <g className="combat-critical-scar"><path d="M-74 68L64 -61M-62 66L69 -53"/></g>
  </g>;
  if(primitive==='melee_pierce')return <g className="combat-critical-pierce">
    <g className="combat-critical-pierce-weapon"><path d="M-140 -7H-32L46 0L-32 7H-140Z"/><path d="M-120 -23V23M-157 -5H-127V5H-157Z"/></g>
    <g className="combat-critical-pierce-rush"><path d="M-166 -23H-38L19 0L-38 23H-166M-178 -35H-85M-185 35H-98"/></g>
    <g className="combat-critical-puncture"><path d="M-14 0L93 -7L128 0L93 7ZM6 -8L76 -35L49 -7M6 8L76 35L49 7"/></g>
  </g>;
  if(primitive==='melee_bash')return <g className="combat-critical-bash">
    <g className="combat-critical-bash-weapon"><path className="combat-critical-hammer-handle" d="M-93 -8H-18V8H-93Z"/><path d="M-22 -36H20L31 -24V24L20 36H-22L-31 24V-24Z"/><path d="M-15 -26V26M15 -26V26M-26 -17H24M-26 17H24"/></g>
    <g className="combat-critical-bash-trail"><path d="M-114 -47Q-35 -110 33 -44M-106 -65Q-39 -110 7 -80"/></g>
    <g className="combat-critical-crater"><ellipse rx="56" ry="24"/><path d="M-18 -14L-29 -39L-50 -49M12 -18L31 -49L49 -43M31 -3L64 -16L78 -10M27 12L54 37L48 48M-6 18L-15 50L-32 57M-31 9L-63 30L-78 22"/></g>
  </g>;
  return <g className="combat-critical-penetration"><path d="M-29 0L76 -11L125 0L76 11ZM-2 -8L65 -41L35 -5M-2 8L65 41L35 5"/><ellipse rx="10" ry="43"/></g>;
}

export function CriticalWeaponImpact({profile}: {profile:CombatAnimationProfile}) {
  return <g className="combat-critical-impact" data-critical-impact="true">
    <circle className="combat-critical-pressure" r="76"/>
    <circle className="combat-critical-contact" r="35"/>
    <path className="combat-critical-burst" d="M0 -68L12 -21L43 -43L22 -10L76 0L24 12L50 42L12 26L0 71L-12 26L-51 45L-24 12L-74 0L-25 -11L-49 -47L-12 -23Z"/>
    {Array.from({length:14},(_,i)=><g key={i} transform={`rotate(${i*360/14+9})`}>
      <g className="combat-critical-fragment" style={{'--fragment-distance':`${59+i%4*17}px`,'--fragment-turn':`${(i%2?1:-1)*(80+i*11)}deg`,'--fragment-delay':`${i%3*15}ms`} as CSSProperties}>
        <path d={`M${12+i%3} -4L${28+i%4*4} -8L${22+i%3*3} 4L14 7Z`}/>
      </g>
      <path className="combat-critical-impact-streak" d={`M27 0H${65+i%4*11}`} pathLength="1"/>
    </g>)}
    {profile.motif&&profile.motif!=='weapon'&&<g className="combat-critical-impact-glyph"><CombatAnimationGlyph motif={profile.motif}/></g>}
  </g>;
}
