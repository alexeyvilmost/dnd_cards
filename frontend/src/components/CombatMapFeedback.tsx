import type { CSSProperties } from 'react';
import type { CombatBeat } from '../solo-combat/presentation';
import type { SoloCombatState } from '../solo-combat/types';
import { getDamageIconPath, getDamageLabel } from '../utils/damageTypes';

export default function CombatMapFeedback({beat,state}: {beat:CombatBeat|null;state:SoloCombatState}) {
  if(!beat)return null;
  const from=beat.from,to=beat.to;
  const angle=from&&to?Math.atan2(to.y-from.y,to.x-from.x)*180/Math.PI:0;
  const distance=from&&to?Math.hypot(to.x-from.x,to.y-from.y):0;
  const grouped=new Map<string,typeof beat.cues>();
  for(const cue of beat.cues)grouped.set(cue.actorId,[...(grouped.get(cue.actorId)??[]),cue]);
  return <div key={beat.id} className="combat-map-feedback" aria-live="polite">
    {beat.roll&&beat.visual&&from&&to&&<div className={`combat-attack-fx is-${beat.visual}`}
      style={{left:`calc((${from.x} + .5) * var(--tactical-cell-size))`,top:`calc((${from.y} + .5) * var(--tactical-cell-size))`,
        '--attack-angle':`${angle}deg`,'--attack-distance':`calc(${distance} * var(--tactical-cell-size))`} as CSSProperties}>
      <svg viewBox="0 0 100 60" aria-hidden="true">
        {beat.visual==='slashing'?<path d="M10 52 Q68 -6 93 12 Q74 10 22 56 Z"/>:
          beat.visual==='ranged'?<><path d="M8 30 H90 M72 18 L94 30 L72 42 M20 30 L9 19 M20 30 L9 41"/></>:
          beat.visual==='piercing'?<path d="M8 27 L76 27 L91 30 L76 33 L8 33 M20 18 V42"/>:
          beat.visual==='magic'?<><circle cx="65" cy="30" r="12"/><path d="M10 30 H51 M29 16 L49 24 M29 44 L49 36"/></>:
            <><path d="M15 30 H58 M58 17 H82 V43 H58 Z"/><path d="M87 12 L95 5 M90 30 H100 M87 48 L95 55"/></>}
      </svg>
    </div>}
    {[...grouped].map(([actorId,cues])=>{
      const pos=state.tokens[actorId]?.position;
      if(!pos)return null;
      return <div key={actorId} className="combat-floating-stack" style={{left:`clamp(116px, calc((${pos.x} + .5) * var(--tactical-cell-size)), calc(100% - 116px))`,top:`calc(${pos.y < 1 ? pos.y + 1 : pos.y} * var(--tactical-cell-size))`}}>
        {cues.map((cue,i)=><span key={i} className={`combat-floating-cue is-${cue.kind}`}>
          {cue.damageType&&<img src={getDamageIconPath(cue.damageType)} alt={getDamageLabel(cue.damageType)}/>}<b>{cue.text}</b>
        </span>)}
      </div>;
    })}
  </div>;
}
