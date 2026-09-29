import type {CSSProperties} from 'react';
import type {CombatBeat} from '../solo-combat/presentation';
import type {CombatAnimationProfile} from '../solo-combat/animationProfiles';
import type {GridPosition} from '../solo-combat/types';
import CombatAnimationGlyph from './CombatAnimationGlyph';
import CombatSpellCircle from './CombatSpellCircle';

function Sparks({count=10}: {count?:number}) {
  return <g className="combat-fx-sparks">{Array.from({length:count},(_,i)=><g key={i} transform={`rotate(${i*360/count+13})`}>
    <path className="combat-fx-spark" d={`M${15+i%3*4} 0h${9+i%4*5}`} style={{'--spark-distance':`${28+i%4*12}px`,'--spark-delay':`${i%3*35}ms`} as CSSProperties}/>
  </g>)}</g>;
}

function Impact({motif,critical=false}: {motif?:string;critical?:boolean}) {
  return <g className={`combat-fx-impact${critical?' is-critical':''}`}>
    <circle className="combat-fx-shockwave" r="38"/>
    <circle className="combat-fx-flash" r="25"/>
    <Sparks count={critical?16:10}/>
    {motif&&motif!=='weapon'&&<g className="combat-fx-impact-glyph"><CombatAnimationGlyph motif={motif}/></g>}
  </g>;
}

function Utility({primitive,motif}: {primitive:string;motif?:string}) {
  switch(primitive) {
    case 'dash': case 'move': case 'disengage': return <g className="combat-fx-dash">
      {[0,1,2,3].map(i=><path key={i} className="combat-fx-speedline" d={`M${-75-i*10} ${-30+i*20}h${65-i%2*12}`} style={{'--trail-delay':`${i*65}ms`} as CSSProperties}/>)}
      <path className="combat-fx-chevron" d="M5 -32L36 0L5 32M-19 -25L7 0L-19 25"/>
      {primitive==='disengage'&&<path className="combat-fx-orbit-line" d="M-35 -37A51 51 0 1 0 43 23"/>}
    </g>;
    case 'hide': return <g className="combat-fx-hide">{[0,1,2,3,4].map(i=><circle key={i} className="combat-fx-smoke" cx={(i-2)*18} cy={i%2*20-10} r={25+i%2*9} style={{'--smoke-delay':`${i*65}ms`,'--smoke-x':`${(i-2)*14}px`} as CSSProperties}/>)}<path className="combat-fx-eye" d="M-31 0Q0 -26 31 0Q0 26 -31 0M-31 26L31 -26"/></g>;
    case 'ward': case 'dodge': return <g className="combat-fx-ward"><path className="combat-fx-shield" d="M0 -48L37 -32V5Q34 34 0 49Q-34 34 -37 5V-32Z"/><path className="combat-fx-shield-inset" d="M0 -34L25 -23V4Q21 26 0 35Q-21 26 -25 4V-23Z"/>{primitive==='dodge'?<path d="M-65 0L-45 -20M-65 0L-43 10M65 0L45 -20M65 0L43 10"/>:<path d="M0 -20V20M-20 0H20"/>}</g>;
    case 'help': return <g className="combat-fx-aura"><path d="M-38 5L-19 -16L0 3L19 -16L38 5L18 26L0 10L-18 26Z"/><path className="combat-fx-orbit-line" d="M-46 -24A54 54 0 1 1 -44 29"/><Sparks count={6}/></g>;
    case 'search': return <g className="combat-fx-search"><circle r="39"/><path d="M-37 35L-54 52M0 0L28 -27"/><circle className="combat-fx-shockwave" r="55"/></g>;
    case 'death': return <g className="combat-fx-death"><circle className="combat-fx-shockwave" r="42"/><path d="M-19 -26L19 26M19 -26L-19 26"/>{[0,1,2,3,4].map(i=><path key={i} className="combat-fx-soul" d="M0 -8L5 0L0 8L-5 0Z" transform={`translate(${(i-2)*19} ${i%2*19})`}/>)}</g>;
    case 'spectral_hand': return <g className="combat-fx-hand"><path d="M-19 29L-34 6Q-40 -8 -29 -5L-19 6V-22Q-17 -34 -10 -22V-33Q-4 -43 2 -32V-34Q10 -41 13 -29V-25Q23 -34 24 -19V11Q22 26 12 35L-15 35Z"/><path d="M-10 -20V-3M2 -29V-4M13 -25V-4"/></g>;
    case 'vines': return <g className="combat-fx-vines">{[-1,1].map(side=><g key={side} transform={`scale(${side} 1)`}><path className="combat-fx-vine" d="M-12 51C-52 35 -43 -10 -18 -20C-3 -25 -4 -43 -17 -48"/><path className="combat-fx-leaf" d="M-40 7Q-65 -16 -47 -27Q-25 -16 -40 7Z M-19 -20Q-2 -15 6 -32Q-16 -40 -19 -20Z"/></g>)}</g>;
    case 'illusion': return <g className="combat-fx-illusion">{[-1,0,1].map(i=><g key={i} className="combat-fx-illusion-echo" transform={`translate(${i*24} ${i*5})`} style={{'--echo-delay':`${(i+1)*90}ms`} as CSSProperties}><CombatAnimationGlyph motif={motif??'illusion'}/></g>)}</g>;
    case 'thunder': return <g className="combat-fx-thunder">{[0,1,2].map(i=><circle key={i} className="combat-fx-wave" r={30+i*12} style={{'--wave-delay':`${i*110}ms`} as CSSProperties}/>)}<CombatAnimationGlyph motif="thunder"/></g>;
    case 'heal': case 'recover': return <g className="combat-fx-heal"><circle className="combat-fx-shockwave" r="46"/>{[-1,0,1].map(i=><g key={i} transform={`translate(${i*30} ${i%2*15})`}><g className="combat-fx-heal-mote" style={{'--mote-delay':`${(i+1)*100}ms`} as CSSProperties}><path d="M-4 -12H4V-4H12V4H4V12H-4V4H-12V-4H-4Z"/></g></g>)}</g>;
    default: return <g className="combat-fx-aura"><circle className="combat-fx-shockwave" r="47"/><g className="combat-fx-glyph"><CombatAnimationGlyph motif={motif}/></g><Sparks count={8}/></g>;
  }
}

