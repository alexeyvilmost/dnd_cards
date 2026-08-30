import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Moon, Sun, Swords } from 'lucide-react';
import type { EncounterApply } from '../battle/encountersApi';
import { charactersV3Api, type CharacterEventRow } from '../character/api';
import { persistCharacterRuntime } from '../character/runtimePersistence';
import { collectActionUsesRecharge, collectActionUsesRecovery } from '../character/actionSheet';
import type { AssembledCharacter } from '../character/assemble';
import { collectFreeuseRecharge } from '../engine/freeuse';
import {
  buildCharacterContext,
  alignRuntimeHp,
  forgeToRuntimeState,
  writeRulesEngineRuntimeTurnState,
} from '../character/runtime';
import {
  buildResourceRuntimePatch,
  collectPassiveMechanics,
} from '../character/resourceInit';
import type { ForgeCharacter } from '../character/types';
import type { CharacterRuleState } from '../character/rules/types';
import { buildResourceRecharge } from '../engine/resources';
import { hitDiceResourceKey, hitDieSides } from '../engine/resources';
import {
  endTurn,
  longRest,
  resolveTurnBoundaryOffers,
  shortRest,
  spendHitDie,
  startTurn,
} from '../engine/turn';
import { applySourceTurnBoundary } from '../engine/sourceTurnExpiry';
import { canPay } from '../engine/cost';
import { executeAction } from '../engine/execute';
import { describeMechanicsLine } from '../engine/describeMechanics';
import { emptyDeathSaves } from '../character/death';
import type { EngineEvent, ReactionOffer, RuntimeState } from '../mvp/contracts';
import { useDiceDialog } from '../contexts/DiceDialogContext';
import { useChoiceDialog } from '../contexts/ChoiceDialogContext';
import { useReactionPrompt } from '../contexts/ReactionPromptContext';
import {
  collectLongRestPreparationChoices,
  writeSheetSpellPreparation,
} from '../character/sheetSpellPreparation';
import {
  applySheetSlotRecoverySelections,
  collectSheetSlotRecoveryPolicies,
  slotRecoveryPickerState,
} from '../character/sheetRestDecisions';
import { clearSheetCombatSession } from '../character/sheetCombatSession';
import { writeSoloCombatState } from '../solo-combat/persistence';
import { fetchBasicActions } from '../character/basicActions';
import { getCardsIndex } from '../utils/cardsIndex';
import { loadSheetCombatParticipant } from '../character/sheetCombatTargetRuntime';
import { newSheetRuntimeCommandId } from '../character/sheetCombatSession';
import {
  persistedSourceTurnCharacterIds,
  prepareSheetNextTurnAtomicCommit,
} from '../character/sheetNextTurn';
import {
  commitPreparedSheetAtomicWorld,
  type PreparedSheetAtomicWorldCommit,
} from '../character/sheetAtomicWorldCommit';
import { commitSheetRuntimeCommand } from '../character/sheetRuntimeCommand';
import { sheetCompanionRetryPolicy } from '../character/sheetCompanionInteraction';

interface Props {
  character: ForgeCharacter;
  assembled: AssembledCharacter;
  ruleState: CharacterRuleState;
  onUpdated: (c: ForgeCharacter) => void;
  onEvents?: (events: EngineEvent[]) => void;
  /** Reconciles journal rows already persisted by an atomic turn transition. */
  onPersistedEvents?: (rows: CharacterEventRow[]) => void;
  compact?: boolean;
  /** Вызывается после успешного долгого отдыха (диалог действий отдыха). */
  onLongRestComplete?: () => void;
  encounterApply?: EncounterApply;
  disabledReason?: string;
}

/** Pure adapter used by the real sheet: action mechanics remain the authority. */
export function collectSheetActionUseRestPolicies(assembled: AssembledCharacter) {
  return {
    recharge: collectActionUsesRecharge(assembled),
    recovery: collectActionUsesRecovery(assembled),
  };
}

/** A rest starts a new timeline and cannot retain an old combat continuation. */
export function clearCombatContinuationsForRest(
  turnState: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return clearSheetCombatSession(writeSoloCombatState(turnState, null));
}

