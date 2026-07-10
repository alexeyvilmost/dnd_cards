/**
 * Единый исполнитель действий (фазы D4, E1–E5).
 */
import type {
  ActiveEffectEntry,
  AdvantageState,
  CharacterContext,
  EngineEvent,
  ExecuteContext,
  ExecuteResult,
  ReactionOffer,
  RollModifier,
  RuntimeState,
} from '../mvp/contracts';
import { canPay, pay } from './cost';
import {
  conditionAppliedEvent, damageEvent, healingEvent, itemAddedEvent, narrativeEvent,
  resourceRestoredEvent, rollEvent, tempHpEvent,
} from './events';
import { evaluate, FormulaError, MissingVariableError, rollFormula, type AbilityKey, type FormulaContext } from './formula';
import { collectModifiers, foldAdvantage } from './modifiers';
import { activeConditionsOf, type EvalContext } from './circumstances';
import { conditionModifierPayloads } from './conditions';
import { payloadsOf } from './mechanicsView';
import { selectedChoicePayloads, normalizeChoicePayload } from '../mechanics/expandChoices';
import { collectListeners, isAuto, toOffer, type DomainEvent } from './dispatch';
import { concentrationDC, concentrationEntry, dropConcentration } from './concentration';
import { rollD20 } from './roll';
import { weaponContext } from './weapon';

type Dict = Record<string, unknown>;

const ABILITY_LABEL: Record<AbilityKey, string> = {
  str: 'СИЛ', dex: 'ЛВК', con: 'ТЕЛ', int: 'ИНТ', wis: 'МДР', cha: 'ХАР',
};

export class InsufficientResourcesError extends Error {
  constructor(readonly missing: string[]) {
    super(`INSUFFICIENT_RESOURCES: ${missing.join(', ')}`);
    this.name = 'InsufficientResourcesError';
  }
}

function cloneState(state: RuntimeState): RuntimeState {
  return {
    ...state,
    hp: { ...state.hp },
    resources: { ...state.resources },
    maxResources: { ...state.maxResources },
    equipment: { ...state.equipment },
    inventory: state.inventory.map((r) => ({ ...r })),
    activeEffects: state.activeEffects.map((e) => ({ ...e })),
    firedThisTurn: state.firedThisTurn ? [...state.firedThisTurn] : undefined,
    firedThisRest: state.firedThisRest ? [...state.firedThisRest] : undefined,
  };
}

function passivesFromCtx(ctx: ExecuteContext): Dict[] {
  return (ctx as ExecuteContext & { passives?: Dict[] }).passives ?? [];
}

function formulaCtx(ctx: ExecuteContext): FormulaContext {
  return {
    abilityMods: ctx.character.abilityMods,
    profBonus: ctx.character.profBonus,
    selfLevel: ctx.character.level,
    classLevels: ctx.character.classLevels,
    spellcastingMod: ctx.character.spellcastingMod,
    variables: ctx.character.variables,
    rng: ctx.rng,
  };
}

/** Контекст формул ЦЕЛИ (её характеристики/уровень/переменные) — для formula-aware
 *  вычисления проецируемых цель→атакующий модификаторов. null, если цель обобщённая. */
function targetFormulaCtx(target: ExecuteContext['target']): FormulaContext | null {
  const cc = target?.characterContext;
  if (!cc) return null;
  return {
    abilityMods: cc.abilityMods,
    profBonus: cc.profBonus,
    selfLevel: cc.level,
    classLevels: cc.classLevels,
    spellcastingMod: cc.spellcastingMod,
    variables: cc.variables,
  };
}

function evalCtxOf(state: RuntimeState, ctx: ExecuteContext): EvalContext {
  return {
    character: ctx.character,
    state,
    target: ctx.target,
    activeConditions: activeConditionsOf(state),
    // C10: состояния ЦЕЛИ — чтобы предикат target_has_condition («преимущество, пока цель
    // распластана/опутана») гейтился данными, а не молча давал false. Пустое множество, если цели нет.
    targetConditions: activeConditionsOf(ctx.target?.runtimeState),
  };
}

// ─── Фаза E: двусторонний контекст ──────────────────────────────────────────

/**
 * Модификаторы, проецируемые ЦЕЛЬЮ на бросок атакующего (фаза E). Читаются обобщённо из
 * активных эффектов цели по данным scope:'target' — и из состояний (по данным состояния),
 * и из любого эффекта с scope:'target'-модификатором. Никакого хардкода проекции.
 */
function projectedAgainst(
  target: ExecuteContext['target'],
  roll: string,
): { modifiers: RollModifier[]; advantage: AdvantageState; hasAdvantage: boolean; hasDisadvantage: boolean } {
  const out = { modifiers: [] as RollModifier[], advantage: 'none' as AdvantageState, hasAdvantage: false, hasDisadvantage: false };
  const st = target?.runtimeState;
  if (!st) return out;

  // C14-родственник: значение проецируемого модификатора вычисляем formula-aware в контексте
  // ЦЕЛИ (её характеристики/переменные), а не голым Number() — иначе формульные моды теряются.
  const tctx = targetFormulaCtx(target);
  const consider = (m: Dict, source: string): void => {
    if (String(m.scope ?? 'self') !== 'target') return;
    const applies = m.applies_to as Dict | undefined;
    if (!applies || applies.roll !== roll) return;
    const op = String(m.op ?? '');
    if (op === 'advantage' || op === 'disadvantage') {
      if (op === 'advantage') out.hasAdvantage = true; else out.hasDisadvantage = true;
      out.advantage = foldAdvantage(out.hasAdvantage, out.hasDisadvantage);
    } else if (op === 'add' && m.value != null) {
      const raw = String(m.value).replace(/^\+/, '');
      let v: number | undefined;
      try { const r = evaluate(raw, tctx ?? {}); v = typeof r === 'number' ? r : undefined; }
      catch { v = undefined; }
      if (v != null && !Number.isNaN(v) && v !== 0) out.modifiers.push({ value: v, source });
    }
  };

  for (const e of st.activeEffects) {
    const mech = e.mechanics as Dict;
    if (mech?.kind === 'condition' && mech.value) {
      for (const rule of conditionModifierPayloads(String(mech.value))) consider(rule as unknown as Dict, String(mech.value));
    } else {
      for (const p of payloadsOf(mech)) if (p.kind === 'modifier') consider(p, e.name);
    }
  }
  return out;
}

/** Уровень сопротивления существа к типу урона (активные resistance-эффекты + пассивки). */
function resistanceLevelFor(state: RuntimeState, ctx: ExecuteContext, damageType: string): string | null {
  const rank = (l: string | null) => (l === 'immunity' ? 3 : l === 'resistance' ? 2 : l === 'vulnerability' ? 1 : 0);
  const scan = (mech: Dict | undefined): string | null => {
    for (const p of payloadsOf(mech)) {
      if (p.kind === 'resistance' && String(p.damage_type ?? '') === damageType) return String(p.value ?? '');
    }
    return null;
  };
  let level: string | null = null;
  for (const e of state.activeEffects) { const l = scan(e.mechanics as Dict); if (rank(l) > rank(level)) level = l; }
  for (const m of passivesFromCtx(ctx)) { const l = scan(m); if (rank(l) > rank(level)) level = l; }
  return level;
}

