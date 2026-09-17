// @vitest-environment jsdom
import {act,StrictMode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {automaticCombatDecisionKey,useAutomaticCombatDecision} from './useAutomaticCombatDecision';
import type {SoloCombatState} from './types';

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
function held(revision=46,lastId='first',actorId='archer'):SoloCombatState{
 return {world:{id:'encounter',revision},log:Array.from({length:80},(_,i)=>({id:i===79?lastId:`old-${i}`})),
  pendingD20Interrupt:{operation:'roll_influence',command:{actorId,actionId:'bow',targetIds:['enemy']},
   held:{kind:'attack',roll:{kind:'d20',dice:[{sides:20,result:13}],outcome:'hit',total:20}}}} as SoloCombatState;
}
type Props={state:SoloCombatState|null;kind?:'roll_influence'|'reaction'|null;blocked?:boolean};
describe('automatic continuation of saved decisions',()=>{
 let root:Root,container:HTMLDivElement;
 const send=vi.fn();
 function Harness({state,kind='roll_influence',blocked=false}:Props){
  // New callback each render, as in the combat page.
  useAutomaticCombatDecision(state,kind,blocked,k=>send(k));return null;
 }
 const render=async(props:Props)=>act(async()=>root.render(<StrictMode><Harness {...props}/></StrictMode>));
 beforeEach(()=>{send.mockClear();container=document.createElement('div');document.body.append(container);root=createRoot(container);});
 afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
 it('continues successive identical hits after the journal reaches 80 rows',async()=>{
  const first=held(),second=held(63,'second');
  expect(first.log.length).toBe(second.log.length);
  await render({state:first});await render({state:JSON.parse(JSON.stringify(first))});
  expect(send).toHaveBeenCalledTimes(1);
  await render({state:second});await render({state:second});
  expect(send).toHaveBeenCalledTimes(2);
 });
 it('does not retry on rerenders, StrictMode, busy transitions or temporary hidden policy',async()=>{
  const state=held();await render({state,blocked:true});expect(send).not.toHaveBeenCalled();
  await render({state});await render({state,blocked:true});await render({state});
  await render({state,kind:null});await render({state});
  expect(send).toHaveBeenCalledTimes(1);
 });
 it('leaves manual offers alone and allows a new saved decision after an error gate',async()=>{
  await render({state:held(),kind:null});expect(send).not.toHaveBeenCalled();
  await render({state:held()});expect(send).toHaveBeenCalledTimes(1);
  await render({state:held(63,'second'),blocked:true});expect(send).toHaveBeenCalledTimes(1);
  await render({state:held(63,'second')});expect(send).toHaveBeenCalledTimes(2);
 });
 it('resumes the saved decision once after remount (page reload)',async()=>{
  const saved=JSON.parse(JSON.stringify(held()));await render({state:saved});
  await act(async()=>root.unmount());root=createRoot(container);
  await render({state:saved});await render({state:saved});
  expect(send).toHaveBeenCalledTimes(2);
 });
 it('distinguishes encounters, actors, revisions and new log entries',()=>{
  const original=held();const anotherBattle=held();anotherBattle.world.id='different';
  const keys=[original,held(63),held(46,'second'),held(46,'first','monk'),anotherBattle].map(s=>automaticCombatDecisionKey(s,'roll_influence'));
  expect(new Set(keys).size).toBe(keys.length);
  expect(automaticCombatDecisionKey(JSON.parse(JSON.stringify(original)),'roll_influence')).toBe(keys[0]);
 });
 it('uses reaction request identity, not changing presentation or journal length',async()=>{
  const state=held();state.world.pendingResolution={request:{id:'shield-1',type:'reaction'}} as SoloCombatState['world']['pendingResolution'];
  await render({state,kind:'reaction'});await render({state:structuredClone(state),kind:'reaction'});
  const second=structuredClone(state);second.world.pendingResolution!.request.id='ward-2';
  await render({state:second,kind:'reaction'});expect(send).toHaveBeenCalledTimes(2);
 });
 it('supports archived heroic roll snapshots without rewriting them',async()=>{
  const state=held(),pending=state.pendingD20Interrupt!;
  state.pendingD20Interrupt={...pending,operation:'heroic_reroll',heroic:pending.held,held:undefined} as unknown as SoloCombatState['pendingD20Interrupt'];
  const before=JSON.stringify(state);await render({state});
  expect(send).toHaveBeenCalledTimes(1);expect(JSON.stringify(state)).toBe(before);
 });
 it('ignores absent decisions',async()=>{
  await render({state:null});const state=held();delete state.pendingD20Interrupt;
  await render({state});await render({state,kind:'reaction'});expect(send).not.toHaveBeenCalled();
 });
});
