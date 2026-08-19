import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Hourglass, Moon, Sun, Swords } from 'lucide-react';
import type { EncounterApply } from '../battle/encountersApi';
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
import { endTurn, longRest, shortRest, spendHitDie, startTurn } from '../engine/turn';
import { emptyDeathSaves } from '../character/death';
import type { EngineEvent, RuntimeState } from '../mvp/contracts';
import { useDiceDialog } from '../contexts/DiceDialogContext';

interface Props {
  character: ForgeCharacter;
  assembled: AssembledCharacter;
  ruleState: CharacterRuleState;
  onUpdated: (c: ForgeCharacter) => void;
  onEvents?: (events: EngineEvent[]) => void;
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

export default function SheetRestButtons({
  character,
  assembled,
  ruleState,
  onUpdated,
  onEvents,
  compact,
  onLongRestComplete,
  encounterApply,
  disabledReason,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [shortRestDraft, setShortRestDraft] = useState<{ state: RuntimeState; events: EngineEvent[] } | null>(null);
  const syncAttempted = useRef(false);
  const diceDialog = useDiceDialog();
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
  function persistPayload(state: RuntimeState, attunementUnlocked?: boolean, resetDeathSaves?: boolean) {
    return {
      current_hp: state.hp.current,
      max_hp: state.hp.max,
      resources: state.resources,
      max_resources: state.maxResources,
      active_effects: state.activeEffects,
      turn_state: writeRulesEngineRuntimeTurnState(character.turn_state, state, {
        ...(attunementUnlocked !== undefined ? { attunement_unlocked: attunementUnlocked } : {}),
        ...(resetDeathSaves ? { death_saves: emptyDeathSaves() } : {}),
      }),
    };
  }

  const apply = useCallback(async (next: RuntimeState, events: EngineEvent[], attunementUnlocked?: boolean, resetDeathSaves?: boolean) => {
    setBusy(true);
    try {
      const updated = await persistCharacterRuntime(
        character,
        persistPayload(next, attunementUnlocked, resetDeathSaves),
        encounterApply,
      );
      onUpdated(updated);
      onEvents?.(events);
      return true;
    } catch (e) {
      console.error(e);
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

  const handleStartTurn = () => {
    const { state, events } = startTurn(runtime, restCtx);
    void apply(state, events, false);
  };

  const handleEndTurn = () => {
    const { state, events } = endTurn(runtime, restCtx);
    void apply(state, events, false);
  };

  const handleShortRest = () => {
    const { state, events } = shortRest(runtime, restCtx);
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
    const ok = await apply(shortRestDraft.state, shortRestDraft.events, true, true);
    if (ok) setShortRestDraft(null);
  };

  const handleLongRest = async () => {
    const { state, events } = longRest(runtime, restCtx);
    const ok = await apply(state, events, true, true);
    if (ok) onLongRestComplete?.();
  };

  // KB-037: без сознания (0 HP) нельзя брать короткий/долгий отдых — персонаж умирает/стабилизируется,
  // а не отдыхает. Ходы (Новый ход/Конец хода) при 0 HP остаются доступны — идут спасброски смерти.
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
      <button type="button" className={compact ? 'cs-top-rest-btn' : 'forge-btn ghost sheet-roll-btn'} disabled={busy || Boolean(lockReason)} title={lockReason} onClick={handleStartTurn}>
        <Swords size={14} /> Новый ход
      </button>
      <button
        type="button"
        className={compact ? 'cs-top-rest-btn' : 'forge-btn ghost sheet-roll-btn'}
        disabled={busy || Boolean(lockReason)}
        onClick={handleEndTurn}
        title={lockReason ?? 'Конец хода: спасброски в конце хода, истечение эффектов, тикающие эффекты'}
      >
        <Hourglass size={14} /> Конец хода
      </button>
      <button
        type="button"
        className={compact ? 'cs-top-rest-btn' : 'forge-btn ghost sheet-roll-btn'}
        disabled={busy || unconscious || Boolean(lockReason)}
        onClick={handleShortRest}
        title={lockReason ?? restTitle('Короткий отдых: добровольная трата костей хитов и заряды умений')}
      >
        <Sun size={14} /> Короткий отдых
      </button>
      <button
        type="button"
        className={compact ? 'cs-top-rest-btn' : 'forge-btn ghost sheet-roll-btn'}
        disabled={busy || unconscious || Boolean(lockReason)}
        onClick={handleLongRest}
        title={lockReason ?? restTitle('Долгий отдых')}
      >
        <Moon size={14} /> Долгий отдых
      </button>
    </div>
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