/** Применить уровень сопротивления к количеству урона. */
function applyResistance(amount: number, level: string | null): number {
  if (level === 'immunity') return 0;
  if (level === 'resistance') return Math.floor(amount / 2);
  if (level === 'vulnerability') return amount * 2;
  return amount;
}

/** Модификатор спасброска цели: динамически из её характеристик (фаза E) или из saveMods. */
function targetSaveMod(target: ExecuteContext['target'], ability: AbilityKey): number {
  const cc = target?.characterContext;
  if (cc) {
    const base = cc.abilityMods[ability] ?? 0;
    const prof = cc.saveProficiencies?.includes(ability) ? cc.profBonus : 0;
    return base + prof;
  }
  return target?.saveMods?.[ability] ?? 0;
}

function evalDc(formula: string, ctx: ExecuteContext): number {
  const normalized = formula.replace(/\s+/g, '');
  const v = evaluate(normalized, formulaCtx(ctx));
  if (typeof v !== 'number') throw new FormulaError(`DC формула «${formula}» не число`);
  return v;
}

function expiryFromDuration(duration: Dict | undefined): string | undefined {
  const t = duration?.type;
  if (t === 'until_start_of_next_turn') return 'start_of_next_turn';
  if (t === 'until_end_of_turn') return 'end_of_turn';
  return undefined;
}

/**
 * C6: единый резолвер длительности «стоячего» эффекта → { roundsLeft, expiry }. Общий для
 * condition / modifier / resistance (раньше логика дублировалась, а у modifier её вовсе не было —
 * бафф «+2 на 3 раунда» висел вечно). duration.rounds → roundsLeft (тикает на начале хода в
 * expireStartOfTurnEffects); until_start/end_of_turn → expiry-метка; без длительности → 'manual'
 * (снимается вручную/до отдыха, как чип Ярости).
 */
function resolveDuration(duration: Dict | undefined): { roundsLeft?: number; expiry?: string } {
  if (duration?.type === 'rounds') {
    // Целое число раундов → тикающий эффект. Невалидный amount (0/отрицательное/дробное/NaN, а
    // также формульное '1d4' — Number()→NaN) НЕ делаем вечным: даём 1 раунд (истечёт на следующем
    // ходу), иначе временный эффект тихо стал бы постоянным. Формульные длительности через evaluate —
    // отдельная фича (нужен ctx/rng здесь), пока усекаются до 1 раунда.
    const n = Math.floor(Number(duration.amount));
    return { roundsLeft: Number.isFinite(n) && n > 0 ? n : 1 };
  }
  // Нет длительности / until_*-метка: expiry ('start_of_next_turn'|'end_of_turn') либо 'manual'
  // (стоячий до ручного снятия/отдыха — Ярость и т.п.).
  return { expiry: expiryFromDuration(duration) ?? 'manual' };
}

/**
 * Скейлинг формулы урона/лечения (E5):
 * - per: 'spell_slot_above' — апкаст: +dice за каждый уровень слота выше базового;
 * - per: 'character_level' | 'cantrip' — рост заговора на уровнях персонажа 5/11/17.
 */
function withScaling(base: string, payload: Dict, ctx: ExecuteContext): string {
  const scaling = payload.scaling as Dict | undefined;
  const dice = scaling?.dice;
  if (!scaling || typeof dice !== 'string' || !dice) return base;

  const per = String(scaling.per ?? '');
  let steps = 0;
  if (per === 'spell_slot_above') {
    const baseLevel = ctx.spell?.baseLevel ?? 0;
    const castLevel = ctx.spell?.castLevel ?? baseLevel;
    steps = Math.max(0, castLevel - baseLevel);
  } else if (per === 'character_level' || per === 'cantrip') {
    const lvl = ctx.character.level;
    steps = (lvl >= 5 ? 1 : 0) + (lvl >= 11 ? 1 : 0) + (lvl >= 17 ? 1 : 0);
  }
  if (steps <= 0) return base;
  return `${base}${` + ${dice}`.repeat(steps)}`;
}

function resolveHand(effect: Dict): 'main' | 'off' {
  const tags = effect.tags as string[] | undefined;
  return tags?.includes('off_hand') ? 'off' : 'main';
}

function attackAbilityMods(effect: Dict, ctx: ExecuteContext, hand: 'main' | 'off', state: RuntimeState): RollModifier[] {
  const mods: RollModifier[] = [];
  const ability = String(effect.ability ?? 'str');

  if (ability === 'spellcasting') {
    mods.push({ value: ctx.character.spellcastingMod ?? 0, source: 'заклин.', reason: 'модификатор заклинаний' });
    mods.push({ value: ctx.character.profBonus, source: 'БМ', reason: 'бонус мастерства' });
  } else if (ability === 'auto') {
    const w = weaponContext(ctx.character, hand, state.equipment);
    if (w) {
      mods.push({
        value: ctx.character.abilityMods[w.ability],
        source: ABILITY_LABEL[w.ability],
        reason: 'модификатор характеристики',
      });
      if (w.enchant) {
        mods.push({ value: w.enchant, source: `+${w.enchant}`, reason: 'зачарование оружия' });
      }
    }
    mods.push({ value: ctx.character.profBonus, source: 'БМ', reason: 'бонус мастерства' });
  } else {
    const key = ability as AbilityKey;
    mods.push({
      value: ctx.character.abilityMods[key] ?? 0,
      source: ABILITY_LABEL[key] ?? ability,
      reason: 'модификатор характеристики',
    });
    mods.push({ value: ctx.character.profBonus, source: 'БМ', reason: 'бонус мастерства' });
  }
  return mods;
}

/**
 * Ключ стека (фаза D, модель StackId из BG3): явный stack_id, а для состояний —
 * неявный `cond:<value>` (состояние бинарно — оно либо есть, либо нет).
 */
function stackKeyOf(mech: Dict | undefined): string | undefined {
  if (!mech) return undefined;
  if (mech.stack_id != null) return String(mech.stack_id);
  if (mech.kind === 'condition' && mech.value != null) return `cond:${String(mech.value)}`;
  return undefined;
}

/**
 * Добавить активный эффект с учётом стекинга (RAW 2024 «Combining Game Effects»):
 * - нет ключа стека → просто добавить (текущее поведение, обратная совместимость);
 * - overwrite (дефолт при ключе): потентнейший (stack_priority) остаётся, при равенстве —
 *   новый (свежесть); одноимённое не удваивается;
 * - ignore → если такой уже есть, новый не добавляется;
 * - additive → длительности складываются;
 * - stack → независимые экземпляры.
 */
function stackApply(state: RuntimeState, entry: ActiveEffectEntry, payload: Dict): RuntimeState {
  const stackId = stackKeyOf(payload);
  const add = (): RuntimeState => ({ ...state, activeEffects: [...state.activeEffects, entry] });
  if (!stackId) return add();

  const stackType = String(payload.stack_type ?? 'overwrite');
  const same = state.activeEffects.filter((e) => stackKeyOf(e.mechanics as Dict) === stackId);
  const others = state.activeEffects.filter((e) => stackKeyOf(e.mechanics as Dict) !== stackId);

  if (stackType === 'stack') return add();
  if (stackType === 'ignore') return same.length ? state : add();
  if (stackType === 'additive') {
    if (!same.length) return add();
    const merged = same.map((e) => ({
      ...e,
      roundsLeft: ((e.roundsLeft ?? 0) + (entry.roundsLeft ?? 0)) || undefined,
    }));
    return { ...state, activeEffects: [...others, ...merged] };
  }
  // overwrite: потентнейший (priority) остаётся; равенство → новый (recency).
  const priority = Number(payload.stack_priority ?? 0);
  const maxPrio = same.reduce((m, e) => Math.max(m, Number((e.mechanics as Dict).stack_priority ?? 0)), -Infinity);
  if (same.length && priority < maxPrio) return state;
  return { ...state, activeEffects: [...others, entry] };
}

