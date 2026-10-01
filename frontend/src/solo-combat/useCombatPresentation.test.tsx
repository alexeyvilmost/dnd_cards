// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {useCombatPresentation} from './useCombatPresentation';
import type {SoloCombatState} from './types';
import type {CombatBeat} from './presentation';
import {setSetting} from '../settings';

vi.mock('./presentation',async importOriginal=>({...await importOriginal<typeof import('./presentation')>(),presentCombatEntries:(_state:unknown,entries:unknown[])=>entries}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const roll:CombatBeat['roll']={kind:'d20',dice:[{sides:20,result:10}],modifiers:[],total:10,advantage:'none',outcome:'miss',text:'10'};
const animation=(durationMs:number):NonNullable<CombatBeat['animation']>=>({key:'test',primitive:'aura',
  palette:{primary:'#ffffff',secondary:'#99ccff'},motion:{durationMs,scale:1},casterCircle:false});
const beats:CombatBeat[]=['own','enemy','own'].map((audience,i)=>({id:String(i),sourceId:String(i),sourceName:'Actor',audience:audience as 'own'|'enemy',actionName:'Attack',roll,animation:animation(1800),cues:[]}));
const state=(log:CombatBeat[])=>({log} as unknown as SoloCombatState);
let current:ReturnType<typeof useCombatPresentation>;
function Harness({combat}:{combat:SoloCombatState}) { current=useCombatPresentation(combat,null);return null; }

describe('per-source combat presentation queue',()=>{
  let root:Root,container:HTMLDivElement;
  beforeEach(()=>{
    vi.useFakeTimers(); let stored:string|null=null;
    vi.stubGlobal('localStorage',{getItem:()=>stored,setItem:(_key:string,value:string)=>{stored=value;}});
    setSetting('combatRollMode','standard');setSetting('enemyCombatRollMode','standard');
    container=document.createElement('div');document.body.append(container);root=createRoot(container);
  });
  afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals();});
  it('does not replay historical visual events when an encounter is reloaded', async()=>{
    await act(async()=>root.render(<Harness combat={state(beats)}/>));
    expect(current.playing).toBeNull(); expect(current.beat).toBeUndefined(); expect(current.blocked).toBe(false);
  });
  it('uses the entity profile duration for a utility animation with no roll', async()=>{
    const utility:CombatBeat={...beats[0],roll:undefined,animation:{key:'utility',primitive:'aura',
      palette:{primary:'#ffffff',secondary:'#99ccff'},motion:{durationMs:2400,scale:1},casterCircle:true}};
    await act(async()=>root.render(<Harness combat={state([])}/>));
    await act(async()=>root.render(<Harness combat={state([utility])}/>));
    await act(async()=>vi.advanceTimersByTime(1800));
    expect(current.playing?.id).toBe(utility.id);
    await act(async()=>vi.advanceTimersByTime(600));
    expect(current.playing).toBeNull();
  });
  it('shortens decorative animation time for reduced motion', async()=>{
    vi.stubGlobal('matchMedia',()=>({matches:true}));
    const utility:CombatBeat={...beats[0],roll:undefined};
    await act(async()=>root.render(<Harness combat={state([])}/>));
    await act(async()=>root.render(<Harness combat={state([utility])}/>));
    await act(async()=>vi.advanceTimersByTime(240));
    expect(current.playing).toBeNull();
  });
  it.each([false,true])('does not hold gameplay for captions after a short weapon animation, reduced motion=%s', async reduced=>{
    vi.stubGlobal('matchMedia',()=>({matches:reduced}));
    const result:CombatBeat={...beats[0],roll:undefined,animation:animation(920),
      cues:[{actorId:'target',text:'8',kind:'damage'}]};
    await act(async()=>root.render(<Harness combat={state([])}/>));
    await act(async()=>root.render(<Harness combat={state([result])}/>));
    const duration=reduced?240:920;
    await act(async()=>vi.advanceTimersByTime(duration-1));
    expect(current.playing?.id).toBe(result.id);
    await act(async()=>vi.advanceTimersByTime(1));
    expect(current.playing).toBeNull();
    expect(current.blocked).toBe(false);
  });
  it('immediately resolves caption-only events without inventing a delivery animation',async()=>{
    const result:CombatBeat={...beats[0],roll:undefined,animation:undefined,suppressAnimation:true,
      cues:[{actorId:'target',text:'Завершено',kind:'effect'}]};
    await act(async()=>root.render(<Harness combat={state([])}/>));
    await act(async()=>root.render(<Harness combat={state([result])}/>));
    await act(async()=>vi.advanceTimersByTime(0));
    expect(current.playing).toBeNull();expect(current.blocked).toBe(false);
  });
  it('lets the longest grouped target animation finish', async()=>{
    const first:CombatBeat={...beats[0],roll:undefined,rollKind:'save',saveGroupId:'cast',targetId:'a',animation:animation(920)};
    const second:CombatBeat={...first,id:'long',targetId:'b',animation:animation(2600)};
    await act(async()=>root.render(<Harness combat={state([])}/>));
    await act(async()=>root.render(<Harness combat={state([first,second])}/>));
    expect(current.playing?.saveRows).toHaveLength(2);
    await act(async()=>vi.advanceTimersByTime(2599));
    expect(current.playing).not.toBeNull();
    await act(async()=>vi.advanceTimersByTime(1));
    expect(current.playing).toBeNull();
  });
  it('coalesces route trails without blocking input and immediately yields to an action', async()=>{
    const first:CombatBeat={...beats[0],id:'step-1',roll:undefined,blocksInput:false,animation:animation(850)};
    const second:CombatBeat={...first,id:'step-2'};
    const last:CombatBeat={...first,id:'step-10'};
    await act(async()=>root.render(<Harness combat={state([])}/>));
    await act(async()=>root.render(<Harness combat={state([first])}/>));
    expect(current.playing?.id).toBe(first.id);expect(current.blocked).toBe(false);
    await act(async()=>root.render(<Harness combat={state([first,second,last])}/>));
    expect(current.playing?.id).toBe(last.id);expect(current.blocked).toBe(false);
    const attack={...beats[0],id:'attack'};
    await act(async()=>root.render(<Harness combat={state([first,second,last,attack])}/>));
    expect(current.playing).toBeNull();expect(current.beat?.id).toBe(attack.id);expect(current.blocked).toBe(true);
    await act(async()=>current.closeAttack());
    await act(async()=>vi.advanceTimersByTime(1800));
    expect(current.playing).toBeNull();expect(current.blocked).toBe(false);
  });
  it('does not replay a confirmed animation when a command returns the same log again', async()=>{
    const utility:CombatBeat={...beats[0],roll:undefined,animation:animation(920)};
    await act(async()=>root.render(<Harness combat={state([])}/>));
    await act(async()=>root.render(<Harness combat={state([utility])}/>));
    await act(async()=>vi.advanceTimersByTime(920));
    await act(async()=>root.render(<Harness combat={state([{...utility}])}/>));
    expect(current.playing).toBeNull();expect(current.blocked).toBe(false);
  });
  it('shows own attacks on both sides of a skipped enemy beat and keeps the map feedback',async()=>{
    setSetting('enemyCombatRollMode','skip');
    await act(async()=>root.render(<Harness combat={state([])}/>));
    await act(async()=>root.render(<Harness combat={state(beats)}/>));
    expect(current.beat?.id).toBe('0');
    await act(async()=>current.closeAttack());
    expect(current.playing?.id).toBe('0');
    await act(async()=>vi.advanceTimersByTime(1800));
    expect(current.beat).toBeUndefined();
    expect(current.playing?.id).toBe('1');
    await act(async()=>vi.advanceTimersByTime(1800));
    expect(current.beat?.id).toBe('2');
    expect(current.blocked).toBe(true);
    await act(async()=>current.closeAttack());
    await act(async()=>vi.advanceTimersByTime(1800));
    expect(current.blocked).toBe(false);
  });
  it('also allows own skip and enemy standard without skipping the enemy',async()=>{
    setSetting('combatRollMode','skip');setSetting('enemyCombatRollMode','standard');
    await act(async()=>root.render(<Harness combat={state([])}/>));
    await act(async()=>root.render(<Harness combat={state(beats)}/>));
    expect(current.playing?.id).toBe('0');
    await act(async()=>vi.advanceTimersByTime(1800));
    expect(current.beat?.id).toBe('1');
  });
  it('collects save continuations without blocking outstanding target decisions',async()=>{
    const first={...beats[0],rollKind:'save' as const,saveGroupId:'cast',targetId:'a'};
    const second={...first,id:'second',targetId:'b'};
    await act(async()=>root.render(<Harness combat={state([])}/>));
    const partial={...state([first]),catalogActions:[{id:'effect',name:first.actionName}],world:{pendingResolution:{type:'target_save',sourceActorId:first.sourceId,actionId:'effect'}}} as unknown as SoloCombatState;
    await act(async()=>root.render(<Harness combat={partial}/>));
    expect(current.beat).toBeUndefined();expect(current.blocked).toBe(false);expect(current.playing).toBeNull();
    await act(async()=>root.render(<Harness combat={state([first,second])}/>));
    expect(current.beat?.saveRows).toHaveLength(2);expect(current.blocked).toBe(true);
  });
  it('keeps a held roll continuation ahead of unfinished map feedback',async()=>{
    setSetting('combatRollMode','standard');
    await act(async()=>root.render(<Harness combat={state([])}/>));
    const movement={...beats[0],id:'movement',roll:undefined};
    const held={...state([movement]),pendingD20Interrupt:{operation:'roll_influence',command:{actorId:'hero'},held:{kind:'attack',roll}}} as unknown as SoloCombatState;
    await act(async()=>root.render(<Harness combat={held}/>));
    expect(current.playing?.id).toBe('movement');
    const confirmed={...beats[0],id:'confirmed',sourceId:'hero',damage:[{amount:4,damageType:'piercing'}]};
    await act(async()=>root.render(<Harness combat={state([movement,confirmed])}/>));
    expect(current.playing).toBeNull();
    expect(current.beat?.id).toBe('confirmed');
    expect(current.beat?.damage?.[0].amount).toBe(4);
  });
});
