// @vitest-environment jsdom
import {act,Profiler} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import * as lighting from '../solo-combat/combatIllumination';
import * as auraTerrain from '../solo-combat/auraTerrain';
import type {SoloCombatState} from '../solo-combat/types';
import compiled from '../pages/rulesLabFixture.generated.json';
import TacticalBattleMap from './TacticalBattleMap';

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
vi.mock('../settings',()=>({useSiteSettings:()=>({combat3d:false})}));
vi.mock('../solo-combat/useAnimationCatalog',()=>({useAnimationCatalog:()=>({})}));
afterEach(()=>vi.restoreAllMocks());

it('reuses static geometry and light cells during hover, invalidating on authoritative state changes',async()=>{
  vi.spyOn(window,'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window,'cancelAnimationFrame').mockImplementation(()=>{});
  const actor=structuredClone(compiled.roots.magicInitiateFighter.actor);
  const state={characterId:'hero',sideByActorId:{hero:'party'},boardRevision:1,
    world:{actors:{hero:{...actor,id:'hero'}},objects:Object.fromEntries([0,1,2,3].map(index=>[`lamp${index}`,{id:`lamp${index}`,kind:'item',dancingLight:{dimRadiusFt:25}}])),
      scene:{mode:'encounter',initiative:['hero'],activeIndex:0,round:1}},
    worldObjectPositions:{lamp0:{x:2,y:2},lamp1:{x:15,y:2},lamp2:{x:2,y:12},lamp3:{x:15,y:12}},
    tokens:{hero:{actorId:'hero',position:{x:0,y:0}}},catalogActions:[],combatAreas:{},movementRemainingFt:{hero:30},
    battleMap:{id:'local-profile',name:'Profile',width:24,height:18,maxFootprint:4,maxActors:24,background:'',description:'',ambientLight:'dark',
      features:[{id:'wall',name:'Стена',x:8,y:3,width:1,height:8,blocksMovement:true,blocksSight:true}]},
  } as unknown as SoloCombatState;
  const original=structuredClone(state),probe=vi.spyOn(lighting,'illuminationAt'),surfaces=vi.spyOn(auraTerrain,'auraSurfacesAt'),host=document.createElement('div');
  document.body.append(host);const root=createRoot(host),durations:number[]=[];
  const render=(current:SoloCombatState,highlightedActorId:string|null=null)=>root.render(<Profiler id="map" onRender={(_id,_phase,duration)=>durations.push(duration)}>
    <TacticalBattleMap state={current} actorId="hero" selectedActionId={null} movementMode={false} highlightedActorId={highlightedActorId} onCell={()=>{}}/>
  </Profiler>);
  try{
    await act(async()=>render(state));
    const firstCalls=probe.mock.calls.length;probe.mockClear();surfaces.mockClear();durations.length=0;
    for(let i=0;i<30;i++){
      const cell=host.querySelector<HTMLButtonElement>(`[aria-label="Клетка ${3+i%10}, 17"]`)!;
      expect(cell).not.toBeNull();
      await act(async()=>cell.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,clientX:100+i,clientY:120})));
      await act(async()=>render(state,i%2?'hero':null));
    }
    const hoverCalls=probe.mock.calls.length;
    console.info(JSON.stringify({scenario:'24x18-four-lights-30-hovers',firstCalls,hoverCalls,renderDurationsMs:durations}));
    expect(state).toEqual(original);
    expect(hoverCalls).toBe(0);
    expect(surfaces.mock.calls.length).toBe(0);
    const changed={...state,boardRevision:2,worldObjectPositions:{...state.worldObjectPositions,lamp0:{x:20,y:15}}};
    await act(async()=>render(changed));
    expect(probe.mock.calls.length).toBe(24*18);
    for(const update of [
      {...changed,tokens:{hero:{...changed.tokens.hero,position:{x:1,y:0}}}},
      {...changed,world:{...changed.world,actors:{hero:{...changed.world.actors.hero,runtime:{...changed.world.actors.hero.runtime,resources:{...changed.world.actors.hero.runtime.resources,action:0}}}}}},
      {...changed,world:{...changed.world,objects:{}}},
      {...changed,battleMap:{...changed.battleMap!,ambientLight:'bright' as const}},
    ]){probe.mockClear();await act(async()=>render(update));expect(probe.mock.calls.length).toBe(24*18);}
  }finally{await act(async()=>root.unmount());host.remove();}
});
