import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import type { EngineEvent } from '../mvp/contracts';
import { describeEngineEvent, formatRollBreakdown } from '../engine/events';
import { useResourceOptions } from '../utils/resources';
import { resourceEventNode } from '../utils/eventDisplay';
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

const rowTime = (ts: string) => new Date(ts).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Одна строка журнала в текст (для копирования): время + сводка + разбивка броска. */
export function journalRowToText(row: JournalRow): string {
  const roll = rollFromEvent(row.payload);
  const detail = roll ? `\n  ${formatRollBreakdown(roll)}` : '';
  return `[${rowTime(row.ts)}] ${describeEngineEvent(row.payload)}${detail}`;
}
export const journalRowsToText = (rows: JournalRow[]): string => rows.map(journalRowToText).join('\n');

/** Копирование в буфер с fallback на execCommand (для не-HTTPS/старых окружений). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fallthrough */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

export default function EventJournal({ rows, emptyHint }: EventJournalProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const resourceOptions = useResourceOptions();

  const toggle = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  const doCopy = async (text: string, key: string) => {
    if (await copyText(text)) { setCopied(key); window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500); }
  };

  if (!rows.length) {
    return <p className="event-journal-empty">{emptyHint || 'Журнал пуст. Броски и действия появятся здесь.'}</p>;
  }

  return (
    <>
      <div className="event-journal-toolbar">
        <button type="button" className="event-journal-copyall" onClick={() => doCopy(journalRowsToText(rows), '__all__')}>
          {copied === '__all__' ? <Check size={13} /> : <Copy size={13} />}
          {copied === '__all__' ? 'Скопировано' : 'Скопировать всё'}
        </button>
      </div>
      <ul className="event-journal">
        {rows.map((row) => {
          const roll = rollFromEvent(row.payload);
          const isOpen = expanded[row.id];
          return (
            <li key={row.id} className="event-journal-item">
              <div className="event-journal-row">
                <button type="button" className="event-journal-head" onClick={() => toggle(row.id)}>
                  <span className="event-journal-time">{rowTime(row.ts)}</span>
                  {roll && (
                    <RollFlash value={roll.dice.find((d) => !d.discarded)?.result ?? roll.dice[0]?.result ?? 0} flashKey={row.id} />
                  )}
                  <span className="event-journal-summary">{resourceEventNode(row.payload, resourceOptions) ?? describeEngineEvent(row.payload)}</span>
                  {roll && <span className="event-journal-chevron">{isOpen ? '▾' : '▸'}</span>}
                </button>
                <button
                  type="button"
                  className="event-journal-copy"
                  title="Скопировать строку"
                  onClick={() => doCopy(journalRowToText(row), row.id)}
                >
                  {copied === row.id ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>
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
    </>
  );
}
