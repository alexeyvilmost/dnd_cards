import type {CSSProperties} from 'react';
import type {CombatBeat} from '../solo-combat/presentation';
import type {CombatAnimationProfile} from '../solo-combat/animationProfiles';
import {combatAnimationTimingStyle} from '../solo-combat/animationTiming';
import type {GridPosition} from '../solo-combat/types';
import CombatAnimationGlyph from './CombatAnimationGlyph';
import CombatSpellCircle from './CombatSpellCircle';
import CombatChargedBeam from './CombatChargedBeam';
import CombatAreaAnimation from './CombatAreaAnimation';
import {CriticalWeaponImpact, CriticalWeaponStrike} from './CombatCriticalWeapon';
import {CriticalMagicBeamTrail, CriticalMagicFocus, CriticalMagicImpact, CriticalMagicProjectile} from './CombatCriticalMagic';
import './CombatAdvancedAnimations.css';

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

export default function CombatAnimationLayer({beat,profile,from,to,sourceSize=1,targetSize=1,showCasterCircle=true,showArea=true}: {
  beat:CombatBeat;profile:CombatAnimationProfile;from:GridPosition;to:GridPosition;sourceSize?:number;targetSize?:number;showCasterCircle?:boolean;
  showArea?:boolean;
}) {
  const primitive=profile.primitive;
  const miss=beat.cues.some(c=>c.kind==='miss')||['miss','crit_miss'].includes(beat.roll?.outcome??'');
  const critical=profile.strikeStyle==='critical'&&beat.roll?.outcome==='crit'&&beat.rollPhase!=='before-reaction'&&!miss;
  const criticalMagic=critical&&profile.criticalEffect==='magic';
  const criticalWeapon=critical&&!criticalMagic;
  const angle=Math.atan2(to.y-from.y,to.x-from.x)*180/Math.PI;
  const distance=Math.hypot(to.x-from.x,to.y-from.y)*100;
  const directional=['melee_slash','melee_pierce','melee_bash','ranged_arrow','bite','projectile','beam','charged_beam','claws','tail','tentacle','sting','natural_slam','weapon_throw','firearm'].includes(primitive);
  const areaPrimitive=['area_cone','area_line','area_wave','area_burst'].includes(primitive);
  const endpoint={x:to.x*100+(miss?-Math.sin(angle*Math.PI/180)*44:0),y:to.y*100+(miss?Math.cos(angle*Math.PI/180)*44:0)};
  const deliveryAngle=Math.atan2(endpoint.y-from.y*100,endpoint.x-from.x*100)*180/Math.PI;
  const deliveryDistance=Math.hypot(endpoint.x-from.x*100,endpoint.y-from.y*100);
  const style={'--fx-primary':profile.palette.primary,'--fx-secondary':profile.palette.secondary,
    ...combatAnimationTimingStyle(profile),'--fx-distance':`${distance}px`,
    '--fx-scale':profile.motion.scale??1} as CSSProperties;
  return <g className={`combat-animation is-${primitive}${miss?' is-miss':''}${criticalWeapon?' is-critical-weapon':''}${criticalMagic?' is-critical-magic':''}`} data-animation-profile={profile.key} data-strike-style={critical?'critical':undefined} data-critical-effect={criticalMagic?'magic':criticalWeapon?'weapon':undefined} style={style}>
    {profile.casterCircle&&showCasterCircle&&<CombatSpellCircle x={from.x*100} y={from.y*100} level={beat.spellLevel??0} footprint={sourceSize} profile={profile}/>}
    {areaPrimitive&&showArea&&beat.area&&<CombatAreaAnimation area={beat.area} profile={profile}/>}
    {directional&&<>
      <g transform={`translate(${from.x*100} ${from.y*100}) rotate(${angle})`}>
        {primitive!=='charged_beam'&&<g className="combat-fx-windup"><path d="M-33 -28Q-53 0 -33 28"/><path d="M-45 -18Q-60 0 -45 18"/></g>}
        {primitive==='ranged_arrow'&&<g className="combat-fx-bow"><path d="M-8 -33Q33 0 -8 33L-23 0Z"/></g>}
        {primitive==='firearm'&&<g className="combat-firearm-flash" transform={`translate(${sourceSize*44} 0)`}><path d="M-12 -5L13 -15L7 -4L33 0L7 4L13 15L-12 5Z"/></g>}
      </g>
      {['projectile','ranged_arrow','weapon_throw','firearm'].includes(primitive)&&<g transform={`translate(${from.x*100} ${from.y*100}) rotate(${deliveryAngle})`} style={{'--fx-distance':`${deliveryDistance}px`} as CSSProperties}>
        <g className="combat-fx-projectile">
          <path className="combat-fx-trail" d="M-95 0H-5M-73 -6H-12M-67 6H-12"/>
          {criticalWeapon&&<g className="combat-critical-projectile-wake"><path d="M-139 -15L-37 -8M-139 15L-37 8M-159 0H-78"/><path d="M-53 -20L-23 0L-53 20"/></g>}
          {criticalMagic&&<CriticalMagicProjectile profile={profile} weapon={primitive!=='projectile'}/>}
          {primitive==='weapon_throw'?<g className={`combat-thrown-weapon is-${profile.weaponShape??'blade'}`}>
            {profile.weaponShape==='axe'?<><path d="M-24 22L19 -21"/><path d="M3 -21Q34 -31 32 -2L11 2Z"/></>:
              profile.weaponShape==='hammer'?<><path d="M-22 22L10 -10"/><path d="M-3 -24L11 -10L23 -23L9 -37Z"/></>:
                profile.weaponShape==='stone'?<path d="M-13 -9L4 -15L16 -4L12 11L-8 14L-17 2Z"/>:
                  profile.weaponShape==='spear'?<><path d="M-47 0H17"/><path d="M10 -7L32 0L10 7Z"/></>:
                    <><path d="M-19 -5L26 0L-19 5Z"/><path d="M-20 -10V10M-20 0H-32"/></>}
          </g>:primitive==='firearm'?<path className="combat-firearm-bullet" d="M-13 -3H2Q13 0 2 3H-13Z"/>:
          primitive==='ranged_arrow'?<g className="combat-fx-arrow"><path className="combat-fx-arrow-shaft" d="M-55 0H10"/><path d="M15 0L-3 -7L0 0L-3 7Z M-48 0L-63 -9L-55 0L-63 9Z"/></g>:
            !criticalMagic&&<g className="combat-fx-orb"><circle r="22" className="combat-fx-orb-halo"/><circle r="13"/><g transform="scale(.5)"><CombatAnimationGlyph motif={profile.motif}/></g></g>}
        </g>
      </g>}
      {primitive==='beam'&&<g transform={`translate(${from.x*100} ${from.y*100}) rotate(${deliveryAngle})`}>
        {criticalMagic&&<><CriticalMagicFocus/><CriticalMagicBeamTrail distance={deliveryDistance}/></>}
        <g className="combat-fx-beam"><path className="combat-fx-beam-glow" d={`M0 0L${deliveryDistance} 0`}/><path className="combat-fx-beam-core" d={profile.motif==='lightning'?`M0 0L${deliveryDistance*.25} -12L${deliveryDistance*.32} 10L${deliveryDistance*.59} -9L${deliveryDistance*.67} 13L${deliveryDistance} 0`:`M0 0L${deliveryDistance} 0`}/></g>
      </g>}
      {primitive==='charged_beam'&&<g transform={`translate(${from.x*100} ${from.y*100}) rotate(${deliveryAngle})`}>
        <CombatChargedBeam distance={deliveryDistance} sourceSize={sourceSize} profile={profile} critical={criticalMagic}/>
      </g>}
      <g transform={`translate(${endpoint.x} ${endpoint.y}) rotate(${angle}) scale(${Math.max(1,Math.sqrt(targetSize))*(profile.motion.scale??1)})`}>
        {primitive==='melee_slash'&&!criticalWeapon&&<g className="combat-fx-slash"><path className="combat-fx-slash-trail" d="M-71 56C-101 -42 0 -93 74 -44C5 -70 -61 -16 -71 56Z"/><path className="combat-fx-slash-edge" d="M-71 56C-101 -42 0 -93 74 -44"/><path className="combat-fx-slash-follow" d="M-45 65C-65 -7 -3 -56 61 -35"/></g>}
        {primitive==='melee_pierce'&&!criticalWeapon&&<g className="combat-fx-thrust"><path className="combat-fx-blade" d="M-90 -5H-10L32 0L-10 5H-90Z"/><path d="M-71 -16V16M-105 0H-76"/><path className="combat-fx-thrust-trail" d="M-124 -13H-75M-133 13H-78"/></g>}
        {primitive==='melee_bash'&&!criticalWeapon&&<g className="combat-fx-bash"><path className="combat-fx-hammer" d="M-62 -7H-11V-24H17V24H-11V7H-62Z"/><path d="M-56 -36Q-12 -58 26 -27"/></g>}
        {primitive==='bite'&&<g className="combat-fx-bite"><g className="combat-fx-jaw is-upper"><path d="M-43 -25Q0 -56 43 -25L31 -5L21 -23L11 1L0 -22L-12 1L-22 -23L-32 -5Z"/></g><g className="combat-fx-jaw is-lower"><path d="M-43 25Q0 56 43 25L31 5L21 23L11 -1L0 22L-12 -1L-22 23L-32 5Z"/></g></g>}
        {primitive==='claws'&&<g className="combat-natural-claws">{[-1,0,1].map((lane,i)=><g key={lane} transform={`translate(${lane*19} ${lane*9})`}><path className="combat-claw-cut" d="M-32 -50Q-20 -5 20 44Q-11 21 -32 -50Z" style={{'--claw-delay':i*.05} as CSSProperties}/></g>)}</g>}
        {primitive==='tail'&&<g className="combat-natural-tail"><path d="M-93 43C-79 -56 -25 -58 12 -9Q24 8 48 -14Q43 24 16 20C-25 1 -35 -12 -48 2Q-62 18 -64 44Z"/><path className="combat-tail-spine" d="M-79 33Q-57 -40 -10 -13L28 9"/></g>}
        {primitive==='tentacle'&&<g className="combat-natural-tentacle"><path d="M-81 33C-35 26 -69 -39 -6 -32C47 -25 27 44 -4 23C-26 9 -2 -6 7 5"/><path d="M-69 29L-62 33M-51 13L-42 15M-41 -6L-32 -4M-21 -23L-19 -13M6 -20L4 -11M19 -2L10 1" className="combat-tentacle-suckers"/></g>}
        {primitive==='sting'&&<g className="combat-natural-sting"><path d="M-76 -16Q-36 -47 -16 -8L21 0L-17 7Q-48 -24 -76 -16Z"/><path d="M26 -11L32 -22M32 0H46M26 11L32 22"/></g>}
        {primitive==='natural_slam'&&<g className="combat-natural-slam"><path d="M-45 10L-45 -12Q-42 -26 -32 -17V-23Q-26 -35 -18 -24Q-10 -34 -2 -22Q7 -28 12 -17L17 4Q28 15 9 33L-14 38Z"/><path d="M-31 -17L-28 -2M-18 -24L-13 -5M-2 -22L3 -4M-26 18L-13 8L4 13"/><path className="combat-slam-cracks" d="M-34 46L-47 61L-43 69M0 48L10 64L7 74M33 25L48 32L53 45"/></g>}
        {criticalWeapon&&<><CriticalWeaponStrike primitive={primitive}/><CriticalWeaponImpact profile={profile}/></>}
        {criticalMagic&&<CriticalMagicImpact profile={profile}/>}
        {!miss&&!critical&&<Impact motif={profile.motif} critical={beat.roll?.outcome==='crit'}/>}
        {miss&&<path className="combat-fx-miss-wisp" d="M-25 -35Q30 -47 44 0Q49 22 70 30"/>}
      </g>
    </>}
    {!directional&&!areaPrimitive&&<g transform={`translate(${to.x*100} ${to.y*100}) rotate(${['move','dash','disengage'].includes(primitive)?angle:0}) scale(${Math.max(1,Math.sqrt(targetSize))*(profile.motion.scale??1)})`}><Utility primitive={primitive} motif={profile.motif}/></g>}
    {areaPrimitive&&!beat.area&&showArea&&<g transform={`translate(${to.x*100} ${to.y*100})`}><Impact motif={profile.motif}/></g>}
  </g>;
}
