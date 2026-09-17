import {useEffect, useRef, useState, type CSSProperties} from 'react';
import {createCommittedDieRenderer} from './d20Renderer';
import {supportedDieSides} from './polyhedralGeometry';
import './CommittedD20.css';
import {soundPlayer} from '../audio/player';

export const D20_ROLL_DURATION_MS = 1450;
export const D20_SELECTION_DURATION_MS = 400;

/** Displays the authoritative roll on a real 20-faced mesh; never rerolls it. */
type DieProps = {value: number; rolling: boolean; discarded?: boolean; selectionPending?: boolean; critical?: 'success' | 'failure'; animateEffects?: boolean};
export default function CommittedD20(props: DieProps) { return <CommittedDie {...props} sides={20}/>; }

export function CommittedDie({value, rolling, sides, discarded = false, selectionPending = false, critical, animateEffects = true}: DieProps & {sides: number}) {
  useEffect(()=>{if(rolling)soundPlayer.play('dice.roll');},[rolling,value]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ReturnType<typeof createCommittedDieRenderer>>(null);
  const [unavailable, setUnavailable] = useState(false);
  const latest = useRef({value, progress: rolling ? 0 : 1});
  useEffect(() => {
    const surface = canvas.current;
    if (!surface) return;
    const initialize = () => {
      renderer.current?.dispose();
      try { renderer.current = supportedDieSides.some(n=>n===sides) ? createCommittedDieRenderer(surface, sides, available=>setUnavailable(!available)) : null; }
      catch { renderer.current = null; }
      setUnavailable(!renderer.current);
      renderer.current?.draw(latest.current.value, latest.current.progress);
    };
    initialize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      renderer.current?.draw(latest.current.value, latest.current.progress);
    });
    observer?.observe(surface);
    return () => {
      observer?.disconnect(); renderer.current?.dispose(); renderer.current = null;
    };
  }, [sides]);
  useEffect(() => {
    let frame = 0;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    const draw = (time: number) => {
      const progress = rolling && !reduced ? Math.min(1, (time - start) / D20_ROLL_DURATION_MS) : 1;
      latest.current = {value, progress};
      if (renderer.current && !renderer.current.draw(value, progress)) setUnavailable(true);
      if (progress < 1) frame = requestAnimationFrame(draw);
    };
    draw(start);
    return () => cancelAnimationFrame(frame);
  }, [value, rolling, sides]);
  const revealedDiscard = !rolling && !selectionPending && discarded;
  const revealedCritical = !rolling && !selectionPending && !discarded && sides===20 ? critical : undefined;
  return <div className={`committed-die${rolling ? ' is-rolling' : ''}${revealedDiscard ? ' is-discarded' : ''}${revealedCritical ? ` is-critical-${revealedCritical}${animateEffects ? ' has-critical-motion' : ''}` : ''}`}
    data-sides={sides} role="img" aria-label={rolling ? `Бросок к${sides}` : `к${sides}: ${value}${revealedDiscard ? ' — отброшено' : ''}`}>
    {revealedCritical && <span className="committed-critical-fx" aria-hidden="true"><i className="committed-critical-ring"/>{Array.from({length:8},(_,i)=><i key={i} className="committed-critical-spark" style={{'--spark-angle': `${i*45}deg`} as CSSProperties}/>)}</span>}
    <span className="committed-die-shadow" aria-hidden="true" />
    <canvas ref={canvas} className="committed-die-canvas" aria-hidden="true" />
    {unavailable && <span className="committed-die-fallback"><small>к{sides}</small>{rolling ? '…' : value}</span>}
  </div>;
}
