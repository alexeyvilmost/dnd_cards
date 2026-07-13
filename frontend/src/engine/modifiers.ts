/**
 * Сбор модификаторов броска из активных эффектов и пассивок.
 *
 * Фаза C: единый formula-aware путь + вычисление обстоятельств (when).
 * - значение модификатора вычисляется через evaluate() (поддержка формул/переменных:
 *   rage_bonus, martial_arts_die и т.п.), а не берётся только как литерал;
 * - payload.when проверяется через circumstances.matchesWhen (если передан evalCtx).
 * Старый экспорт collectRollModifiers сохранён как обёртка (см. низ файла).
 */
import type { AdvantageState, RollModifier, RuntimeState } from '../mvp/contracts';
import { conditionModifierPayloads } from './conditions';
import { payloadsOf } from './mechanicsView';
import { evaluate, type FormulaContext } from './formula';
import { matchesWhen, type EvalContext } from './circumstances';

type Dict = Record<string, unknown>;

export interface CollectOptions {
  roll: string;
  filter?: Dict;
  /** Контекст формул. Без него формульные значения (rage_bonus, переменные) мягко пропускаются. */
  formulaCtx?: FormulaContext;
  /** Контекст обстоятельств. Без него when-условия НЕ блокируют (обратная совместимость). */
  evalCtx?: EvalContext;
}

/** @deprecated Бинарная свёртка порядко-зависима ([adv,dis,adv]→adv). Используйте
 *  foldAdvantage(hasAdv, hasDis) с накоплением флагов (C7). Оставлена для совместимости. */
export function combineAdvantage(current: AdvantageState, op: string): AdvantageState {
  if (op !== 'advantage' && op !== 'disadvantage') return current;
  if (current === 'none') return op as AdvantageState;
  if (current === op) return current;
  return 'none';
}

/** RAW 2024: при наличии И преимущества, И помехи они полностью аннулируются (none)
 *  независимо от числа источников и порядка; иначе — присутствующий вид. */
export function foldAdvantage(hasAdvantage: boolean, hasDisadvantage: boolean): AdvantageState {
  if (hasAdvantage && hasDisadvantage) return 'none';
  if (hasAdvantage) return 'advantage';
  if (hasDisadvantage) return 'disadvantage';
  return 'none';
}

/** C5: не-аддитивная операция над ЗНАЧЕНИЕМ (Foundry-модель). set — override; multiply — ×;
 *  upgrade — «не ниже» (max); downgrade — «не выше» (min). priority упорядочивает применение. */
export interface ModifierOp {
  op: 'set' | 'multiply' | 'upgrade' | 'downgrade';
  value: number;
  priority: number;
  source: string;
}

/** Аккумулятор сбора: помимо свёрнутого advantage несёт флаги наличия — чтобы
 *  межпроходное объединение (collected + projected) тоже было порядко-независимым (C7).
 *  ops (C5) — не-аддитивные операции над значением (скорость/КЗ/…); в d20-бросках не применяются. */
export interface CollectResult {
  modifiers: RollModifier[];
  advantage: AdvantageState;
  hasAdvantage: boolean;
  hasDisadvantage: boolean;
  ops: ModifierOp[];
  /** op:'auto_fail' — запрошенный спасбросок автоматически провален (Парализован/Ошеломлён/…). */
  autoFail: boolean;
  /** op:'deny' — запрошенная способность (action/bonus_action/reaction/concentration) запрещена (Недееспособен). */
  denied: boolean;
}

/** Ключ фильтра эффекта, отсутствующий в запросе = НЕ матч (R2). */
function matchFilter(effectFilter: Dict | undefined, queryFilter: Dict | undefined): boolean {
  if (!effectFilter || Object.keys(effectFilter).length === 0) return true;
  if (!queryFilter) return false;
  for (const [k, v] of Object.entries(effectFilter)) {
    if (queryFilter[k] !== v) return false;
  }
  return true;
}

function collectFromPayload(
  payload: Dict,
  opts: CollectOptions,
  sourceName: string,
  out: CollectResult,
): void {
  if (payload.kind !== 'modifier') return;
  // scope:'target' — проекция на атакующего носителя (фаза E); к своим броскам не относится.
  if (String(payload.scope ?? 'self') === 'target') return;
  const applies = payload.applies_to as Dict | undefined;
  if (!applies || applies.roll !== opts.roll) return;
  if (!matchFilter(applies.filter as Dict | undefined, opts.filter)) return;

  // Обстоятельства (§5.5): применяем модификатор только если when выполнено.
  // whenCtx строим лишь при наличии evalCtx — иначе matchesWhen не блокирует.
  const whenCtx: EvalContext | undefined = opts.evalCtx
    ? { ...opts.evalCtx, advantageSoFar: out.advantage }
    : undefined;
  if (!matchesWhen(payload.when as Dict[] | undefined, whenCtx)) return;

  if (payload.op === 'advantage' || payload.op === 'disadvantage') {
    if (payload.op === 'advantage') out.hasAdvantage = true;
    else out.hasDisadvantage = true;
    out.advantage = foldAdvantage(out.hasAdvantage, out.hasDisadvantage);
    return;
  }
  // Не-числовые маркеры (self-scope): автопровал спаса, запрет способности хода. Проходят те же
  // гейты (roll/filter/when/scope), что и adv/dis — фильтр по roll уже отсеял чужие цели.
  if (payload.op === 'auto_fail') { out.autoFail = true; return; }
  if (payload.op === 'deny') { out.denied = true; return; }
  if ((payload.op == null || payload.op === 'add') && payload.value != null) {
    const raw = String(payload.value).replace(/^\+/, '');
    let value: number | undefined;
    try {
      const r = evaluate(raw, opts.formulaCtx ?? {});
      value = typeof r === 'number' ? r : undefined;
    } catch {
      // Формула ссылается на недоступную переменную / битая — мягко пропускаем модификатор.
      value = undefined;
    }
    if (value != null && !Number.isNaN(value) && value !== 0) {
      out.modifiers.push({ value, source: String(payload.source ?? sourceName) });
    }
    return;
  }
  // C5: не-аддитивная алгебра над значением (скорость 0 у Схвачен, ×2 скорость Ускорения, «КЗ не ниже N»).
  if (payload.op === 'set' || payload.op === 'multiply' || payload.op === 'upgrade' || payload.op === 'downgrade') {
    if (payload.value == null) return;
    let value: number | undefined;
    try {
      const r = evaluate(String(payload.value).replace(/^\+/, ''), opts.formulaCtx ?? {});
      value = typeof r === 'number' ? r : undefined;
    } catch {
      value = undefined;
    }
    if (value == null || Number.isNaN(value)) return;
    out.ops.push({ op: payload.op, value, priority: Number(payload.priority ?? 0) || 0, source: String(payload.source ?? sourceName) });
  }
}

