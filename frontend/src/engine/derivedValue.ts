/**
 * Парадигма №3 — «методы расчёта»: производное значение = набор методов-кандидатов,
 * каждый со своей применимостью; берём МАКСИМУМ среди применимых, затем прибавляем
 * аддитивные модификаторы. Набор расширяется данными (КЗ ×N способов, Пояс силы огра
 * как ещё один метод СИЛ и т.п.).
 *
 * Раньше это существовало только для КЗ и как if/else-каскад, бравший ПЕРВЫЙ подходящий
 * override, а не максимум. Здесь — единый примитив.
 */
import type { RollModifier, ValueBreakdown } from '../mvp/contracts';

export interface ValueMethod {
  /** Имя метода для превью (например «Защита без доспехов», «Кольчуга»). */
  name: string;
  /** Значение, которое даёт метод, если он применим сейчас. */
  value: number;
  /** Разбивка слагаемых метода (для popover). */
  parts: RollModifier[];
  /** Применим ли метод в текущем состоянии. По умолчанию true. */
  applicable?: boolean;
}

/**
 * Выбрать лучший применимый метод и прибавить аддитивные модификаторы.
 * `parts` итога = разбивка выбранного метода + аддитивы; `rejected` — прочие
 * применимые методы (для превью «другие способы дали бы …»).
 */
export function pickBestMethod(
  methods: ValueMethod[],
  additive: RollModifier[] = [],
): ValueBreakdown {
  const applicable = methods.filter((m) => m.applicable !== false);
  let best: ValueMethod | undefined;
  for (const m of applicable) {
    if (!best || m.value > best.value) best = m;
  }
  const rejected = applicable
    .filter((m) => m !== best)
    .map((m) => ({ name: m.name, value: m.value }));
  const additiveSum = additive.reduce((s, p) => s + p.value, 0);

  return {
    value: (best?.value ?? 0) + additiveSum,
    parts: [...(best?.parts ?? []), ...additive],
    ...(rejected.length ? { rejected } : {}),
  };
}
