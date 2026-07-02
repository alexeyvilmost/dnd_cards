import { useCallback, useMemo, useState } from 'react';
import { Heart, HeartPulse, Minus, Plus, Shield } from 'lucide-react';
import { charactersV3Api } from '../character/api';
import { alignRuntimeHp, forgeToRuntimeState } from '../character/runtime';
import type { ForgeCharacter } from '../character/types';
import { applyDamage, applyHealing, applyTempHp } from '../engine/hp';
import ValueBreakdownTip from './ValueBreakdownTip';
import type { EngineEvent, RuntimeState, ValueBreakdown } from '../mvp/contracts';

interface Props {
  character: ForgeCharacter;
  maxHp: number;
  maxHpBreakdown?: ValueBreakdown | null;
  onUpdated: (c: ForgeCharacter) => void;
  onEvents?: (events: EngineEvent[]) => void;
}

function persistPayload(state: RuntimeState) {
  return {
    current_hp: state.hp.current,
    max_hp: state.hp.max,
    turn_state: { temp_hp: state.hp.temp },
  };
}

export default function SheetHpPanel({ character, maxHp, maxHpBreakdown, onUpdated, onEvents }: Props) {
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState(5);

  const runtime = useMemo(
    () => alignRuntimeHp(forgeToRuntimeState(character), maxHp),
    [character, maxHp],
  );
  const unconscious = runtime.hp.current <= 0;

  const apply = useCallback(async (next: RuntimeState, events: EngineEvent[]) => {
    setBusy(true);
    try {
      const updated = await charactersV3Api.patchRuntime(character.id, persistPayload(next));
      onUpdated(updated);
      onEvents?.(events);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }, [character.id, onUpdated, onEvents]);

  const mutate = (fn: (s: RuntimeState) => { state: RuntimeState; events: EngineEvent[] }) => {
    const { state, events } = fn(runtime);
    apply(state, events);
  };

  return (
    <section className="sheet-panel">
      <h2 className="sheet-h2">Хиты</h2>

      <div className="sheet-hp-display">
        <div className="sheet-hp-main">
          <Heart size={18} />
          <strong className={unconscious ? 'sheet-hp-unconscious' : ''}>
            {runtime.hp.current}
          </strong>
          {maxHpBreakdown ? (
            <ValueBreakdownTip breakdown={maxHpBreakdown} label="Максимум HP">
              <span>/ {maxHp}</span>
            </ValueBreakdownTip>
          ) : (
            <span>/ {maxHp}</span>
          )}
          {runtime.hp.temp > 0 && (
            <span className="sheet-hp-temp" title="Временные HP">
              <Shield size={14} /> +{runtime.hp.temp}
            </span>
          )}
        </div>
        {unconscious && <p className="sheet-hp-status">Без сознания</p>}
      </div>

      <div className="sheet-hp-controls">
        <input
          type="number"
          className="forge-input sheet-hp-amount"
          min={1}
          max={999}
          value={amount}
          onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 1))}
        />
        <button
          type="button"
          className="forge-btn ghost sheet-roll-btn"
          disabled={busy}
          onClick={() => mutate((s) => applyDamage(s, amount))}
        >
          <Minus size={14} /> Урон
        </button>
        <button
          type="button"
          className="forge-btn ghost sheet-roll-btn"
          disabled={busy}
          onClick={() => mutate((s) => applyHealing(s, amount))}
        >
          <HeartPulse size={14} /> Лечение
        </button>
        <button
          type="button"
          className="forge-btn ghost sheet-roll-btn"
          disabled={busy}
          onClick={() => mutate((s) => applyTempHp(s, amount))}
        >
          <Plus size={14} /> Temp HP
        </button>
      </div>
    </section>
  );
}
