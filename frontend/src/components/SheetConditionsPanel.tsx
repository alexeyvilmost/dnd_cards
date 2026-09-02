/**
 * Состояния персонажа: активные condition-эффекты (наложенные механикой или
 * вручную) с правилами 2024 в подсказке; ручное наложение/снятие.
 * Модификаторы состояний подтягиваются в броски через collectRollModifiers.
 */
import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { EncounterApply } from '../battle/encountersApi';
import { certifiedConditionEffectEntity } from '../api/conditionsApi';
import { persistDetachedManualEffects } from '../character/manualEffectPersistence';
import { forgeToRuntimeState } from '../character/runtime';
import {
  assertManualEffectMutationAllowed,
  manualEffectMutationBlockReason,
} from '../character/manualEffectMutationPolicy';
import type { ForgeCharacter } from '../character/types';
import {
  conditionLevel,
  conditionOptions,
  conditionStacking,
} from '../engine/conditions';
import { groupActiveEffectsForDisplay } from '../engine/effects';
import { deniedCapabilities } from '../engine/modifiers';
import {
  applyEffectCommandFromEntity,
  collectConditionImmunitiesFromPassives,
  conditionRequiresSourceActor,
  executeManualEffectCommand,
  nextBrowserManualEffectId,
} from '../engine/manualEffectCommands';
import type { EngineEvent } from '../mvp/contracts';
import ActiveEffectCard from './ActiveEffectCard';

interface Props {
  character: ForgeCharacter;
  onUpdated: (c: ForgeCharacter) => void;
  onEvents?: (events: EngineEvent[]) => void;
  passives: Record<string, unknown>[];
  embedded?: boolean;
  encounterApply?: EncounterApply;
}

