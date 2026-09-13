import { useCallback, useEffect, useRef, useState } from 'react';
import { useSiteSettings } from '../settings';
import type { SoloCombatState } from './types';
import { presentCombatEntries, type CombatBeat } from './presentation';

export function useCombatPresentation(state: SoloCombatState | null, opening: SoloCombatState | null) {
  const {combatRollMode}=useSiteSettings();
  const previous=useRef<SoloCombatState|null>(null);
  const [queue,setQueue]=useState<CombatBeat[]>([]);
  const [playing,setPlaying]=useState<CombatBeat|null>(null);
  const [openingDone,setOpeningDone]=useState(false);
  useEffect(()=>{
    if(!state || previous.current===state)return;
    const seen=new Set(previous.current?.log.map(entry=>entry.id)??[]);
    const isFirst=!previous.current;
    previous.current=state;
    if(isFirst&&!opening)return;
    const incoming=presentCombatEntries(state,state.log.filter(entry=>!seen.has(entry.id)));
    if(incoming.length)setQueue(current=>[...current,...incoming]);
  },[state,opening]);
  const next=queue[0];
  const initiative=opening&&!openingDone?opening:null;
  const playNext=useCallback(()=>{
    if (!next) return;
    setPlaying(next);
    setQueue(current=>current[0]?.id === next.id ? current.slice(1) : current);
  },[next]);
  useEffect(()=>{
    if(!initiative&&!playing&&next&&(!next.roll||combatRollMode==='skip'))playNext();
  },[initiative,playing,next,combatRollMode,playNext]);
  useEffect(()=>{
    if(!playing)return;
    const timer=window.setTimeout(()=>setPlaying(null),playing.rollPhase==='before-reaction'?0:1800);
    return ()=>window.clearTimeout(timer);
  },[playing]);
  return {initiative,beat:!initiative&&!playing&&next?.roll?next:undefined,
    playing,blocked:Boolean(initiative||queue.length||playing),
    closeInitiative:useCallback(()=>setOpeningDone(true),[]),closeAttack:playNext};
}
