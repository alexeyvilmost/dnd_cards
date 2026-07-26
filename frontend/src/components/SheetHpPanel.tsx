import { useCallback, useMemo, useState } from 'react';
import { Dices, Heart, HeartPulse, Minus, Plus, Shield, Skull } from 'lucide-react';
import { charactersV3Api } from '../character/api';
import {
  applyDamageAtZero, applyDeathSaveRoll, describeDeathSaveOutcome,
  emptyDeathSaves, readDeathSaves, rollDeathSaveDie, type DeathSaveState,
} from '../character/death';
import type { FormulaContext } from '../engine/formula';
import { alignRuntimeHp, forgeToRuntimeState } from '../character/runtime';
import type { AbilityKey, ForgeCharacter } from '../character/types';
import { ABILITY_KEYS, ABILITY_LABEL_RU } from '../character/types';
import { useDiceDialog } from '../contexts/DiceDialogContext';
import { useReactionPrompt } from '../contexts/ReactionPromptContext';
import { activeConditionsOf } from '../engine/circumstances';
import { concentrationDC, concentrationEntry, dropConcentration } from '../engine/concentration';
import { conditionLabel, conditionOptions } from '../engine/conditions';
import { canPay } from '../engine/cost';
import { describeMechanicsLine } from '../engine/describeMechanics';
import { extractDiceFromEvents, plannedValuesRng, PLANNING_RNG } from '../engine/dicePlan';
import { applyIncomingDamage, executeAction } from '../engine/execute';
import { applyDamage, applyHealing, applyTempHp } from '../engine/hp';
import { collectRollModifiers } from '../engine/modifiers';
import { rollD20 } from '../engine/roll';
import { rollEvent } from '../engine/events';
import ValueBreakdownTip from './ValueBreakdownTip';
import type { CharacterContext, EngineEvent, ExecuteContext, ReactionOffer, RuntimeState, TargetContext, ValueBreakdown } from '../mvp/contracts';
import { DAMAGE_TYPES as SHARED_DAMAGE_TYPES } from '../utils/damageTypes';

/** Пустой рантайм «кастера» для тест-наложения состояния на владельца листа как на цель. */
const EMPTY_CASTER_STATE: RuntimeState = {
  hp: { current: 1, max: 1, temp: 0 },
  resources: {},
  maxResources: {},
  equipment: {},
  inventory: [],
  activeEffects: [],
};

const DUMMY_CASTER: CharacterContext = {
  abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
  profBonus: 2,
  level: 1,
};

/** Механика содержит payload reduce_damage (снижение входящего урона). */
function hasReduceDamage(mechanics: unknown): boolean {
  const effects = (mechanics as { effects?: unknown[] })?.effects;
  if (!Array.isArray(effects)) return false;
  return effects.some((e) => Array.isArray((e as { result?: unknown[] })?.result)
    && (e as { result: unknown[] }).result.some((p) => (p as { kind?: string })?.kind === 'reduce_damage'));
}

/** Реакции «снизить входящий урон» (Каменная стойкость): mode reaction/triggered + trigger
 *  damage_taken + payload reduce_damage. Предлагаются ДО применения урона. */
function collectReduceDamageReactions(passives: Record<string, unknown>[]): ReactionOffer[] {
  const out: ReactionOffer[] = [];
  for (const m of passives) {
    const act = m.activation as { mode?: string; trigger?: { event?: string }; cost?: unknown[] } | undefined;
    if (!act || (act.mode !== 'reaction' && act.mode !== 'triggered')) continue;
    if (act.trigger?.event !== 'damage_taken' || !hasReduceDamage(m)) continue;
    out.push({
      listenerId: String(m.id ?? m.name ?? 'reduce_damage'),
      name: String(m.name ?? 'Снижение урона'),
      mechanics: m,
      cost: (act.cost as Record<string, unknown>[]) ?? [],
      event: { kind: 'damage_taken' },
    });
  }
  return out;
}