export default function SheetConditionsPanel({ character, onUpdated, onEvents, passives, embedded }: Props) {
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState('poisoned');
  const [sourceActorId, setSourceActorId] = useState('');
  const [causeTags, setCauseTags] = useState('');
  const [error, setError] = useState<string | null>(null);

  const runtime = useMemo(() => forgeToRuntimeState(character), [character]);
  const conditions = runtime.activeEffects.filter(
    (e) => (e.mechanics as Record<string, unknown>)?.kind === 'condition',
  );
  const conditionGroups = groupActiveEffectsForDisplay(conditions);
  const activeValues = new Set(
    conditions.map((e) => String((e.mechanics as Record<string, unknown>).value ?? '')),
  );
  const immunityProjection = useMemo(() => {
    try {
      return { values: collectConditionImmunitiesFromPassives(passives), error: null };
    } catch (reason) {
      return {
        values: [],
        error: reason instanceof Error ? reason.message : 'Некорректные данные иммунитетов',
      };
    }
  }, [passives]);
  const conditionImmunities = immunityProjection.values;
  const mutationBlockReason = manualEffectMutationBlockReason(character.current_encounter_id);
  const pickedNeedsSource = conditionRequiresSourceActor(picked);
  const pickedEntity = certifiedConditionEffectEntity(picked);
  const pickedStacking = conditionStacking(picked);
  const pickedLevel = conditionLevel(runtime, picked);
  const pickedAtMaximum = pickedStacking.mode === 'binary'
    ? pickedLevel > 0
    : pickedStacking.max != null && pickedLevel >= pickedStacking.max;

  const persist = async (
    activeEffects: typeof runtime.activeEffects,
    events: EngineEvent[],
    endsConcentration = false,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await persistDetachedManualEffects(character, activeEffects, { endsConcentration });
      onUpdated(updated);
      if (events.length) onEvents?.(events);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Не удалось изменить состояние');
    } finally {
      setBusy(false);
    }
  };

  const applyCondition = () => {
    if (pickedAtMaximum) return;
    try {
      assertManualEffectMutationAllowed(character.current_encounter_id);
      if (!pickedEntity) {
        throw new Error('Сертифицированная карточка состояния из БД недоступна; изменение запрещено');
      }
      const command = applyEffectCommandFromEntity(
        pickedEntity,
        'manual:sheet_conditions',
        {
          ownerActorId: character.id,
          conditionImmunities,
          causeTags: causeTags.split(',').map((tag) => tag.trim()).filter(Boolean),
          ...(sourceActorId.trim() ? { sourceActorId: sourceActorId.trim() } : {}),
        },
      );
      const result = executeManualEffectCommand(runtime, command, {
        nextId: nextBrowserManualEffectId,
      });
      void persist(
        result.state.activeEffects,
        result.events,
        deniedCapabilities(result.state, passives).has('concentration'),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось наложить состояние');
    }
  };

  const removeConditions = (ids: readonly string[]) => {
    try {
      assertManualEffectMutationAllowed(character.current_encounter_id);
      let state = runtime;
      const events: EngineEvent[] = [];
      for (const id of ids) {
        const result = executeManualEffectCommand(state, {
          type: 'RemoveEffect',
          effectId: id,
          ownerActorId: character.id,
          provenance: 'manual:sheet_conditions',
        }, { nextId: nextBrowserManualEffectId });
        state = result.state;
        events.push(...result.events);
      }
      void persist(
        state.activeEffects,
        events,
        deniedCapabilities(state, passives).has('concentration'),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось снять состояние');
    }
  };

  const body = (
    <>
      {error && <p className="issues" role="alert">{error}</p>}
      {conditions.length === 0 && (
        <p className="forge-note">Нет активных состояний.</p>
      )}
      {conditions.length > 0 && (
        <ul className="sheet-conditions">
          {conditionGroups.map((group) => {
            return (
              <li key={group.key} className="sheet-condition">
                <ActiveEffectCard group={group} actions={<button
                  type="button"
                  className="sheet-active-effect-dismiss"
                  disabled={busy || Boolean(mutationBlockReason)}
                  title={mutationBlockReason ?? 'Снять состояние'}
                  onClick={() => removeConditions(group.effects.map((effect) => effect.id))}
                >
                  <X size={13} />
                </button>} />
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
          {conditionOptions().map((o) => {
            const stacking = conditionStacking(o.id);
            const level = conditionLevel(runtime, o.id);
            const unavailable = stacking.mode === 'binary'
              ? activeValues.has(o.id)
              : stacking.max != null && level >= stacking.max;
            return (
              <option key={o.id} value={o.id} disabled={unavailable}>
                {o.label}{stacking.mode === 'levels' ? ` (${level}/${stacking.max ?? '∞'})` : ''}
              </option>
            );
          })}
        </select>
        <button
          type="button"
          className="forge-btn ghost sheet-roll-btn"
          disabled={busy || Boolean(mutationBlockReason) || !pickedEntity || !!immunityProjection.error || pickedAtMaximum || (pickedNeedsSource && !sourceActorId.trim())}
          onClick={applyCondition}
        >
          <Plus size={14} /> Наложить
        </button>
      </div>
      {!pickedEntity && (
        <p className="issues" role="alert">
          Состояния доступны только для просмотра: сертифицированный каталог БД не загружен.
        </p>
      )}
      {mutationBlockReason && (
        <p className="issues" role="alert">{mutationBlockReason}</p>
      )}
      {immunityProjection.error && (
        <p className="issues" role="alert">
          Изменение запрещено: {immunityProjection.error}
        </p>
      )}
      {pickedNeedsSource && (
        <label className="forge-note">
          ID источника состояния (обязательно для реляционных правил)
          <input
            className="forge-input"
            value={sourceActorId}
            onChange={(event) => setSourceActorId(event.target.value)}
            placeholder="ID персонажа или участника боя"
          />
        </label>
      )}
      <label className="forge-note">
        Теги причины (если применимы, через запятую)
        <input
          className="forge-input"
          value={causeTags}
          onChange={(event) => setCauseTags(event.target.value)}
          placeholder="например: magical, sleep"
        />
      </label>
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
