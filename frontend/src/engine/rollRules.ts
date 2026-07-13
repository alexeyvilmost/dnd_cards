/**
 * Правила бросков (data-driven die interventions) — РАСШИРЯЕМЫЙ интерпретатор вмешательств в бросок.
 * Единый неймспейс op у payload `kind:'modifier'`; собираются как пассивы/эффекты тем же
 * collectModifiers. Новый эффект = новый op-обработчик здесь + данные (никакого хардкода под кейс).
 *
 * D20-правила (применяет roll.ts):
 *  - reroll     — переброс натуральной кости по предикату (Везение полурослика: natural {max:1}).
 *  - set_die    — заменить грани d20 (к24 вместо к20 при проверках): faces.
 *  - crit_range — сместить порог крита (складывается): value (отрицательное — крит легче).
 *  - outcome    — переопределить исход при натуральном значении в диапазоне (11–14 → крит-промах):
 *                 natural + value ('crit'|'crit_miss'|'hit'|'miss'|'success'|'fail').
 *  - on_roll    — сработать payload-ами при натуральном значении (на 15 при атаке → парализовать
 *                 цель): natural + then[].
 * Правила урона (применяет execute.ts resolveDamageAmounts):
 *  - die_bonus  — +value к каждой кости заданных граней (+1 к каждой к8): applies_to.die + value.
 *  - explode    — взрывные кости: на натуральном максимуме добросить ещё (Чародейский выброс):
 *                 limit (сколько всего добросов; формула вычисляется вызывающим). Может задаваться
 *                 и свойством payload-урона `explode:{limit}` (локально для конкретного заклинания).
 */
import type { DieRoll } from '../mvp/contracts';

type Dict = Record<string, unknown>;

export const D20_RULE_OPS = new Set(['reroll', 'set_die', 'crit_range', 'outcome', 'on_roll']);
export const DAMAGE_RULE_OPS = new Set(['die_bonus', 'explode']);
export const ROLL_RULE_OPS = new Set([...D20_RULE_OPS, ...DAMAGE_RULE_OPS]);

const num = (v: unknown, d = 0): number => { const n = Number(v); return Number.isFinite(n) ? n : d; };

/** Совпадение натурального значения кости с предикатом ({eq} | {min,max} | {min} | {max}). */
export function matchesNatural(natural: number, spec: unknown): boolean {
  if (spec == null || typeof spec !== 'object') return false;
  const s = spec as Dict;
  if (s.eq != null) return natural === num(s.eq, NaN);
  if (s.min != null || s.max != null) {
    const min = s.min != null ? num(s.min, -Infinity) : -Infinity;
    const max = s.max != null ? num(s.max, Infinity) : Infinity;
    return natural >= min && natural <= max;
  }
  return false;
}

// ─── D20-правила ────────────────────────────────────────────────────────────

/** Грани d20-броска: максимум из set_die-правил, иначе 20 (к24 вместо к20). */
export function d20Faces(rules: Dict[]): number {
  let faces = 20;
  for (const r of rules) if (r.op === 'set_die') faces = Math.max(faces, num(r.faces ?? r.value, 20));
  return faces;
}

/** Суммарное смещение диапазона крита (crit_range складывается). Отрицательное — крит легче. */
export function critRangeShift(rules: Dict[]): number {
  let s = 0;
  for (const r of rules) if (r.op === 'crit_range') s += num(r.value ?? r.shift, 0);
  return s;
}

/** Нужно ли перебросить натуральное значение (совпало любое reroll-правило). */
export function shouldReroll(rules: Dict[], natural: number): boolean {
  return rules.some((r) => r.op === 'reroll'
    && (r.natural != null ? matchesNatural(natural, r.natural) : natural <= num(r.value, 1)));
}

/** Плоский бонус к натуральной d20-кости граней faces (die_bonus с applies_to.die===faces). */
export function d20DieBonus(rules: Dict[], faces: number): number {
  let b = 0;
  for (const r of rules) if (r.op === 'die_bonus' && num((r.applies_to as Dict)?.die) === faces) b += num(r.value, 0);
  return b;
}

/** Переопределение исхода по натуральному значению; undefined — базовая логика. */
export function outcomeOverride(rules: Dict[], natural: number): string | undefined {
  for (const r of rules) if (r.op === 'outcome' && matchesNatural(natural, r.natural)) return String(r.value ?? r.outcome ?? '');
  return undefined;
}

/** Payload-ы (then) всех on_roll-правил, чьё условие по натуральному значению совпало. */
export function rollTriggers(rules: Dict[], natural: number): Dict[] {
  const out: Dict[] = [];
  for (const r of rules) {
    if (r.op !== 'on_roll' || !matchesNatural(natural, r.natural)) continue;
    const then = (r.then ?? r.result) as Dict[] | undefined;
    if (Array.isArray(then)) out.push(...then);
  }
  return out;
}

// ─── Правила урона (кости формулы) ──────────────────────────────────────────

/**
 * Применить правила урона к костям формулы (мутирует копию): сначала explode (на натуральном
 * максимуме добросить ещё того же размера, до limit суммарно — учитывая цепные взрывы), затем
 * die_bonus (+value к каждой кости заданных граней, включая добавленные взрывом). Возвращает новый
 * массив костей и дельту к сумме.
 */
export function applyDamageDieRules(
  dice: DieRoll[],
  rules: Dict[],
  opts: { explodeLimit?: number; rng: () => number },
): { dice: DieRoll[]; delta: number } {
  let delta = 0;
  const out = dice.map((d) => ({ ...d }));

  const exRule = rules.find((r) => r.op === 'explode');
  const limit = opts.explodeLimit ?? (exRule ? num(exRule.limit ?? exRule.value, 0) : 0);
  if (limit > 0) {
    let budget = limit;
    // Идём по костям, включая добавленные — цепные взрывы, но не больше budget суммарно.
    for (let i = 0; i < out.length && budget > 0; i += 1) {
      const d = out[i];
      if (d.discarded || d.result < d.sides) continue; // взрыв только на натуральном максимуме
      const nv = Math.floor(opts.rng() * d.sides) + 1;
      out.push({ sides: d.sides, result: nv });
      delta += nv;
      budget -= 1;
    }
  }

  for (const r of rules) {
    if (r.op !== 'die_bonus') continue;
    const dieSize = num((r.applies_to as Dict)?.die);
    const v = num(r.value, 0);
    if (!dieSize || !v) continue;
    for (const d of out) if (!d.discarded && d.sides === dieSize) { d.result += v; delta += v; }
  }

  return { dice: out, delta };
}