export default function CombatAnimationLayer({beat,profile,from,to,sourceSize=1,targetSize=1,showCasterCircle=true}: {
  beat:CombatBeat;profile:CombatAnimationProfile;from:GridPosition;to:GridPosition;sourceSize?:number;targetSize?:number;showCasterCircle?:boolean;
}) {
  const primitive=profile.primitive;
  const miss=beat.cues.some(c=>c.kind==='miss')||['miss','crit_miss'].includes(beat.roll?.outcome??'');
  const angle=Math.atan2(to.y-from.y,to.x-from.x)*180/Math.PI;
  const distance=Math.hypot(to.x-from.x,to.y-from.y)*100;
  const directional=['melee_slash','melee_pierce','melee_bash','ranged_arrow','bite','projectile','beam'].includes(primitive);
  const endpoint={x:to.x*100+(miss?-Math.sin(angle*Math.PI/180)*44:0),y:to.y*100+(miss?Math.cos(angle*Math.PI/180)*44:0)};
  const deliveryAngle=Math.atan2(endpoint.y-from.y*100,endpoint.x-from.x*100)*180/Math.PI;
  const deliveryDistance=Math.hypot(endpoint.x-from.x*100,endpoint.y-from.y*100);
  const style={'--fx-primary':profile.palette.primary,'--fx-secondary':profile.palette.secondary,
    '--fx-duration':`${profile.motion.durationMs}ms`,'--fx-distance':`${distance}px`,
    '--fx-scale':profile.motion.scale??1} as CSSProperties;
  return <g className={`combat-animation is-${primitive}${miss?' is-miss':''}`} data-animation-profile={profile.key} style={style}>
    {profile.casterCircle&&showCasterCircle&&<CombatSpellCircle x={from.x*100} y={from.y*100} level={beat.spellLevel??0} footprint={sourceSize} profile={profile}/>}
    {directional&&<>
      <g transform={`translate(${from.x*100} ${from.y*100}) rotate(${angle})`}>
        <g className="combat-fx-windup"><path d="M-33 -28Q-53 0 -33 28"/><path d="M-45 -18Q-60 0 -45 18"/></g>
        {primitive==='ranged_arrow'&&<g className="combat-fx-bow"><path d="M-8 -33Q33 0 -8 33L-23 0Z"/></g>}
      </g>
      {(primitive==='projectile'||primitive==='ranged_arrow')&&<g transform={`translate(${from.x*100} ${from.y*100}) rotate(${deliveryAngle})`} style={{'--fx-distance':`${deliveryDistance}px`} as CSSProperties}>
        <g className="combat-fx-projectile">
          <path className="combat-fx-trail" d="M-95 0H-5M-73 -6H-12M-67 6H-12"/>
          {primitive==='ranged_arrow'?<g className="combat-fx-arrow"><path className="combat-fx-arrow-shaft" d="M-55 0H10"/><path d="M15 0L-3 -7L0 0L-3 7Z M-48 0L-63 -9L-55 0L-63 9Z"/></g>:
            <g className="combat-fx-orb"><circle r="22" className="combat-fx-orb-halo"/><circle r="13"/><g transform="scale(.5)"><CombatAnimationGlyph motif={profile.motif}/></g></g>}
        </g>
      </g>}
      {primitive==='beam'&&<g transform={`translate(${from.x*100} ${from.y*100}) rotate(${deliveryAngle})`}>
        <g className="combat-fx-beam"><path className="combat-fx-beam-glow" d={`M0 0L${deliveryDistance} 0`}/><path className="combat-fx-beam-core" d={profile.motif==='lightning'?`M0 0L${deliveryDistance*.25} -12L${deliveryDistance*.32} 10L${deliveryDistance*.59} -9L${deliveryDistance*.67} 13L${deliveryDistance} 0`:`M0 0L${deliveryDistance} 0`}/></g>
      </g>}
      <g transform={`translate(${endpoint.x} ${endpoint.y}) rotate(${angle}) scale(${Math.max(1,Math.sqrt(targetSize))*(profile.motion.scale??1)})`}>
        {primitive==='melee_slash'&&<g className="combat-fx-slash"><path className="combat-fx-slash-trail" d="M-71 56C-101 -42 0 -93 74 -44C5 -70 -61 -16 -71 56Z"/><path className="combat-fx-slash-edge" d="M-71 56C-101 -42 0 -93 74 -44"/><path className="combat-fx-slash-follow" d="M-45 65C-65 -7 -3 -56 61 -35"/></g>}
        {primitive==='melee_pierce'&&<g className="combat-fx-thrust"><path className="combat-fx-blade" d="M-90 -5H-10L32 0L-10 5H-90Z"/><path d="M-71 -16V16M-105 0H-76"/><path className="combat-fx-thrust-trail" d="M-124 -13H-75M-133 13H-78"/></g>}
        {primitive==='melee_bash'&&<g className="combat-fx-bash"><path className="combat-fx-hammer" d="M-62 -7H-11V-24H17V24H-11V7H-62Z"/><path d="M-56 -36Q-12 -58 26 -27"/></g>}
        {primitive==='bite'&&<g className="combat-fx-bite"><g className="combat-fx-jaw is-upper"><path d="M-43 -25Q0 -56 43 -25L31 -5L21 -23L11 1L0 -22L-12 1L-22 -23L-32 -5Z"/></g><g className="combat-fx-jaw is-lower"><path d="M-43 25Q0 56 43 25L31 5L21 23L11 -1L0 22L-12 -1L-22 23L-32 5Z"/></g></g>}
        {!miss&&<Impact motif={profile.motif} critical={beat.roll?.outcome==='crit'}/>}
        {miss&&<path className="combat-fx-miss-wisp" d="M-25 -35Q30 -47 44 0Q49 22 70 30"/>}
      </g>
    </>}
    {!directional&&<g transform={`translate(${to.x*100} ${to.y*100}) rotate(${['move','dash','disengage'].includes(primitive)?angle:0}) scale(${Math.max(1,Math.sqrt(targetSize))*(profile.motion.scale??1)})`}><Utility primitive={primitive} motif={profile.motif}/></g>}
  </g>;
}