function applyModifierPayload(
  state: RuntimeState,
  payload: Dict,
  source: string,
  events: EngineEvent[],
): RuntimeState {
  const { roundsLeft, expiry } = resolveDuration(payload.duration as Dict | undefined);
  const entry: ActiveEffectEntry = {
    id: `fx-${state.activeEffects.length}-${Date.now()}`,
    name: source,
    mechanics: payload,
    roundsLeft, // C6: раньше не выставлялся — модификатор с duration.rounds не истекал
    expiry,
    source,
  };
  events.push({ type: 'effect_applied', name: source });
  return stackApply(state, entry, payload);
}

/**
 * resistance/immunity/vulnerability, выданные действием (Ярость), — как «стоячий» активный
 * эффект: кладём payload в activeEffects через stackApply, чтобы resistanceLevelFor нашёл его
 * при получении урона. Зеркало applyModifierPayload; разница только в kind полезной нагрузки.
 */
function applyResistancePayload(
  state: RuntimeState,
  payload: Dict,
  source: string,
  events: EngineEvent[],
): RuntimeState {
  const { roundsLeft, expiry } = resolveDuration(payload.duration as Dict | undefined);
  const entry: ActiveEffectEntry = {
    id: `res-${state.activeEffects.length}-${Date.now()}`,
    name: source,
    mechanics: payload,
    roundsLeft,
    expiry,
    source,
  };
  events.push({ type: 'effect_applied', name: source });
  return stackApply(state, entry, payload);
}

/**
 * 2.4: set_value — установить поле состояния значением/формулой. target: hp|current_hp (клампится
 * в [0,max] — Неумолимая стойкость hp=1), temp_hp, max_hp|hp_max, иначе id ресурса. ac_base —
 * пассивное понятие (метод КЗ, acBaseOverrides), в рантайме не хранится. Формула — formula|value.
 */
function applySetValue(state: RuntimeState, payload: Dict, fctx: FormulaContext, events: EngineEvent[]): RuntimeState {
  const target = String(payload.target ?? '');
  const raw = String(payload.formula ?? payload.value ?? '').replace(/\s+/g, '');
  if (!raw) return state;
  // formula-aware: fctx выбирается вызывающим (для who:'target' — контекст ЦЕЛИ, а не исполнителя).
  let val: number;
  try {
    const r = evaluate(raw, fctx);
    if (typeof r !== 'number' || Number.isNaN(r)) {
      events.push(narrativeEvent(`set_value «${target}»: формула «${raw}» не число — пропущено.`));
      return state;
    }
    val = Math.floor(r);
  } catch {
    events.push(narrativeEvent(`set_value «${target}»: формула «${raw}» не вычислена — пропущено.`));
    return state;
  }

  const next = cloneState(state);
  switch (target) {
    case 'hp':
    case 'current_hp':
      next.hp.current = Math.max(0, Math.min(next.hp.max, val));
      events.push(narrativeEvent(`Хиты установлены: ${next.hp.current}`));
      break;
    case 'temp_hp':
      next.hp.temp = Math.max(0, val);
      events.push(tempHpEvent(next.hp.temp));
      break;
    case 'max_hp':
    case 'hp_max':
      next.hp.max = Math.max(1, val);
      if (next.hp.current > next.hp.max) next.hp.current = next.hp.max;
      events.push(narrativeEvent(`Макс. хиты установлены: ${next.hp.max}`));
      break;
    case 'ac_base':
      events.push(narrativeEvent('set_value ac_base — вычисляется как метод КЗ (armorClassValue), не рантайм-мутация.'));
      break;
    default: {
      // Только ИЗВЕСТНЫЙ ресурс. Иначе — ГРОМКО (narrative), а не тихо создаём фантомный ресурс:
      // это ловит опечатки target ('hp'→'hpp') и не-рантаймовые target ('str' у Пояса силы огра →
      // это value_method характеристики, C8), которые раньше были видны как NOT_IMPLEMENTED.
      if (target && (target in next.maxResources || target in next.resources)) {
        const before = next.resources[target] ?? 0;
        next.resources[target] = Math.max(0, val);
        const delta = next.resources[target] - before;
        events.push(delta > 0
          ? resourceRestoredEvent(target, delta, next.resources[target])
          : narrativeEvent(`Ресурс «${target}» установлен: ${next.resources[target]}`));
      } else {
        events.push(narrativeEvent(`set_value: неизвестный target «${target}» — пропущено (ожидался hp/temp_hp/max_hp/известный ресурс).`));
      }
    }
  }
  return next;
}

function applyHealing(
  state: RuntimeState,
  payload: Dict,
  ctx: ExecuteContext,
  events: EngineEvent[],
): RuntimeState {
  const formula = withScaling(String(payload.amount ?? '0'), payload, ctx);
  const fr = rollFormula(formula, formulaCtx(ctx), { rng: ctx.rng });
  const next = cloneState(state);
  next.hp.current = Math.min(next.hp.max, next.hp.current + fr.total);
  events.push(healingEvent(fr.total, {
    kind: 'healing',
    advantage: 'none',
    dice: fr.dice,
    modifiers: fr.modifiers,
    total: fr.total,
    text: fr.text,
  }));
  return next;
}

/** temp_hp: временные хиты не суммируются — остаётся большее значение. */
function applyTempHp(
  state: RuntimeState,
  payload: Dict,
  ctx: ExecuteContext,
  events: EngineEvent[],
): RuntimeState {
  const formula = withScaling(String(payload.amount ?? '0'), payload, ctx);
  const fr = rollFormula(formula, formulaCtx(ctx), { rng: ctx.rng });
  const next = cloneState(state);
  next.hp.temp = Math.max(next.hp.temp, fr.total);
  events.push(tempHpEvent(fr.total));
  return next;
}

/** condition: наложение состояния как активного эффекта (op:apply|remove). */
function applyCondition(
  state: RuntimeState,
  payload: Dict,
  source: string,
  events: EngineEvent[],
): RuntimeState {
  const condition = String(payload.value ?? '');
  if (!condition) return state;
  const op = String(payload.op ?? 'apply');

  if (op === 'remove') {
    const kept = state.activeEffects.filter((e) => {
      const m = e.mechanics as Dict;
      const match = m?.kind === 'condition' && String(m.value ?? '') === condition;
      if (match) events.push({ type: 'effect_expired', name: e.name });
      return !match;
    });
    return { ...state, activeEffects: kept };
  }

  const { roundsLeft, expiry } = resolveDuration(payload.duration as Dict | undefined);
  const entry: ActiveEffectEntry = {
    id: `cond-${state.activeEffects.length}-${Date.now()}`,
    name: condition,
    mechanics: payload,
    roundsLeft,
    expiry,
    source,
  };
  events.push(conditionAppliedEvent(condition));
  return stackApply(state, entry, payload);
}

