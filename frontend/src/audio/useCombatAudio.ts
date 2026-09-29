import {useEffect,useState,useSyncExternalStore} from 'react';
import type {SoloCombatState} from '../solo-combat/types';
import type {CombatBeat} from '../solo-combat/presentation';
import {combatBeatAudioPlan} from './combatSounds';
import {soundPlayer,type ScheduledSound} from './player';

function useReducedMotion(){
 const [reduced,setReduced]=useState(()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches);
 useEffect(()=>{
  if(typeof matchMedia!=='function')return;
  const media=matchMedia('(prefers-reduced-motion: reduce)'),change=()=>setReduced(media.matches);
  change();media.addEventListener('change',change);return()=>media.removeEventListener('change',change);
 },[]);
 return reduced;
}

/** Only the currently displayed accepted beat has audio. Loading history,
 * movement, initiative and encounter outcomes do not manufacture effects. */
export function useCombatAudio(state:SoloCombatState|null,playing:CombatBeat|null,_opening:SoloCombatState|null,_blocked:boolean){
 const catalog=useSyncExternalStore(soundPlayer.subscribeCatalog,soundPlayer.getCatalog,soundPlayer.getCatalog);
 const reducedMotion=useReducedMotion();
 const signature=JSON.stringify(state&&playing?combatBeatAudioPlan(state,playing,catalog,reducedMotion):[]);
 // A board refresh with the same accepted beat must not restart its phase clock.
 useEffect(()=>soundPlayer.schedule(JSON.parse(signature) as ScheduledSound[]),[signature]);
 const map=state?.battleMap;
 const mapId=map?.generation?.templateId??map?.id;
 const music=mapId?catalog.music?.battles?.[mapId]:undefined;
 // The combat page remains visible through the final blow, reward dialog and
 // defeat screen. Only unmounting that page releases its music priority.
 // A transient null state while loading must not replace a visible map theme.
 const hasState=state!==null;
 useEffect(()=>{if(hasState)soundPlayer.setCombatMusic(music??null);},[hasState,music]);
 useEffect(()=>()=>soundPlayer.setCombatMusic(undefined),[]);
}
