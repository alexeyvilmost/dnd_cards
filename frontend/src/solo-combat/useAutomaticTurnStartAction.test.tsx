// @vitest-environment jsdom
import {act,StrictMode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {automaticTurnStartConditionAction,combatTurnStartKey,useAutomaticTurnStartAction} from './useAutomaticTurnStartAction';
import {executeConditionAction} from './engine';
import {decisionPolicyToggles} from './decisionPolicies';
import {registerConditions,resetConditionsToOfflineFixture} from '../engine/conditions';
import type {SoloCombatState} from './types';
import compiled from '../pages/rulesLabFixture.generated.json';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const policy='turn-start.auto-stand';
const effect=(value:string)=>({id:value,name:value,source:'test',mechanics:{kind:'condition',value}});
const state=():SoloCombatState=>({characterId:'hero',outcome:'active',conditionActionSchemaVersion:1,log:[],
  world:{id:'encounter',revision:1,actors:{hero:{...structuredClone(compiled.roots.magicInitiateFighter.actor),id:'hero',name:'Hero',
    runtime:{...structuredClone(compiled.roots.magicInitiateFighter.actor.runtime),hp:{current:10,max:10,temp:0},activeEffects:[effect('prone')]}}},
    objects:{},scene:{mode:'encounter',round:1,initiative:['hero'],activeIndex:0,turnStarted:true}},
  movementRemainingFt:{hero:30},tokens:{hero:{actorId:'hero',position:{x:1,y:1}}},catalogActions:[],
} as unknown as SoloCombatState);
describe('data-owned turn-start condition automation',()=>{
  afterEach(()=>resetConditionsToOfflineFixture('test finished'));
  it('defaults on, selects the granted action, and pays through the existing executor once',()=>{
    expect(decisionPolicyToggles('turn_start')[0]).toMatchObject({id:policy,defaultEnabled:true});
    const original=state(),saved=JSON.stringify(original),action=automaticTurnStartConditionAction(original,{});
    expect(action?.name).toBe('Встать');
    const next=executeConditionAction(original,'hero',action!.id);
    expect(next.movementRemainingFt.hero).toBe(15);
    expect(next.world.actors.hero.runtime.activeEffects).toEqual([]);
    expect(automaticTurnStartConditionAction(next,{})).toBeNull();expect(JSON.stringify(original)).toBe(saved);
  });
  it('handles another authored condition/action and movement fraction without an ID/name branch',()=>{
    registerConditions([{id:'sticky',label:'Mud',modifiers:[],worldFacts:{granted_actions:[{
      id:'mud.clear',name:'Очистить сапоги',description:'Quarter speed',movementFraction:.25,decisionPolicies:[policy],
      effects:[{resolution:'auto',result:[{kind:'condition',value:'$granting_condition',op:'remove'}]}],
    }]}}]);
    const original=state();original.world.actors.hero.runtime.activeEffects=[effect('sticky')];
    const action=automaticTurnStartConditionAction(original,{});
    expect(action?.id).toBe('mud.clear:sticky');
    expect(executeConditionAction(original,'hero',action!.id).movementRemainingFt.hero).toBe(23);
  });
  it.each(['disabled','not-enough','zero-speed','unconscious','pending','already-acted'] as const)('leaves %s for manual resolution',mode=>{
    const original=state(),preferences:Record<string,boolean>=mode==='disabled'?{[policy]:false}:{};
    if(mode==='not-enough')original.movementRemainingFt.hero=14;
    if(mode==='zero-speed')original.world.actors.hero.character.baseSpeed=0;
    if(mode==='unconscious')original.world.actors.hero.runtime.hp.current=0;
    if(mode==='pending')original.pendingTriggeredAction={event:'hit',sourceActorId:'hero',sourceActionId:'a',targetIds:[],optionActionIds:[]};
    if(mode==='already-acted')original.log=[{id:'played',round:1,actorId:'hero',text:'Anything',records:[{kind:'action',ordinal:0,sourceActorId:'hero',actorId:'hero',targetIds:[],actionId:'anything'}]}];
    expect(automaticTurnStartConditionAction(original,preferences)).toBeNull();
  });
  it('uses turn identity rather than changing revision or bounded log length',()=>{
    const original=state(),next=structuredClone(original);next.world.revision++;
    expect(combatTurnStartKey(next)).toBe(combatTurnStartKey(original));
    if(next.world.scene.mode==='encounter')next.world.scene.round++;
    expect(combatTurnStartKey(next)).not.toBe(combatTurnStartKey(original));
  });
  it('leaves an ambiguous legacy mid-turn journal for the player after reload',()=>{
    const original=state();original.log=[{id:'legacy',round:1,actorId:'hero',text:'An old action'}];
    expect(automaticTurnStartConditionAction(original,{})).toBeNull();
  });
});
describe('one authoritative command opportunity per turn',()=>{
  let root:Root,container:HTMLDivElement;
  const perform=vi.fn();
  function Harness({combat,blocked=false,preferences={}}:{combat:SoloCombatState;blocked?:boolean;preferences?:Record<string,boolean>}){
    useAutomaticTurnStartAction(combat,preferences,blocked,perform);return null;
  }
  beforeEach(()=>{perform.mockClear();container=document.createElement('div');document.body.append(container);root=createRoot(container);});
  afterEach(async()=>{await act(async()=>root.unmount());container.remove();resetConditionsToOfflineFixture('test finished');});
  it('waits for the initial delivery, survives StrictMode and does not spend again on rerender',async()=>{
    const original=state();
    await act(async()=>root.render(<StrictMode><Harness combat={original} blocked/></StrictMode>));expect(perform).not.toHaveBeenCalled();
    await act(async()=>root.render(<StrictMode><Harness combat={original}/></StrictMode>));expect(perform).toHaveBeenCalledTimes(1);
    const copy=structuredClone(original);copy.world.revision++;
    await act(async()=>root.render(<StrictMode><Harness combat={copy}/></StrictMode>));expect(perform).toHaveBeenCalledTimes(1);
    if(copy.world.scene.mode==='encounter')copy.world.scene.round++;
    await act(async()=>root.render(<StrictMode><Harness combat={copy}/></StrictMode>));expect(perform).toHaveBeenCalledTimes(2);
  });
  it('does not auto recover from a later knockdown or toggle-on in the middle of the same turn',async()=>{
    const original=state();original.world.actors.hero.runtime.activeEffects=[];
    await act(async()=>root.render(<Harness combat={original}/>));
    await act(async()=>root.render(<Harness combat={state()}/>));expect(perform).not.toHaveBeenCalled();
    const next=state();if(next.world.scene.mode==='encounter')next.world.scene.round++;
    await act(async()=>root.render(<Harness combat={next} preferences={{[policy]:false}}/>));
    await act(async()=>root.render(<Harness combat={structuredClone(next)}/>));expect(perform).not.toHaveBeenCalled();
  });
});
