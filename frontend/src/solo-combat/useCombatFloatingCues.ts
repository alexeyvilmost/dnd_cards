import {useEffect, useRef, useState} from 'react';
import type {CombatBeat, CombatCue} from './presentation';
import {combatAnimationTiming} from './animationTiming';
import {useReducedMotion} from '../hooks/useReducedMotion';

export const COMBAT_CUE_DURATION_MS = 1800;
export interface CombatCueBatch {
  id: string;
  cues: CombatCue[];
  delayMs: number;
}

function cueBatch(beat: CombatBeat | null | undefined, reducedMotion: boolean): CombatCueBatch | null {
  if (!beat?.cues.length || beat.rollPhase === 'before-reaction') return null;
  const rows = beat.saveRows ?? [beat];
  return {id: beat.id, cues: beat.cues, delayMs: Math.max(0, ...rows.map(row =>
    combatAnimationTiming(row.suppressAnimation ? undefined : row.animation ?? beat.animation, reducedMotion).contactMs))};
}

/** Captions outlive their delivery without holding the gameplay queue. This
 * live renderer never reads history, applies rules or reschedules the same beat. */
export function useCombatFloatingCues(beat: CombatBeat | null | undefined): CombatCueBatch[] {
  const reducedMotion = useReducedMotion();
  const initial = useRef(cueBatch(beat, reducedMotion));
  const [batches, setBatches] = useState<CombatCueBatch[]>(() => initial.current ? [initial.current] : []);
  const seen = useRef(new Set(initial.current ? [initial.current.id] : []));
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const incoming = cueBatch(beat, reducedMotion);
    if (incoming && !seen.current.has(incoming.id)) {
      seen.current.add(incoming.id);
      setBatches(current => [...current, incoming]);
    }
  }, [beat, reducedMotion]);
  useEffect(() => {
    for (const batch of batches) if (!timers.current.has(batch.id)) {
      const timer = setTimeout(() => {
        timers.current.delete(batch.id);
        setBatches(current => current.filter(row => row.id !== batch.id));
      }, batch.delayMs + COMBAT_CUE_DURATION_MS);
      timers.current.set(batch.id, timer);
    }
  }, [batches]);
  useEffect(() => {
    const activeTimers = timers.current;
    return () => {for (const timer of activeTimers.values()) clearTimeout(timer); activeTimers.clear();};
  }, []);
  return batches;
}
