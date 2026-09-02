import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { EncounterApply } from '../battle/encountersApi';
import { persistCharacterRuntime } from '../character/runtimePersistence';
import { persistDetachedManualEffects } from '../character/manualEffectPersistence';
import {
  assertManualEffectMutationAllowed,
  manualEffectMutationBlockReason,
} from '../character/manualEffectMutationPolicy';
import type { AssembledCharacter } from '../character/assemble';
import {
  buildCharacterContext,
  alignRuntimeHp,
  forgeToRuntimeState,
} from '../character/runtime';
import {
  buildResourceRuntimePatch,
  hpNeedsSync,
  resourcesNeedSync,
  resourceMaximumBreakdown,
  syncRuntimeResources,
} from '../character/resourceInit';
import type { ForgeCharacter } from '../character/types';
import type { CharacterRuleState } from '../character/rules/types';
import { buildResourceRecharge, buildResourceRecovery } from '../engine/resources';
import { collectFreeuseRecharge, isFreeusePoolKey } from '../engine/freeuse';
import { groupActiveEffectsForDisplay } from '../engine/effects';
import {
  executeManualEffectCommand,
  nextBrowserManualEffectId,
} from '../engine/manualEffectCommands';
import FreeuseSpellsTile from './FreeuseSpellsTile';
import type { EngineEvent } from '../mvp/contracts';
import type { CharacterEventRow } from '../character/api';
import { findResource, useResourceOptions } from '../utils/resources';
import SheetRestButtons from './SheetRestButtons';
import SheetResourceTile, { sheetResourceTileOrder } from './SheetResourceTile';
import ActiveEffectCard from './ActiveEffectCard';
import BoonActivationDialog from './BoonActivationDialog';
import { armBoonForNextRoll, runtimeBoonSpec, type RuntimeBoonSpec } from '../engine/boons';
import type { Card } from '../types';

interface Props {
  character: ForgeCharacter;
  assembled: AssembledCharacter;
  ruleState: CharacterRuleState;
  onUpdated: (c: ForgeCharacter) => void;
  onEvents?: (events: EngineEvent[]) => void;
  onPersistedEvents?: (rows: CharacterEventRow[]) => void;
  onLongRestComplete?: () => void;
  encounterApply?: EncounterApply;
  combatLocked?: boolean;
  itemCards?: readonly Card[];
}