/** resource: grant — сверх максимума (Прилив действий), restore — до максимума. */
function applyResource(
  state: RuntimeState,
  payload: Dict,
  events: EngineEvent[],
): RuntimeState {
  let key = String(payload.id ?? payload.resource ?? '');
  if (!key) return state;
  if (key === 'spell_slot' && payload.level != null) key = `spell_slot_${payload.level}`;

  const amount = typeof payload.amount === 'number' ? payload.amount : Number(payload.amount) || 1;
  const op = String(payload.op ?? 'grant');
  const next = cloneState(state);
  const current = next.resources[key] ?? 0;

  if (op === 'restore') {
    const max = next.maxResources[key];
    next.resources[key] = max != null ? Math.min(max, current + amount) : current + amount;
  } else {
    next.resources[key] = current + amount;
  }
  const gained = next.resources[key] - current;
  if (gained > 0) events.push(resourceRestoredEvent(key, gained, next.resources[key]));
  return next;
}

type DamageInstance = { amount: number; damageType: string; roll?: import('../mvp/contracts').RollLog };

/** C1: модификаторы урона из активных эффектов/пассивок (Ярость +СИЛ, «Свет Латандера» +3).
 *  Запрос ОБЯЗАН передать ability использованной характеристики — иначе фильтр Ярости
 *  {ability:'str'} отсечёт её (matchFilter). Возвращает отдельные строки (гранулярность №4). */
function collectDamageModifiers(ctx: ExecuteContext, state: RuntimeState, filter: Dict): RollModifier[] {
  return collectModifiers(state, passivesFromCtx(ctx), {
    roll: 'damage',
    filter,
    formulaCtx: formulaCtx(ctx),
    evalCtx: evalCtxOf(state, ctx),
  }).modifiers;
}

/**
 * Одна payload-строка урона → одна ИЛИ несколько нанесённых инстанций.
 * dice:"weapon" раскрывается в оружие в руке: основная строка (кость + мод характеристики
 * + зачарование) плюс отдельная инстанция на каждый стихийный урон (без мода и зачарования).
 * Порядок стабилен (основная первой) — важно для плана кубов/диалога и сопротивлений по типам.
 */
function resolveDamageAmounts(
  payload: Dict,
  ctx: ExecuteContext,
  state: RuntimeState,
  hand: 'main' | 'off',
): DamageInstance[] {
  const handWeapon = weaponContext(ctx.character, hand, state.equipment);

  if (payload.dice === 'weapon') {
    const fallbackType = String(payload.type) === 'weapon'
      ? (handWeapon?.damageType ?? 'bludgeoning')
      : String(payload.type ?? 'bludgeoning');
    const lines = handWeapon?.damages ?? [{ dice: handWeapon?.dice ?? '1d4', type: fallbackType }];
    const ab = String(payload.ability ?? 'auto');
    return lines.map((line, i) => {
      const fr = rollFormula(line.dice, formulaCtx(ctx), { rng: ctx.rng });
      let total = fr.total;
      let extraMods: RollModifier[] = [];
      // Мод характеристики и зачарование — только на основную строку (RAW: +N один раз к урону оружия).
      if (i === 0) {
        if (ab === 'auto' && handWeapon) total += ctx.character.abilityMods[handWeapon.ability];
        else if (ab !== 'auto' && ab !== 'none') total += ctx.character.abilityMods[ab as AbilityKey] ?? 0;
        if (handWeapon?.enchant) total += handWeapon.enchant;
        // C1: модификаторы урона из эффектов (Ярость и т.п.) — на основную строку, отдельными частями.
        const usedAbility = ab === 'auto' ? handWeapon?.ability : (ab !== 'none' ? (ab as AbilityKey) : undefined);
        extraMods = collectDamageModifiers(ctx, state, { hand, ...(usedAbility ? { ability: usedAbility } : {}) });
        for (const m of extraMods) total += m.value;
      }
      return {
        amount: total,
        damageType: line.type,
        roll: { kind: 'damage', advantage: 'none', dice: fr.dice, modifiers: [...fr.modifiers, ...extraMods], total, text: fr.text },
      };
    });
  }

  let damageType = String(payload.type ?? 'bludgeoning');
  if (damageType === 'weapon') damageType = handWeapon?.damageType ?? 'bludgeoning';

  const flat = payload.amount != null ? String(payload.amount) : payload.dice != null ? String(payload.dice) : null;
  if (flat != null) {
    const fr = rollFormula(withScaling(flat, payload, ctx), formulaCtx(ctx), { rng: ctx.rng });
    // C1: модификаторы урона из эффектов. Для не-оружейного урона ability берём из payload,
    // если задан; иначе ability в фильтр не кладём (эффект без ability-фильтра всё равно применится).
    const usedAbility = payload.ability != null && payload.ability !== 'auto' && payload.ability !== 'none'
      ? (payload.ability as AbilityKey) : undefined;
    const extraMods = collectDamageModifiers(ctx, state, usedAbility ? { ability: usedAbility } : {});
    let total = fr.total;
    for (const m of extraMods) total += m.value;
    return [{
      amount: total,
      damageType,
      roll: { kind: 'damage', advantage: 'none', dice: fr.dice, modifiers: [...fr.modifiers, ...extraMods], total, text: fr.text },
    }];
  }

  return [{ amount: 0, damageType }];
}

/**
 * Единый роутер payload-ов (§6.5 схемы): исполняет список исходов
 * on_hit / on_crit / on_fail / on_success / result.
 */
/** Холдер состояния ЦЕЛИ (C2). payload-ы who:'target' мутируют его, а не состояние
 *  исполнителя; state undefined → цель без runtimeState, всё идёт в self (обратная совм.). */
type TargetRef = { state?: RuntimeState; mutated: boolean };

/** «Талон» (Вдохновение барда): чип-эффект с костью, снимается вручную; кость вводится
 *  диалогом бросков получателя. Вынесен в хелпер, чтобы who:'target' мог класть его цели. */
function applyBoon(state: RuntimeState, p: Dict, source: string, events: EngineEvent[]): RuntimeState {
  const die = String(p.die ?? 'к6').replace(/d/i, 'к');
  const name = `Талон ${die}${p.id ? ` (${source})` : ''}`;
  const entry: ActiveEffectEntry = {
    id: `boon-${state.activeEffects.length}-${Date.now()}`, name, mechanics: p, expiry: 'manual', source,
  };
  const next = { ...state, activeEffects: [...state.activeEffects, entry] };
  events.push({ type: 'effect_applied', name, sourceAction: source });
  events.push(narrativeEvent(
    `Талон ${die}: получатель добавляет ${die} к броску атаки, проверке или спасброску`
    + `${p.expires ? ` (истекает: ${p.expires})` : ''}. Снимите эффект при использовании.`,
  ));
  return next;
}

