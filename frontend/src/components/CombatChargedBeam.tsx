import {useId, type CSSProperties} from 'react';
import type {CombatAnimationProfile} from '../solo-combat/animationProfiles';
import {CriticalMagicBeamTrail, CriticalMagicFocus} from './CombatCriticalMagic';

/** A focus in front of the source gathers energy, then releases a fast ray.
 * All distances are presentation coordinates, with the endpoint supplied by
 * the committed result (including the deliberately offset miss endpoint). */
export default function CombatChargedBeam({distance,sourceSize,profile,critical=false}: {
  distance:number;sourceSize:number;profile:CombatAnimationProfile;critical?:boolean;
}) {
  const id=useId().replace(/[^a-zA-Z0-9_-]/g,'');
  const focus=Math.min(Math.max(24,sourceSize*43+14),distance*.45);
  const length=Math.max(0,distance-focus);
  const width=profile.motif==='force'?12:8;
  return <g className="combat-charged-ray" data-focus-distance={focus} style={{'--ray-length':`${length}px`} as CSSProperties}>
    <defs>
      <linearGradient id={`${id}-ray`} x1="0" x2="1"><stop offset="0" stopColor={profile.palette.primary}/><stop offset=".25" stopColor={profile.palette.secondary}/><stop offset="1" stopColor={profile.palette.primary}/></linearGradient>
      <radialGradient id={`${id}-focus`}><stop offset="0" stopColor={profile.palette.secondary} stopOpacity=".95"/><stop offset=".3" stopColor={profile.palette.primary} stopOpacity=".65"/><stop offset="1" stopColor={profile.palette.primary} stopOpacity="0"/></radialGradient>
    </defs>
    <g transform={`translate(${focus} 0)`}>
      {critical&&<CriticalMagicFocus/>}
      <g className="combat-ray-charge">
        <circle className="combat-ray-charge-halo" r="52" fill={`url(#${id}-focus)`}/>
        <g className="combat-ray-focus-rings"><ellipse rx="12" ry="32"/><ellipse rx="7" ry="21"/><path d="M0 -40V-32M0 32V40M-18 0H-10M10 0H18"/></g>
        {Array.from({length:8},(_,i)=><g key={i} transform={`rotate(${i*45+22.5})`}><path className="combat-ray-inflow" d="M45 0H62" style={{'--ray-particle-delay':`${i%3*.025}`} as CSSProperties}/></g>)}
        <circle className="combat-ray-focus-core" r="10"/>
      </g>
      <g className="combat-ray-release">
        <path className="combat-ray-corona" pathLength="1" d={`M0 0H${length}`} stroke={`url(#${id}-ray)`} strokeWidth={width*3}/>
        <path className="combat-ray-body" pathLength="1" d={`M0 0H${length}`} stroke={`url(#${id}-ray)`} strokeWidth={width}/>
        <path className="combat-ray-thread" pathLength="1" d={`M0 0H${length}`} strokeWidth={profile.motif==='force'?3:2}/>
        <path className="combat-ray-ribbon" pathLength="1" d={`M0 -6Q${length*.26} -15 ${length*.5} -5T${length} 0 M0 6Q${length*.26} 15 ${length*.5} 5T${length} 0`}/>
        <g className="combat-ray-tip"><path d="M-26 -9L7 0L-26 9L-14 0Z"/><circle r="6"/></g>
      </g>
      {critical&&<CriticalMagicBeamTrail distance={length}/>}
      <ellipse className="combat-ray-recoil-ring" rx="8" ry="25"/>
    </g>
  </g>;
}
