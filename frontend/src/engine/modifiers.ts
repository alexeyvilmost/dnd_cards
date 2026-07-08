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

/** Аккумулятор сбора: помимо свёрнутого advantage несёт флаги наличия — чтобы
 *  межпроходное объединение (collected + projected) тоже было порядко-независимым (C7). */
export interface CollectResult {
  modifiers: RollModifier[];
  advantage: AdvantageState;
  hasAdvantage: boolean;
  hasDisadvantage: boolean;
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

/**
 * @deprecated Обёртка над collectModifiers для колл-сайтов без formula/eval-контекста
 * (ручные броски листа). Формульные значения без formulaCtx мягко пропускаются;
 * when без evalCtx не блокирует — как было до фазы C. Новый код используйте
 * collectModifiers напрямую, передавая formulaCtx и evalCtx.
 */
export function collectRollModifiers(
  state: RuntimeState,
  passives: Dict[],
  appliesTo: { roll: string; filter?: Dict },
): { modifiers: RollModifier[]; advantage: AdvantageState } {
  return collectModifiers(state, passives, appliesTo);
}
