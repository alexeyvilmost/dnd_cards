// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {useCombatAudio} from './useCombatAudio';
import {soundPlayer} from './player';
import {routeMusic} from './AudioDirector';
import type {SoloCombatState} from '../solo-combat/types';
import type {CombatBeat} from '../solo-combat/presentation';
import type {AudioCatalog} from './catalog';
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const catalog:AudioCatalog={cues:[{key:'impact',name:'Impact',url:'/impact.mp3',channel:'effects',gain:1,loop:false,version:2,license:'test'}],bindings:[],can_manage:false,profiles:{'test-profile':{hit:'impact'}},music:{site:'site-track',run:'run-track',battles:{'map-template':'battle-track'}}};
const state=(outcome:SoloCombatState['outcome']='active')=>({characterId:'hero',world:{id:'encounter',actors:{}},tokens:{},log:[{id:'first'}],outcome,battleMap:{id:'map-template'}}) as unknown as SoloCombatState;
const beat:CombatBeat={id:'beat',sourceId:'hero',sourceName:'Hero',actionName:'Action',animation:{key:'test-profile',primitive:'melee_slash',palette:{primary:'#fff',secondary:'#aaa'},motion:{durationMs:1000,scale:1},casterCircle:false},cues:[{actorId:'enemy',kind:'damage',text:'3'}]};
function Harness({value,playing=null}:{value:SoloCombatState|null;playing?:CombatBeat|null}){useCombatAudio(value,playing,null,false);return null;}
const cancel=vi.fn();
beforeEach(()=>{soundPlayer.setCatalog(catalog);vi.spyOn(soundPlayer,'schedule').mockImplementation(()=>cancel);vi.spyOn(soundPlayer,'setCombatMusic').mockImplementation(()=>{});});
afterEach(()=>{vi.restoreAllMocks();cancel.mockClear();});
it('does not replay loaded history, initiative, movement or combat outcomes',async()=>{
 const root=createRoot(document.createElement('div'));
 try{
  for(const outcome of ['active','victory','defeat'] as const)await act(()=>root.render(<Harness value={state(outcome)}/>));
  expect(vi.mocked(soundPlayer.schedule).mock.calls.every(([plan])=>plan.length===0)).toBe(true);
 }finally{await act(()=>root.unmount());}
});
it('retains one phase clock across state refreshes and cancels it when the visible beat ends',async()=>{
 const root=createRoot(document.createElement('div'));
 try{
  await act(()=>root.render(<Harness value={state()} playing={beat}/>));expect(soundPlayer.schedule).toHaveBeenCalledTimes(1);
  await act(()=>root.render(<Harness value={{...state(),boardRevision:2}} playing={{...beat}}/>));
  expect(soundPlayer.schedule).toHaveBeenCalledTimes(1);expect(cancel).not.toHaveBeenCalled();
  await act(()=>root.render(<Harness value={state()}/>));expect(cancel).toHaveBeenCalledTimes(1);
 }finally{await act(()=>root.unmount());}
});
it('starts the same beat only after its held reaction is committed',async()=>{
 const root=createRoot(document.createElement('div'));
 try{
  await act(()=>root.render(<Harness value={state()} playing={{...beat,rollPhase:'before-reaction'}}/>));expect(soundPlayer.schedule).toHaveBeenLastCalledWith([]);
  await act(()=>root.render(<Harness value={state()} playing={{...beat,rollPhase:'after-reaction'}}/>));expect(vi.mocked(soundPlayer.schedule).mock.calls.at(-1)?.[0]).toHaveLength(1);
 }finally{await act(()=>root.unmount());}
});
it('uses the inherited map template music and releases priority on unmount',async()=>{
 const root=createRoot(document.createElement('div'));
 const generated={...state(),battleMap:{...state().battleMap,id:'generated-layout',generation:{templateId:'map-template'}}} as SoloCombatState;
 await act(()=>root.render(<Harness value={generated}/>));expect(soundPlayer.setCombatMusic).toHaveBeenLastCalledWith('battle-track');
 await act(()=>root.unmount());expect(soundPlayer.setCombatMusic).toHaveBeenLastCalledWith(undefined);
});
it.each(['victory','defeat'] as const)('keeps the map music on the visible %s screen until combat unmounts',async outcome=>{
 const root=createRoot(document.createElement('div'));
 try{
  await act(()=>root.render(<Harness value={state()}/>));
  expect(soundPlayer.setCombatMusic).toHaveBeenLastCalledWith('battle-track');
  const calls=vi.mocked(soundPlayer.setCombatMusic).mock.calls.length;
  await act(()=>root.render(<Harness value={state(outcome)}/>));
  expect(vi.mocked(soundPlayer.setCombatMusic).mock.calls).toHaveLength(calls);
  await act(()=>root.render(<Harness value={null}/>));
  expect(vi.mocked(soundPlayer.setCombatMusic).mock.calls).toHaveLength(calls);
 }finally{await act(()=>root.unmount());}
 expect(soundPlayer.setCombatMusic).toHaveBeenLastCalledWith(undefined);
});
it('routes music through catalog roles and has no hardcoded legacy cue fallback',()=>{
 expect(routeMusic('/','',catalog)).toBe('site-track');expect(routeMusic('/roguelike/run','',catalog)).toBe('run-track');
 expect(routeMusic('/characters-v3/hero','?roguelike=run',catalog)).toBe('run-track');
 expect(routeMusic('/shop/roguelike','?roguelike=run',catalog)).toBe('run-track');
 expect(routeMusic('/character-forge/hero','?roguelike=run',catalog)).toBe('run-track');
 expect(routeMusic('/characters-v3/hero','?roguelike=',catalog)).toBe('site-track');
 expect(routeMusic('/characters-v3/hero/combat','?roguelike=run',catalog)).toBeNull();
 expect(routeMusic('/characters-v3/hero/combat','',catalog)).toBeNull();
 expect(routeMusic('/shop/one','',{...catalog,music:undefined})).toBeNull();
});
