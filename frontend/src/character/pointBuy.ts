/**
 * Point-buy 27 очков (PHB 2024) + бонусы предыстории (+2/+1 или +1/+1/+1).
 * draft.abilities всегда хранит ИТОГОВЫЕ значения (база + бонус) — все
 * потребители (rules, лист, сохранение) остаются без изменений; база
 * восстанавливается вычитанием бонуса.
 */
import type { AbilityBonuses, AbilityKey, AbilityScores } from './types';
import { ABILITY_KEYS, emptyBonuses } from './types';

export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_MIN = 8;
export const POINT_BUY_MAX = 15;

const COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

export function bonusOf(bonuses: AbilityBonuses | undefined, k: AbilityKey): number {
  return bonuses?.assignments?.[k] ?? 0;
}

/** База point-buy = итоговое значение − бонус предыстории. */
export function baseOf(
  abilities: Partial<AbilityScores>,
  bonuses: AbilityBonuses | undefined,
  k: AbilityKey,
): number | undefined {
  const v = abilities[k];
  if (typeof v !== 'number') return undefined;
  return v - bonusOf(bonuses, k);
}

export function pointCost(base: number): number | undefined {
  return COST[base];
}

export function pointsSpent(
  abilities: Partial<AbilityScores>,
  bonuses: AbilityBonuses | undefined,
): number {
  let total = 0;
  for (const k of ABILITY_KEYS) {
    const b = baseOf(abilities, bonuses, k);
    if (typeof b === 'number') total += COST[b] ?? 0;
  }
  return total;
}

export function pointsRemaining(
  abilities: Partial<AbilityScores>,
  bonuses: AbilityBonuses | undefined,
): number {
  return POINT_BUY_BUDGET - pointsSpent(abilities, bonuses);
}

/** Ошибки point-buy распределения (пусто = валидно). */
export function pointBuyIssues(
  abilities: Partial<AbilityScores>,
  bonuses: AbilityBonuses | undefined,
): string[] {
  const issues: string[] = [];
  for (const k of ABILITY_KEYS) {
    const b = baseOf(abilities, bonuses, k);
    if (typeof b !== 'number') continue;
    if (b < POINT_BUY_MIN || b > POINT_BUY_MAX) {
      issues.push(`База ${k.toUpperCase()} вне диапазона ${POINT_BUY_MIN}–${POINT_BUY_MAX}`);
    }
  }
  const spent = pointsSpent(abilities, bonuses);
  if (spent > POINT_BUY_BUDGET) issues.push(`Превышен бюджет point-buy: ${spent} из ${POINT_BUY_BUDGET}`);
  return issues;
}

/** Ошибки распределения бонусов (частичное распределение допустимо только пустое). */
export function bonusIssues(bonuses: AbilityBonuses | undefined): string[] {
  if (!bonuses) return [];
  const vals = Object.values(bonuses.assignments).filter((v): v is number => !!v);
  if (!vals.length) return [];
  if (bonuses.mode === 'two_one') {
    const ok = vals.length === 2 && vals.includes(2) && vals.includes(1);
    return ok ? [] : ['Бонусы предыстории: назначьте +2 и +1 двум разным характеристикам'];
  }
  const ok = vals.length === 3 && vals.every((v) => v === 1);
  return ok ? [] : ['Бонусы предыстории: назначьте +1 трём разным характеристикам'];
}

/** Пересчитать итоговые значения при смене бонусов: итог = база + новый бонус. */
export function reapplyBonuses(
  abilities: Partial<AbilityScores>,
  prev: AbilityBonuses | undefined,
  next: AbilityBonuses,
): Partial<AbilityScores> {
  const out: Partial<AbilityScores> = { ...abilities };
  for (const k of ABILITY_KEYS) {
    const base = baseOf(abilities, prev, k);
    if (typeof base === 'number') out[k] = base + bonusOf(next, k);
  }
  return out;
}

// ─── Персист в resolved_choices (без миграции БД) ────────────────────────────

export const BONUS_KEY = 'builder:ability_bonus';
export const METHOD_KEY = 'builder:ability_method';
export const EQUIPMENT_OPTION_KEY = 'builder:equipment_option';

export function serializeBonuses(b: AbilityBonuses): string[] {
  return [
    `mode:${b.mode}`,
    ...(b.anyAbilities ? ['any'] : []),
    ...Object.entries(b.assignments)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}:${v}`),
  ];
}

export function parseBonuses(values: string[] | undefined): AbilityBonuses {
  const b = emptyBonuses();
  for (const v of values ?? []) {
    if (v === 'any') { b.anyAbilities = true; continue; }
    const [k, val] = v.split(':');
    if (k === 'mode') b.mode = val === 'one_one_one' ? 'one_one_one' : 'two_one';
    else if ((ABILITY_KEYS as string[]).includes(k)) b.assignments[k as AbilityKey] = Number(val) || 0;
  }
  return b;
}