// C15: типы урона для селектора (сопротивления/иммунитеты/уязвимости).
const DAMAGE_TYPES: Array<{ v: string; label: string }> = [
  { v: '', label: 'Без типа' },
  ...SHARED_DAMAGE_TYPES.map((d) => ({ v: d.value, label: d.label })),
];

interface Props {
  character: ForgeCharacter;
  maxHp: number;
  maxHpBreakdown?: ValueBreakdown | null;
  onUpdated: (c: ForgeCharacter) => void;
  onEvents?: (events: EngineEvent[]) => void;
  /** Бонус спасброска ТЕЛ — для проверки концентрации при уроне. */
  conSaveBonus?: number;
  /** true — без обёртки-панели (для диалога кокпита). */
  embedded?: boolean;
  /** Контекст движка листа: включает полный конвейер входящего урона (C15) —
   *  сопротивления/иммунитеты/уязвимости, концентрацию, реакции. Без него — простое вычитание. */
  sheetCtx?: CharacterContext | null;
  passives?: Record<string, unknown>[];
}

export default function SheetHpPanel({
  character, maxHp, maxHpBreakdown, onUpdated, onEvents, conSaveBonus = 0, embedded,
  sheetCtx, passives,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState(5);
  const [damageType, setDamageType] = useState('');
  const [crit, setCrit] = useState(false);
  const [conditionId, setConditionId] = useState('poisoned');
  const [withSave, setWithSave] = useState(true);
  const [saveAbility, setSaveAbility] = useState<AbilityKey>('con');
  const [saveDc, setSaveDc] = useState(13);
  const diceDialog = useDiceDialog();
  const reactionPrompt = useReactionPrompt();

  const runtime = useMemo(
    () => alignRuntimeHp(forgeToRuntimeState(character), maxHp),
    [character, maxHp],
  );
  const deathSaves = useMemo(() => readDeathSaves(character.turn_state), [character.turn_state]);
  const unconscious = runtime.hp.current <= 0;
  const concentration = concentrationEntry(runtime);
  const condChoices = useMemo(() => conditionOptions(), []);

  const persist = useCallback(async (
    state: RuntimeState,
    events: EngineEvent[],
    ds?: DeathSaveState,
  ) => {
    setBusy(true);
    try {
      const updated = await charactersV3Api.patchRuntime(character.id, {
        current_hp: state.hp.current,
        max_hp: state.hp.max,
        // Реакции в конвейере урона могут тратить ресурсы (реакция, заряд Наследия великанов) —
        // персистим resources, иначе трата терялась бы (giant_legacy Каменной стойкости и т.п.).
        resources: state.resources,
        active_effects: state.activeEffects,
        turn_state: {
          ...(character.turn_state ?? {}),
          temp_hp: state.hp.temp,
          death_saves: ds ?? readDeathSaves(character.turn_state),
        },
      });
      onUpdated(updated);
      if (events.length) onEvents?.(events);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }, [character.id, character.turn_state, onUpdated, onEvents]);

  // ── Урон: провалы при 0 HP, проверка концентрации при уроне ──
  const handleDamage = async () => {
    if (unconscious) {
      // Урон по бессознательному — провал спасброска смерти; критическое попадание — ДВА провала
      // (KB-039). Галочка «крит» в этой же панели раньше не передавалась в applyDamageAtZero и
      // молча не влияла — расхождение «жив/погиб».
      const { next, dead } = applyDamageAtZero(deathSaves, crit);
      const events: EngineEvent[] = [
        { type: 'narrative', text: dead
          ? 'Урон по бессознательному: третий провал. Персонаж погибает.'
          : crit
            ? 'Критический урон по бессознательному персонажу — два провала спасброска смерти.'
            : 'Урон по бессознательному персонажу — провал спасброска смерти.' },
      ];
      await persist(runtime, events, next);
      return;
    }

    // C15: полный конвейер входящего урона через движок (сопротивления/иммунитеты/
    // уязвимости + проверка концентрации с collectModifiers и помехой при крите +
    // реакции на damage_taken) — когда лист передал контекст движка.
    if (sheetCtx) {
      const execCtx = (rng: () => number, planning = false): ExecuteContext =>
        ({ character: sheetCtx, rng, passives: passives ?? [], planning }) as ExecuteContext;
      const opts = { crit, damageType, conSaveBonus };
      const dtLabel = DAMAGE_TYPES.find((d) => d.v === damageType)?.label ?? '';

      // 0. ДО УРОНА: снижение входящего урона (Каменная стойкость). Применяется как вычет из урона
      //    в applyIncomingDamage, а не лечение → HP не проседает ниже итогового (нет ложных
      //    «Окровален»/падения до 0) и не блокируется запретом исцеления.
      let working = runtime;
      let damageReduction = 0;
      const preEvents: EngineEvent[] = [];
      for (const react of collectReduceDamageReactions(passives ?? [])) {
        if (!canPay(working, react.cost).ok) continue;
        const rRes = await reactionPrompt.request(react, {
          describe: `Входящий урон ${amount}${dtLabel ? ` (${dtLabel})` : ''} — снизить «${react.name}»?`,
        });
        if (rRes.decision !== 'accept') continue;
        const r = executeAction(working, { ...react.mechanics, name: react.name }, execCtx(() => Math.random()));
        working = r.state; // стоимость (заряд Наследия великанов) списана
        for (const e of r.events) if (e.type === 'damage_reduction') damageReduction += e.amount;
        preEvents.push(...r.events);
      }
      const dmgOpts = { ...opts, damageReduction };

      // 1. План кубов проверки концентрации (уже по СНИЖЕННОМУ урону) → диалог → реальный прогон.
      const plan = extractDiceFromEvents(
        applyIncomingDamage(working, amount, execCtx(PLANNING_RNG, true), dmgOpts).events,
      );
      let rng: () => number = () => Math.random();
      if (plan.length) {
        const decision = await diceDialog.request(
          plan, `Урон ${amount}${dtLabel ? ` (${dtLabel})` : ''}${crit ? ', крит' : ''}`,
        );
        if (decision.mode === 'cancel') return;
        rng = decision.mode === 'manual' ? plannedValuesRng(plan, decision.values) : () => Math.random();
      }
      const res = applyIncomingDamage(working, amount, execCtx(rng), dmgOpts);
      let state = res.state;
      let events = [...preEvents, ...res.events];
      let ds: DeathSaveState | undefined;
      if (state.hp.current === 0) {
        ds = emptyDeathSaves();
        const dropped = dropConcentration(state, 'без сознания');
        state = dropped.state;
        events = [...events, ...dropped.events];
      }
      // Пост-урон реакции (Адское возмездие и т.п.). Снижающие урон уже предложены ДО урона — пропускаем.
      for (const offer of res.pendingReactions ?? []) {
        if (hasReduceDamage(offer.mechanics) || !canPay(state, offer.cost).ok) continue;
        const rRes = await reactionPrompt.request(offer, { describe: describeMechanicsLine(offer.mechanics) });
        if (rRes.decision !== 'accept') continue;
        const rmech = { ...offer.mechanics, name: offer.name };
        const rplan = extractDiceFromEvents(executeAction(state, rmech, execCtx(PLANNING_RNG, true)).events);
        let rrng: () => number = () => Math.random();
        if (rplan.length) {
          const rdec = await diceDialog.request(rplan, offer.name);
          if (rdec.mode === 'cancel') continue;
          rrng = rdec.mode === 'manual' ? plannedValuesRng(rplan, rdec.values) : () => Math.random();
        }
        const r = executeAction(state, rmech, execCtx(rrng));
        state = r.state;
        events = [...events, ...r.events];
      }
      await persist(state, events, ds);
      return;
    }

    // Fallback без контекста листа: простое вычитание + локальная концентрация.
    let { state, events } = applyDamage(runtime, amount);
    let ds: DeathSaveState | undefined;
    if (state.hp.current === 0) {
      ds = emptyDeathSaves(); // счёт начинается заново при падении в 0
      // концентрация прервана недееспособностью
      const dropped = dropConcentration(state, 'без сознания');
      state = dropped.state;
      events = [...events, ...dropped.events];
    } else if (concentration && amount > 0) {
      // проверка концентрации: ТЕЛ СЛ max(10, урон/2)
      const dc = concentrationDC(amount);
      const plan = [{ sides: 20, label: `Концентрация (ТЕЛ, СЛ ${dc})` }];
      const decision = await diceDialog.request(plan, `Проверка концентрации — СЛ ${dc}`);
      if (decision.mode !== 'cancel') {
        const rng = decision.mode === 'manual' ? plannedValuesRng(plan, decision.values) : () => Math.random();
        const roll = rollD20({
          modifiers: [{ value: conSaveBonus, source: 'ТЕЛ', reason: 'спасбросок' }],
          target: { type: 'dc', value: dc },
          rng,
        });
        events = [...events, rollEvent('Проверка концентрации', { ...roll, kind: 'save' })];
        if (roll.outcome !== 'success') {
          const dropped = dropConcentration(state, `провал проверки, СЛ ${dc}`);
          state = dropped.state;
          events = [...events, ...dropped.events];
        }
      }
    }
    await persist(state, events, ds);
  };

  const handleHeal = () => {
    // KB-038: погибшего (три провала) обычное лечение не поднимает — нужно воскрешение.
    // Иначе кнопка «Лечение» сбрасывала death_saves и молча возвращала труп к жизни.
    if (deathSaves.dead) {
      onEvents?.([{ type: 'narrative', text: 'Персонаж мёртв — обычное лечение не действует. Нужно воскрешение (напр., «Возрождение»).' }]);
      return;
    }
    const { state, events } = applyHealing(runtime, amount);
    // лечение поднимает из 0 и сбрасывает спасброски смерти
    persist(state, events, emptyDeathSaves());
  };

  /**
   * Наложение состояния / входящий спас — через executeAction с владельцем листа как ЦЕЛЬЮ
   * (тот же конвейер, что межперсонажное взаимодействие). Спас бросается как у цели в бою:
   * collectRollModifiers + savedConditions → предикат save_avoids_condition
   * (Устойчивость конструкта / Дворфская стойкость / Происхождение фей).
   */
  const handleApplyCondition = async () => {
    if (!sheetCtx || !conditionId) return;
    const label = conditionLabel(conditionId);
    const selfTarget: TargetContext = {
      characterContext: sheetCtx,
      runtimeState: runtime,
    };
    const applyViaEngine = (forceSaveOutcome?: 'success' | 'fail') => {
      const mechanics = withSave
        ? {
          name: `Тест: ${label}`,
          activation: { mode: 'action', cost: [] },
          effects: [{
            resolution: 'save',
            who: 'target',
            ability: saveAbility,
            dc: String(saveDc),
            on_fail: [{ kind: 'condition', op: 'apply', value: conditionId }],
            on_success: [],
          }],
        }
        : {
          name: `Тест: ${label}`,
          activation: { mode: 'action', cost: [] },
          effects: [{
            resolution: 'auto',
            who: 'target',
            result: [{ kind: 'condition', op: 'apply', value: conditionId }],
          }],
        };
      return executeAction(EMPTY_CASTER_STATE, mechanics, {
        character: DUMMY_CASTER,
        selfId: 'test-source',
        target: selfTarget,
        rng: () => Math.random(),
        ...(forceSaveOutcome ? { forceSaveOutcome } : {}),
      } as ExecuteContext);
    };

    if (!withSave) {
      const res = applyViaEngine();
      const state = res.targetState ?? runtime;
      await persist(state, [
        { type: 'narrative', text: `Тест наложения: «${label}» (без спасброска, через цель)` },
        ...res.events,
      ]);
      return;
    }

    // Как resolveIncomingSave на листе цели: пассивки + savedConditions гейтят преимущество.
    const abilLabel = ABILITY_LABEL_RU[saveAbility] ?? saveAbility.toUpperCase();
    const saveMod = (sheetCtx.abilityMods[saveAbility] ?? 0)
      + (sheetCtx.saveProficiencies?.includes(saveAbility) ? sheetCtx.profBonus : 0);
    const collected = collectRollModifiers(runtime, passives ?? [], {
      roll: 'saving_throw',
      filter: { ability: saveAbility },
      evalCtx: {
        state: runtime,
        character: sheetCtx,
        activeConditions: activeConditionsOf(runtime),
        savedConditions: new Set([conditionId]),
      },
    });

    let saved: boolean;
    const events: EngineEvent[] = [];
    if (collected.autoFail) {
      saved = false;
      events.push({ type: 'narrative', text: `Спасбросок ${abilLabel} — автопровал (состояние)` });
    } else {
      const plan = [{ sides: 20, label: `Спасбросок ${abilLabel} (СЛ ${saveDc})` }];
      const preview = (
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          Входящий спас против «{label}»
          {collected.advantage === 'advantage' ? ' · преимущество' : ''}
          {collected.advantage === 'disadvantage' ? ' · помеха' : ''}
        </div>
      );
      const decision = await diceDialog.request(plan, `Спас против «${label}»`, preview);
      if (decision.mode === 'cancel') return;
      const rng = decision.mode === 'manual' ? plannedValuesRng(plan, decision.values) : () => Math.random();
      const roll = rollD20({
        advantage: collected.advantage,
        modifiers: [{ value: saveMod, source: abilLabel, reason: 'спасбросок' }, ...collected.modifiers],
        target: { type: 'dc', value: saveDc },
        rng,
        rules: collected.rules,
      });
      saved = roll.outcome === 'success';
      events.push(rollEvent(`Спасбросок ${abilLabel} — ${saved ? 'успех' : 'провал'}`, { ...roll, kind: 'save' }));
    }

    // Исход форсируем в движок (как кастер в онлайн-бою) — condition пишется в targetState.
    const res = applyViaEngine(saved ? 'success' : 'fail');
    const state = res.targetState ?? runtime;
    events.push(
      { type: 'narrative', text: saved
        ? `Спасбросок против «${label}» успешен — состояние не наложено.`
        : `Провал спасброска — «${label}» наложено через механизм цели.` },
      ...res.events,
    );
    await persist(state, events);
  };

  const rollDeathSave = async () => {
    const plan = [{ sides: 20, label: 'Спасбросок смерти' }];
    const decision = await diceDialog.request(plan, 'Спасбросок смерти (без модификаторов)');
    if (decision.mode === 'cancel') return;
    const rng = decision.mode === 'manual' ? plannedValuesRng(plan, decision.values) : () => Math.random();
    // KB-042: без модификаторов характеристик, НО с правилами бросков (Везение полурослика) и
    // преимуществом/помехой на спасброски — раньше катилось голым rollD20, и Везение не срабатывало.
    const formulaCtx: FormulaContext = sheetCtx
      ? {
        abilityMods: sheetCtx.abilityMods, profBonus: sheetCtx.profBonus,
        selfLevel: sheetCtx.level, classLevels: sheetCtx.classLevels, variables: sheetCtx.variables,
      }
      : {};
    const roll = rollDeathSaveDie(runtime, passives ?? [], formulaCtx, rng);
    const natural = roll.dice.find((d) => !d.discarded)?.result ?? roll.total;
    const { next, outcome } = applyDeathSaveRoll(deathSaves, natural);

    let state = runtime;
    const events: EngineEvent[] = [
      rollEvent('Спасбросок смерти', roll),
      { type: 'narrative', text: describeDeathSaveOutcome(outcome, natural) },
    ];
    if (outcome === 'revive') {
      const healed = applyHealing(runtime, 1);
      state = healed.state;
    }
    await persist(state, events, next);
  };

  const body = (
    <>
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
        {concentration && !unconscious && (
          <p className="sheet-hp-concentration" title="При уроне — проверка ТЕЛ СЛ max(10, урон/2)">
            ✦ {concentration.name}
          </p>
        )}
      </div>

      {unconscious && (
        <div className="sheet-death-saves">
          <p className="sheet-hp-status">
            {deathSaves.dead ? 'Погиб' : deathSaves.stable ? 'Стабилизирован' : 'Без сознания — спасброски смерти'}
          </p>
          <div className="sheet-death-rows">
            <span className="sheet-death-row">
              Успехи
              {[0, 1, 2].map((i) => (
                <i key={i} className={`sheet-death-dot ok ${deathSaves.successes > i ? 'on' : ''}`} />
              ))}
            </span>
            <span className="sheet-death-row">
              Провалы
              {[0, 1, 2].map((i) => (
                <i key={i} className={`sheet-death-dot bad ${deathSaves.failures > i ? 'on' : ''}`} />
              ))}
            </span>
          </div>
          {!deathSaves.dead && !deathSaves.stable && (
            <button type="button" className="forge-btn ghost sheet-roll-btn" disabled={busy} onClick={rollDeathSave}>
              <Dices size={14} /> Спасбросок смерти
            </button>
          )}
          {deathSaves.dead && <Skull size={18} className="sheet-death-skull" />}
        </div>
      )}

      {sheetCtx && (
        <div className="sheet-hp-dmg-opts">
          <select
            className="forge-input sheet-hp-dmgtype"
            value={damageType}
            onChange={(e) => setDamageType(e.target.value)}
            title="Тип урона — для сопротивлений/иммунитетов/уязвимостей цели"
          >
            {DAMAGE_TYPES.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
          </select>
          <label className="sheet-hp-crit" title="Критический удар: концентрация проверяется с помехой">
            <input type="checkbox" checked={crit} onChange={(e) => setCrit(e.target.checked)} /> крит
          </label>
        </div>
      )}
      <div className="sheet-hp-controls">
        <input
          type="number"
          className="forge-input sheet-hp-amount"
          min={1}
          max={999}
          value={amount}
          onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 1))}
        />
        <button type="button" className="forge-btn ghost sheet-roll-btn" disabled={busy} onClick={handleDamage}>
          <Minus size={14} /> Урон
        </button>
        <button type="button" className="forge-btn ghost sheet-roll-btn" disabled={busy} onClick={handleHeal}>
          <HeartPulse size={14} /> Лечение
        </button>
        <button
          type="button"
          className="forge-btn ghost sheet-roll-btn"
          disabled={busy}
          onClick={() => {
            const { state, events } = applyTempHp(runtime, amount);
            persist(state, events);
          }}
        >
          <Plus size={14} /> Temp HP
        </button>
      </div>

      {sheetCtx && (
        <div className="sheet-hp-condition" title="Наложение через цель (executeAction who:target) — как входящее действие другого персонажа">
          <div className="sheet-hp-condition-row">
            <select
              className="forge-input sheet-hp-cond-select"
              value={conditionId}
              onChange={(e) => setConditionId(e.target.value)}
            >
              {condChoices.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
            <label className="sheet-hp-crit" title="Спасбросок цели с пассивками (save_avoids_condition)">
              <input type="checkbox" checked={withSave} onChange={(e) => setWithSave(e.target.checked)} />
              спас
            </label>
          </div>
          {withSave && (
            <div className="sheet-hp-condition-row">
              <select
                className="forge-input sheet-hp-dmgtype"
                value={saveAbility}
                onChange={(e) => setSaveAbility(e.target.value as AbilityKey)}
                title="Характеристика спасброска"
              >
                {ABILITY_KEYS.map((k) => (
                  <option key={k} value={k}>{ABILITY_LABEL_RU[k]}</option>
                ))}
              </select>
              <label className="sheet-hp-dc">
                СЛ
                <input
                  type="number"
                  className="forge-input sheet-hp-amount"
                  min={1}
                  max={40}
                  value={saveDc}
                  onChange={(e) => setSaveDc(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
            </div>
          )}
          <button
            type="button"
            className="forge-btn ghost sheet-roll-btn"
            disabled={busy}
            onClick={handleApplyCondition}
          >
            <Plus size={14} /> {withSave ? 'Спровоцировать спас' : 'Наложить состояние'}
          </button>
        </div>
      )}
    </>
  );

  if (embedded) return body;

  return (
    <section className="sheet-panel">
      <h2 className="sheet-h2">Хиты</h2>
      {body}
    </section>
  );
}
