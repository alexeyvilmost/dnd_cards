import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import CombatMapFeedback from './CombatMapFeedback';
import {spellCircleGeometry} from './CombatSpellCircle';
import {combatAnimationForOutcome,getAnimationProfile} from '../solo-combat/animationProfiles';
import type {CombatBeat} from '../solo-combat/presentation';
import type {CombatAnimationArea, SoloCombatState} from '../solo-combat/types';
import compiled from '../pages/rulesLabFixture.generated.json';

const actor=compiled.roots.magicInitiateFighter.actor;
function state():SoloCombatState {
  return {tacticalFootprints:'sized',world:{actors:{
    hero:{...structuredClone(actor),id:'hero'},enemy:{...structuredClone(actor),id:'enemy'},second:{...structuredClone(actor),id:'second'},
  },objects:{},concentrations:{},scene:{mode:'encounter',round:1}},
  tokens:{hero:{position:{x:1,y:2}},enemy:{position:{x:3,y:2}},second:{position:{x:4,y:4}}},
  catalogActions:[],combatAreas:{}} as unknown as SoloCombatState;
}
const beat=(key='natural.bite'):CombatBeat=>({id:'committed',sourceId:'hero',targetId:'enemy',sourceName:'Источник',targetName:'Цель',
  actionName:'Произвольное действие',from:{x:1,y:2},to:{x:3,y:2},animation:getAnimationProfile(key),cues:[]});
const render=(combat:SoloCombatState,current:CombatBeat|null)=>renderToStaticMarkup(<CombatMapFeedback state={combat} beat={current}/>);

