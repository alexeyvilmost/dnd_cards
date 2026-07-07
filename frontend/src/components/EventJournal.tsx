import { useState, type ReactNode } from 'react';
import type { EngineEvent } from '../mvp/contracts';
import { describeEngineEvent, formatRollBreakdown } from '../engine/events';
import { RESOURCE_ICONS, getResourceIconPath } from '../utils/damageTypes';
import { findResource, useResourceOptions } from '../utils/resources';
import RollFlash from './RollFlash';
import './EventJournal.css';

const RES_LABEL: Record<string, string> = Object.fromEntries(RESOURCE_ICONS.map((r) => [r.value, r.label]));

/** Ключ иконки ресурса: spell_slot_N → spell_slot, warlock_spell_slot_N → warlock_spell_slot. */
function resourceIconKey(key: string): string {
  if (/^spell_slot_\d+$/.test(key)) return 'spell_slot';
  if (/^warlock_spell_slot/.test(key)) return 'warlock_spell_slot';
  return key;
}

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
  const resourceOptions = useResourceOptions();

  const toggle = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  // Русское название + иконка ресурса (вместо английского id).
  const resourceView = (key: string): { label: string; icon: string } => {
    const def = findResource(resourceOptions, key);
    const slot = /^spell_slot_(\d+)$/.exec(key);
    const label = def?.label
      || RES_LABEL[key]
      || (slot ? `Ячейка ${slot[1]}-го круга` : /^warlock_spell_slot/.test(key) ? 'Ячейка колдуна' : key);
    const icon = def?.imageUrl && !def.imageUrl.startsWith('/charges/')
      ? def.imageUrl
      : getResourceIconPath(resourceIconKey(key));
    return { label, icon };
  };

  const hideImg = (e: React.SyntheticEvent<HTMLImageElement>) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; };

  // Событие траты/восстановления ресурса — с русским названием и иконкой.
  const resourceSummary = (e: EngineEvent): ReactNode | null => {
    if (e.type === 'resource_spent') {
      const { label, icon } = resourceView(e.resource);
      return <>Потрачено {label}<img className="event-journal-res-icon" src={icon} alt="" onError={hideImg} /> {e.amount} (осталось {e.remaining})</>;
    }
    if (e.type === 'resource_restored') {
      const { label, icon } = resourceView(e.resource);
      return <>Восстановлено {label}<img className="event-journal-res-icon" src={icon} alt="" onError={hideImg} /> +{e.amount} (сейчас {e.current})</>;
    }
    return null;
  };

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
              <span className="event-journal-summary">{resourceSummary(row.payload) ?? describeEngineEvent(row.payload)}</span>
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
