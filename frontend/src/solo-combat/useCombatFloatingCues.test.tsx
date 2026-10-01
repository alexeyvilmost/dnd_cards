// @vitest-environment jsdom
import {act, StrictMode} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {useCombatFloatingCues,COMBAT_CUE_DURATION_MS,type CombatCueBatch} from './useCombatFloatingCues';
import type {CombatBeat} from './presentation';
import {useCombatPresentation} from './useCombatPresentation';
import type {SoloCombatState} from './types';
import {setSetting} from '../settings';
import CombatMapFeedback from '../components/CombatMapFeedback';
import compiled from '../pages/rulesLabFixture.generated.json';

vi.mock('./presentation',async importOriginal=>({...await importOriginal<typeof import('./presentation')>(),
  presentCombatEntries:(_state:unknown,entries:unknown[])=>entries}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const animation:NonNullable<CombatBeat['animation']>={key:'authored',primitive:'aura',palette:{primary:'#fff',secondary:'#ccc'},
  motion:{durationMs:600,scale:1,contactRatio:.5},casterCircle:false};
const first:CombatBeat={id:'first',sourceId:'hero',sourceName:'Hero',targetId:'enemy',actionName:'First',animation,
  cues:[{actorId:'enemy',text:'8',kind:'damage'}]};
const second:CombatBeat={...first,id:'second',actionName:'Second',cues:[{actorId:'hero',text:'Ослеплён',kind:'effect'}]};
let captions:CombatCueBatch[],presentation:ReturnType<typeof useCombatPresentation>;
function CueHarness({beat}:{beat:CombatBeat|null}){captions=useCombatFloatingCues(beat);return null;}
const state=(log:CombatBeat[])=>({log} as unknown as SoloCombatState);
function QueueHarness({combat}:{combat:SoloCombatState}){
  presentation=useCombatPresentation(combat,null);captions=useCombatFloatingCues(presentation.playing);return null;
}
describe('independent live combat captions',()=>{
  let root:Root,container:HTMLDivElement;
  beforeEach(()=>{
    vi.useFakeTimers();vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
    let stored:string|null=null;vi.stubGlobal('localStorage',{getItem:()=>stored,setItem:(_key:string,value:string)=>{stored=value;}});
    setSetting('combatRollMode','skip');setSetting('enemyCombatRollMode','skip');
    container=document.createElement('div');document.body.append(container);root=createRoot(container);
  });
  afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals();});
  it('keeps prior damage visible while the next effect is already resolved and gameplay is unblocked',async()=>{
    const committed=state([first,second]),saved=JSON.stringify(committed);
    await act(async()=>root.render(<QueueHarness combat={state([])}/>));
    await act(async()=>root.render(<QueueHarness combat={committed}/>));
    expect(presentation.playing?.id).toBe('first');expect(captions.map(row=>row.id)).toEqual(['first']);
    await act(async()=>vi.advanceTimersByTime(600));
    expect(presentation.playing?.id).toBe('second');expect(captions.map(row=>row.id)).toEqual(['first','second']);
    await act(async()=>vi.advanceTimersByTime(600));
    expect(presentation.playing).toBeNull();expect(presentation.blocked).toBe(false);
    expect(captions.map(row=>row.id)).toEqual(['first','second']);
    expect(JSON.stringify(committed)).toBe(saved);
    await act(async()=>vi.advanceTimersByTime(900));expect(captions.map(row=>row.id)).toEqual(['second']);
    await act(async()=>vi.advanceTimersByTime(600));expect(captions).toEqual([]);
  });
  it('retains the authored contact delay and readable lifetime after delivery disappears',async()=>{
    await act(async()=>root.render(<CueHarness beat={first}/>));
    expect(captions[0].delayMs).toBe(300);
    await act(async()=>root.render(<CueHarness beat={null}/>));
    await act(async()=>vi.advanceTimersByTime(300+COMBAT_CUE_DURATION_MS-1));expect(captions).toHaveLength(1);
    await act(async()=>vi.advanceTimersByTime(1));expect(captions).toEqual([]);
  });
  it('does not replay expired captions on copied or repeated command responses',async()=>{
    await act(async()=>root.render(<CueHarness beat={first}/>));
    await act(async()=>vi.advanceTimersByTime(300+COMBAT_CUE_DURATION_MS));
    await act(async()=>root.render(<CueHarness beat={{...first}}/>));expect(captions).toEqual([]);
    await act(async()=>root.render(<CueHarness beat={null}/>));
    await act(async()=>root.render(<CueHarness beat={first}/>));expect(captions).toEqual([]);
  });
  it('does not show provisional outcomes or manufacture captions when loading history',async()=>{
    await act(async()=>root.render(<CueHarness beat={{...first,rollPhase:'before-reaction'}}/>));expect(captions).toEqual([]);
    await act(async()=>root.render(<QueueHarness combat={state([first,second])}/>));expect(captions).toEqual([]);
    expect(presentation.blocked).toBe(false);
  });
  it('removes a suppressed effect caption without an animation contact delay',async()=>{
    await act(async()=>root.render(<CueHarness beat={{...second,suppressAnimation:true}}/>));expect(captions[0].delayMs).toBe(0);
    await act(async()=>vi.advanceTimersByTime(COMBAT_CUE_DURATION_MS));expect(captions).toEqual([]);
  });
  it('keeps reduced-motion captions readable without delaying contact',async()=>{
    vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
    await act(async()=>root.render(<CueHarness beat={first}/>));expect(captions[0].delayMs).toBe(0);
    await act(async()=>vi.advanceTimersByTime(COMBAT_CUE_DURATION_MS-1));expect(captions).toHaveLength(1);
    await act(async()=>vi.advanceTimersByTime(1));expect(captions).toEqual([]);
  });
  it('cleans up timers and survives StrictMode effect restart',async()=>{
    await act(async()=>root.render(<StrictMode><CueHarness beat={first}/></StrictMode>));
    expect(captions).toHaveLength(1);expect(vi.getTimerCount()).toBe(1);
    await act(async()=>vi.advanceTimersByTime(300+COMBAT_CUE_DURATION_MS));expect(captions).toEqual([]);
    await act(async()=>root.render(<CueHarness beat={second}/>));
    await act(async()=>root.unmount());expect(vi.getTimerCount()).toBe(0);
    root=createRoot(container);
  });
  it('the 2D map retains both actors captions after the attack FX is gone',async()=>{
    const actor=compiled.roots.magicInitiateFighter.actor;
    const combat={world:{actors:{hero:{...actor,id:'hero'},enemy:{...actor,id:'enemy'}}},
      tokens:{hero:{position:{x:1,y:1}},enemy:{position:{x:3,y:2}}},catalogActions:[] } as unknown as SoloCombatState;
    await act(async()=>root.render(<CombatMapFeedback state={combat} beat={first}/>));
    await act(async()=>root.render(<CombatMapFeedback state={combat} beat={second}/>));
    await act(async()=>root.render(<CombatMapFeedback state={combat} beat={null}/>));
    expect(container.querySelectorAll('.combat-floating-stack')).toHaveLength(2);
    expect(container.querySelector('.combat-floating-cue.is-damage')?.textContent).toBe('8');
    expect(container.querySelector('.combat-floating-cue.is-effect')?.textContent).toBe('Ослеплён');
    expect(container.querySelector('[data-animation-profile]')).toBeNull();
  });
});
