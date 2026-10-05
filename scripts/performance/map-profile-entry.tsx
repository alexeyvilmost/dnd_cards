import {Profiler,useState} from 'react';
import {createRoot} from 'react-dom/client';
import TacticalBattleMap from '../../frontend/src/components/TacticalBattleMap';
import '../../frontend/src/pages/SoloCombatPage.css';
import compiled from '../../frontend/src/pages/rulesLabFixture.generated.json';
import {actorFootprint} from '../../frontend/src/solo-combat/footprint';
import type {SoloCombatState} from '../../frontend/src/solo-combat/types';

// Presentation-only fixture: no initialized game, saved state, RNG or command
// is edited. The same canonical renderer and fixture are built for both arms.
const actors=Object.fromEntries(['hero','large','huge'].map((id,index)=>{
  const actor=structuredClone(compiled.roots.magicInitiateFighter.actor) as any;
  actor.id=id;actor.character.name=id;actor.character.baseSize=2+index;
  return [id,actor];
}));
const initial={characterId:'hero',sideByActorId:{hero:'party',large:'enemy',huge:'enemy'},boardRevision:1,tacticalFootprints:'sized',
  world:{actors,objects:Object.fromEntries([0,1,2,3].map(index=>[`lamp${index}`,{id:`lamp${index}`,kind:'item',dancingLight:{dimRadiusFt:25}}])),
    scene:{mode:'encounter',initiative:['hero','large','huge'],activeIndex:0,round:1}},
  worldObjectPositions:{lamp0:{x:2,y:2},lamp1:{x:18,y:2},lamp2:{x:2,y:13},lamp3:{x:18,y:13}},
  tokens:{hero:{actorId:'hero',position:{x:1,y:1}},large:{actorId:'large',position:{x:13,y:3}},huge:{actorId:'huge',position:{x:16,y:10}}},
  catalogActions:[],combatAreas:{},movementRemainingFt:{hero:30,large:30,huge:30},log:[],
  battleMap:{id:'local-renderer-profile',name:'Renderer profile',width:24,height:18,maxFootprint:4,maxActors:24,background:'',description:'',ambientLight:'dark',
    features:[{id:'wall',name:'Стена',x:8,y:3,width:1,height:8,blocksMovement:true,blocksSight:true}]},
} as unknown as SoloCombatState;
const original=JSON.stringify(initial);
const local=window as any;
local.__mapProfile={renders:[],lighting:0,surfaces:0,clicks:0,frames:[],longTasks:[],footprints:Object.values(actors).map(actor=>actorFootprint(actor,initial))};
const frames=(previous:number)=>requestAnimationFrame(now=>{local.__mapProfile.frames.push({at:now,duration:now-previous});frames(now);});
requestAnimationFrame(frames);
new PerformanceObserver(list=>{for(const entry of list.getEntries())local.__mapProfile.longTasks.push({at:entry.startTime,duration:entry.duration});}).observe({type:'longtask',buffered:true});
function Harness(){
  const [state,setState]=useState(initial),[target,setTarget]=useState<string|null>(null),[beat,setBeat]=useState<any>(null),[step,setStep]=useState(0);
  const next=()=>{const value=step+1;setStep(value);return value;};
  local.__mapProfile.unchanged=()=>JSON.stringify(initial)===original;
  return <><nav style={{position:'fixed',zIndex:10000,top:0,left:0,background:'white'}}>
    <button onClick={()=>{const i=next();setTarget(i%2?'large':'huge');}}>Target</button>
    <button onClick={()=>{const i=next();setState({...initial,boardRevision:i+1,tokens:{...initial.tokens,hero:{...initial.tokens.hero,position:{x:1+i%2,y:1}}}});}}>Movement presentation</button>
    <button onClick={()=>{const i=next();setBeat({id:`local-beat-${i}`,sourceId:'hero',targetId:'large',sourceName:'hero',targetName:'large',actionName:'Presentation',visual:'ranged',from:{x:1,y:1},to:{x:13,y:3},cues:[],rollPhase:'after-reaction'});}}>Animation</button>
  </nav><div style={{height:'950px',paddingTop:30}}><Profiler id="TacticalBattleMap" onRender={(id,phase,actualDuration,baseDuration,startTime,commitTime)=>local.__mapProfile.renders.push({id,phase,actualDuration,baseDuration,startTime,commitTime})}>
    <TacticalBattleMap state={state} actorId="hero" selectedActionId={null} movementMode={false} highlightedActorId={target} feedback={beat}
      onCell={()=>{local.__mapProfile.clicks++;}}/>
  </Profiler></div></>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
