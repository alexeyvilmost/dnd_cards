import type { CSSProperties } from 'react';
import type { CombatAnimationProfile } from '../solo-combat/animationProfiles';

/** Rings use the committed slot level. Cantrips have one ring, level nine has six. */
export function spellCircleGeometry(level: number, footprint = 1) {
  const safeLevel = Math.min(9, Math.max(0, Math.floor(Number.isFinite(level) ? level : 0)));
  return {rings: 1 + Math.ceil(safeLevel / 2), radius: 55 * footprint + safeLevel * 7};
}

export default function CombatSpellCircle({x,y,level,footprint=1,profile,persistent=false}: {
  x:number;y:number;level:number;footprint?:number;profile:CombatAnimationProfile;persistent?:boolean;
}) {
  const {rings,radius}=spellCircleGeometry(level,footprint);
  return <g transform={`translate(${x} ${y})`} className={`combat-spell-circle${persistent?' is-persistent':''}`}
    data-spell-level={level} data-ring-count={rings} style={{'--fx-primary':profile.palette.primary,'--fx-secondary':profile.palette.secondary,'--fx-duration':`${profile.motion.durationMs}ms`} as CSSProperties}>
    <g className="combat-spell-circle__reveal">
      <circle className="combat-spell-circle__ground" r={radius+7}/>
      {Array.from({length:rings},(_,i)=><g key={i} className={`combat-spell-circle__orbit${i%2?' is-counter':''}`} style={{'--circle-speed':`${22+i*9}s`} as CSSProperties}>
        <circle r={radius-i*8} className="combat-spell-circle__ring" strokeDasharray={i%2?'3 5 16 5':undefined}/>
        {Array.from({length:8+i*2},(_,n)=>{
          const a=n*360/(8+i*2),r=radius-i*8;
          return <path key={n} transform={`rotate(${a}) translate(0 ${-r})`} d={n%3===0?'M-3 -5L3 0L-3 5M0 -5V5':n%3===1?'M-4 -4L0 4L4 -4M-3 0H3':'M-4 4V-4L4 4V-4'} className="combat-spell-circle__rune"/>;
        })}
      </g>)}
      <g className="combat-spell-circle__seal">
        <path d={`M0 ${-radius*.72}L${radius*.62} ${radius*.36}H${-radius*.62}Z M0 ${radius*.72}L${radius*.62} ${-radius*.36}H${-radius*.62}Z`}/>
        <circle r={radius*.44}/>
      </g>
    </g>
  </g>;
}