/** Превращение (Дикий облик): облик как активный эффект-чип; стат-блок зверя — по бестиарию. */
function applyTransform(state: RuntimeState, p: Dict, source: string, events: EngineEvent[]): RuntimeState {
  const formName = String(p.form ?? p.value ?? p.into ?? 'Дикий облик');
  const entry: ActiveEffectEntry = {
    id: `form-${state.activeEffects.length}-${Date.now()}`, name: `Облик: ${formName}`, mechanics: p, expiry: 'manual', source,
  };
  const next = { ...state, activeEffects: [...state.activeEffects, entry] };
  events.push({ type: 'effect_applied', name: entry.name, sourceAction: source });
  events.push(narrativeEvent(
    `Превращение (${source}): используйте стат-блок зверя${p.max_cr != null ? ` (ПО ≤ ${p.max_cr})` : ''}; `
    + 'ментальные характеристики и спасброски МДР/ИНТ/ХАР — ваши. Снимите эффект при возврате.',
  ));
  return next;
}

// Инлайн инвентарных хелперов (как в cost.ts) — избегаем cross-layer импорта character/runtime.
function invQtyOf(state: RuntimeState, cardId: string): number {
  return state.inventory.find((r) => r.cardId === cardId)?.qty ?? 0;
}
function addItemToInventory(state: RuntimeState, cardId: string, qty: number): RuntimeState {
  const inventory = state.inventory.map((r) => ({ ...r }));
  // S4: add_item кладёт на ВЕРХНИЙ уровень (containerId пусто), не в стопку внутри контейнера.
  const row = inventory.find((r) => r.cardId === cardId && r.containerId == null);
  if (row) row.qty += qty;
  else inventory.push({ cardId, qty });
  return { ...state, inventory };
}

function applyPayloads(
  payloads: Dict[],
  state: RuntimeState,
  ctx: ExecuteContext,
  events: EngineEvent[],
  source: string,
  hand: 'main' | 'off',
  halfDamage = false,
  whoTarget = false,
  targetRef: TargetRef = { mutated: false },
): RuntimeState {
  let next = state;
  // Роутер мутации (C2): who:'target' с переданным состоянием цели пишет в ЦЕЛЬ и метит
  // mutated; иначе — в состояние исполнителя (self). Урон/перемещение/переброс/нарратив —
  // только события, состояние не трогают, поэтому маршрутизации не требуют.
  const route = (mutate: (s: RuntimeState) => RuntimeState) => {
    if (whoTarget && targetRef.state) {
      targetRef.state = mutate(targetRef.state);
      targetRef.mutated = true;
    } else {
      next = mutate(next);
    }
  };
  for (const p of payloads) {
    const kind = String(p.kind ?? '');
    switch (kind) {
      case 'damage': {
        // Оружейный урон может раскрыться в несколько строк (основной + стихийный) —
        // каждую наносим отдельным событием (сопротивления по типам, план кубов, №4).
        for (const dmg of resolveDamageAmounts(p, ctx, next, hand)) {
          const amount = halfDamage ? Math.floor(dmg.amount / 2) : dmg.amount;
          events.push(damageEvent(amount, dmg.damageType, dmg.roll));
        }
        break;
      }
      case 'healing': route((s) => applyHealing(s, p, ctx, events)); break;
      case 'temp_hp': route((s) => applyTempHp(s, p, ctx, events)); break;
      case 'condition': route((s) => applyCondition(s, p, source, events)); break;
      case 'resource': route((s) => applyResource(s, p, events)); break;
      case 'modifier': route((s) => applyModifierPayload(s, p, source, events)); break;
      case 'resistance': route((s) => applyResistancePayload(s, p, source, events)); break;
      case 'set_value': {
        // Значение считаем в контексте того, КОГО меняем: при who:'target' — по статам ЦЕЛИ
        // (targetFormulaCtx), иначе исполнителя. Для литералов (hp=1) неважно; для формул — критично.
        const fctx = (whoTarget && targetRef.state) ? (targetFormulaCtx(ctx.target) ?? formulaCtx(ctx)) : formulaCtx(ctx);
        route((s) => applySetValue(s, p, fctx, events));
        break;
      }
      case 'variable':
        // 2.4: рантайм-мутация переменной пока не поддержана — нет RuntimeState.variables и наложения
        // на formulaCtx (мутация была бы инертна для формул). Ждёт слайса «рантайм-переменные».
        events.push(narrativeEvent(`Переменная «${p.id ?? p.target ?? ''}» — рантайм-мутация переменных пока не реализована.`));
        break;
      case 'value_method':
        // C8: value_method — build-only (расчёт характеристик в resolveCharacterRules). В рантайме
        // это no-op (не мусорим NOT_IMPLEMENTED), как build-гранты grant_*.
        break;
      case 'choice': {
        // Ярус 1.2: выбор в момент исполнения. Решение игрока собрано предпроходом на клике
        // действия в ctx.choices[<сырой id выбора>] (fallback 'choice' — как в коллекторе).
        // Разворачиваем выбранные ветки тем же роутером (вложенный choice → снова сюда).
        // Нормализуем форму (resistance из apply-шаблона) и НЕ пропускаем build-гранты (grant_* —
        // их применяет резолвер сборки, здесь они лишь замусорили бы журнал NOT_IMPLEMENTED).
        const raw = ctx.choices?.[String(p.id ?? 'choice')];
        const vals = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
        if (vals.length) {
          const sub = selectedChoicePayloads(p, vals)
            .map(normalizeChoicePayload)
            .filter((sp) => !String(sp.kind).startsWith('grant_'));
          next = applyPayloads(sub, next, ctx, events, source, hand, halfDamage, whoTarget, targetRef);
        }
        break;
      }
      case 'add_item': {
        // Контейнеры (S1): рантайм-выдача предмета в инвентарь ИСПОЛНИТЕЛЯ (self, не target —
        // контейнер наполняет сумку носителя). Имя вне grant_-неймспейса намеренно: in-play choice
        // вырезает grant_* (см. case 'choice'). Персист включает item_added-гейт (панель).
        const cardId = String(p.card_id ?? p.value ?? '');
        const qty = Math.max(1, Math.floor(Number(p.qty ?? p.amount ?? 1)) || 1);
        if (cardId) {
          next = addItemToInventory(next, cardId, qty);
          const name = typeof p.name === 'string' ? p.name : undefined;
          events.push(itemAddedEvent(cardId, qty, invQtyOf(next, cardId), name));
        } else {
          // Диагностика (ревью S1): пустой card_id И value — обычно опечатка имени поля (item_id/card).
          // Схему ужесточить нельзя: S3-форма выбора {kind:'add_item'} получает value из выбранного
          // варианта в рантайме, поэтому сигналим здесь, а не required в схеме.
          events.push(narrativeEvent('add_item: не указан card_id/value — предмет не выдан (проверьте имя поля card_id).'));
        }
        break;
      }
      case 'movement':
        events.push(narrativeEvent(`Перемещение: ${p.value} ${p.distance ?? ''} фт`));
        break;
      case 'boon': route((s) => applyBoon(s, p, source, events)); break;
      case 'reroll': {
        // Переброс (Везунчик): архитектурно бросок уже совершён — движок фиксирует
        // право переброса, значение вводится диалогом кубов.
        const which = String(p.which ?? 'd20').replace(/d/i, 'к');
        const keep = p.keep === 'either' ? 'оставьте любой из двух результатов' : 'используйте новый результат';
        events.push(narrativeEvent(`Переброс ${which}: перебросьте кость — ${keep}.`));
        break;
      }
      case 'transform': route((s) => applyTransform(s, p, source, events)); break;
      case 'narrative':
        events.push(narrativeEvent(String(p.description ?? p.text ?? '')));
        break;
      default:
        events.push(narrativeEvent(`NOT_IMPLEMENTED payload: ${kind}`));
    }
  }
  return next;
}

