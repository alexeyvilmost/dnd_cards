import {useId, type CSSProperties} from 'react';
import type {CombatAnimationProfile} from '../solo-combat/animationProfiles';
import type {CombatBeat} from '../solo-combat/presentation';
import CombatAnimationGlyph from './CombatAnimationGlyph';

/** Geometry is a frozen projection of the same cells used by targeting. The
 * renderer only clips paint to them; it cannot discover targets or apply rules. */
export default function CombatAreaAnimation({area,profile}: {area:NonNullable<CombatBeat['area']>;profile:CombatAnimationProfile}) {
  const id=useId().replace(/[^a-zA-Z0-9_-]/g,'');
  const origin={x:(area.origin.x+.5)*100,y:(area.origin.y+.5)*100};
  const direction=Math.atan2(area.aim.y-area.sourcePosition.y,area.aim.x-area.sourcePosition.x)*180/Math.PI;
  const geometry=area.geometry;
  const length=('lengthFt' in geometry?geometry.lengthFt:'sizeFt' in geometry?geometry.sizeFt:geometry.radiusFt)/5*100;
  const extent=area.cells.reduce((radius,p)=>Math.max(radius,Math.hypot((p.x+.5)*100-origin.x,(p.y+.5)*100-origin.y)+72),Math.max(100,length));
  const cellsPath=area.cells.map(p=>`M${p.x*100} ${p.y*100}h100v100h-100Z`).join(' ');
  if(!area.cells.length)return null;
  const cone=geometry.kind==='cone',line=geometry.kind==='line';
  const wave=profile.primitive==='area_wave';
  const directional=cone||line;
  const halfWidth=line?geometry.widthFt/5*50:length*.5;
  return <g className={`combat-area-fx is-${geometry.kind} motif-${profile.motif??'force'}`}
    data-area-kind={geometry.kind} data-area-cell-count={area.cells.length} data-area-origin={`${area.origin.x},${area.origin.y}`}>
    <defs>
      <clipPath id={`${id}-cells`} clipPathUnits="userSpaceOnUse"><path d={cellsPath}/></clipPath>
      <radialGradient id={`${id}-bloom`}><stop offset="0" stopColor={profile.palette.secondary} stopOpacity=".48"/><stop offset=".45" stopColor={profile.palette.primary} stopOpacity=".32"/><stop offset="1" stopColor={profile.palette.primary} stopOpacity="0"/></radialGradient>
      <linearGradient id={`${id}-breath`} x1="0" x2="1"><stop offset="0" stopColor={profile.palette.secondary} stopOpacity=".95"/><stop offset=".3" stopColor={profile.palette.primary} stopOpacity=".72"/><stop offset="1" stopColor={profile.palette.primary} stopOpacity=".03"/></linearGradient>
    </defs>
    <g clipPath={`url(#${id}-cells)`}>
      <path className="combat-area-ground" d={cellsPath} fill={profile.palette.primary} stroke="none"/>
      <g transform={`translate(${origin.x} ${origin.y})`}>
        <circle className="combat-area-bloom" r={extent} fill={`url(#${id}-bloom)`} stroke="none"/>
        {directional?<g transform={`rotate(${direction})`}>
          <g className="combat-area-breath">
            <path className="combat-area-breath-sheet" d={cone?`M0 0L${length+80} ${-halfWidth-55}Q${length+140} 0 ${length+80} ${halfWidth+55}Z`:`M0 ${-halfWidth-25}H${length+75}V${halfWidth+25}H0Z`} fill={`url(#${id}-breath)`}/>
            {Array.from({length:cone?9:5},(_,i)=>{
              const count=cone?9:5,lane=(i-(count-1)/2)/((count-1)/2);
              const endY=lane*halfWidth;
              return <path key={i} className="combat-area-stream" pathLength="1"
                d={`M${cone?0:12} ${cone?0:endY*.9}Q${length*.35} ${endY*.26+(i%2?16:-16)} ${length*.66} ${endY*.65}T${length+45} ${endY}`}
                style={{'--stream-delay':i%3*.025,strokeWidth:profile.motif==='lightning'?3:12+i%3*6} as CSSProperties}/>;
            })}
            {Array.from({length:18},(_,i)=>{
              const lane=(i%7-3)/3,distance=length*(.5+(i%5)*.115),y=lane*(cone?distance*.5:halfWidth);
              return <g key={i} transform={`translate(${distance} ${y})`}><g className="combat-area-element" style={{'--element-delay':.24+(i%5)*.035} as CSSProperties}>
                {profile.motif==='frost'?<path d="M0 -12V12M-10 -6L10 6M-10 6L10 -6"/>:
                  profile.motif==='lightning'?<path d="M-14 -4L0 4L-3 -6L14 4"/>:
                    profile.motif==='acid'||profile.motif==='poison'?<circle r={5+i%4*2}/>:
                      <path d={`M-16 ${-4-i%3}Q-4 -14 14 0Q-4 14 -16 ${4+i%3}Z`}/>}
              </g></g>;
            })}
          </g>
        </g>:wave?<g className="combat-area-pressure">
          {[0,1,2,3].map(i=><circle key={i} className="combat-area-pressure-ring" r={extent} style={{'--wave-offset':i*.055} as CSSProperties}/>)}
          {Array.from({length:12},(_,i)=><path key={i} className="combat-area-pressure-ray" transform={`rotate(${i*30})`} d={`M30 0H${extent}`} pathLength="1"/>)}
          <g className="combat-area-wave-seal"><CombatAnimationGlyph motif="thunder"/></g>
        </g>:profile.motif==='nature'||profile.motif==='necrotic'?<g className="combat-area-growth">
          {Array.from({length:12},(_,i)=>{
            const distance=extent*(.55+(i%3)*.15),curl=i%2?1:-1;
            return <g key={i} transform={`rotate(${i*30+13})`}>
              <path className={profile.motif==='nature'?'combat-area-vine':'combat-area-tendril'} pathLength="1"
                d={`M0 0C${distance*.3} ${curl*45} ${distance*.45} ${-curl*65} ${distance*.7} ${curl*12}S${distance*1.1} ${curl*55} ${distance*.9} ${-curl*15}`}/>
              {profile.motif==='nature'&&[.4,.65,.8].map((fraction,j)=><g key={j} transform={`translate(${distance*fraction} ${curl*(j%2?18:-12)}) rotate(${j%2?25:-35})`}>
                <path className="combat-area-leaf" d="M0 0Q6 -24 29 -17Q25 4 0 0Z"/>
              </g>)}
            </g>;
          })}
          <g className="combat-area-splash-core"><CombatAnimationGlyph motif={profile.motif}/></g>
        </g>:['psychic','illusion','wind','radiant','force'].includes(profile.motif??'force')?<g className="combat-area-cloud">
          {area.cells.map((cell,i)=><g key={`${cell.x}:${cell.y}`} transform={`translate(${(cell.x-area.origin.x)*100} ${(cell.y-area.origin.y)*100})`}>
            <ellipse className="combat-area-mist" rx={63+i%3*7} ry={38+i%2*10}/>
            <g className="combat-area-mote" transform={`rotate(${i*41})`}>
              {profile.motif==='wind'?<path d="M-32 -7Q-4 -28 30 -8M-27 11Q0 -4 24 13"/>:
                profile.motif==='psychic'?<><path d="M-5 -17Q-22 -4 -8 13Q2 18 10 9Q-10 10 -5 -17Z"/><circle cx="24" cy="-22" r="2"/></>:
                  <path d="M0 -13L3 -3L13 0L3 3L0 13L-3 3L-13 0L-3 -3Z"/>}
            </g>
          </g>)}
          <g className="combat-area-splash-core"><CombatAnimationGlyph motif={profile.motif}/></g>
        </g>:<g className="combat-area-splash">
          <circle className="combat-area-splash-ring" r={extent*.7}/>
          {Array.from({length:16},(_,i)=>{
            const angle=i*360/16+13,distance=extent*(.42+(i%4)*.14);
            return <g key={i} transform={`rotate(${angle})`}><g className="combat-area-droplet" style={{'--drop-distance':`${distance}px`,'--drop-delay':(i%3)*.025} as CSSProperties}>
              <path d="M-16 0Q-4 -11 8 -5Q20 4 5 9Q-5 9 -16 0Z"/><circle cx="-25" cy="8" r="3"/>
            </g></g>;
          })}
          {area.cells.map((cell,i)=><g key={`${cell.x}:${cell.y}`} transform={`translate(${(cell.x-area.origin.x)*100} ${(cell.y-area.origin.y)*100})`}>
            <ellipse className="combat-area-puddle" rx={22+i%3*5} ry={12+i%2*3} style={{'--puddle-delay':.39+i%5*.02} as CSSProperties}/>
          </g>)}
          <g className="combat-area-splash-core"><CombatAnimationGlyph motif={profile.motif}/></g>
        </g>}
      </g>
    </g>
  </g>;
}
