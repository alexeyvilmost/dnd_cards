import {createContext, useCallback, useContext, useEffect, useId, useMemo, type ReactNode} from 'react';
import {soundPlayer} from '../audio/player';

type VisualStart = () => void;
const DiceStageContext = createContext<VisualStart | null>(null);

function useStageStart(rollKey: string, diceCount: number): VisualStart {
  const instance = useId();
  const stage = useMemo(() => ({started: false, active: true}), [rollKey]);
  useEffect(() => {
    stage.active = true;
    return () => { stage.active = false; };
  }, [stage]);
  return useCallback(() => {
    if (stage.started || !stage.active) return;
    stage.started = true;
    // All successful first draws happen before this microtask. A cancelled or
    // unmounted stage cannot leave a sound behind, including in StrictMode.
    queueMicrotask(() => {
      if (stage.active && !document.hidden) soundPlayer.playDefault(diceCount > 1 ? 'diceRoll' : 'diceSingle', `dice:${instance}:${rollKey}`);
    });
  }, [stage, diceCount, instance, rollKey]);
}

/** A visual throw may contain many dice, but owns one sound event. */
export default function DiceStage({rollKey, diceCount, independent = false, children}: {
  rollKey: string; diceCount: number; independent?: boolean; children: ReactNode;
}) {
  const parent = useContext(DiceStageContext);
  const start = useStageStart(rollKey, diceCount);
  return <DiceStageContext.Provider value={!independent && parent ? parent : start}>{children}</DiceStageContext.Provider>;
}

export function useDiceVisualStart(rollKey: string): VisualStart {
  const group = useContext(DiceStageContext);
  const single = useStageStart(rollKey, 1);
  return group ?? single;
}