function runAttackRoll(
  effect: Dict,
  state: RuntimeState,
  ctx: ExecuteContext,
  events: EngineEvent[],
  source: string,
  pending: ReactionOffer[],
  targetRef: TargetRef = { mutated: false },
): RuntimeState {
  const whoTarget = String(effect.who ?? 'self') === 'target' && !!targetRef.state;
  const hand = resolveHand(effect);
  const ac = ctx.target?.ac ?? 10;
  const passives = passivesFromCtx(ctx);
  const collected = collectModifiers(state, passives, {
    roll: 'attack',
    formulaCtx: formulaCtx(ctx),
    evalCtx: evalCtxOf(state, ctx),
  });
  // Проекция состояний цели на бросок атакующего (фаза E): атака по распластанному/
  // опутанному/ослеплённому/парализованному/ошеломлённому/без сознания — с преимуществом.
  const projected = projectedAgainst(ctx.target, 'attack');
  const mods = [...attackAbilityMods(effect, ctx, hand, state), ...collected.modifiers, ...projected.modifiers];

  const roll = rollD20({
    // C7: объединяем флаги обоих проходов — и преим., и помеха (свои + от цели) → none.
    advantage: foldAdvantage(
      collected.hasAdvantage || projected.hasAdvantage,
      collected.hasDisadvantage || projected.hasDisadvantage,
    ),
    modifiers: mods,
    target: { type: 'ac', value: ac },
    rng: ctx.rng,
  });
  events.push(rollEvent('Атака', roll));

  let next = state;
  if (roll.outcome === 'hit' || roll.outcome === 'crit') {
    const payloads = (roll.outcome === 'crit' && effect.on_crit
      ? effect.on_crit
      : effect.on_hit) as Dict[] | undefined;
    if (Array.isArray(payloads)) {
      next = applyPayloads(payloads, next, ctx, events, source, hand, false, whoTarget, targetRef);
    }
    // Событие попадания → on-hit-райдеры: Скрытая атака (авто), Божественная кара /
    // Внезапный удар (предложение со стоимостью). Без timing — совпадает с любым.
    next = emitEvent({ kind: 'hit', source: 'self' }, next, ctx, events, pending, targetRef);
    if (roll.outcome === 'crit') next = emitEvent({ kind: 'crit', source: 'self' }, next, ctx, events, pending, targetRef);
  } else {
    // Промах: on_miss-райдеры (Graze/Vex — оружейное мастерство 2024) + событие miss.
    if (Array.isArray(effect.on_miss)) {
      next = applyPayloads(effect.on_miss as Dict[], next, ctx, events, source, hand, false, whoTarget, targetRef);
    }
    next = emitEvent({ kind: 'miss', source: 'self' }, next, ctx, events, pending, targetRef);
  }
  return next;
}

function runSave(
  effect: Dict,
  state: RuntimeState,
  ctx: ExecuteContext,
  events: EngineEvent[],
  source: string,
  targetRef: TargetRef = { mutated: false },
): RuntimeState {
  const whoTarget = String(effect.who ?? 'self') === 'target' && !!targetRef.state;
  const dcFormula = String(effect.dc ?? '10');
  const dc = evalDc(dcFormula, ctx);
  const ability = String(effect.ability ?? 'dex') as AbilityKey;
  const saveMod = targetSaveMod(ctx.target, ability);
  // Спасбросок совершает ЦЕЛЬ своими модификаторами/преимуществом — НЕ атакующий.
  // Берём эффекты из рантайма цели (богатая цель, фаза E); у обобщённой цели их нет.
  const targetState = ctx.target?.runtimeState;
  const collected = targetState
    ? collectModifiers(targetState, [], { roll: 'saving_throw', filter: { ability } })
    : { modifiers: [] as RollModifier[], advantage: 'none' as const };

  const roll = rollD20({
    advantage: collected.advantage,
    modifiers: [{ value: saveMod, source: 'цель' }, ...collected.modifiers],
    target: { type: 'dc', value: dc },
    rng: ctx.rng,
  });
  events.push(rollEvent('Спасбросок', { ...roll, kind: 'save' }));

  // Планирующий прогон: берём ветку провала, чтобы кости on_fail-урона попали в план кубов
  // (иначе при высоком PLANNING_RNG цель успевает спастись и урон не планируется → #8).
  const success = ctx.planning ? false : roll.outcome === 'success';
  const payloads = (success ? effect.on_success : effect.on_fail) as Dict[] | undefined;
  if (!Array.isArray(payloads)) return state;

  const half = success && payloads.some((p) => p.on_success === 'half');
  return applyPayloads(payloads, state, ctx, events, source, 'main', half, whoTarget, targetRef);
}

function runAbilityCheck(
  effect: Dict,
  state: RuntimeState,
  ctx: ExecuteContext,
  events: EngineEvent[],
  source: string,
  targetRef: TargetRef = { mutated: false },
): RuntimeState {
  const ability = String(effect.ability ?? 'str') as AbilityKey;
  const skill = String(effect.skill ?? '');
  // C12: бонус мастерства — ТОЛЬКО при владении навыком (экспертиза ×2). «Голая» проверка
  // характеристики (без skill) бонус мастерства не получает — раньше он прибавлялся безусловно.
  const prof = skill && ctx.character.skillExpertise?.includes(skill)
    ? ctx.character.profBonus * 2
    : skill && ctx.character.skillProficiencies?.includes(skill)
      ? ctx.character.profBonus
      : 0;
  const attackerTotal = (ctx.character.abilityMods[ability] ?? 0) + prof;
  const collected = collectModifiers(state, passivesFromCtx(ctx), {
    roll: 'ability_check',
    filter: skill ? { skill } : { ability },
    formulaCtx: formulaCtx(ctx),
    evalCtx: evalCtxOf(state, ctx),
  });
  const attRoll = rollD20({
    advantage: collected.advantage,
    modifiers: [
      { value: attackerTotal, source: skill || ABILITY_LABEL[ability] },
      ...collected.modifiers,
    ],
    rng: ctx.rng,
  });
  events.push(rollEvent(skill ? `Проверка (${skill})` : 'Проверка', { ...attRoll, kind: 'check' }));

  // Исход: против фиксированной СЛ (mode:dc) ИЛИ состязание (contest_vs, по умолчанию Атлетика).
  let success: boolean;
  if (effect.dc != null) {
    success = attRoll.total >= evalDc(String(effect.dc), ctx);
  } else {
    // RAW 2024: цель ВЫБИРАЕТ одну защитную характеристику (Атлетика ИЛИ Акробатика) — берёт
    // выгоднейшую по модификатору — и совершает ОДИН бросок (не максимум из нескольких d20,
    // что раньше давало защите фактическое преимущество).
    const contestVs = (effect.contest_vs as string[]) ?? ['athletics'];
    const defSkill = contestVs.reduce(
      (best, s) => ((ctx.target?.checkMods?.[s] ?? 0) > (ctx.target?.checkMods?.[best] ?? 0) ? s : best),
      contestVs[0] ?? 'athletics',
    );
    const defMod = ctx.target?.checkMods?.[defSkill] ?? 0;
    const defRoll = rollD20({ modifiers: [{ value: defMod, source: defSkill }], rng: ctx.rng });
    events.push(rollEvent(`Ответ (${defSkill})`, { ...defRoll, kind: 'check' }));
    success = attRoll.total > defRoll.total;
  }

  if (!success) return state;
  // C12: исход успеха идёт через общий роутер payload-ов — состояние (Толчок → prone),
  // перемещение, нарратив. who:'target' направляет состояние ЦЕЛИ, а не исполнителю.
  const onSuccess = effect.on_success as Dict[] | undefined;
  if (!Array.isArray(onSuccess)) return state;
  const whoTarget = String(effect.who ?? 'self') === 'target' && !!targetRef.state;
  return applyPayloads(onSuccess, state, ctx, events, source, 'main', false, whoTarget, targetRef);
}

