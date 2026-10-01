import { combatLogDetails, combatLogRecords, combatLogTone } from '../solo-combat/combatLog';
import type { SoloCombatState } from '../solo-combat/types';
import {armorClassTerminology} from '../utils/armorClassTerminology';
import { ChevronRight } from 'lucide-react';
import { withoutLegacyRunSuffix } from '../character/familiarLabels';

export default function CombatLogPanel({ state, onCollapse }: { state: SoloCombatState; onCollapse?: () => void }) {
  return (
    <aside className="combat-log" aria-label="Журнал боя">
      <div className="combat-log__heading"><h2>Журнал боя</h2>{onCollapse && <button type="button" className="combat-log-toggle" onClick={onCollapse} aria-label="Скрыть журнал боя"><ChevronRight size={18} /></button>}</div>
      {[...state.log].reverse().map((entry) => {
        const entryActor = state.world.actors[entry.actorId];
        const loggedName = (actorId: string) => (
          withoutLegacyRunSuffix(entry.actorNames?.[actorId] ?? state.world.actors[actorId]?.name ?? actorId)
        );
        const records = combatLogRecords(entry);
        const tone = combatLogTone(entry, state);
        return (
          <article key={entry.id} className={`combat-log-entry combat-log-entry--${tone}`} data-tone={tone}>
            <header>Раунд {entry.round} · {withoutLegacyRunSuffix(entry.actorNames?.[entry.actorId] ?? entryActor?.name ?? 'Участник')}</header>
            <p className="combat-log-entry__summary">{armorClassTerminology(entry.text.replaceAll(' · Забег', ''))}</p>
            {records.length > 0 && (
              <div className="combat-log-entry__events">
                {records.flatMap((record, recordIndex) => combatLogDetails(record, state).map((detail, detailIndex) => {
                  const targets = record.targetIds.map(loggedName);
                  const source = loggedName(record.sourceActorId);
                  return (
                    <div
                      key={`${recordIndex}:${record.ordinal}:${detailIndex}`}
                      className={`combat-log-detail combat-log-detail--${detail.kind}`}
                    >
                      <b>{armorClassTerminology(detail.label)}</b>
                      <span>{armorClassTerminology(detail.text)}</span>
                      {(targets.length > 0 || record.sourceActorId !== entry.actorId) && (
                        <small>{source}{targets.length ? ` → ${targets.join(', ')}` : ''}</small>
                      )}
                      {detail.roll?.dice.length ? (
                        <ul className="combat-log-dice" aria-label="Кости броска">
                          {detail.roll.dice.map((die, dieIndex) => (
                            <li key={`${dieIndex}:${die.sides}:${die.result}`} className={die.discarded ? 'is-discarded' : ''}>
                              к{die.sides}: {die.result}{die.source ? ` · ${die.source}` : ''}{die.discarded ? ' · отброшено' : ''}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  );
                }))}
              </div>
            )}
          </article>
        );
      })}
    </aside>
  );
}