export default function SheetRestButtons({
  character,
  assembled,
  ruleState,
  onUpdated,
  onEvents,
  onPersistedEvents,
  compact,
  onLongRestComplete,
  encounterApply,
  disabledReason,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [shortRestDraft, setShortRestDraft] = useState<{ state: RuntimeState; events: EngineEvent[] } | null>(null);
  const [shortRestSelections, setShortRestSelections] = useState<Record<string, number[]>>({});
  const [shortRestError, setShortRestError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingAtomicTurn, setPendingAtomicTurn] = useState<PreparedSheetAtomicWorldCommit | null>(null);
  const syncAttempted = useRef(false);
  const diceDialog = useDiceDialog();
  const choiceDialog = useChoiceDialog();
  const reactionPrompt = useReactionPrompt();
  const soloCombat = character.turn_state?.solo_combat_v1;
  const activeSoloCombat = Boolean(soloCombat && typeof soloCombat === 'object'
    && !Array.isArray(soloCombat)
    && (soloCombat as Record<string, unknown>).outcome === 'active');
  const lockReason = disabledReason ?? (character.current_encounter_id || activeSoloCombat
    ? 'Персонаж находится в бою: управляйте ходом и отдыхом на поле'
    : undefined);

  const passives = useMemo(() => collectPassiveMechanics(assembled, character.resolved_choices ?? {}), [assembled, character.resolved_choices]);
  const actionUseRestPolicies = useMemo(
    () => collectSheetActionUseRestPolicies(assembled),
    [assembled],
  );
  const preparationChoices = useMemo(() => collectLongRestPreparationChoices({
    assembled,
    character,
  }), [assembled, character]);
  const slotRecoveryPolicies = useMemo(
    () => collectSheetSlotRecoveryPolicies(assembled),
    [assembled],
  );

  // Ресурсы класса + виртуальные пулы использований действий + пулы freeuse (ключ → per).
  const resourceRecharge = useMemo(
    () => ({
      ...buildResourceRecharge((assembled.klass?.resources ?? null) as Record<string, unknown> | null),
      ...actionUseRestPolicies.recharge,
      ...collectFreeuseRecharge(ruleState.freeuseSpells),
    }),
    [assembled.klass?.resources, actionUseRestPolicies.recharge, ruleState.freeuseSpells],
  );
  const resourceRecovery = actionUseRestPolicies.recovery;

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
    [
      ruleState,
      character.level,
      character.abilities,
      assembled.klass,
      resourceRecharge,
      resourceRecovery,
    ],
  );

  const runtime = useMemo(
    () => alignRuntimeHp(forgeToRuntimeState(character), ruleState.maxHP),
    [character, ruleState.maxHP],
  );

  // Отдых открывает окно смены настройки на предметы; новый ход закрывает.
  // resetDeathSaves: отдых сбрасывает спасброски смерти (KB-037). Без этого персонаж, которого
  // подняли отдыхом из 0 HP, оставался с {failures:3, dead:true} в БД при полном current_hp —
  // и следующее падение убивало его с первого урона без единого броска. Сброс ТОЛЬКО на отдыхе:
  // на start/end хода спасброски обязаны сохраняться между ходами (бой при 0 HP).
  function persistPayload(
    state: RuntimeState,
    attunementUnlocked?: boolean,
    resetDeathSaves?: boolean,
    baseTurnState: Record<string, unknown> | null | undefined = character.turn_state,
  ) {
    return {
      ...(!Number.isSafeInteger(character.runtime_revision) ? {} : {
        expected_runtime_revision: Number(character.runtime_revision),
      }),
      current_hp: state.hp.current,
      max_hp: state.hp.max,
      resources: state.resources,
      max_resources: state.maxResources,
      active_effects: state.activeEffects,
      turn_state: writeRulesEngineRuntimeTurnState(baseTurnState, state, {
        ...(attunementUnlocked !== undefined ? { attunement_unlocked: attunementUnlocked } : {}),
        ...(resetDeathSaves ? { death_saves: emptyDeathSaves() } : {}),
      }),
    };
  }

  const apply = useCallback(async (
    next: RuntimeState,
    events: EngineEvent[],
    attunementUnlocked?: boolean,
    resetDeathSaves?: boolean,
    baseTurnState?: Record<string, unknown> | null,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await persistCharacterRuntime(
        character,
        persistPayload(next, attunementUnlocked, resetDeathSaves, baseTurnState),
        encounterApply,
      );
      for (const [resource, expected] of Object.entries(next.resources)) {
        if (updated.resources?.[resource] !== expected) {
          throw new Error(`Сервер не подтвердил обновление ресурса ${resource}`);
        }
      }
      onUpdated(updated);
      onEvents?.(events);
      return true;
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Не удалось сохранить отдых');
      return false;
    } finally {
      setBusy(false);
    }
  }, [character, encounterApply, onUpdated, onEvents]);

  const syncResources = useCallback(async (force = false) => {
    const patch = buildResourceRuntimePatch(character, ctx, assembled, force, ruleState.maxHP, ruleState.freeuseSpells);
    if (!patch) return;
    setBusy(true);
    try {
      const updated = await persistCharacterRuntime(character, patch, encounterApply);
      onUpdated(updated);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }, [character, ctx, assembled, encounterApply, onUpdated, ruleState.maxHP]);

  // Один прогон синка на маунт: buildResourceRuntimePatch сам вернёт null,
  // если пулы (включая uses_<key> действий) и HP уже актуальны.
  useEffect(() => {
    if (syncAttempted.current) return;
    syncAttempted.current = true;
    syncResources();
  }, [syncResources]);

  const restCtx = useMemo(() => ({ ...ctx, passives }), [ctx, passives]);

  const resolveTurnReaction = async (state: RuntimeState, offer: ReactionOffer) => {
    if (!canPay(state, offer.cost).ok) return null;
    const decision = await reactionPrompt.request(offer, {
      describe: describeMechanicsLine(offer.mechanics),
    });
    if (decision.decision !== 'accept') return null;
    return executeAction(state, { ...offer.mechanics, name: offer.name }, {
      character: restCtx,
      passives,
      rng: () => Math.random(),
    });
  };

  const commitAtomicTurn = async (prepared: PreparedSheetAtomicWorldCommit) => {
    try {
      const committed = await commitSheetRuntimeCommand({
        request: prepared.request,
        commit: () => commitPreparedSheetAtomicWorld(
          { commit: charactersV3Api.postRuntimeCommand },
          prepared,
        ),
        loadCurrent: charactersV3Api.get,
        viewingCharacterId: character.id,
        loadPersistedEvents: charactersV3Api.getEvents,
      });
      const updated = committed.characters[character.id];
      if (!updated) throw new Error('Сервер не вернул состояние персонажа после нового хода');
      setPendingAtomicTurn(null);
      onUpdated(updated);
      if (committed.persistedEvents) onPersistedEvents?.(committed.persistedEvents);
      return true;
    } catch (cause) {
      console.error(cause);
      const message = cause instanceof Error ? cause.message : 'Не удалось сохранить новый ход';
      if (sheetCompanionRetryPolicy(cause) === 'retain_exact_retry') {
        setPendingAtomicTurn(prepared);
        setError(`${message}. Безопасный повтор сохранён.`);
      } else {
        setPendingAtomicTurn(null);
        setError(`${message}. Обновите лист перед повтором.`);
      }
      return false;
    }
  };

  const handleStartTurn = async () => {
    setBusy(true);
    setError(null);
    try {
      if (pendingAtomicTurn) {
        await commitAtomicTurn(pendingAtomicTurn);
        return;
      }
      const externalIds = persistedSourceTurnCharacterIds(character.turn_state, character.id);
      if (externalIds.length) {
        const [characters, cards, basicActions] = await Promise.all([
          Promise.all([character.id, ...externalIds].map(charactersV3Api.get)),
          getCardsIndex(),
          fetchBasicActions(),
        ]);
        const participants = await Promise.all(characters.map((selected) => (
          loadSheetCombatParticipant({ character: selected, basicActions, cards })
        )));
        const source = participants.find((participant) => participant.character.id === character.id);
        if (!source) throw new Error('Не удалось загрузить источник нового хода');
        const prepared = await prepareSheetNextTurnAtomicCommit({
          commandId: newSheetRuntimeCommandId(),
          source,
          externalParticipants: participants.filter((participant) => participant !== source),
          endSource: (state) => resolveTurnBoundaryOffers(
            endTurn(state, restCtx, { advanceRoundDurations: false }),
            resolveTurnReaction,
          ),
          startSource: (state) => resolveTurnBoundaryOffers(
            startTurn(state, restCtx),
            resolveTurnReaction,
          ),
        });
        setPendingAtomicTurn(prepared);
        await commitAtomicTurn(prepared);
        return;
      }

      const endedBoundary = applySourceTurnBoundary(runtime, {
        sourceActorId: character.id,
        ownerActorId: character.id,
        boundary: 'end',
      });
      const ended = await resolveTurnBoundaryOffers(
        endTurn(endedBoundary.state, restCtx, { advanceRoundDurations: false }),
        resolveTurnReaction,
      );
      const startedBoundary = applySourceTurnBoundary(ended.state, {
        sourceActorId: character.id,
        ownerActorId: character.id,
        boundary: 'start',
      });
      const started = await resolveTurnBoundaryOffers(
        startTurn(startedBoundary.state, restCtx),
        resolveTurnReaction,
      );
      await apply(started.state, [
        ...endedBoundary.events,
        ...ended.events,
        ...startedBoundary.events,
        ...started.events,
      ], false);
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : 'Не удалось начать новый ход');
    } finally {
      setBusy(false);
    }
  };

  const handleShortRest = () => {
    const { state, events } = shortRest(runtime, restCtx);
    setShortRestSelections({});
    setShortRestError(null);
    setShortRestDraft({ state, events });
  };

  const handleSpendHitDie = async () => {
    if (!shortRestDraft) return;
    const sides = hitDieSides(ctx.hitDie);
    if (!sides) return;
    const decision = await diceDialog.request(
      [{ sides, label: 'Кость хитов', resultGroup: 'hit-die', modifier: ctx.abilityMods.con }],
      'Короткий отдых — кость хитов',
    );
    if (decision.mode === 'cancel') return;
    const rolled = decision.mode === 'manual'
      ? decision.values[0]
      : Math.floor(Math.random() * sides) + 1;
    setShortRestDraft((current) => {
      if (!current) return current;
      const result = spendHitDie(current.state, ctx, rolled);
      return { state: result.state, events: [...current.events, ...result.events] };
    });
  };

  const handleFinishShortRest = async () => {
    if (!shortRestDraft) return;
    try {
      const recovery = applySheetSlotRecoverySelections({
        state: shortRestDraft.state,
        classLevels: ctx.classLevels,
        policies: slotRecoveryPolicies,
        selections: shortRestSelections,
      });
      const ok = await apply(
        recovery.state,
        [...shortRestDraft.events, ...recovery.events],
        true,
        true,
      );
      if (ok) {
        setShortRestDraft(null);
        setShortRestSelections({});
        setShortRestError(null);
      }
    } catch (cause) {
      setShortRestError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const addRecoveryLevel = (decisionType: string, level: number) => {
    if (!shortRestDraft) return;
    const entry = slotRecoveryPolicies.find(({ policy }) => policy.decisionType === decisionType);
    if (!entry) return;
    const picker = slotRecoveryPickerState({
      state: shortRestDraft.state,
      classLevels: ctx.classLevels,
      policy: entry.policy,
    });
    setShortRestSelections((current) => {
      const selected = current[decisionType] ?? [];
      const occurrences = selected.filter((candidate) => candidate === level).length;
      if (occurrences >= (picker.recoverableByLevel[level] ?? 0)
        || selected.reduce((sum, candidate) => sum + candidate, 0) + level > picker.budget) {
        return current;
      }
      return { ...current, [decisionType]: [...selected, level] };
    });
    setShortRestError(null);
  };

  const removeRecoveryLevel = (decisionType: string, index: number) => {
    setShortRestSelections((current) => ({
      ...current,
      [decisionType]: (current[decisionType] ?? []).filter((_, row) => row !== index),
    }));
    setShortRestError(null);
  };

  const handleLongRest = async () => {
    const picked = preparationChoices.length
      ? await choiceDialog.request(
        preparationChoices,
        'Долгий отдых — подготовка заклинаний',
      )
      : {};
    if (!picked) return;
    const turnState = preparationChoices.length
      ? writeSheetSpellPreparation(character.turn_state, picked)
      : character.turn_state;
    const { state, events } = longRest(runtime, restCtx);
    const ok = await apply(
      state,
      events,
      true,
      true,
      clearCombatContinuationsForRest(turnState),
    );
    if (ok) onLongRestComplete?.();
  };

  // KB-037: без сознания (0 HP) нельзя брать короткий/долгий отдых — персонаж умирает/стабилизируется,
  // а не отдыхает. Новый ход при 0 HP остаётся доступен — идут спасброски смерти.
  const unconscious = runtime.hp.current <= 0;
  const restTitle = (base: string) => (unconscious ? 'Недоступно при 0 HP — сначала стабилизируйтесь или получите лечение' : base);

  const cls = compact ? 'cs-top-rest' : 'sheet-runtime-actions';
  const hitDiceKey = hitDiceResourceKey(ctx.hitDie);
  const hitDiceAvailable = shortRestDraft && hitDiceKey
    ? shortRestDraft.state.resources[hitDiceKey] ?? 0
    : 0;
  const canSpendHitDie = !!shortRestDraft
    && hitDiceAvailable > 0
    && shortRestDraft.state.hp.current < shortRestDraft.state.hp.max;

  return (
    <>
    <div className={cls}>
      <button type="button" className={compact ? 'cs-top-rest-btn' : 'forge-btn ghost sheet-roll-btn'} disabled={busy || Boolean(lockReason)} title={lockReason} onClick={() => { void handleStartTurn(); }}>
        <Swords size={14} /> {pendingAtomicTurn ? 'Повторить ход' : 'Новый ход'}
      </button>
      <button
        type="button"
        className={compact ? 'cs-top-rest-btn' : 'forge-btn ghost sheet-roll-btn'}
        disabled={busy || Boolean(pendingAtomicTurn) || unconscious || Boolean(lockReason)}
        onClick={handleShortRest}
        title={lockReason ?? restTitle('Короткий отдых: добровольная трата костей хитов и заряды умений')}
      >
        <Sun size={14} /> Короткий отдых
      </button>
      <button
        type="button"
        className={compact ? 'cs-top-rest-btn' : 'forge-btn ghost sheet-roll-btn'}
        disabled={busy || Boolean(pendingAtomicTurn) || unconscious || Boolean(lockReason)}
        onClick={handleLongRest}
        title={lockReason ?? restTitle('Долгий отдых')}
      >
        <Moon size={14} /> Долгий отдых
      </button>
    </div>
    {error && <p className="issues" role="alert">{error}</p>}
    {shortRestDraft && (
      <div className="dice-dialog-backdrop" onClick={() => !busy && setShortRestDraft(null)}>
        <div className="dice-dialog-wrap" onClick={(event) => event.stopPropagation()}>
          <div className="dice-dialog" role="dialog" aria-label="Короткий отдых">
            <div className="dice-dialog-title">Короткий отдых</div>
            <div className="dice-dialog-summary">
              HP: <b>{shortRestDraft.state.hp.current}/{shortRestDraft.state.hp.max}</b>
              {' · '}Кости хитов {ctx.hitDie ?? '—'}: <b>{hitDiceAvailable}</b>
            </div>
            <p className="dice-dialog-note">
              После каждого броска вы решаете, тратить ли ещё одну кость. К каждому броску
              добавляется модификатор Телосложения (минимум 1 HP).
            </p>
            {slotRecoveryPolicies.map(({ actionId, name, policy }) => {
              const picker = slotRecoveryPickerState({
                state: shortRestDraft.state,
                classLevels: ctx.classLevels,
                policy,
              });
              const selected = shortRestSelections[policy.decisionType] ?? [];
              const spentBudget = selected.reduce((sum, level) => sum + level, 0);
              return (
                <div className="choice-box" key={actionId}>
                  <div className="choice-title">{name}</div>
                  <div className="choice-count">
                    Бюджет уровней ячеек: {spentBudget} из {picker.budget}
                  </div>
                  <div className="chips">
                    {Object.entries(picker.recoverableByLevel).map(([rawLevel, count]) => {
                      const level = Number(rawLevel);
                      const used = selected.filter((candidate) => candidate === level).length;
                      return (
                        <button
                          type="button"
                          className="chip"
                          key={level}
                          disabled={!picker.available || used >= count || spentBudget + level > picker.budget}
                          onClick={() => addRecoveryLevel(policy.decisionType, level)}
                        >
                          Ячейка {level} ур. · доступно {count - used}
                        </button>
                      );
                    })}
                    {!picker.available && (
                      <span className="ec-sub">Нет доступного заряда или потраченных подходящих ячеек.</span>
                    )}
                  </div>
                  {selected.length > 0 && (
                    <div className="chips">
                      {selected.map((level, index) => (
                        <button
                          type="button"
                          className="chip on"
                          key={`${level}:${index}`}
                          onClick={() => removeRecoveryLevel(policy.decisionType, index)}
                        >
                          Восстановить {level} ур. ×
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {shortRestError && <p className="dice-dialog-note" role="alert">{shortRestError}</p>}
            <div className="dice-dialog-actions">
              <button type="button" className="dice-dialog-btn primary" disabled={busy || !canSpendHitDie} onClick={() => void handleSpendHitDie()}>
                Потратить 1 кость
              </button>
              <button type="button" className="dice-dialog-btn" disabled={busy} onClick={() => void handleFinishShortRest()}>
                Завершить отдых
              </button>
              <button type="button" className="dice-dialog-btn ghost" disabled={busy} onClick={() => setShortRestDraft(null)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