describe('2D committed animation rendering',()=>{
  it('renders a utility cast without an attack roll and scales the circle from its saved slot',()=>{
    const html=render(state(),{...beat('spell.light'),spellLevel:7});
    expect(html).toContain('data-animation-profile="spell.light"');
    expect(html).toContain('data-spell-level="7"');
    expect(html).toContain(`data-ring-count="${spellCircleGeometry(7).rings}"`);
    expect(spellCircleGeometry(7).radius).toBeGreaterThan(spellCircleGeometry(0).radius);
    expect(spellCircleGeometry(9).rings).toBeGreaterThan(spellCircleGeometry(3).rings);
  });
  it('suppresses all transient result decoration before a reaction even if a consumer supplies cues',()=>{
    const html=render(state(),{...beat(),rollPhase:'before-reaction',cues:[{actorId:'enemy',kind:'damage',text:'999'}]});
    expect(html).not.toContain('data-animation-profile');
    expect(html).not.toContain('999');
    expect(html).not.toContain('combat-floating-cue');
  });
  it('shows jaws and an off-target miss trail without depicting an impact',()=>{
    const html=render(state(),{...beat(),cues:[{actorId:'enemy',kind:'miss',text:'Промах'}]});
    expect(html).toContain('combat-fx-jaw is-upper');
    expect(html).toContain('combat-fx-jaw is-lower');
    expect(html).toContain('combat-fx-miss-wisp');
    expect(html).not.toContain('class="combat-fx-impact');
  });
  it.each([['weapon.slash','slash'],['weapon.pierce','pierce'],['weapon.bash','bash'],['weapon.arrow','penetration'],['weapon.throw-hammer','penetration'],['weapon.firearm','penetration']])('renders a distinct confirmed critical strike for %s', (key, shape)=>{
    const base=getAnimationProfile(key)!;
    const animation=combatAnimationForOutcome(base,{outcome:'crit',damageType:'force'});
    const roll:NonNullable<CombatBeat['roll']>={kind:'d20',dice:[{sides:20,result:19}],total:24,modifiers:[],advantage:'none',text:'',target:{type:'ac',value:15},outcome:'crit'};
    const current={...beat(key),animation,roll};
    const html=render(state(),current);
    expect(html).toContain('data-strike-style="critical"');
    expect(html).toContain(`combat-critical-${shape}`);
    expect(html).toContain('data-critical-impact="true"');
    expect(html).toContain('--fx-primary:#ef4444');
    expect(html).not.toContain('class="combat-fx-impact');
    // Defensive rendering also rejects critical paint on an inconsistent miss,
    // or on a result which is still awaiting the player's reaction.
    expect(render(state(),{...current,roll:{...roll,outcome:'crit_miss'}})).not.toContain('data-critical-impact');
    expect(render(state(),{...current,rollPhase:'before-reaction'})).not.toContain('data-animation-profile');
    expect(render(state(),{...current,animation:base,roll:{...roll,outcome:'hit'}})).not.toContain('data-strike-style');
  });
  it.each(['spell.frost-ray','spell.eldritch-blast'])('directs a missed %s ray past the target, while a hit connects the two centres',key=>{
    const hit=render(state(),beat(key));
    const missed=render(state(),{...beat(key),cues:[{actorId:'enemy',kind:'miss',text:'Промах'}]});
    expect(hit).toContain('data-focus-distance="57"');
    expect(hit).toContain('class="combat-ray-body" pathLength="1" d="M0 0H143"');
    expect(missed).not.toContain('class="combat-ray-body" pathLength="1" d="M0 0H143"');
    expect(missed).not.toContain('class="combat-fx-impact');
  });
  it.each([['spell.frost-ray','combat-critical-magic-beam-trail'],['spell.eldritch-blast','combat-critical-magic-focus'],['spell.shocking-grasp','combat-critical-magic-beam-trail'],['spell.fire-bolt','combat-critical-magic-projectile'],['spell.ice-knife','combat-critical-magic-projectile']])('renders magical critical geometry for %s only after confirmation',(key,geometry)=>{
    const base=getAnimationProfile(key)!;
    const animation=combatAnimationForOutcome(base,{outcome:'crit'});
    const roll:NonNullable<CombatBeat['roll']>={kind:'d20',dice:[{sides:20,result:20}],total:25,modifiers:[],advantage:'none',text:'',target:{type:'ac',value:15},outcome:'crit'};
    const current={...beat(key),animation,roll};
    const html=render(state(),current);
    expect(html).toContain('data-critical-effect="magic"');
    expect(html).toContain('data-critical-impact="magic"');
    expect(html).toContain(geometry);
    expect(html).toContain('combat-spell-circle');
    expect(html).not.toContain('combat-critical-penetration');
    expect(html).not.toContain('class="combat-fx-impact');
    if(key==='spell.eldritch-blast')expect(html).toContain('--fx-primary:#ef4444');
    if(key==='spell.ice-knife')expect(html).toContain('combat-thrown-weapon');
    expect(render(state(),{...current,roll:{...roll,outcome:'miss'}})).not.toContain('data-critical-impact');
    expect(render(state(),{...current,rollPhase:'before-reaction'})).not.toContain('data-animation-profile');
    expect(render(state(),{...current,animation:base,roll:{...roll,outcome:'hit'}})).not.toContain('data-critical-effect');
  });
  it('renders all defenders in a grouped save with one caster circle',()=>{
    const first=beat('spell.frost-ray');
    const second={...first,id:'other-save',targetId:'second',to:{x:4,y:4}};
    const html=render(state(),{...first,saveRows:[first,second]});
    expect(html.match(/data-animation-profile=/g)).toHaveLength(2);
    expect(html.match(/data-ring-count=/g)).toHaveLength(1);
    expect(html).toContain('translate(450 450)');
  });
  it.each(['spell.burning-hands','spell.thunderwave'])('paints %s once for grouped defenders, clipped to the saved terrain cells',key=>{
    const area:CombatAnimationArea={geometry:key==='spell.burning-hands'?{kind:'cone',sizeFt:15}:{kind:'cube',sizeFt:15},
      sourcePosition:{x:1,y:2},origin:{x:2,y:2},aim:{x:3,y:2},cells:[{x:2,y:2},{x:3,y:2},{x:3,y:3}]};
    const first={...beat(key),area};
    const second={...first,id:'second-save',targetId:'second',to:{x:4,y:4}};
    const combat=state();
    // Current token movement/size must not alter frozen targeting geometry.
    combat.tokens.hero.position={x:8,y:7};
    combat.world.actors.hero.character.baseSize=3;
    const html=render(combat,{...first,saveRows:[first,second]});
    expect(html.match(/data-area-kind=/g)).toHaveLength(1);
    expect(html.match(/data-ring-count=/g)).toHaveLength(1);
    expect(html).toContain('data-area-cell-count="3" data-area-origin="2,2"');
    expect(html).toContain('clipPathUnits="userSpaceOnUse"><path d="M200 200h100v100h-100Z M300 200h100v100h-100Z M300 300h100v100h-100Z"');
    expect(html).toContain('clip-path="url(#');
  });
  it('keeps damage cues for later area saves without replaying the cast',()=>{
    const html=render(state(),{...beat('spell.thunderwave'),suppressAnimation:true,cues:[{actorId:'enemy',kind:'damage',text:'7'}]});
    expect(html).not.toContain('data-animation-profile=');
    expect(html).not.toContain('data-ring-count=');
    expect(html).toContain('combat-floating-cue is-damage');
    expect(html).toContain('<b>7</b>');
  });
  it('keeps an empty-cell spell centred on its point when the caster occupies several cells',()=>{
    const combat=state();
    combat.world.actors.hero.character.baseSize=3;
    const html=render(combat,{...beat('spell.mage-hand'),targetId:'hero',targetIsPoint:true,to:{x:7,y:3}});
    expect(html).toContain('translate(750 350)');
    expect(html).not.toContain('translate(800 400)');
  });
  it('retains a persistent circle without a playing beat and removes it when the authoritative effect expires',()=>{
    const combat=state();
    combat.catalogActions=[{id:'authored-spell',name:'Другое имя',kind:'spell',sourceEntityIds:['authored-spell'],spell:{entityId:'authored-spell',level:2},mechanics:{}}];
    combat.world.actors.enemy.runtime.activeEffects=[{id:'ongoing',name:'Эффект',source:'',sourceId:'hero',spellOriginId:'authored-spell',roundsLeft:2,mechanics:{}}];
    const active=render(combat,null);
    expect(active).toContain('combat-spell-circle is-persistent');
    expect(active).toContain('data-spell-level="2"');
    expect(active).not.toContain('data-animation-profile');
    combat.world.actors.enemy.runtime.activeEffects=[];
    expect(render(combat,null)).not.toContain('combat-spell-circle is-persistent');
  });
});
