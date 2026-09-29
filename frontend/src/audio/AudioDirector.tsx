import {useEffect,useRef,useSyncExternalStore} from 'react';
import {useLocation} from 'react-router-dom';
import {useAuth} from '../contexts/AuthContext';
import {useSiteSettings} from '../settings';
import {audioApi,builtInAudioCatalog,type AudioCatalog} from './catalog';
import {soundPlayer} from './player';

export function routeMusic(path:string,search:string,catalog:AudioCatalog):string|null{
 // The map-specific theme is selected by the mounted combat page. During its
 // initial load there is no map yet, so neither site nor run music belongs here.
 if(/^\/characters-v3\/[^/]+\/combat\/?$/.test(path))return null;
 const role=path==='/roguelike'||path.startsWith('/roguelike/')||Boolean(new URLSearchParams(search).get('roguelike'))?'run':'site';
 return catalog.music?.[role]??null;
}
export default function AudioDirector(){
 const location=useLocation(),{isAuthenticated}=useAuth(),settings=useSiteSettings();
 const catalog=useSyncExternalStore(soundPlayer.subscribeCatalog,soundPlayer.getCatalog,soundPlayer.getCatalog);
 // A run query is page context on entry. Editing the query while the same
 // page remains visible must not choose a different soundtrack.
 const page=useRef({path:location.pathname,search:location.search});
 useEffect(()=>{
  if(!isAuthenticated){soundPlayer.setCatalog(builtInAudioCatalog);return;}
  let live=true;
  const load=()=>void audioApi.get().then(c=>{if(live)soundPlayer.setCatalog(c);}).catch(()=>{});
  load();window.addEventListener('audio-catalog-changed',load);
  return()=>{live=false;window.removeEventListener('audio-catalog-changed',load);};
 },[isAuthenticated]);
 useEffect(()=>{
  soundPlayer.visibility(document.hidden);
  const unlock=(event:Event)=>{if(event.isTrusted)soundPlayer.unlock();};
  const visibility=()=>soundPlayer.visibility(document.hidden);
  document.addEventListener('pointerdown',unlock);document.addEventListener('keydown',unlock);document.addEventListener('visibilitychange',visibility);
  return()=>{document.removeEventListener('pointerdown',unlock);document.removeEventListener('keydown',unlock);document.removeEventListener('visibilitychange',visibility);soundPlayer.dispose();};
 },[]);
 useEffect(()=>soundPlayer.refresh(),[settings]);
 useEffect(()=>{
  if(page.current.path!==location.pathname)page.current={path:location.pathname,search:location.search};
  soundPlayer.setMusic(routeMusic(page.current.path,page.current.search,catalog));
 },[location.pathname,location.search,catalog]);
 return null;
}
