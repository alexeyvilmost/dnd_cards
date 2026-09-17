import { useCallback, useEffect, useState } from 'react';
import { combatRollModeFor, useSiteSettings } from '../settings';
import type { SoloCombatState } from './types';
import { groupCombatSaveBeats, presentCombatEntries, type CombatBeat } from './presentation';
import {persistedRollPresentation} from './persistedRollPresentation';

export function useCombatPresentation(state: SoloCombatState | null, opening: SoloCombatState | null) {
  const settings=useSiteSettings();
  const [previous,setPrevious]=useState<SoloCombatState|null>(null);
  const [queue,setQueue]=useState<CombatBeat[]>([]);
  const [playing,setPlaying]=useState<CombatBeat|null>(null);
  const [openingDone,setOpeningDone]=useState(false);
  // Derive incoming beats before committing the render. An effect would leave
  // one painted frame with neither the held roll nor its confirmed result.
  if (state && previous !== state) {
    const seen=new Set(previous?.log.map(entry=>entry.id)??[]);
    setPrevious(state);
    if (previous || opening) {
      const incoming=presentCombatEntries(state,state.log.filter(entry=>!seen.has(entry.id)))
        .filter(beat=>!beat.roll?.deathSave); // persistent death-save dialog owns this result
      const held = persistedRollPresentation(previous?.pendingD20Interrupt);
      if (held?.held && !persistedRollPresentation(state.pendingD20Interrupt)?.held) {
        // The confirmed phase belongs to the dialog already on screen, ahead
        // of unrelated queued movement/resource feedback. Do not remount it.
        const confirmation = incoming.filter(beat => beat.roll && beat.sourceId === held.command.actorId);
        const remainder = incoming.filter(beat => !confirmation.includes(beat));
        if (confirmation.length) setPlaying(null);
        setQueue(current=>groupCombatSaveBeats([...confirmation,...current,...remainder]));
      } else if(incoming.length)setQueue(current=>groupCombatSaveBeats([...current,...incoming]));
    }
  }
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
