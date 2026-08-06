/**
 * Инициализация пулов ресурсов (фаза D1).
 */
import type { CharacterContext, ResourceRestRecovery } from '../mvp/contracts';
import { evaluate, type FormulaContext } from './formula';

type Dict = Record<string, unknown>;

const TURN_RESOURCES: Record<string, number> = {
  action: 1,
  bonus_action: 1,
  reaction: 1,
};

const TURN_KEYS = ['action', 'bonus_action', 'reaction'] as const;

export function hitDiceResourceKey(hitDie: string | null | undefined): string | null {
  const match = /^d(\d+)$/i.exec(String(hitDie ?? '').trim());
  return match ? `hit_dice_d${Number(match[1])}` : null;
}

export function hitDieSides(hitDie: string | null | undefined): number | null {
  const match = /^d(\d+)$/i.exec(String(hitDie ?? '').trim());
  const sides = match ? Number(match[1]) : 0;
  return sides >= 2 ? sides : null;
}

function formulaCtx(ctx: CharacterContext): FormulaContext {
  return {
    abilityMods: ctx.abilityMods,
    profBonus: ctx.profBonus,
    selfLevel: ctx.level,
    classLevels: ctx.classLevels,
  };
}

/** Количество из числа или формулы («prof_bonus», «1 + cha»…). */
export function resolveCount(raw: unknown, ctx: CharacterContext): number {
  if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
  if (raw == null) return 0;
  if (typeof raw === 'string') {
    try {
      const v = evaluate(raw, formulaCtx(ctx));
      if (typeof v === 'number' && !Number.isNaN(v)) return v;
    } catch {
      const n = Number(raw);
      if (!Number.isNaN(n)) return n;
    }
  }
  return 0;
}

/**
 * Сетка значений по уровням: {"2": 2, "3": 3, "5": 4} — берётся значение
 * с наибольшим ключом ≤ уровня персонажа (ступени слотов полу-/треть-кастеров).
 */
export function resolveByLevel(byLevel: unknown, level: number): number | null {
  if (!byLevel || typeof byLevel !== 'object') return null;
  let best: number | null = null;
  let bestLvl = -1;
  for (const [lvl, val] of Object.entries(byLevel as Dict)) {
    const l = Number(lvl);
    const v = Number(val);
    if (Number.isNaN(l) || Number.isNaN(v)) continue;
    if (l <= level && l > bestLvl) { bestLvl = l; best = v; }
  }
  return best;
}

export function buildResourceRecharge(classResources: Dict | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!classResources) return out;
  for (const [id, def] of Object.entries(classResources)) {
    const row = def as Dict;
    const per = row.per ?? row.recharge;
    if (per) out[id] = String(per);
  }
  return out;
}

export function initResources(
  ctx: CharacterContext,
  classResources: Dict | null,
  grantPayloads: Dict[],
): { resources: Record<string, number>; maxResources: Record<string, number> } {
  const maxResources: Record<string, number> = { ...TURN_RESOURCES };
  const resources: Record<string, number> = { ...TURN_RESOURCES };

  const hitDiceKey = hitDiceResourceKey(ctx.hitDie);
  if (hitDiceKey && ctx.level > 0) {
    maxResources[hitDiceKey] = ctx.level;
    resources[hitDiceKey] = ctx.level;
  }

  if (classResources) {
    for (const [id, def] of Object.entries(classResources)) {
      const row = def as Dict;
      const count = resolveByLevel(row.by_level, ctx.level)
        ?? resolveCount(row.count ?? row.max, ctx);
      if (count > 0) {
        maxResources[id] = count;
        resources[id] = count;
      }
    }
  }

  for (const grant of grantPayloads) {
    if (grant.kind !== 'resource' || grant.op !== 'grant') continue;
    const id = String(grant.id ?? '');
    const amount = resolveCount(grant.amount ?? 1, ctx);
    if (!id || amount <= 0) continue;
    maxResources[id] = (maxResources[id] ?? 0) + amount;
    resources[id] = (resources[id] ?? 0) + amount;
  }

  return { resources, maxResources };
}

/**
 * Максимальный круг заклинаний, ячейка которого доступна персонажу (для grant_spells
 * only_available_slots). Сканирует ячейки в maxResources: spell_slot_N (обычные касты),
 * warlock_spell_slot_N / pact_slot_N (колдунские пактовые). Возвращает наибольший N с
 * количеством > 0; 0 — если ячеек нет. Данные-ориентировано (без хардкода классов):
 * какие круги доступны, определяют ресурсы, а не тип класса.
 */
export function maxAvailableSpellSlotLevel(maxResources: Record<string, number>): number {
  let max = 0;
  for (const [key, val] of Object.entries(maxResources)) {
    if (!(Number(val) > 0)) continue;
    const m = /^(?:spell_slot|warlock_spell_slot|pact_slot)_(\d+)$/.exec(key);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/** Ресурсы, восстанавливаемые коротким отдыхом (R4: по recharge; без метаданных — legacy). */
export function resourcesRestoredOnShortRest(
  maxResources: Record<string, number>,
  recharge?: Record<string, string>,
  recovery?: Record<string, ResourceRestRecovery | null>,
): string[] {
  return Object.keys(maxResources).filter((k) => {
    if (TURN_KEYS.includes(k as typeof TURN_KEYS[number])) return false;
    if (k.startsWith('hit_dice_')) return false;
    if (recovery && Object.prototype.hasOwnProperty.call(recovery, k)) {
      return recovery[k]?.short_rest != null;
    }
    if (!recharge) return k !== 'heroic_inspiration';
    return recharge[k] === 'short_rest';
  });
}

/**
 * Amount restored for one eligible short-rest resource. Missing policy keeps
 * legacy full-pool recharge. An explicit null/malformed policy restores zero;
 * a configured fixed rule is bounded by both its amount and the pool maximum.
 */
export function resourceAmountRestoredOnShortRest(
  resourceKey: string,
  current: number,
  maximum: number,
  recovery?: Record<string, ResourceRestRecovery | null>,
): number {
  if (!Number.isSafeInteger(current) || !Number.isSafeInteger(maximum)
    || current < 0 || maximum < 0 || current >= maximum) return 0;

  const missing = maximum - current;
  if (!recovery || !Object.prototype.hasOwnProperty.call(recovery, resourceKey)) return missing;
  const rule = recovery[resourceKey]?.short_rest;
  if (!rule || rule.mode !== 'fixed' || !Number.isSafeInteger(rule.amount) || rule.amount <= 0) {
    return 0;
  }
  return Math.min(missing, rule.amount);
}

/** Full recovery declared for an explicitly configured resource. */
export function resourceAmountRestoredOnLongRest(
  resourceKey: string,
  current: number,
  maximum: number,
  recovery?: Record<string, ResourceRestRecovery | null>,
): number | null {
  if (!recovery || !Object.prototype.hasOwnProperty.call(recovery, resourceKey)) return null;
  if (!Number.isSafeInteger(current) || !Number.isSafeInteger(maximum)
    || current < 0 || maximum < 0 || current >= maximum) return 0;
  const rule = recovery[resourceKey]?.long_rest;
  if (!rule || rule.mode !== 'full') return 0;
  return maximum - current;
}
