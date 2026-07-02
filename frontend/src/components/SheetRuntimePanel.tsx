import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Moon, Shield, Sun, Swords, X } from 'lucide-react';
import { charactersV3Api } from '../character/api';
import type { AssembledCharacter } from '../character/assemble';
import { buildCharacterContext, forgeToRuntimeState } from '../character/runtime';
import {
  buildResourceRuntimePatch,
  collectPassiveMechanics,
  resourcesNeedSync,
} from '../character/resourceInit';
import { STANDARD_DODGE } from '../character/standardActions';
import type { ForgeCharacter } from '../character/types';
import type { CharacterRuleState } from '../character/rules/types';
import { canPay } from '../engine/cost';
import { expiryLabel, removeActiveEffect } from '../engine/effects';
import { executeAction } from '../engine/execute';
import { longRest, shortRest, startTurn } from '../engine/turn';
import type { Action } from '../types';
import type { EngineEvent, RuntimeState } from '../mvp/contracts';

interface Props {
  character: ForgeCharacter;
  assembled: AssembledCharacter;
  ruleState: CharacterRuleState;
  onUpdated: (c: ForgeCharacter) => void;
  onEvents?: (events: EngineEvent[]) => void;
}

const RESOURCE_LABELS: Record<string, string> = {
  action: 'Действие',
  bonus_action: 'Бонус',
  reaction: 'Реакция',
  second_wind: 'Второе дыхание',
  heroic_inspiration: 'Вдохновение',
};

type CombatAction = {
  id: string;
  name: string;
  mechanics: Record<string, unknown>;
};

function persistPayload(state: RuntimeState) {
  return {
    current_hp: state.hp.current,
    max_hp: state.hp.max,
    resources: state.resources,
    max_resources: state.maxResources,
    active_effects: state.activeEffects,
  };
}

function actionMechanics(action: Action): Record<string, unknown> | null {
  const mech = action.mechanics;
  if (!mech || typeof mech !== 'object') return null;
  const activation = mech.activation as Record<string, unknown> | undefined;
  if (activation?.mode !== 'active') return null;
  const cost = activation.cost as unknown[] | undefined;
  if (!Array.isArray(cost) || !cost.length) return null;
  return mech as Record<string, unknown>;
}

function collectCombatActions(assembled: AssembledCharacter): CombatAction[] {
  const fromEntities: CombatAction[] = assembled.actions
    .map(({ action }) => {
      const mechanics = actionMechanics(action);
      if (!mechanics) return null;
      return { id: action.id, name: action.name, mechanics };
    })
    .filter((a): a is CombatAction => a != null);

  return [
    { id: 'standard-dodge', name: STANDARD_DODGE.name, mechanics: { ...STANDARD_DODGE.mechanics, name: STANDARD_DODGE.name } },
    ...fromEntities,
  ];
}

