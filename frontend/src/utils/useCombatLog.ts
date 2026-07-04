import { useCallback, useEffect, useRef, useState } from 'react';
import type { CombatLogEntry } from './combatLog';

const TOAST_TTL_MS = 15_000;
const MAX_ENTRIES = 200;

/**
 * Лог боя: полная история (для журнала #6) + активные всплывающие подсказки (#5).
 * Каждая подсказка живёт 15 секунд.
 */
export function useCombatLog() {
  const [entries, setEntries] = useState<CombatLogEntry[]>([]);
  const [activeToastIds, setActiveToastIds] = useState<string[]>([]);
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
    },
    [],
  );

  const push = useCallback((entry: CombatLogEntry) => {
    setEntries((prev) => [...prev, entry].slice(-MAX_ENTRIES));
    setActiveToastIds((prev) => [...prev, entry.id]);
    const timer = window.setTimeout(() => {
      setActiveToastIds((prev) => prev.filter((id) => id !== entry.id));
    }, TOAST_TTL_MS);
    timers.current.push(timer);
  }, []);

  const clearToasts = useCallback(() => setActiveToastIds([]), []);

  // Активные подсказки в порядке появления (старые → новые).
  const activeToasts = entries.filter((e) => activeToastIds.includes(e.id));

  return { entries, activeToasts, push, clearToasts };
}
