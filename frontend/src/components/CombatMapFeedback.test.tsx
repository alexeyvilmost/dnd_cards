import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import CombatMapFeedback from './CombatMapFeedback';
import {spellCircleGeometry} from './CombatSpellCircle';
import {getAnimationProfile} from '../solo-combat/animationProfiles';
import type {CombatBeat} from '../solo-combat/presentation';
import type {SoloCombatState} from '../solo-combat/types';
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
  it('directs a missed ray past the target, while a hit connects the two centres',()=>{
    const hit=render(state(),beat('spell.frost-ray'));
    const missed=render(state(),{...beat('spell.frost-ray'),cues:[{actorId:'enemy',kind:'miss',text:'Промах'}]});
    expect(hit).toContain('class="combat-fx-beam-glow" d="M0 0L200 0"');
    expect(missed).not.toContain('class="combat-fx-beam-glow" d="M0 0L200 0"');
    expect(missed).not.toContain('class="combat-fx-impact');
  });
  it('renders all defenders in a grouped save with one caster circle',()=>{
    const first=beat('spell.frost-ray');
    const second={...first,id:'other-save',targetId:'second',to:{x:4,y:4}};
    const html=render(state(),{...first,saveRows:[first,second]});
    expect(html.match(/data-animation-profile=/g)).toHaveLength(2);
    expect(html.match(/data-ring-count=/g)).toHaveLength(1);
    expect(html).toContain('translate(450 450)');
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
