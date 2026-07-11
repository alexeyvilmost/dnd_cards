/**
 * Бесплатные использования заклинаний (freeuse): granted-заклинание можно скастовать
 * БЕЗ траты ячейки, из ограниченного пула (по умолчанию 1 раз, перезарядка долгим отдыхом).
 * Даётся видами/чертами/предметами через параметр `freeuse` у payload `grant_spell`
 * (нативно и внутри choice). См. docs (фича freeuse).
 *
 * Реализация — виртуальный пул-ресурс `freeuse-<spell>` (близнец uses_<action>, actionUses.ts):
 * тратится штатным canPay/pay, восстанавливается отдыхом по recharge-карте, СКРЫТ из общего
 * ряда плиток (рисуется отдельной витриной `freeuse-spells`). Оплата generic — движок правок
 * не требует; при касте cost-запись spell_slot ПОДМЕНЯЕТСЯ на freeuse-пул.
 */

type Dict = Record<string, unknown>;

export const FREEUSE_PREFIX = 'freeuse-';
/** id ресурса-витрины «Бесплатные заклинания» (создан в справочнике; НЕ пул). */
export const FREEUSE_SHOWCASE_KEY = 'freeuse-spells';

/** Спецификация бесплатных использований конкретного заклинания. */
export interface FreeuseSpec {
  /** grant_spell.value — slug (card_number) ИЛИ uuid заклинания; идентификатор пула. */
  spell: string;
  /** Максимум бесплатных использований (число или формула, resolveCount). По умолчанию 1. */
  count: number | string;
  /** Когда перезаряжается: long_rest (деф.) | short_rest | day. */
  recharge: string;
  /** Фиксированный круг бесплатного каста; не задан → базовый круг заклинания. */
  level?: number;
}

/** Ключ пула бесплатных использований заклинания. */
export function freeuseKey(spell: string): string {
  return `${FREEUSE_PREFIX}${spell}`;
}

/** true для пулов freeuse-<spell>, НО не для витрины freeuse-spells (её показываем). */
export function isFreeusePoolKey(key: string): boolean {
  return key.startsWith(FREEUSE_PREFIX) && key !== FREEUSE_SHOWCASE_KEY;
}

/** Кандидаты ключей пула для заклинания-действия (контент ссылается slug'ом ИЛИ uuid). */
export function freeuseKeyCandidates(opts: { cardNumber?: string | null; id?: string | null }): string[] {
  const keys: string[] = [];
  if (opts.cardNumber) keys.push(freeuseKey(opts.cardNumber));
  if (opts.id) keys.push(freeuseKey(opts.id));
  return keys;
}

/** Существующий пул freeuse для заклинания среди кандидатов (или null). */
export function findFreeusePoolKey(
  resources: Record<string, number> | undefined,
  opts: { cardNumber?: string | null; id?: string | null },
): string | null {
  if (!resources) return null;
  for (const k of freeuseKeyCandidates(opts)) if (k in resources) return k;
  return null;
}

/**
 * Подменяет оплату ячейкой на трату freeuse-пула: убирает cost-записи spell_slot,
 * добавляет {resource: freeuse-<spell>, amount: 1}. Прочие косты (action/bonus/reaction)
 * сохраняются — бесплатный каст всё равно тратит действие.
 */
export function applyFreeuseCost(mech: Dict, poolKey: string): Dict {
  const activation = { ...(mech.activation as Dict | undefined) };
  const cost = Array.isArray(activation.cost) ? [...(activation.cost as Dict[])] : [];
  const filtered = cost.filter((c) => c && (c as Dict).resource !== 'spell_slot');
  filtered.push({ resource: poolKey, amount: 1 });
  activation.cost = filtered;
  return { ...mech, activation };
}

/** recharge-карта пулов freeuse: freeuse-<spell> → per (для короткого отдыха/дня). */
export function collectFreeuseRecharge(specs: FreeuseSpec[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of specs) if (s.recharge) out[freeuseKey(s.spell)] = s.recharge;
  return out;
}

/**
 * Нормализация значения `grant_spell.freeuse` в спецификацию (без поля spell — оно
 * добавляется вызывающим из grant_spell.value). Формы: true | число | {count,recharge,level}.
 */
export function parseFreeuse(raw: unknown): Omit<FreeuseSpec, 'spell'> | undefined {
  if (raw == null || raw === false) return undefined;
  if (raw === true) return { count: 1, recharge: 'long_rest' };
  if (typeof raw === 'number') return { count: raw, recharge: 'long_rest' };
  if (typeof raw === 'string') return { count: raw, recharge: 'long_rest' };
  if (typeof raw === 'object') {
    const o = raw as Dict;
    const count = typeof o.count === 'number' || typeof o.count === 'string' ? o.count : 1;
    const recharge = typeof o.recharge === 'string' ? o.recharge : 'long_rest';
    const level = typeof o.level === 'number' ? o.level : undefined;
    return { count, recharge, level };
  }
  return undefined;
}
