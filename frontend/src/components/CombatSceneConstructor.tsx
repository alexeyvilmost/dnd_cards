import { useEffect, useState } from 'react';
import { RefreshCcw, Save, X } from 'lucide-react';
import {
  refreshSoloCombatResources,
  setSoloCombatInitiativeTotals,
} from '../solo-combat/engine';
import { isControlledCharacter, type SoloCombatState } from '../solo-combat/types';

export default function CombatSceneConstructor({
  state,
  busy,
  onApply,
  onClose,
}: {
  state: SoloCombatState;
  busy: boolean;
  onApply: (state: SoloCombatState) => void;
  onClose: () => void;
}) {
  const [totals, setTotals] = useState<Record<string, number>>({});
  useEffect(() => {
    setTotals(Object.fromEntries(state.initiative.map((entry) => [entry.actorId, entry.total])));
  }, [state.initiative]);

  return <aside className="combat-scene-constructor" aria-label="Конструктор сцены">
    <header>
      <div><p>ТЕСТОВЫЕ ИНСТРУМЕНТЫ</p><h2>Конструктор сцены</h2></div>
      <button type="button" onClick={onClose} aria-label="Закрыть"><X /></button>
    </header>
    <p className="combat-scene-constructor__hint">Меняйте порядок хода и восстанавливайте ресурсы без пересоздания персонажей.</p>
    <div className="combat-scene-constructor__actors">
      {state.initiative.map((entry) => {
        const actor = state.world.actors[entry.actorId];
        const controlled = isControlledCharacter(state, entry.actorId);
        return <article key={entry.actorId}>
          <span className="combat-scene-constructor__token">{state.tokens[entry.actorId]?.tokenUrl ? <img src={state.tokens[entry.actorId].tokenUrl} alt="" /> : actor.name.slice(0, 1)}</span>
          <span><b>{actor.name}</b><small>{controlled ? 'Персонаж' : 'Противник'} · ресурсы {Object.values(actor.runtime.resources).filter((value) => Number(value) > 0).length}/{Object.keys(actor.runtime.maxResources).length}</small></span>
          <label>Инициатива<input type="number" min={-100} max={100} value={totals[entry.actorId] ?? entry.total} onChange={(event) => setTotals((current) => ({ ...current, [entry.actorId]: Number(event.target.value) }))} /></label>
          <button type="button" disabled={busy} onClick={() => onApply(refreshSoloCombatResources(state, entry.actorId))}><RefreshCcw size={15} /> Ресурсы</button>
        </article>;
      })}
    </div>
    <footer><button type="button" disabled={busy} onClick={() => onApply(setSoloCombatInitiativeTotals(state, totals))}><Save size={16} /> Применить инициативу</button></footer>
  </aside>;
}
