import type { CSSProperties } from 'react';
import type { CombatBeat } from '../solo-combat/presentation';
import type { SoloCombatState } from '../solo-combat/types';
import { getDamageIconPath, getDamageLabel } from '../utils/damageTypes';
import {actorFootprint} from '../solo-combat/footprint';
import {boardDimensions} from '../solo-combat/boardGeometry';
import {resolveCombatAnimation, resolveActiveSpellCircles} from '../solo-combat/animationProfiles';
import CombatAnimationLayer from './CombatAnimationLayer';
import CombatSpellCircle from './CombatSpellCircle';
import {useCombatFloatingCues} from '../solo-combat/useCombatFloatingCues';
import '../dice/CombatPresentation.css';
import './CombatAnimations.css';
import '../audio/healing.css';

export default function CombatMapFeedback({beat,state}: {beat:CombatBeat|null;state:SoloCombatState}) {
  const captionBatches=useCombatFloatingCues(beat);
  const centre=(position: NonNullable<CombatBeat['from']>, actorId?: string)=>{
    const offset=actorFootprint(actorId ? state.world.actors[actorId] : undefined, state)/2;
    return {x:position.x+offset,y:position.y+offset};
  };
  // Never render a provisional roll's outcome, even in independently embedded maps.
  const committed=beat?.rollPhase==='before-reaction'?null:beat;
  const fromPosition=committed&&(committed.from??state.tokens[committed.sourceId]?.position);
  const toPosition=committed&&(committed.to??state.tokens[committed.targetId??'']?.position??fromPosition);
  const from=fromPosition&&centre(fromPosition,committed?.sourceId);
  const to=toPosition&&centre(toPosition,committed?.targetIsPoint?undefined:committed?.targetId??committed?.sourceId);
  const profile=committed?.suppressAnimation?undefined:committed?.animation??(committed?.visual?resolveCombatAnimation(undefined,{visual:committed.visual}):undefined);
  const grouped=new Map<string,CombatBeat['cues']>();
  for(const cue of committed?.cues??[])grouped.set(cue.actorId,[...(grouped.get(cue.actorId)??[]),cue]);
  const circles=resolveActiveSpellCircles(state);
  const dimensions=boardDimensions(state);
  return <div className="combat-map-feedback" aria-live="polite">
    <svg className="combat-animation-canvas" viewBox={`0 0 ${dimensions.width*100} ${dimensions.height*100}`} preserveAspectRatio="none" aria-hidden="true">
      {circles.map(circle=>{
        const point=centre(state.tokens[circle.actorId].position,circle.actorId);
        return <CombatSpellCircle key={circle.key} x={point.x*100} y={point.y*100} level={circle.spellLevel}
          footprint={actorFootprint(state.world.actors[circle.actorId],state)} profile={circle.profile} persistent/>;
      })}
      {committed&&profile&&from&&to&&(committed.saveRows??[committed]).map((row,index)=>{
        if(row.suppressAnimation)return null;
        const targetPosition=row.to??state.tokens[row.targetId??'']?.position;
        const target=targetPosition?centre(targetPosition,row.targetIsPoint?undefined:row.targetId):to;
        return <CombatAnimationLayer key={row.id} beat={row} profile={row.animation??profile} from={from} to={target} showCasterCircle={index===0} showArea={index===0}
          sourceSize={actorFootprint(state.world.actors[row.sourceId],state)}
          targetSize={row.targetIsPoint?1:actorFootprint(state.world.actors[row.targetId??row.sourceId],state)}/>;
      })}
    </svg>
    {[...grouped].filter(([,cues])=>cues.some(c=>c.kind==='healing')).map(([id])=>{
      const pos=state.tokens[id]?.position;if(!pos)return null;
      return <div key={`heal:${id}`} className="combat-healing-aura" aria-hidden="true" style={{left:`calc(${pos.x} * var(--tactical-cell-size))`,top:`calc(${pos.y} * var(--tactical-cell-size))`,'--healing-size':actorFootprint(state.world.actors[id],state)} as CSSProperties}/>;
    })}
    {captionBatches.flatMap(batch=>{
      const captionGroups=new Map<string,CombatBeat['cues']>();
      for(const cue of batch.cues)captionGroups.set(cue.actorId,[...(captionGroups.get(cue.actorId)??[]),cue]);
      return [...captionGroups].map(([actorId,cues])=>{
        const pos=state.tokens[actorId]?.position;
        if(!pos)return null;
        return <div key={`${batch.id}:${actorId}`} className="combat-floating-stack" style={{animationDelay:`${batch.delayMs}ms`,left:`clamp(116px, calc(${centre(pos,actorId).x} * var(--tactical-cell-size)), calc(100% - 116px))`,top:`calc(${pos.y < 1 ? pos.y + 1 : pos.y} * var(--tactical-cell-size))`}}>
          {cues.map((cue,i)=><span key={i} className={`combat-floating-cue is-${cue.kind}`}>
            {cue.damageType&&<img src={getDamageIconPath(cue.damageType)} alt={getDamageLabel(cue.damageType)}/>}<b>{cue.text}</b>
          </span>)}
        </div>;
      });
    })}
  </div>;
}
