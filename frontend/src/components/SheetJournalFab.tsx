import { useEffect, useRef } from 'react';
import { Dices, X } from 'lucide-react';
import EventJournal, { type JournalRow } from './EventJournal';
import './SheetJournalFab.css';

interface SheetJournalFabProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: JournalRow[];
  loading?: boolean;
  onRollInitiative?: () => void;
  rollingInit?: boolean;
}

export default function SheetJournalFab({
  open,
  onOpenChange,
  rows,
  loading,
  onRollInitiative,
  rollingInit,
}: SheetJournalFabProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !bodyRef.current) return;
    const el = bodyRef.current;
    el.scrollTop = el.scrollHeight;
  }, [open, rows.length]);

  return (
    <div className="sheet-journal-fab-root">
      {open && (
        <div className="sheet-journal-popup" role="dialog" aria-label="Журнал действий">
          <div className="sheet-journal-popup-head">
            <h2 className="sheet-journal-popup-title">Журнал</h2>
            {onRollInitiative && (
              <button
                type="button"
                className="forge-btn ghost sheet-journal-popup-init"
                onClick={onRollInitiative}
                disabled={rollingInit}
                title="Бросок инициативы"
              >
                <Dices size={15} />
                {rollingInit ? '…' : 'Инициатива'}
              </button>
            )}
          </div>
          <div className="sheet-journal-popup-body" ref={bodyRef}>
            {loading ? (
              <p className="forge-note sheet-journal-popup-loading">Загрузка журнала…</p>
            ) : (
              <EventJournal rows={rows} />
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        className={`sheet-journal-fab${open ? ' open' : ''}`}
        onClick={() => onOpenChange(!open)}
        title={open ? 'Закрыть журнал' : 'Журнал действий'}
        aria-expanded={open}
        aria-label={open ? 'Закрыть журнал' : 'Открыть журнал'}
      >
        {open ? <X size={26} strokeWidth={2} /> : <D20Icon />}
      </button>
    </div>
  );
}

function D20Icon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden className="sheet-journal-d20">
      <path
        d="M12 2.5L3.5 8.2v7.6L12 21.5l8.5-5.7V8.2L12 2.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M12 2.5v19M3.5 8.2l8.5 4.5 8.5-4.5M3.5 15.8l8.5-4.5 8.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