/**
 * Единый сбор модификаторов броска (бой + лист). Formula-aware, учитывает when.
 */
export function collectModifiers(
  state: RuntimeState,
  passives: Dict[],
  opts: CollectOptions,
): CollectResult {
  const out: CollectResult = {
    modifiers: [],
    advantage: 'none',
    hasAdvantage: false,
    hasDisadvantage: false,
    ops: [],
    autoFail: false,
    denied: false,
  };

  for (const effect of state.activeEffects) {
    const src = effect.name || 'эффект';
    for (const payload of payloadsOf(effect.mechanics)) {
      collectFromPayload(payload, opts, src, out);
      // Состояние (kind:'condition') влияет на броски по правилам 2024.
      if (payload.kind === 'condition' && payload.value) {
        for (const rule of conditionModifierPayloads(String(payload.value))) {
          collectFromPayload({ kind: 'modifier', ...rule }, opts, String(payload.value), out);
        }
      }
    }
  }

  for (const mech of passives) {
    const src = String((mech as Dict).name ?? 'пассивка');
    for (const payload of payloadsOf(mech)) {
      collectFromPayload(payload, opts, src, out);
    }
  }

  return out;
}

const OP_REASON: Record<ModifierOp['op'], string> = {
  multiply: 'множитель', downgrade: 'не выше', upgrade: 'не ниже', set: 'установлено',
};
const OP_ORDER: Record<ModifierOp['op'], number> = { multiply: 0, downgrade: 1, upgrade: 2, set: 3 };

/**
 * C5: свести ЗНАЧЕНИЕ с учётом не-аддитивной алгебры. Порядок (Foundry): base + аддитивы, затем
 * multiply (×), downgrade (min), upgrade (max), set (override); внутри группы — по возрастанию
 * priority (наибольший priority применяется последним и перекрывает для set/min/max). Возвращает
 * итог и op-части (дельты) для popover. Для d20-бросков НЕ применяется — там модификаторы аддитивны.
 */
export function foldModifiers(base: number, result: CollectResult): { value: number; parts: RollModifier[] } {
  const parts: RollModifier[] = [...result.modifiers];
  let value = base + result.modifiers.reduce((s, m) => s + m.value, 0);
  const ops = [...result.ops].sort((a, b) => (OP_ORDER[a.op] - OP_ORDER[b.op]) || (a.priority - b.priority));
  for (const op of ops) {
    const before = value;
    if (op.op === 'multiply') value = Math.trunc(value * op.value);
    else if (op.op === 'downgrade') value = Math.min(value, op.value);
    else if (op.op === 'upgrade') value = Math.max(value, op.value);
    else value = op.value; // set (override)
    if (value !== before) parts.push({ value: value - before, source: op.source, reason: OP_REASON[op.op] });
  }
  return { value, parts };
}

/**
 * @deprecated Обёртка над collectModifiers для колл-сайтов без formula/eval-контекста
 * (ручные броски листа). Формульные значения без formulaCtx мягко пропускаются;
 * when без evalCtx не блокирует — как было до фазы C. Новый код используйте
 * collectModifiers напрямую, передавая formulaCtx и evalCtx.
 */
export function collectRollModifiers(
  state: RuntimeState,
  passives: Dict[],
  appliesTo: { roll: string; filter?: Dict; evalCtx?: EvalContext },
): { modifiers: RollModifier[]; advantage: AdvantageState; autoFail: boolean; denied: boolean } {
  return collectModifiers(state, passives, appliesTo);
}

/** Способности экономики хода, запрещённые состояниями (D: Недееспособный → все четыре). */
const ACTION_CAPABILITIES = ['action', 'bonus_action', 'reaction', 'concentration'] as const;

/** Множество запрещённых способностей (op:'deny') из активных состояний/эффектов (Недееспособность). */
export function deniedCapabilities(state: RuntimeState, passives: Dict[] = []): Set<string> {
  const out = new Set<string>();
  for (const cap of ACTION_CAPABILITIES) {
    if (collectModifiers(state, passives, { roll: cap }).denied) out.add(cap);
  }
  return out;
}
