import { useState } from 'react';
import type { EngineEvent } from '../mvp/contracts';
import { describeEngineEvent, formatRollBreakdown } from '../engine/events';
import RollFlash from './RollFlash';
import './EventJournal.css';

export interface JournalRow {
  id: string;
  ts: string;
  type: string;
  payload: EngineEvent;
}

interface EventJournalProps {
  rows: JournalRow[];
  emptyHint?: string;
}

function rollFromEvent(event: EngineEvent) {
  if (event.type === 'roll') return event.roll;
  if (event.type === 'damage' && event.roll) return event.roll;
  if (event.type === 'healing' && event.roll) return event.roll;
  return null;
}

export default function EventJournal({ rows, emptyHint }: EventJournalProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  if (!rows.length) {
    return <p className="event-journal-empty">{emptyHint || 'Журнал пуст. Броски и действия появятся здесь.'}</p>;
  }

  return (
    <ul className="event-journal">
      {rows.map((row) => {
        const roll = rollFromEvent(row.payload);
        const isOpen = expanded[row.id];
        const time = new Date(row.ts).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        return (
          <li key={row.id} className="event-journal-item">
            <button type="button" className="event-journal-head" onClick={() => toggle(row.id)}>
              <span className="event-journal-time">{time}</span>
              {roll && (
                <RollFlash value={roll.dice.find((d) => !d.discarded)?.result ?? roll.dice[0]?.result ?? 0} flashKey={row.id} />
              )}
              <span className="event-journal-summary">{describeEngineEvent(row.payload)}</span>
              {roll && <span className="event-journal-chevron">{isOpen ? '▾' : '▸'}</span>}
            </button>
            {roll && isOpen && (
              <div className="event-journal-detail">
                <p>{formatRollBreakdown(roll)}</p>
                {roll.dice.some((d) => d.discarded) && (
                  <ul className="event-journal-dice">
                    {roll.dice.map((d, i) => (
                      <li key={i} className={d.discarded ? 'discarded' : ''}>
                        к{d.sides}: {d.result}{d.discarded ? ' (отброшено)' : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
