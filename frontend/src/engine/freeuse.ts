import type {ResourceRestRecovery} from '../mvp/contracts';
import {parseResourceRestRecovery} from './actionUses';
/**
 * Бесплатные использования заклинаний (freeuse): granted-заклинание можно скастовать
 * БЕЗ траты ячейки, из ограниченного пула (по умолчанию 1 раз, перезарядка долгим отдыхом).
 * Даётся видами/чертами/предметами через параметр `freeuse` у payload `grant_spell`
 * (нативно и внутри choice). См. docs (фича freeuse).
 *
 * Реализация — виртуальный generic-пул `freeuse-<spell>`, без отдельной записи
 * ресурса в каталоге. Сохранённый пул связывается с заклинанием по его ссылкам,
 * поэтому исправление ссылки выдачи не восстанавливает потраченные заряды. Пул тратится
 * штатным canPay/pay и восстанавливается по recharge-карте; отдельная витрина
 * freeuse-spells собирает бесплатные применения. Стоимость ячейки заменяется этим пулом.
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
  /** Explicit unlimited use declared by the granting entity; no resource pool. */
  atWill?: boolean;
  recovery?:ResourceRestRecovery|null;
}

/** Ключ пула бесплатных использований заклинания. */
export function freeuseKey(spell: string): string {
  return `${FREEUSE_PREFIX}${spell}`;
}

/** Identity aliases are compatibility references, never catalog resource declarations. */
export interface FreeuseSpellIdentity {
  id?: string | null;
  card_number?: string | null;
  name_en?: string | null;
}

export function freeuseSpellReferences(spell: FreeuseSpellIdentity): string[] {
  const english = spell.name_en?.trim().toLowerCase();
  const aliases = english ? [
    english.replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
    english.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
  ] : [];
  return [...new Set([spell.card_number, spell.id, ...aliases].filter((ref): ref is string => !!ref))];
}

export interface FreeusePoolBindings {
  spells: readonly FreeuseSpellIdentity[];
  resources?: Readonly<Record<string, number>>;
}

/** Preserve the existing generic key even when a grant's alias was repaired. */
export function resolveFreeusePoolKey(spec: Pick<FreeuseSpec, 'spell'>, bindings?: FreeusePoolBindings): string {
  const spell = bindings?.spells.find(candidate => freeuseSpellReferences(candidate).includes(spec.spell));
  const references = [spec.spell, ...(spell ? freeuseSpellReferences(spell) : [])];
  return findFreeusePoolKey(bindings?.resources, { aliases: references }) ?? freeuseKey(spec.spell);
}

/** true для пулов freeuse-<spell>, НО не для витрины freeuse-spells (её показываем). */
export function isFreeusePoolKey(key: string): boolean {
  return key.startsWith(FREEUSE_PREFIX) && key !== FREEUSE_SHOWCASE_KEY;
}

/** Кандидаты ключей пула для заклинания-действия (контент ссылается slug'ом ИЛИ uuid). */
export function freeuseKeyCandidates(opts: { cardNumber?: string | null; id?: string | null; aliases?: readonly string[] }): string[] {
  const references = [opts.cardNumber, opts.id, ...(opts.aliases ?? [])];
  return [...new Set(references.filter((ref): ref is string => !!ref).map(freeuseKey))];
}

/** Существующий пул freeuse для заклинания среди кандидатов (или null). */
export function findFreeusePoolKey(
  resources: Readonly<Record<string, number>> | undefined,
  opts: { cardNumber?: string | null; id?: string | null; aliases?: readonly string[] },
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
export function collectFreeuseRecharge(specs: FreeuseSpec[], bindings?: FreeusePoolBindings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of specs) if (!s.atWill && s.recharge) out[resolveFreeusePoolKey(s, bindings)] = s.recharge;
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
    if (o.at_will === true) return { count: 0, recharge: '', atWill: true,
      ...(typeof o.level === 'number' ? { level: o.level } : {}) };
    const count = typeof o.count === 'number' || typeof o.count === 'string' ? o.count : 1;
    const recharge = typeof o.recharge === 'string' ? o.recharge : 'long_rest';
    const level = typeof o.level === 'number' ? o.level : undefined;
    return { count, recharge, level, ...(o.recovery===undefined?{}:{recovery:parseResourceRestRecovery(o.recovery)??null}) };
  }
  return undefined;
}

export function collectFreeuseRecovery(specs:FreeuseSpec[],bindings?:FreeusePoolBindings):Record<string,ResourceRestRecovery|null>{
  return Object.fromEntries(specs.filter(s=>!s.atWill&&s.recovery!==undefined).map(s=>[resolveFreeusePoolKey(s,bindings),s.recovery??null]));
}