export default function SheetRuntimePanel({ character, assembled, ruleState, onUpdated, onEvents }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const syncAttempted = useRef(false);

  const passives = useMemo(() => collectPassiveMechanics(assembled), [assembled]);

  const ctx = useMemo(
    () => buildCharacterContext(
      ruleState,
      { level: character.level, abilities: character.abilities ?? {} },
      [],
      assembled.klass,
    ),
    [ruleState, character.level, character.abilities, assembled.klass],
  );

  const runtime = useMemo(() => forgeToRuntimeState(character), [character]);

  const combatActions = useMemo(() => collectCombatActions(assembled), [assembled]);

  const apply = useCallback(async (next: RuntimeState, events: EngineEvent[]) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await charactersV3Api.patchRuntime(character.id, persistPayload(next));
      onUpdated(updated);
      onEvents?.(events);
    } catch (e) {
      console.error(e);
      setError('Не удалось сохранить состояние');
    } finally {
      setBusy(false);
    }
  }, [character.id, onUpdated, onEvents]);

  const syncResources = useCallback(async (force = false) => {
    const patch = buildResourceRuntimePatch(character, ctx, assembled, force);
    if (!patch) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await charactersV3Api.patchRuntime(character.id, patch);
      onUpdated(updated);
    } catch (e) {
      console.error(e);
      setError('Не удалось синхронизировать ресурсы');
    } finally {
      setBusy(false);
    }
  }, [character, ctx, assembled, onUpdated]);

  useEffect(() => {
    if (syncAttempted.current || !resourcesNeedSync(character)) return;
    syncAttempted.current = true;
    syncResources();
  }, [character, syncResources]);

  const resourceKeys = Object.keys(runtime.maxResources).filter((k) => runtime.maxResources[k] > 0);

  const restCtx = useMemo(() => ({ ...ctx, passives }), [ctx, passives]);

  const handleStartTurn = () => {
    const { state, events } = startTurn(runtime);
    apply(state, events);
  };

  const handleShortRest = () => {
    const { state, events } = shortRest(runtime, restCtx);
    apply(state, events);
  };

  const handleLongRest = () => {
    const { state, events } = longRest(runtime, restCtx);
    apply(state, events);
  };

  const handleUseAction = (action: CombatAction) => {
    const mech = { ...action.mechanics, name: action.name };
    const activation = mech.activation as Record<string, unknown> | undefined;
    const cost = (activation?.cost as Record<string, unknown>[]) ?? [];
    if (cost.length && !canPay(runtime, cost).ok) return;

    const { state, events } = executeAction(runtime, mech, {
      character: ctx,
      rng: () => Math.random(),
    });
    apply(state, events);
  };

  const handleDismissEffect = (effectId: string) => {
    const { state, events } = removeActiveEffect(runtime, effectId);
    apply(state, events);
  };

  const isActionDisabled = (action: CombatAction): boolean => {
    const activation = action.mechanics.activation as Record<string, unknown> | undefined;
    const cost = (activation?.cost as Record<string, unknown>[]) ?? [];
    if (!cost.length) return busy;
    return busy || !canPay(runtime, cost).ok;
  };

  return (
    <section className="sheet-panel">
      <h2 className="sheet-h2">Ресурсы и отдых</h2>
      {error && <p className="issues">{error}</p>}

      <div className="sheet-resource-chips">
        {resourceKeys.map((key) => (
          <span key={key} className="sheet-resource-chip" title={key}>
            {RESOURCE_LABELS[key] ?? key}: {runtime.resources[key] ?? 0}/{runtime.maxResources[key]}
          </span>
        ))}
        {!resourceKeys.length && (
          <p className="forge-note">
            Ресурсы не инициализированы.{' '}
            <button type="button" className="sheet-link-btn" disabled={busy} onClick={() => syncResources(true)}>
              Синхронизировать
            </button>
          </p>
        )}
      </div>

      <div className="sheet-runtime-actions">
        <button type="button" className="forge-btn ghost sheet-roll-btn" disabled={busy} onClick={handleStartTurn}>
          <Swords size={14} /> Новый ход
        </button>
        <button type="button" className="forge-btn ghost sheet-roll-btn" disabled={busy} onClick={handleShortRest} title="Короткий отдых: +50% HP, ресурсы short_rest">
          <Sun size={14} /> Короткий отдых
        </button>
        <button type="button" className="forge-btn ghost sheet-roll-btn" disabled={busy} onClick={handleLongRest}>
          <Moon size={14} /> Длинный отдых
        </button>
      </div>

      {runtime.activeEffects.length > 0 && (
        <div className="sheet-group" style={{ marginTop: 12 }}>
          <h3 className="sheet-h3">Активные эффекты</h3>
          <ul className="sheet-active-effects">
            {runtime.activeEffects.map((fx) => (
              <li key={fx.id} className="sheet-active-effect">
                <span className="sheet-active-effect-name">{fx.name}</span>
                <span className="sheet-active-effect-meta">{expiryLabel(fx.expiry)}</span>
                <button
                  type="button"
                  className="sheet-active-effect-dismiss"
                  disabled={busy}
                  title="Снять вручную"
                  onClick={() => handleDismissEffect(fx.id)}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="sheet-group" style={{ marginTop: 12 }}>
        <h3 className="sheet-h3">Боевые действия</h3>
        <div className="sheet-combat-actions">
          {combatActions.map((action) => {
            const disabled = isActionDisabled(action);
            return (
              <button
                key={action.id}
                type="button"
                className={`forge-btn ghost sheet-combat-action${disabled ? ' sheet-combat-action-disabled' : ''}`}
                disabled={disabled}
                title={disabled ? 'Недостаточно ресурсов' : `Использовать: ${action.name}`}
                onClick={() => handleUseAction(action)}
              >
                {action.id === 'standard-dodge' ? <Shield size={14} /> : <Swords size={14} />}
                {action.name}
              </button>
            );
          })}
        </div>
      </div>

      <p className="forge-note" style={{ marginTop: 8 }}>
        Короткий отдых: +половина max HP (без костей хитов) и заряды умений с восстановлением «короткий отдых».
      </p>
    </section>
  );
}
