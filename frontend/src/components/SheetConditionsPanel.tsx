/**
 * Состояния персонажа: активные condition-эффекты (наложенные механикой или
 * вручную) с правилами 2024 в подсказке; ручное наложение/снятие.
 * Модификаторы состояний подтягиваются в броски через collectRollModifiers.
 */
import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { charactersV3Api } from '../character/api';
import { forgeToRuntimeState } from '../character/runtime';
import type { ForgeCharacter } from '../character/types';
import { conditionOptions, conditionLabel, conditionRule } from '../engine/conditions';
import type { EngineEvent } from '../mvp/contracts';

interface Props {
  character: ForgeCharacter;
  onUpdated: (c: ForgeCharacter) => void;
  onEvents?: (events: EngineEvent[]) => void;
  embedded?: boolean;
}

export default function SheetConditionsPanel({ character, onUpdated, onEvents, embedded }: Props) {
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState('poisoned');

  const runtime = useMemo(() => forgeToRuntimeState(character), [character]);
  const conditions = runtime.activeEffects.filter(
    (e) => (e.mechanics as Record<string, unknown>)?.kind === 'condition',
  );
  const activeValues = new Set(
    conditions.map((e) => String((e.mechanics as Record<string, unknown>).value ?? '')),
  );

  const persist = async (activeEffects: typeof runtime.activeEffects, events: EngineEvent[]) => {
    setBusy(true);
    try {
      const updated = await charactersV3Api.patchRuntime(character.id, {
        active_effects: activeEffects,
        turn_state: { ...(character.turn_state ?? {}), temp_hp: runtime.hp.temp },
      });
      onUpdated(updated);
      if (events.length) onEvents?.(events);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const applyCondition = () => {
    if (activeValues.has(picked)) return;
    const rule = conditionRule(picked);
    const entry = {
      id: `cond-manual-${Date.now()}`,
      name: rule?.label ?? picked,
      mechanics: { kind: 'condition', value: picked, op: 'apply' },
      expiry: 'manual',
      source: 'вручную',
    };
    persist([...runtime.activeEffects, entry], [{ type: 'condition_applied', condition: rule?.label ?? picked }]);
  };

  const removeCondition = (id: string, name: string) => {
    persist(
      runtime.activeEffects.filter((e) => e.id !== id),
      [{ type: 'effect_expired', name }],
    );
  };

  const conditionTip = (value: string): string => {
    const rule = conditionRule(value);
    if (!rule) return '';
    const mods = rule.modifiers.map((m) => {
      const roll = m.applies_to.roll === 'attack' ? 'атаки'
        : m.applies_to.roll === 'saving_throw' ? 'спасброски' : 'проверки';
      const flt = m.applies_to.filter?.ability ? ` (${String(m.applies_to.filter.ability).toUpperCase()})` : '';
      return `${m.op === 'disadvantage' ? 'помеха' : m.op === 'advantage' ? 'преимущество' : m.value}: ${roll}${flt}`;
    });
    return [...mods, rule.note].filter(Boolean).join('\n');
  };

  const body = (
    <>
      {conditions.length === 0 && (
        <p className="forge-note">Нет активных состояний.</p>
      )}
      {conditions.length > 0 && (
        <ul className="sheet-conditions">
          {conditions.map((c) => {
            const value = String((c.mechanics as Record<string, unknown>).value ?? '');
            return (
              <li key={c.id} className="sheet-condition" title={conditionTip(value)}>
                <span className="sheet-condition-name">{conditionLabel(value)}</span>
                {c.source && c.source !== 'вручную' && (
                  <span className="sheet-condition-src">· {c.source}</span>
                )}
                <button
                  type="button"
                  className="sheet-active-effect-dismiss"
                  disabled={busy}
                  title="Снять состояние"
                  onClick={() => removeCondition(c.id, c.name)}
                >
                  <X size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="sheet-condition-add">
        <select
          className="forge-input"
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
        >
          {conditionOptions().map((o) => (
            <option key={o.id} value={o.id} disabled={activeValues.has(o.id)}>{o.label}</option>
          ))}
        </select>
        <button
          type="button"
          className="forge-btn ghost sheet-roll-btn"
          disabled={busy || activeValues.has(picked)}
          onClick={applyCondition}
        >
          <Plus size={14} /> Наложить
        </button>
      </div>
    </>
  );

  if (embedded) return body;

  return (
    <section className="sheet-panel">
      <h2 className="sheet-h2">Состояния</h2>
      {body}
    </section>
  );
}
