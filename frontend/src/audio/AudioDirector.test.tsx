// @vitest-environment jsdom
import {StrictMode,act,useEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,useLocation,useNavigate} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import AudioDirector from './AudioDirector';
import {soundPlayer} from './player';
import {builtInAudioCatalog} from './catalog';
import {useCombatAudio} from './useCombatAudio';
import type {SoloCombatState} from '../solo-combat/types';
import type {RoguelikeRun} from '../roguelike/api';
import CombatRewardDialog from '../components/CombatRewardDialog';
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({isAuthenticated:false})}));
vi.mock('../utils/cardsIndex',()=>({getCardsIndex:()=>new Promise(()=>{})}));
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let voices:HTMLAudioElement[]=[];
class TestAudio{
 src:string;volume=0;loop=false;currentTime=0;duration=30;preload='';paused=false;
 onended:((event:Event)=>void)|null=null;onerror:((event:Event)=>void)|null=null;ontimeupdate:((event:Event)=>void)|null=null;
 constructor(url:string){this.src=url;voices.push(this as unknown as HTMLAudioElement);}
 play=vi.fn(()=>{this.paused=false;return Promise.resolve();});pause=vi.fn(()=>{this.paused=true;});
}
function BattleMusic({outcome='active',loaded=true,reward=false}:{outcome:SoloCombatState['outcome'];loaded?:boolean;reward?:boolean}){
 const navigate=useNavigate();
 const mapId=Object.keys(builtInAudioCatalog.music?.battles??{})[0];
 const state=loaded?{outcome,world:{id:'test'},battleMap:{id:mapId}} as unknown as SoloCombatState:null;
 useCombatAudio(state,null,null,false);
 const run={id:'run',status:'victory',last_reward:{items:[],experience:10,gold:5}} as unknown as RoguelikeRun;
 return reward?<CombatRewardDialog run={run} onClose={()=>void navigate('/roguelike/run')}/>:null;
}
function MusicScene({path,outcome='active',loaded=true,reward=false}:{path:string;outcome?:SoloCombatState['outcome'];loaded?:boolean;reward?:boolean}){
 const navigate=useNavigate(),location=useLocation(),requested=useRef('');
 useEffect(()=>{if(requested.current!==path){requested.current=path;void navigate(path);}},[navigate,path]);
 return /^\/characters-v3\/[^/]+\/combat\/?$/.test(location.pathname)
  ?<BattleMusic outcome={outcome} loaded={loaded} reward={reward}/>:null;
}
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('Audio',TestAudio);voices=[];soundPlayer.dispose();soundPlayer.visibility(false);soundPlayer.unlock();});
afterEach(()=>{soundPlayer.dispose();vi.unstubAllGlobals();vi.useRealTimers();});
it('StrictMode, route changes and battle priority settle on one music voice and unmount releases it',async()=>{
 const root=createRoot(document.createElement('div'));
 const render=(path:string,loaded=true)=>root.render(<StrictMode><MemoryRouter><AudioDirector/><MusicScene path={path} loaded={loaded}/></MemoryRouter></StrictMode>);
 const audible=()=>voices.filter(voice=>!voice.paused&&voice.volume>0);
 const url=(key:string|undefined)=>builtInAudioCatalog.cues.find(cue=>cue.key===key)?.url;
 try{
  await act(()=>render('/'));await act(()=>vi.advanceTimersByTimeAsync(900));
  expect(audible()).toHaveLength(1);expect(audible()[0].src).toBe(url(builtInAudioCatalog.music?.site));
  await act(()=>render('/roguelike/run'));await act(()=>vi.advanceTimersByTimeAsync(900));
  expect(audible()).toHaveLength(1);expect(audible()[0].src).toBe(url(builtInAudioCatalog.music?.run));
  const runVoice=audible()[0],created=voices.length;
  await act(()=>render('/characters-v3/hero?roguelike=run'));await act(()=>vi.advanceTimersByTimeAsync(900));
  expect(audible()).toEqual([runVoice]);expect(voices).toHaveLength(created);
  await act(()=>render('/characters-v3/hero'));await act(()=>vi.advanceTimersByTimeAsync(900));
  expect(audible()).toEqual([runVoice]);expect(voices).toHaveLength(created);
  const battleKey=Object.values(builtInAudioCatalog.music?.battles??{})[0];
  await act(()=>render('/characters-v3/hero/combat?roguelike=run',false));await act(()=>vi.advanceTimersByTimeAsync(900));
  expect(audible()).toHaveLength(0);
  await act(()=>render('/characters-v3/hero/combat?roguelike=run'));await act(()=>vi.advanceTimersByTimeAsync(900));
  expect(audible()).toHaveLength(1);expect(audible()[0].src).toBe(url(battleKey));
  await act(()=>render('/roguelike/run'));await act(()=>vi.advanceTimersByTimeAsync(900));
  expect(audible()).toHaveLength(1);expect(audible()[0].src).toBe(url(builtInAudioCatalog.music?.run));
 }finally{await act(()=>root.unmount());}
 expect(audible()).toHaveLength(0);expect(vi.getTimerCount()).toBe(0);
});
it('keeps battle music through the last blow and reward dialog, then changes on leaving the page',async()=>{
 const root=createRoot(document.createElement('div'));
 const render=(outcome:SoloCombatState['outcome']='active',loaded=true,reward=false)=>root.render(<StrictMode><MemoryRouter><AudioDirector/><MusicScene path="/characters-v3/hero/combat?roguelike=run" outcome={outcome} loaded={loaded} reward={reward}/></MemoryRouter></StrictMode>);
 const audible=()=>voices.filter(voice=>!voice.paused&&voice.volume>0);
 const url=(key:string|undefined)=>builtInAudioCatalog.cues.find(cue=>cue.key===key)?.url;
 const battleKey=Object.values(builtInAudioCatalog.music?.battles??{})[0];
 try{
  await act(()=>render());await act(()=>vi.advanceTimersByTimeAsync(900));
  expect(audible()).toHaveLength(1);expect(audible()[0].src).toBe(url(battleKey));
  await act(()=>render('victory',true,true));await act(()=>vi.advanceTimersByTimeAsync(900));
  expect(document.body.querySelector('[role="dialog"][aria-label="Итоги сражения"]')).not.toBeNull();
  expect(audible()).toHaveLength(1);expect(audible()[0].src).toBe(url(battleKey));
  await act(()=>render('victory',false,true));await act(()=>vi.advanceTimersByTimeAsync(900));
  expect(audible()).toHaveLength(1);expect(audible()[0].src).toBe(url(battleKey));
  await act(()=>document.body.querySelector<HTMLButtonElement>('.combat-presentation-continue')?.click());
  await act(()=>vi.advanceTimersByTimeAsync(900));
  expect(document.body.querySelector('[role="dialog"][aria-label="Итоги сражения"]')).toBeNull();
  expect(audible()).toHaveLength(1);expect(audible()[0].src).toBe(url(builtInAudioCatalog.music?.run));
 }finally{await act(()=>root.unmount());}
 expect(audible()).toHaveLength(0);
});
it('keeps battle music on the defeat screen until the route changes to the character sheet',async()=>{
 const root=createRoot(document.createElement('div'));
 const render=(path:string,outcome:SoloCombatState['outcome']='active')=>root.render(<StrictMode><MemoryRouter><AudioDirector/><MusicScene path={path} outcome={outcome}/></MemoryRouter></StrictMode>);
 const audible=()=>voices.filter(voice=>!voice.paused&&voice.volume>0);
 const url=(key:string|undefined)=>builtInAudioCatalog.cues.find(cue=>cue.key===key)?.url;
 const battleKey=Object.values(builtInAudioCatalog.music?.battles??{})[0];
 try{
  await act(()=>render('/characters-v3/hero/combat'));await act(()=>vi.advanceTimersByTimeAsync(900));
  await act(()=>render('/characters-v3/hero/combat','defeat'));await act(()=>vi.advanceTimersByTimeAsync(900));
  expect(audible()).toHaveLength(1);expect(audible()[0].src).toBe(url(battleKey));
  await act(()=>render('/characters-v3/hero'));await act(()=>vi.advanceTimersByTimeAsync(900));
  expect(audible()).toHaveLength(1);expect(audible()[0].src).toBe(url(builtInAudioCatalog.music?.site));
 }finally{await act(()=>root.unmount());}
});
