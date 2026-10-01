import { useCallback, useEffect, useRef, useState } from 'react';
import { combatRollModeFor, useSiteSettings } from '../settings';
import type { SoloCombatState } from './types';
import { groupCombatSaveBeats, presentCombatEntries, type CombatBeat } from './presentation';
import {persistedRollPresentation} from './persistedRollPresentation';
import {applyCombatPresentationPhase, combatPresentationView, type CombatPresentationPhase} from './presentationState';
import {combatAnimationTiming} from './animationTiming';
import {movementDurationForTransition} from '../battle3d/movementAnimation';

export function useCombatPresentation(state: SoloCombatState | null, opening: SoloCombatState | null) {
  const settings=useSiteSettings();
  const [previous,setPrevious]=useState<SoloCombatState|null>(null);
  const [queue,setQueue]=useState<CombatBeat[]>([]);
  const [playing,setPlaying]=useState<CombatBeat|null>(null);
  const [playingMovementDuration,setPlayingMovementDuration]=useState(0);
  const [visible,setVisible]=useState<SoloCombatState|null>(null);
  const appliedViewPhases=useRef(new Set<string>());
  const [openingDone,setOpeningDone]=useState(false);
  // Derive incoming beats before committing the render. An effect would leave
  // one painted frame with neither the held roll nor its confirmed result.
  if (state && previous !== state) {
    const seen=new Set((previous?.log??opening?.log??[]).map(entry=>entry.id));
    setPrevious(state);
    if (previous || opening) {
      const projected=presentCombatEntries(state,state.log.filter(entry=>!seen.has(entry.id)))
        .filter(beat=>!beat.roll?.deathSave); // persistent death-save dialog owns this result
      // Player route trails may coalesce while input stays available. A batched
      // enemy turn retains every movement, turn boundary and action in order.
      const incoming=projected.some(beat=>beat.blocksInput!==false)
        ?projected:projected.slice(-1);
      if (incoming.length) setVisible(current => current ?? previous ?? opening);
      if(incoming.length&&playing?.blocksInput===false)setPlaying(null);
      const held = persistedRollPresentation(previous?.pendingD20Interrupt);
      if (held?.held && !persistedRollPresentation(state.pendingD20Interrupt)?.held) {
        // The confirmed phase belongs to the dialog already on screen, ahead
        // of unrelated queued movement/resource feedback. Do not remount it.
        const confirmation = incoming.filter(beat => beat.roll && beat.sourceId === held.command.actorId);
        const remainder = incoming.filter(beat => !confirmation.includes(beat));
        if (confirmation.length) setPlaying(null);
        setQueue(current=>groupCombatSaveBeats([...confirmation,...current.filter(beat=>beat.blocksInput!==false),...remainder]));
      } else if(incoming.length){
        setQueue(current=>groupCombatSaveBeats([...current.filter(beat=>beat.blocksInput!==false),...incoming]));
      }
    }
  }
  const next=queue[0];
  const pending=state?.world?.pendingResolution;
  // Let outstanding target decisions resolve before opening the shared result.
  // Do not block their controls (or the monster controller) while collecting.
  const collecting=next?.rollKind==='save' && pending?.type==='target_save'
    && pending.sourceActorId===next.sourceId
    && (next.actionId ? pending.actionId===next.actionId
      : state?.catalogActions.find(action=>action.id===pending.actionId)?.name===next.actionName);
  const combatRollMode=combatRollModeFor(settings,next?.audience);
  const initiative=opening&&!openingDone?opening:null;
  const advanceView=useCallback((beat:CombatBeat,phase:CombatPresentationPhase)=>{
    const key=`${beat.id}:${phase}`;
    if(appliedViewPhases.current.has(key))return;
    appliedViewPhases.current.add(key);
    setVisible(current=>current?applyCombatPresentationPhase(current,beat,phase):current);
  },[]);
  const playNext=useCallback(()=>{
    if (!next) return;
    const before=visible??state;
    const after=before?applyCombatPresentationPhase(before,next,'start'):null;
    const movementIds=new Set((next.saveRows??[next]).flatMap(row=>row.presentationChanges??[])
      .flatMap(change=>change.kind==='movement'?[change.actorId]:[]));
    setPlayingMovementDuration(before&&after?Math.max(0,...[...movementIds].map(actorId=>movementDurationForTransition(before,after,actorId))):0);
    advanceView(next,'start');
    setPlaying(next);
    setQueue(current=>current[0]?.id === next.id ? current.slice(1) : current);
  },[next,advanceView,visible,state]);
  useEffect(()=>{
    if(!collecting&&!initiative&&!playing&&next&&(!next.roll||combatRollMode==='skip'||combatRollMode==='field'))playNext();
  },[collecting,initiative,playing,next,combatRollMode,playNext]);
  useEffect(()=>{
    if(!playing)return;
    const rows=playing.saveRows??[playing];
    const field=combatRollModeFor(settings,playing.audience)==='field';
    const hasAttack=rows.some(row=>row.roll?.target?.type==='ac');
    const hasDice=rows.some(row=>row.damage?.some(packet=>packet.roll?.dice.length));
    const diceDuration=field&&hasAttack&&hasDice?3200:field&&hasAttack?2200:0;
    const movementOnly=rows.every(row=>!row.roll&&!row.cues.length&&!row.damage?.length
      && row.presentationChanges?.some(change=>change.kind==='movement')
      && row.presentationChanges.every(change=>change.kind==='movement'||change.kind==='log'));
    const reducedMotion=typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // A contextual approach keeps each committed step before its attack. The
    // decorative move profile must not add a pause after every 190ms step.
    // Both coalesced free movement and ordered approach use the renderer route.
    const animationDuration=movementOnly?0:Math.max(0,...rows.map(row=>row.presentationDurationMs
      ??(row.suppressAnimation?0:row.animation?.motion.durationMs??playing.animation?.motion.durationMs??0)));
    // Delivery/movement keeps its ordered contact checkpoint. Readable captions
    // have an independent renderer lifetime and never extend this queue.
    const duration=Math.max(diceDuration,reducedMotion?Math.min(animationDuration,240):animationDuration,
      reducedMotion?0:playingMovementDuration);
    const contact=Math.max(...rows.map(row=>combatAnimationTiming(row.suppressAnimation?undefined:row.animation,reducedMotion).contactMs));
    // HP and the delivery's visible impact share the existing CSS/audio marker.
    // The separately displayed field dice never reroll or alter this checkpoint.
    const impactDelay=movementOnly||playing.rollPhase==='before-reaction'?0:contact;
    const impactTimer=window.setTimeout(()=>advanceView(playing,'impact'),impactDelay);
    const timer=window.setTimeout(()=>{
      advanceView(playing,'end');
      setPlaying(null);
    },playing.rollPhase==='before-reaction'?0:Math.max(duration,impactDelay));
    return ()=>{window.clearTimeout(timer);window.clearTimeout(impactTimer);};
  },[playing,settings,advanceView,playingMovementDuration]);
  useEffect(()=>{
    if(!playing&&!queue.length&&!initiative)setVisible(null);
  },[playing,queue.length,initiative]);
  const displayState=state&&visible?combatPresentationView(state,visible):state;
  return {displayState,initiative,beat:!collecting&&!initiative&&!playing&&next?.roll&&combatRollMode!=='skip'&&combatRollMode!=='field'?next:undefined,
    playing,blocked:Boolean(initiative||(!collecting&&queue.some(beat=>beat.blocksInput!==false))||(playing&&playing.blocksInput!==false)),
    closeInitiative:useCallback(()=>setOpeningDone(true),[]),closeAttack:playNext};
}
