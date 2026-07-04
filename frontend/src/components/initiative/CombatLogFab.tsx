import React, { useEffect, useRef } from 'react';
import { BookOpen, X } from 'lucide-react';
import type { CombatLogEntry } from '../../utils/combatLog';
import CombatLogEntryView from './CombatLogEntryView';

interface CombatLogFabProps {
  entries: CombatLogEntry[];
  open: boolean;
  onToggle: () => void;
}

/**
 * Круглая кнопка-книжка в левом нижнем углу (#6): открывает журнал всех подсказок
 * стопкой (можно скроллить), повторное нажатие скрывает.
 */
const CombatLogFab: React.FC<CombatLogFabProps> = ({ entries, open, onToggle }) => {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [open, entries.length]);

  return (
    <div className="fixed bottom-4 left-4 z-40 flex flex-col items-start gap-3">
      {open && (
        <div className="flex max-h-[min(520px,70vh)] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
            <h2 className="text-sm font-semibold text-gray-900">Журнал боя</h2>
            <span className="text-xs text-gray-400">{entries.length}</span>
          </div>
          <div ref={bodyRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {entries.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">
                Журнал пуст. Броски атак и изменения HP появятся здесь.
              </p>
            ) : (
              entries.map((entry) => <CombatLogEntryView key={entry.id} entry={entry} />)
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onToggle}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-900 text-white shadow-lg transition-transform hover:-translate-y-0.5 hover:bg-gray-800"
        title={open ? 'Скрыть журнал' : 'Журнал боя'}
        aria-expanded={open}
      >
        {open ? <X size={24} /> : <BookOpen size={24} />}
      </button>
    </div>
  );
};

export default CombatLogFab;
