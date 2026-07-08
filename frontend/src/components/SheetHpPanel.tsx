import { useCallback, useMemo, useState } from 'react';
import { Dices, Heart, HeartPulse, Minus, Plus, Shield, Skull } from 'lucide-react';
import { charactersV3Api } from '../character/api';
import {
  applyDamageAtZero, applyDeathSaveRoll, describeDeathSaveOutcome,
  emptyDeathSaves, readDeathSaves, type DeathSaveState,
} from '../character/death';
import { alignRuntimeHp, forgeToRuntimeState } from '../character/runtime';
import type { ForgeCharacter } from '../character/types';
import { useDiceDialog } from '../contexts/DiceDialogContext';
import { useReactionPrompt } from '../contexts/ReactionPromptContext';
import { concentrationDC, concentrationEntry, dropConcentration } from '../engine/concentration';
import { canPay } from '../engine/cost';
import { describeMechanicsLine } from '../engine/describeMechanics';
import { extractDiceFromEvents, plannedValuesRng, PLANNING_RNG } from '../engine/dicePlan';
import { applyIncomingDamage, executeAction } from '../engine/execute';
import { applyDamage, applyHealing, applyTempHp } from '../engine/hp';
import { rollD20 } from '../engine/roll';
import { rollEvent } from '../engine/events';
import ValueBreakdownTip from './ValueBreakdownTip';
import type { CharacterContext, EngineEvent, ExecuteContext, RuntimeState, ValueBreakdown } from '../mvp/contracts';

// C15: типы урона для селектора (влияют на сопротивления/иммунитеты/уязвимости цели).
const DAMAGE_TYPES: Array<{ v: string; label: string }> = [
  { v: '', label: 'Без типа' },
  { v: 'bludgeoning', label: 'Дробящий' },
  { v: 'piercing', label: 'Колющий' },
  { v: 'slashing', label: 'Рубящий' },
  { v: 'fire', label: 'Огонь' },
  { v: 'cold', label: 'Холод' },
  { v: 'lightning', label: 'Молния' },
  { v: 'thunder', label: 'Гром' },
  { v: 'acid', label: 'Кислота' },
  { v: 'poison', label: 'Яд' },
  { v: 'necrotic', label: 'Некротический' },
  { v: 'radiant', label: 'Излучение' },
  { v: 'psychic', label: 'Психический' },
  { v: 'force', label: 'Силовой' },
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
  const diceDialog = useDiceDialog();
  const reactionPrompt = useReactionPrompt();

  const runtime = useMemo(
    () => alignRuntimeHp(forgeToRuntimeState(character), maxHp),
    [character, maxHp],
  );
  const deathSaves = useMemo(() => readDeathSaves(character.turn_state), [character.turn_state]);
  const unconscious = runtime.hp.current <= 0;
  const concentration = concentrationEntry(runtime);

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
      // урон по бессознательному — провал спасброска смерти
      const { next, dead } = applyDamageAtZero(deathSaves);
      const events: EngineEvent[] = [
        { type: 'narrative', text: dead
          ? 'Урон по бессознательному: третий провал. Персонаж погибает.'
          : 'Урон по бессознательному персонажу — провал спасброска смерти (крит — отметьте второй).' },
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
      // План кубов проверки концентрации → диалог игроку → реальный прогон.
      const plan = extractDiceFromEvents(
        applyIncomingDamage(runtime, amount, execCtx(PLANNING_RNG, true), opts).events,
      );
      let rng: () => number = () => Math.random();
      if (plan.length) {
        const dtLabel = DAMAGE_TYPES.find((d) => d.v === damageType)?.label ?? '';
        const decision = await diceDialog.request(
          plan, `Урон ${amount}${dtLabel ? ` (${dtLabel})` : ''}${crit ? ', крит' : ''}`,
        );
        if (decision.mode === 'cancel') return;
        rng = decision.mode === 'manual' ? plannedValuesRng(plan, decision.values) : () => Math.random();
      }
      const res = applyIncomingDamage(runtime, amount, execCtx(rng), opts);
      let state = res.state;
      let events = [...res.events];
      let ds: DeathSaveState | undefined;
      if (state.hp.current === 0) {
        ds = emptyDeathSaves();
        const dropped = dropConcentration(state, 'без сознания');
        state = dropped.state;
        events = [...events, ...dropped.events];
      }
      // Реакции на получение урона (Адское возмездие и т.п.) — предлагаем игроку.
      for (const offer of res.pendingReactions ?? []) {
        if (!canPay(state, offer.cost).ok) continue;
        const rDecision = await reactionPrompt.request(offer, describeMechanicsLine(offer.mechanics));
        if (rDecision !== 'accept') continue;
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

    // Fallback без контекста листа (кокпит V2): простое вычитание + локальная концентрация.
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
    const { state, events } = applyHealing(runtime, amount);
    // лечение поднимает из 0 и сбрасывает спасброски смерти
    persist(state, events, emptyDeathSaves());
  };

  const rollDeathSave = async () => {
    const plan = [{ sides: 20, label: 'Спасбросок смерти' }];
    const decision = await diceDialog.request(plan, 'Спасбросок смерти (без модификаторов)');
    if (decision.mode === 'cancel') return;
    const rng = decision.mode === 'manual' ? plannedValuesRng(plan, decision.values) : () => Math.random();
    const roll = rollD20({ modifiers: [], rng });
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