/**
 * Исполнить список interactions механики (auto/attack_roll/save/ability_check) с мягкой
 * деградацией формул. Общий для основного действия и для авто-срабатывающих слушателей
 * событий (фаза A).
 */
function runMechanicEffects(
  effects: Dict[],
  state: RuntimeState,
  ctx: ExecuteContext,
  events: EngineEvent[],
  sourceName: string,
  pending: ReactionOffer[],
  targetRef: TargetRef = { mutated: false },
): RuntimeState {
  let next = state;
  for (const eff of effects) {
    const resolution = String(eff.resolution ?? '');
    // Мягкая деградация: если формула эффекта ссылается на недоступную переменную,
    // эффект пропускается с логом, а не роняет всё действие (см. docs/variables.md).
    try {
      // Ярус 1.2: choice как самостоятельная интеракция действия — через общий роутер payload-ов
      // (там case 'choice' развернёт выбор из ctx.choices). Иначе бы упал в NOT_IMPLEMENTED resolution.
      if (eff.kind === 'choice') {
        const whoTarget = String(eff.who ?? 'self') === 'target' && !!targetRef.state;
        next = applyPayloads([eff], next, ctx, events, sourceName, 'main', false, whoTarget, targetRef);
        continue;
      }
      if (resolution === 'auto') {
        const results = (eff.result ?? eff.results) as Dict[] | undefined;
        if (Array.isArray(results)) {
          const whoTarget = String(eff.who ?? 'self') === 'target' && !!targetRef.state;
          next = applyPayloads(results, next, ctx, events, sourceName, 'main', false, whoTarget, targetRef);
        }
        continue;
      }
      if (resolution === 'attack_roll') { next = runAttackRoll(eff, next, ctx, events, sourceName, pending, targetRef); continue; }
      if (resolution === 'save') { next = runSave(eff, next, ctx, events, sourceName, targetRef); continue; }
      if (resolution === 'ability_check') { next = runAbilityCheck(eff, next, ctx, events, sourceName, targetRef); continue; }
      events.push(narrativeEvent(`NOT_IMPLEMENTED resolution: ${resolution}`));
    } catch (e) {
      if (e instanceof MissingVariableError) {
        events.push(narrativeEvent(`Переменная «${e.variable}» недоступна — эффект «${sourceName}» не применён.`));
        continue;
      }
      if (e instanceof FormulaError) {
        events.push(narrativeEvent(`Формула эффекта «${sourceName}» не вычислена: ${e.message}`));
        continue;
      }
      throw e;
    }
  }
  return next;
}

/**
 * Диспетчер события (фаза A): находит слушателей, авто-триггеры исполняет сразу
 * (с гейтом uses.per:"turn"), а реакции/триггеры со стоимостью складывает в pending
 * для решения игрока. Возвращает изменённое состояние.
 */
/**
 * Словарь событий шины (C3). Единый источник истины: EMITTED — события, которые движок
 * реально диспатчит из своих путей; PLANNED — валидные по схеме, но пока не эмитятся
 * (с указанием причины ниже). Контрактный тест (eventBusContract.test.ts) сверяет
 * union(EMITTED, PLANNED) с enum схемы: новое событие обязано попасть в один из списков.
 */
export const EMITTED_EVENTS = [
  'hit', 'crit', 'damage_taken', 'miss', 'spell_cast', 'reduced_to_0_hp',
  // Ход и отдыхи через шину (C3 слайс 2 — turn.ts startTurn/endTurn/shortRest/longRest):
  'turn_start', 'turn_end', 'short_rest', 'long_rest',
] as const;

export const PLANNED_EVENTS = [
  // Требуют конвейера стадий атаки/урона (отдельные точки эмиссии):
  'attack_roll_made', 'damage_dealt', 'saving_throw_made', 'forced_save', 'ability_check_made',
  // Требуют многоактора/EncounterState (позиции, дистанции) — вне текущей модели:
  'creature_enters_reach', 'creature_leaves_reach', 'creature_moves',
  // Прочее (условия/инициатива/приобретение/уровень) — отдельные слайсы:
  'condition_applied', 'initiative_roll', 'on_acquire', 'level_gained',
] as const;

// C4: страховка каскада событий (emitEvent → механика слушателя → снова emitEvent). Бюджет на ОДНО
// верхнеуровневое действие / получение урона; при превышении дальнейшие триггеры не запускаются — это
// жёстко исключает стек-оверфлоу от зацикленного on-hit-контента (напр. слушатель, атакующий по своему
// же hit). Ключ — объект ctx (свой на каждое действие); beginCascade обнуляет на входе (защита от
// переиспользования ctx между вызовами). Бюджет по СУММЕ эмиссий ⇒ ограничивает и глубину рекурсии.
const MAX_EVENT_CASCADE = 16;
const cascadeBudget = new WeakMap<object, { n: number; warned: boolean }>();

function beginCascade(ctx: ExecuteContext): void {
  cascadeBudget.set(ctx, { n: 0, warned: false });
}

function cascadeAllows(ctx: ExecuteContext, events: EngineEvent[]): boolean {
  let b = cascadeBudget.get(ctx);
  if (!b) { b = { n: 0, warned: false }; cascadeBudget.set(ctx, b); }
  b.n += 1;
  if (b.n > MAX_EVENT_CASCADE) {
    if (!b.warned) {
      b.warned = true;
      events.push(narrativeEvent(`Каскад событий превысил лимит (${MAX_EVENT_CASCADE}) — дальнейшие триггеры остановлены во избежание зацикливания.`));
    }
    return false;
  }
  return true;
}