export default function SheetRuntimePanel({ character, assembled, ruleState, onUpdated, onEvents, onPersistedEvents, onLongRestComplete, encounterApply, combatLocked, itemCards = [] }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedBoon, setSelectedBoon] = useState<RuntimeBoonSpec | null>(null);
  const syncAttempted = useRef(false);
  const resourceOptions = useResourceOptions();

  const resourceRecharge = useMemo(
    () => ({
      ...buildResourceRecharge((assembled.klass?.resources ?? null) as Record<string, unknown> | null),
      ...collectFreeuseRecharge(ruleState.freeuseSpells),
    }),
    [assembled.klass?.resources, ruleState.freeuseSpells],
  );
  const resourceRecovery = useMemo(
    () => buildResourceRecovery((assembled.klass?.resources ?? null) as Record<string, unknown> | null),
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
      resourceRecovery,
    }),
    [ruleState, character.level, character.abilities, assembled.klass, resourceRecharge, resourceRecovery],
  );

  const runtime = useMemo(
    () => alignRuntimeHp(forgeToRuntimeState(character), ruleState.maxHP),
    [character, ruleState.maxHP],
  );
  const activeEffectGroups = useMemo(
    () => groupActiveEffectsForDisplay(runtime.activeEffects),
    [runtime.activeEffects],
  );
  const effectMutationBlockReason = manualEffectMutationBlockReason(character.current_encounter_id);

  const resourceBreakdowns = useMemo(
    () => syncRuntimeResources(ctx, assembled, runtime, ruleState.freeuseSpells, itemCards).sources,
    [ctx, assembled, runtime, ruleState.freeuseSpells, itemCards],
  );

  const persistManualEffects = useCallback(async (
    activeEffects: typeof runtime.activeEffects,
    events: EngineEvent[],
  ) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await persistDetachedManualEffects(character, activeEffects);
      onUpdated(updated);
      onEvents?.(events);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Не удалось сохранить состояние');
    } finally {
      setBusy(false);
    }
  }, [character, onUpdated, onEvents]);

  const syncResources = useCallback(async (force = false) => {
    const patch = buildResourceRuntimePatch(character, ctx, assembled, force, ruleState.maxHP, ruleState.freeuseSpells, itemCards);
    if (!patch) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await persistCharacterRuntime(character, patch, encounterApply);
      onUpdated(updated);
    } catch (e) {
      console.error(e);
      setError('Не удалось синхронизировать ресурсы');
    } finally {
      setBusy(false);
    }
  }, [character, ctx, assembled, encounterApply, onUpdated, ruleState.maxHP, ruleState.freeuseSpells, itemCards]);

  useEffect(() => {
    if (syncAttempted.current || (!resourcesNeedSync(character) && !hpNeedsSync(character, ruleState.maxHP))) return;
    syncAttempted.current = true;
    syncResources();
  }, [character, ruleState.maxHP, syncResources]);

  // Скрываем пустые пулы, счётчики использований действий (uses_*) и пулы freeuse
  // (freeuse-<spell>, рисуются витриной FreeuseSpellsRow; freeuse-spells не пул).
  const resourceKeys = useMemo(
    () => Object.keys(runtime.maxResources)
      .filter((k) => runtime.maxResources[k] > 0 && !k.startsWith('uses_') && !isFreeusePoolKey(k))
      .sort((a, b) => sheetResourceTileOrder(a, resourceOptions) - sheetResourceTileOrder(b, resourceOptions) || a.localeCompare(b)),
    [runtime.maxResources, resourceOptions],
  );

  const handleDismissEffect = (effectIds: readonly string[]) => {
    try {
      assertManualEffectMutationAllowed(character.current_encounter_id);
      let state = runtime;
      const events: EngineEvent[] = [];
      for (const effectId of effectIds) {
        const result = executeManualEffectCommand(state, {
          type: 'RemoveEffect',
          effectId,
          ownerActorId: character.id,
          provenance: 'manual:sheet_runtime',
        }, { nextId: nextBrowserManualEffectId });
        state = result.state;
        events.push(...result.events);
      }
      void persistManualEffects(state.activeEffects, events);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось снять эффект');
    }
  };

  const handleArmBoon = (
    rollKind: Parameters<typeof armBoonForNextRoll>[2],
    timing: Parameters<typeof armBoonForNextRoll>[3],
  ) => {
    if (!selectedBoon) return;
    try {
      assertManualEffectMutationAllowed(character.current_encounter_id);
      const state = armBoonForNextRoll(runtime, selectedBoon.effectId, rollKind, timing);
      setSelectedBoon(null);
      void persistManualEffects(state.activeEffects, []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось использовать эффект');
    }
  };

  return (
    <section className="sheet-panel">
      <h2 className="sheet-h2">Ресурсы и отдых</h2>
      {error && <p className="issues">{error}</p>}

      <div className="res-tile-row">
        {resourceKeys.map((key) => (
          <SheetResourceTile
            key={key}
            resourceId={key}
            option={findResource(resourceOptions, key)}
            current={runtime.resources[key] ?? 0}
            maximum={runtime.maxResources[key]}
            maximumBreakdown={resourceMaximumBreakdown(key, ctx, assembled, ruleState.freeuseSpells, runtime.maxResources[key])}
          />
        ))}
        <FreeuseSpellsTile
          runtime={runtime}
          freeuseSpells={ruleState.freeuseSpells}
          spells={assembled.spells}
          resourceOptions={resourceOptions}
          resourceSources={resourceBreakdowns}
        />
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
        onPersistedEvents={onPersistedEvents}
        onLongRestComplete={onLongRestComplete}
        encounterApply={encounterApply}
        disabledReason={combatLocked ? 'Управляйте ходами и отдыхом из активного боя' : undefined}
        itemCards={itemCards}
      />

      {activeEffectGroups.length > 0 && (
        <div className="sheet-group" style={{ marginTop: 12 }}>
          <h3 className="sheet-h3">Активные эффекты</h3>
          <ul className="sheet-active-effects">
            {activeEffectGroups.map((group) => (
              <li key={group.key} className="sheet-active-effect">
                <ActiveEffectCard group={group} actions={<>
                  {group.effects.map(runtimeBoonSpec).find(Boolean) && (
                    <button
                      type="button"
                      className="forge-btn ghost sheet-active-effect-use"
                      disabled={busy || Boolean(effectMutationBlockReason)}
                      onClick={() => setSelectedBoon(group.effects.map(runtimeBoonSpec).find(Boolean) ?? null)}
                    >
                      Использовать
                    </button>
                  )}
                  <button
                  type="button"
                  className="sheet-active-effect-dismiss"
                  disabled={busy || Boolean(effectMutationBlockReason)}
                  title={effectMutationBlockReason ?? 'Снять вручную'}
                  onClick={() => handleDismissEffect(group.effects.map((effect) => effect.id))}
                >
                  <X size={14} />
                  </button>
                </>} />
              </li>
            ))}
          </ul>
          {effectMutationBlockReason && (
            <p className="issues" role="alert">{effectMutationBlockReason}</p>
          )}
        </div>
      )}

      <p className="forge-note" style={{ marginTop: 8 }}>
        Короткий отдых: HP восстанавливаются только добровольной тратой костей хитов; также
        возвращаются заряды с recharge «короткий отдых». Долгий отдых полностью восстанавливает
        HP, кости хитов и заряды с recharge «долгий отдых».
      </p>
      <BoonActivationDialog
        boon={selectedBoon}
        busy={busy}
        onChoose={handleArmBoon}
        onClose={() => setSelectedBoon(null)}
      />
    </section>
  );
}
