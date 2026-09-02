import { combatLogDetails, combatLogRecords, combatLogTone } from '../solo-combat/combatLog';
import type { SoloCombatState } from '../solo-combat/types';

export default function CombatLogPanel({ state }: { state: SoloCombatState }) {
  return (
    <aside className="combat-log" aria-label="Журнал боя">
      <h2>Журнал боя</h2>
      {[...state.log].reverse().map((entry) => {
        const entryActor = state.world.actors[entry.actorId];
        const loggedName = (actorId: string) => (
          entry.actorNames?.[actorId] ?? state.world.actors[actorId]?.name ?? actorId
        );
        const records = combatLogRecords(entry);
        const tone = combatLogTone(entry, state);
        return (
          <article key={entry.id} className={`combat-log-entry combat-log-entry--${tone}`} data-tone={tone}>
            <header>Раунд {entry.round} · {entry.actorNames?.[entry.actorId] ?? entryActor?.name ?? 'Участник'}</header>
            <p className="combat-log-entry__summary">{entry.text}</p>
            {records.length > 0 && (
              <div className="combat-log-entry__events">
                {records.flatMap((record) => combatLogDetails(record, state).map((detail, detailIndex) => {
                  const targets = record.targetIds.map(loggedName);
                  const source = loggedName(record.sourceActorId);
                  return (
                    <div
                      key={`${record.ordinal}:${detailIndex}`}
                      className={`combat-log-detail combat-log-detail--${detail.kind}`}
                    >
                      <b>{detail.label}</b>
                      <span>{detail.text}</span>
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
