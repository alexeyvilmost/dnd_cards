import React from 'react';
import type { CombatLogEntry } from '../../utils/combatLog';
import CombatLogEntryView from './CombatLogEntryView';

interface CombatToastsProps {
  /** Активные подсказки в порядке появления (старые → новые). */
  toasts: CombatLogEntry[];
}

/**
 * Стек всплывающих подсказок в правом нижнем углу (#5).
 * Новая появляется снизу, прежние поднимаются вверх и теряют по 20% непрозрачности.
 */
const CombatToasts: React.FC<CombatToastsProps> = ({ toasts }) => {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex w-[min(360px,calc(100vw-2rem))] flex-col items-stretch gap-2">
      {toasts.map((entry, index) => {
        const newerCount = toasts.length - 1 - index;
        const opacity = Math.max(0.2, 1 - 0.2 * newerCount);
        return (
          <div
            key={entry.id}
            className="pointer-events-auto transition-opacity duration-300"
            style={{ opacity }}
          >
            <CombatLogEntryView entry={entry} />
          </div>
        );
      })}
    </div>
  );
};

export default CombatToasts;
