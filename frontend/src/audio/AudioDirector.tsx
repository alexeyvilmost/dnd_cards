import {useEffect} from 'react';
import {useLocation} from 'react-router-dom';
import {useAuth} from '../contexts/AuthContext';
import {useSiteSettings} from '../settings';
import {audioApi} from './catalog';
import {soundPlayer} from './player';
export function routeMusic(path:string,search:string){
 if(path.startsWith('/shop/'))return 'music.shop';
 if(path.endsWith('/combat'))return 'music.combat';
 if(path.startsWith('/roguelike')||new URLSearchParams(search).has('roguelike'))return 'music.camp';
 return null;
}
export default function AudioDirector(){
 const location=useLocation(),{isAuthenticated}=useAuth(),settings=useSiteSettings();
 useEffect(()=>{if(!isAuthenticated)return;let live=true;const load=()=>void audioApi.get().then(c=>{if(live)soundPlayer.setCatalog(c);}).catch(()=>{});load();window.addEventListener('audio-catalog-changed',load);return()=>{live=false;window.removeEventListener('audio-catalog-changed',load);};},[isAuthenticated]);
 useEffect(()=>{soundPlayer.visibility(document.hidden);const unlock=(event:Event)=>{if(event.isTrusted)soundPlayer.unlock();};const click=(event:MouseEvent)=>{if(!event.isTrusted)return;const el=(event.target as Element)?.closest?.('button,a,[role="button"]');if(el&&!el.matches(':disabled,[aria-disabled="true"]'))soundPlayer.play('ui.click');};const visibility=()=>soundPlayer.visibility(document.hidden);document.addEventListener('pointerdown',unlock);document.addEventListener('keydown',unlock);document.addEventListener('click',click);document.addEventListener('visibilitychange',visibility);return()=>{document.removeEventListener('pointerdown',unlock);document.removeEventListener('keydown',unlock);document.removeEventListener('click',click);document.removeEventListener('visibilitychange',visibility);soundPlayer.dispose();};},[]);
 useEffect(()=>soundPlayer.refresh(),[settings]);
 useEffect(()=>{soundPlayer.setMusic(isAuthenticated?routeMusic(location.pathname,location.search):null);if(isAuthenticated&&location.pathname.startsWith('/shop/'))soundPlayer.play('shop.open');},[location.pathname,location.search,isAuthenticated]);
 return null;
}
