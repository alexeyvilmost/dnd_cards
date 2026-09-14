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
const beats:CombatBeat[]=['own','enemy','own'].map((audience,i)=>({id:String(i),sourceId:String(i),sourceName:'Actor',audience:audience as 'own'|'enemy',actionName:'Attack',roll,cues:[]}));
const state=(log:CombatBeat[])=>({log} as unknown as SoloCombatState);
let current:ReturnType<typeof useCombatPresentation>;
function Harness({combat}:{combat:SoloCombatState}) { current=useCombatPresentation(combat,null);return null; }

describe('per-source combat presentation queue',()=>{
  let root:Root,container:HTMLDivElement;
  beforeEach(()=>{
    vi.useFakeTimers(); let stored:string|null=null;
    vi.stubGlobal('localStorage',{getItem:()=>stored,setItem:(_key:string,value:string)=>{stored=value;}});
    container=document.createElement('div');document.body.append(container);root=createRoot(container);
  });
  afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals();});
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
});
