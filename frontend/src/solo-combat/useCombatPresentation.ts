import { useCallback, useEffect, useRef, useState } from 'react';
import { combatRollModeFor, useSiteSettings } from '../settings';
import type { SoloCombatState } from './types';
import { groupCombatSaveBeats, presentCombatEntries, type CombatBeat } from './presentation';

export function useCombatPresentation(state: SoloCombatState | null, opening: SoloCombatState | null) {
  const settings=useSiteSettings();
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
    if(incoming.length)setQueue(current=>groupCombatSaveBeats([...current,...incoming]));
  },[state,opening]);
  const next=queue[0];
  const pending=state?.world?.pendingResolution;
  // Let outstanding target decisions resolve before opening the shared result.
  // Do not block their controls (or the monster controller) while collecting.
  const collecting=next?.rollKind==='save' && pending?.type==='target_save'
    && pending.sourceActorId===next.sourceId
    && state?.catalogActions.find(action=>action.id===pending.actionId)?.name===next.actionName;
  const combatRollMode=combatRollModeFor(settings,next?.audience);
  const initiative=opening&&!openingDone?opening:null;
  const playNext=useCallback(()=>{
    if (!next) return;
    setPlaying(next);
    setQueue(current=>current[0]?.id === next.id ? current.slice(1) : current);
  },[next]);
  useEffect(()=>{
    if(!collecting&&!initiative&&!playing&&next&&(!next.roll||combatRollMode==='skip'))playNext();
  },[collecting,initiative,playing,next,combatRollMode,playNext]);
  useEffect(()=>{
    if(!playing)return;
    const timer=window.setTimeout(()=>setPlaying(null),playing.rollPhase==='before-reaction'?0:1800);
    return ()=>window.clearTimeout(timer);
  },[playing]);
  return {initiative,beat:!collecting&&!initiative&&!playing&&next?.roll&&combatRollMode!=='skip'?next:undefined,
    playing,blocked:Boolean(initiative||(!collecting&&queue.length)||playing),
    closeInitiative:useCallback(()=>setOpeningDone(true),[]),closeAttack:playNext};
}
