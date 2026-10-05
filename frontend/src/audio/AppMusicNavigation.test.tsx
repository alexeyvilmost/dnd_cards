// @vitest-environment jsdom
import {StrictMode,act,useEffect,useRef,type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,useNavigate} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import App from '../App';
import {soundPlayer} from './player';
import {audioApi,builtInAudioCatalog} from './catalog';

vi.mock('../contexts/AuthContext',()=>({
 AuthProvider:({children}:{children:ReactNode})=><>{children}</>,
 useAuth:()=>({isAuthenticated:true,isLoading:false}),
}));
vi.mock('../components/Layout',()=>({default:({children}:{children:ReactNode})=><>{children}</>}));
vi.mock('../components/RulesAuthorityBoundary',()=>({default:({children}:{children:ReactNode})=><>{children}</>}));
vi.mock('../pages/HomePage',()=>({default:()=> <main>Главная</main>}));
vi.mock('../pages/RoguelikePage',()=>({default:()=> <main>Забег</main>}));
vi.mock('../pages/SoloCombatPage',()=>({default:()=> <main>Бой</main>}));
vi.mock('../pages/CharacterSheetMVP',()=>({default:()=> <main>Лист</main>}));
vi.mock('../pages/PaperSheetEntry',()=>({default:()=> <main>Бумажный лист</main>}));
vi.mock('../components/CharacterV3AccessNotice',()=>({default:()=>null}));
vi.mock('../mobile/MobileSuggestion',()=>({default:()=>null}));

(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let voices:HTMLAudioElement[]=[];
class TestAudio{
 src:string;volume=0;loop=false;currentTime=0;duration=180;preload='';paused=false;
 onended:((event:Event)=>void)|null=null;onerror:((event:Event)=>void)|null=null;ontimeupdate:((event:Event)=>void)|null=null;
 constructor(url:string){this.src=url;voices.push(this as unknown as HTMLAudioElement);}
 play=vi.fn(()=>{this.paused=false;return Promise.resolve();});pause=vi.fn(()=>{this.paused=true;});
}
function Route({path}:{path:string}){
 const navigate=useNavigate(),requested=useRef('');
 useEffect(()=>{if(requested.current!==path){requested.current=path;void navigate(path);}},[navigate,path]);
 return null;
}
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('Audio',TestAudio);voices=[];soundPlayer.dispose();soundPlayer.setCatalog(builtInAudioCatalog);soundPlayer.visibility(false);soundPlayer.unlock();vi.spyOn(audioApi,'get').mockResolvedValue(builtInAudioCatalog);});
afterEach(()=>{soundPlayer.dispose();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

it('keeps one site theme across paper sheet and normal pages, then stops it in the isolated rules lab',async()=>{
 const root=createRoot(document.createElement('div'));
 const render=(path:string)=>root.render(<StrictMode><MemoryRouter><Route path={path}/><App/></MemoryRouter></StrictMode>);
 const audible=()=>voices.filter(voice=>!voice.paused&&voice.volume>0);
 const siteURL=builtInAudioCatalog.cues.find(cue=>cue.key===builtInAudioCatalog.music?.site)?.url;
 try{
  await act(async()=>render('/'));
  await act(()=>vi.advanceTimersByTimeAsync(900));
  expect(audible()).toHaveLength(1);expect(audible()[0].src).toBe(siteURL);
  const sameVoice=audible()[0],created=voices.length;
  await act(async()=>render('/paper-sheet/hero'));
  await act(()=>vi.advanceTimersByTimeAsync(900));
  expect(audible()).toEqual([sameVoice]);expect(voices).toHaveLength(created);
  await act(async()=>render('/paper-sheet/hero?roguelike=run'));
  await act(()=>vi.advanceTimersByTimeAsync(900));
  expect(audible()).toEqual([sameVoice]);expect(voices).toHaveLength(created);
  await act(async()=>render('/settings'));
  await act(()=>vi.advanceTimersByTimeAsync(900));
  expect(audible()).toEqual([sameVoice]);expect(voices).toHaveLength(created);
  await act(async()=>render('/rules-lab'));
  expect(audible()).toHaveLength(0);
 }finally{await act(()=>root.unmount());}
});

it('uses run music after the combat reward route and site music after leaving standalone combat',async()=>{
 const root=createRoot(document.createElement('div'));
 const render=(path:string)=>root.render(<StrictMode><MemoryRouter><Route path={path}/><App/></MemoryRouter></StrictMode>);
 const audible=()=>voices.filter(voice=>!voice.paused&&voice.volume>0);
 const url=(key:string|undefined)=>builtInAudioCatalog.cues.find(cue=>cue.key===key)?.url;
 try{
  await act(async()=>render('/roguelike/run'));await act(()=>vi.advanceTimersByTimeAsync(900));
  expect(audible()).toHaveLength(1);expect(audible()[0].src).toBe(url(builtInAudioCatalog.music?.run));
  await act(async()=>render('/characters-v3/hero/combat?roguelike=run'));await act(()=>vi.advanceTimersByTimeAsync(900));
  expect(audible()).toHaveLength(0);
  await act(async()=>render('/roguelike/run'));await act(()=>vi.advanceTimersByTimeAsync(900));
  expect(audible()).toHaveLength(1);expect(audible()[0].src).toBe(url(builtInAudioCatalog.music?.run));
  await act(async()=>render('/characters-v3/hero/combat'));await act(()=>vi.advanceTimersByTimeAsync(900));
  expect(audible()).toHaveLength(0);
  await act(async()=>render('/characters-v3/hero'));await act(()=>vi.advanceTimersByTimeAsync(900));
  expect(audible()).toHaveLength(1);expect(audible()[0].src).toBe(url(builtInAudioCatalog.music?.site));
 }finally{await act(()=>root.unmount());}
});
