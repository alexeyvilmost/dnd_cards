/**
 * Вычисление «Обстоятельств» (unified-mechanics-schema.md §5.5): предикаты
 * when/circumstances на модификаторах и триггерах. До фазы C движок их не вычислял
 * (0 ссылок в engine/) — условные пассивки применялись безусловно. Здесь — маленький
 * интерпретатор предикатов над контекстом броска.
 *
 * Гейт по умолчанию ЗАКРЫТ: нераспознанный/пока не реализованный предикат считается
 * НЕвыполненным (false) — модификатор-ограничитель не применяется, пока движок не умеет
 * подтвердить условие (иначе «+1 КЗ, пока в руке щит» висел бы всегда). Исключение —
 * narrative (на усмотрение ГМ, не блокирует). Предикаты, для которых данных нет прямо
 * сейчас (например «у цели состояние», а цели нет), тоже дают false — условие не выполнено.
 */
import type { AdvantageState, CharacterContext, RuntimeState, TargetContext } from '../mvp/contracts';

type Dict = Record<string, unknown>;

export interface EvalContext {
  character?: CharacterContext;
  state?: RuntimeState;
  target?: TargetContext;
  /** Состояния (kind:'condition' value), активные на владельце листа. */
  activeConditions?: Set<string>;
  /** Состояния на цели (заполнится в фазе E — двусторонний бой). */
  targetConditions?: Set<string>;
  /** Состояния, которые текущий спасбросок пытается ИЗБЕЖАТЬ (из on_fail эффекта-сейва).
   *  Для предиката save_avoids_condition — «преимущество/бонус на спас, чтобы не получить X». */
  savedConditions?: Set<string>;
  /** Преимущество, накопленное к текущему моменту сбора (для has_advantage). */
  advantageSoFar?: AdvantageState;
  /** Результат последнего d20 (для d20_equals). */
  lastD20?: number;
}

/** Собрать множество активных состояний владельца из RuntimeState. */
export function activeConditionsOf(state: RuntimeState | undefined): Set<string> {
  const out = new Set<string>();
  if (!state) return out;
  for (const e of state.activeEffects) {
    const m = e.mechanics as Dict;
    if (m?.kind === 'condition' && m.value) out.add(String(m.value));
  }
  return out;
}

/** Вычислить один предикат обстоятельства. Нераспознанный гейт → false (closed-by-default); narrative → true. */
export function evaluateCondition(cond: Dict, ctx: EvalContext): boolean {
  const kind = String(cond.kind ?? '');
  switch (kind) {
    case 'any_of': {
      const of = (cond.of as Dict[]) ?? [];
      return of.length === 0 || of.some((c) => evaluateCondition(c, ctx));
    }
    case 'all_of': {
      const of = (cond.of as Dict[]) ?? [];
      return of.every((c) => evaluateCondition(c, ctx));
    }
    case 'not': {
      const of = cond.of as Dict | undefined;
      return of ? !evaluateCondition(of, ctx) : true;
    }
    // ПРЕДМЕТНЫЕ ПРЕДИКАТЫ (S2). id из cond.id | cond.value. Оживляют when-гейты «пока предмет X
    // надет/в сумке/настроен» (S2/S6). ВАЖНО: enforced лишь там, где collectModifiers получает evalCtx
    // (боевые броски — execute/turn). Лист (breakdown/AC/ручной бросок) evalCtx пока не передаёт → when
    // там не блокирует (пре-существующее поведение ВСЕХ when-предикатов; сквозной evalCtx — отдельная
    // задача к S6). Closed-by-default: нет id/state → false, и НИКОГДА не бросаем (мягкие guard'ы).
    case 'item_equipped': {
      const id = String(cond.id ?? cond.value ?? '');
      if (!id || !ctx.state) return false;
      return Object.values(ctx.state.equipment ?? {}).some((v) => v === id);
    }
    case 'item_carried': {
      const id = String(cond.id ?? cond.value ?? '');
      if (!id || !ctx.state) return false;
      if (Object.values(ctx.state.equipment ?? {}).some((v) => v === id)) return true;
      return ((ctx.state.inventory ?? []).find((r) => r.cardId === id)?.qty ?? 0) > 0;
    }
    case 'attuned': {
      const id = String(cond.id ?? cond.value ?? '');
      return !!id && (ctx.character?.attunedIds?.includes(id) ?? false);
    }
    case 'you_have_condition':
      return ctx.activeConditions?.has(String(cond.value)) ?? false;
    case 'target_has_condition':
      return ctx.targetConditions?.has(String(cond.value)) ?? false;
    case 'save_avoids_condition':
      // «Спасбросок, чтобы ИЗБЕЖАТЬ состояния X» — истинно, когда текущий сейв налагает X при провале
      // (Происхождение фей: преимущество на спас против Очарования). savedConditions заполняет runSave.
      return ctx.savedConditions?.has(String(cond.value)) ?? false;
    case 'condition':
      // Легаси-форма расовых черт «преимущество на спас против X» ({kind:'condition', id:X}) — движок
      // раньше её не знал (закрыто-по-умолчанию), а до передачи evalCtx в сейв она применялась БЕЗУСЛОВНО.
      // Трактуем как save_avoids_condition (эти черты — Дворфская стойкость/Храбрость — про сейв ПРОТИВ
      // состояния). На не-сейв путях savedConditions пуст → false (как и было). id из cond.id | cond.value.
      return ctx.savedConditions?.has(String(cond.id ?? cond.value)) ?? false;
    case 'has_advantage':
      return ctx.advantageSoFar === 'advantage';
    case 'd20_equals':
      return ctx.lastD20 != null && ctx.lastD20 === Number(cond.value);
    case 'narrative':
      // Текстовое условие — на усмотрение ГМ; движок не блокирует.
      return true;
    default:
      // Нераспознанный предикат — это ЯВНЫЙ гейт, который движок пока не умеет проверить.
      // Считаем условие НЕвыполненным (false), а не «истинным по умолчанию»: иначе модификатор-
      // ограничитель («+1 КЗ, пока в руке щит») применялся бы ВСЕГДА, завышая статы. Как только
      // предикат реализуют — гейт заработает точно. (narrative выше — намеренное исключение.)
      return false;
  }
}

/** true, если все when-условия выполнены (или их нет / нет контекста для оценки). */
export function matchesWhen(when: Dict[] | undefined, ctx?: EvalContext): boolean {
  if (!when || when.length === 0) return true;
  if (!ctx) return true; // нет контекста — не блокируем (обратная совместимость)
  return when.every((c) => evaluateCondition(c, ctx));
}
