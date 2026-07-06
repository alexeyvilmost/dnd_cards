import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { charactersV3Api } from '../character/api';
import type { AssembledCharacter } from '../character/assemble';
import { buildCharacterContext, alignRuntimeHp, forgeToRuntimeState } from '../character/runtime';
import {
  buildResourceRuntimePatch,
  hpNeedsSync,
  resourcesNeedSync,
} from '../character/resourceInit';
import type { ForgeCharacter } from '../character/types';
import type { CharacterRuleState } from '../character/rules/types';
import { buildResourceRecharge } from '../engine/resources';
import { expiryLabel, removeActiveEffect } from '../engine/effects';
import type { EngineEvent, RuntimeState } from '../mvp/contracts';
import { findResource, useResourceOptions } from '../utils/resources';
import SheetRestButtons from './SheetRestButtons';

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

// Каталог /charges/ пуст (см. utils/resources.ts) — такие пути считаем отсутствием картинки,
// чтобы action/bonus_action/reaction и статические заряды остались текстовыми чипами.
const usableImageUrl = (url?: string): string | undefined =>
  url && !url.startsWith('/charges/') ? url : undefined;

const CHARGE_ICON_SIZE = 22;
const MAX_CHARGE_ROW = 8;

export default function SheetRuntimePanel({ character, assembled, ruleState, onUpdated, onEvents }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const syncAttempted = useRef(false);
  const resourceOptions = useResourceOptions();

  const resourceRecharge = useMemo(
    () => buildResourceRecharge((assembled.klass?.resources ?? null) as Record<string, unknown> | null),
    [assembled.klass?.resources],
  );

  const ctx = useMemo(
    () => ({
      ...buildCharacterContext(
        ruleState,
        { level: character.level, abilities: character.abilities ?? {} },
        [],
        assembled.klass,
      ),
      resourceRecharge,
    }),
    [ruleState, character.level, character.abilities, assembled.klass, resourceRecharge],
  );

  const runtime = useMemo(
    () => alignRuntimeHp(forgeToRuntimeState(character), ruleState.maxHP),
    [character, ruleState.maxHP],
  );

  function persistPayload(state: RuntimeState) {
    return {
      current_hp: state.hp.current,
      max_hp: state.hp.max,
      resources: state.resources,
      max_resources: state.maxResources,
      active_effects: state.activeEffects,
      turn_state: { ...(character.turn_state ?? {}), temp_hp: state.hp.temp },
    };
  }

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
    const patch = buildResourceRuntimePatch(character, ctx, assembled, force, ruleState.maxHP);
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
  }, [character, ctx, assembled, onUpdated, ruleState.maxHP]);

  useEffect(() => {
    if (syncAttempted.current || (!resourcesNeedSync(character) && !hpNeedsSync(character, ruleState.maxHP))) return;
    syncAttempted.current = true;
    syncResources();
  }, [character, ruleState.maxHP, syncResources]);

  const resourceKeys = Object.keys(runtime.maxResources).filter((k) => runtime.maxResources[k] > 0);

  const handleDismissEffect = (effectId: string) => {
    const { state, events } = removeActiveEffect(runtime, effectId);
    apply(state, events);
  };

  return (
    <section className="sheet-panel">
      <h2 className="sheet-h2">Ресурсы и отдых</h2>
      {error && <p className="issues">{error}</p>}

      <div className="sheet-resource-chips">
        {resourceKeys.map((key) => {
          const option = findResource(resourceOptions, key);
          const label = option?.label || RESOURCE_LABELS[key] || key;
          const current = runtime.resources[key] ?? 0;
          const max = runtime.maxResources[key];
          const title = option?.description ? `${label} — ${option.description}` : label;
          const iconUrl = usableImageUrl(option?.imageUrl);

          if (!iconUrl) {
            return (
              <span key={key} className="sheet-resource-chip" title={title}>
                {label}: {current}/{max}
              </span>
            );
          }

          const chipStyle = { display: 'inline-flex', alignItems: 'center', gap: 4 } as const;

          if (max > MAX_CHARGE_ROW) {
            return (
              <span key={key} className="sheet-resource-chip" title={title} style={chipStyle}>
                <img
                  src={iconUrl}
                  alt=""
                  style={{ width: CHARGE_ICON_SIZE, height: CHARGE_ICON_SIZE, objectFit: 'contain' }}
                />
                {current}/{max}
              </span>
            );
          }

          const spentUrl = usableImageUrl(option?.imageUrlSpent);
          return (
            <span key={key} className="sheet-resource-chip" title={title} style={chipStyle}>
              {label}:
              {Array.from({ length: max }, (_, i) => {
                const spent = i >= current;
                return (
                  <img
                    key={i}
                    src={spent && spentUrl ? spentUrl : iconUrl}
                    alt={spent ? 'потрачено' : 'заряд'}
                    style={{
                      width: CHARGE_ICON_SIZE,
                      height: CHARGE_ICON_SIZE,
                      objectFit: 'contain',
                      ...(spent && !spentUrl ? { opacity: 0.25, filter: 'grayscale(1)' } : null),
                    }}
                  />
                );
              })}
            </span>
          );
        })}
        {!resourceKeys.length && (
          <p className="forge-note">
            Ресурсы не инициализированы.{' '}
            <button type="button" className="sheet-link-btn" disabled={busy} onClick={() => syncResources(true)}>
              Синхронизировать
            </button>
          </p>
        )}
      </div>

      <SheetRestButtons
        character={character}
        assembled={assembled}
        ruleState={ruleState}
        onUpdated={onUpdated}
        onEvents={onEvents}
      />

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

      <p className="forge-note" style={{ marginTop: 8 }}>
        Короткий отдых: +50% от максимума HP и восстановление зарядов умений с recharge «короткий отдых». Длинный отдых: полное HP и все ресурсы.
      </p>
    </section>
  );
}