export function emitEvent(
  ev: DomainEvent,
  state: RuntimeState,
  ctx: ExecuteContext,
  events: EngineEvent[],
  pending: ReactionOffer[],
  targetRef: TargetRef = { mutated: false },
): RuntimeState {
  const listeners = collectListeners(ev, state, passivesFromCtx(ctx), evalCtxOf(state, ctx));
  if (!listeners.length) return state; // нет слушателей → рекурсии быть не может → бюджет не тратим
  // C4: бюджет жжём только на эмиссии СО слушателями (лишь они способны углубить рекурсию), иначе
  // широкое линейное действие (многолучевое заклинание без триггеров) ловило бы ложный лимит.
  if (!cascadeAllows(ctx, events)) return state;

  let next = state;
  for (const lm of listeners) {
    if (!isAuto(lm)) { pending.push(toOffer(lm, ev)); continue; }
    const per = lm.usesPer;
    // Гейт «уже сработал в этом периоде»: per:'turn' — firedThisTurn (сброс в startTurn); любой иной
    // период (long_rest/short_rest/day/…) — firedThisRest (сброс в longRest), иначе «раз за отдых»-триггер
    // (Неумолимая стойкость → hp=1) срабатывал бы бесконечно. firedThisTurn/Rest читаем СВЕЖИМ на каждой
    // итерации (C4: вложенный каскад мог обновить), помечаем и коммитим ДО запуска механики.
    const firedTurn = new Set(next.firedThisTurn ?? []);
    const firedRest = new Set(next.firedThisRest ?? []);
    if (per === 'turn' && firedTurn.has(lm.id)) continue;
    if (per && per !== 'turn' && firedRest.has(lm.id)) continue;
    if (per === 'turn') {
      firedTurn.add(lm.id);
      next = { ...next, firedThisTurn: [...firedTurn] };
    } else if (per) {
      firedRest.add(lm.id);
      next = { ...next, firedThisRest: [...firedRest] };
    }
    const effs = (lm.mechanics.effects as Dict[]) ?? [];
    if (effs.length) {
      events.push(narrativeEvent(`Сработало: ${lm.name}`));
      next = runMechanicEffects(effs, next, ctx, events, lm.name, pending, targetRef);
    }
  }
  return next;
}

export function executeAction(
  state: RuntimeState,
  mechanics: Dict,
  ctx: ExecuteContext,
): ExecuteResult {
  beginCascade(ctx); // C4: свежий бюджет каскада событий на это действие
  let next = cloneState(state);
  const events: EngineEvent[] = [];
  const pending: ReactionOffer[] = [];
  // Состояние ЦЕЛИ (C2): клон (не мутируем объект вызывающего). payload-ы who:'target'
  // пишут сюда; если цель без runtimeState — state undefined и всё идёт в self.
  const targetRef: TargetRef = {
    state: ctx.target?.runtimeState ? cloneState(ctx.target.runtimeState) : undefined,
    mutated: false,
  };

  const activation = mechanics.activation as Dict | undefined;
  const cost = (activation?.cost as Dict[]) ?? [];
  if (cost.length) {
    const check = canPay(next, cost);
    if (!check.ok) throw new InsufficientResourcesError(check.missing);
    const paid = pay(next, cost);
    next = paid.state;
    events.push(...paid.events);
  }

  const effects = mechanics.effects as Dict[] | undefined;
  if (!Array.isArray(effects)) return { state: next, events };

  const sourceName = String(mechanics.name ?? 'действие');
  next = runMechanicEffects(effects, next, ctx, events, sourceName, pending, targetRef);

  // Событие «сотворено заклинание» → триггеры на каст (напр. отклик оружия/предмета).
  // Активируется, когда лист/кузня передают ctx.spell (пикер уровня слота — D1 слайс 2);
  // до этого не фигурирует (аддитивно, без изменения текущего поведения).
  if (ctx.spell) {
    next = emitEvent(
      { kind: 'spell_cast', source: 'self', data: { level: ctx.spell.castLevel ?? ctx.spell.baseLevel } },
      next, ctx, events, pending, targetRef,
    );
  }

  void (ctx.character as CharacterContext);
  return {
    state: next,
    events,
    ...(pending.length ? { pendingReactions: pending } : {}),
    ...(targetRef.mutated ? { targetState: targetRef.state } : {}),
  };
}

/**
 * Применить ВХОДЯЩИЙ урон к владельцу листа (фаза A/E): списывает временные, затем
 * текущие хиты; при активной концентрации — авто-проверка ТЕЛ (СЛ по 2024, помеха при
 * крите); эмитит damage_taken → реакции (Адское возмездие и т.п.) как pendingReactions.
 */
export function applyIncomingDamage(
  state: RuntimeState,
  amount: number,
  ctx: ExecuteContext,
  opts?: { crit?: boolean; damageType?: string; conSaveBonus?: number },
): ExecuteResult {
  beginCascade(ctx); // C4: свежий бюджет каскада событий на это получение урона
  let next = cloneState(state);
  const events: EngineEvent[] = [];
  const pending: ReactionOffer[] = [];

  const raw = Math.max(0, Math.floor(amount));
  const damageType = opts?.damageType ?? 'урон';
  // Сопротивление/иммунитет/уязвимость цели (фаза E) — применяется при получении урона.
  const level = resistanceLevelFor(next, ctx, damageType);
  const dmg = applyResistance(raw, level);
  if (level && dmg !== raw) {
    const label = level === 'immunity' ? 'иммунитет' : level === 'resistance' ? 'сопротивление' : 'уязвимость';
    events.push(narrativeEvent(`${label} к «${damageType}»: ${raw} → ${dmg}`));
  }
  const absorbed = Math.min(next.hp.temp, dmg);
  next.hp.temp -= absorbed;
  next.hp.current = Math.max(0, next.hp.current - (dmg - absorbed));
  events.push(damageEvent(dmg, damageType));

  // Авто-проверка концентрации при уроне.
  const conc = concentrationEntry(next);
  if (conc && dmg > 0) {
    const dc = concentrationDC(dmg);
    const collected = collectModifiers(next, passivesFromCtx(ctx), {
      roll: 'saving_throw', filter: { ability: 'con' },
      formulaCtx: formulaCtx(ctx), evalCtx: evalCtxOf(next, ctx),
    });
    // Базовый модификатор проверки концентрации: полный бонус ТЕЛ-спасброска (мод +
    // владение), если лист его передал (важно для сорсереров), иначе только мод.
    const conMod = opts?.conSaveBonus ?? (ctx.character.abilityMods.con ?? 0);
    const advantage = opts?.crit
      ? (collected.advantage === 'advantage' ? 'none' : 'disadvantage')
      : collected.advantage;
    const roll = rollD20({
      advantage,
      modifiers: [{ value: conMod, source: 'ТЕЛ' }, ...collected.modifiers],
      target: { type: 'dc', value: dc },
      rng: ctx.rng,
    });
    events.push(rollEvent(`Концентрация (СЛ ${dc})`, { ...roll, kind: 'save' }));
    if (roll.outcome !== 'success') {
      const dropped = dropConcentration(next, `провал спасброска СЛ ${dc}`);
      next = dropped.state;
      events.push(...dropped.events);
    }
  }

  // Событие получения урона → реакции (Адское возмездие, Невероятное уклонение…).
  next = emitEvent({ kind: 'damage_taken', source: 'self', data: { amount: dmg } }, next, ctx, events, pending);

  // Падение до 0 HP → триггеры «при 0 HP» (напр. Отчаянная стойкость, срабатывания черт).
  // Гейт «был >0, стал 0» — чтобы не дублировать эмиссию на добивании уже бессознательного.
  if (next.hp.current === 0 && state.hp.current > 0) {
    next = emitEvent({ kind: 'reduced_to_0_hp', source: 'self' }, next, ctx, events, pending);
  }

  return { state: next, events, ...(pending.length ? { pendingReactions: pending } : {}) };
}
