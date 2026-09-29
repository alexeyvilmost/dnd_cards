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
 *  - minimum_total — поднять итог броска до указанного значения (Героическое вдохновение).
 *  - on_roll    — сработать payload-ами при натуральном значении (на 15 при атаке → парализовать
 *                 цель): natural + then[].
 * Правила урона (применяет execute.ts resolveDamageAmounts):
 *  - minimum_die — считать натуральный результат каждой подходящей кости не ниже value.
 *  - die_bonus  — +value к каждой кости заданных граней (+1 к каждой к8): applies_to.die + value.
 *  - critical_extra_die — добавить value костей того же размера к уже удвоенным костям крита.
 *  - reroll_damage — перебросить весь подходящий набор костей и оставить лучший результат.
 *  - explode    — взрывные кости: на натуральном максимуме добросить ещё (Чародейский выброс):
 *                 limit (сколько всего добросов; формула вычисляется вызывающим). Может задаваться
 *                 и свойством payload-урона `explode:{limit}` (локально для конкретного заклинания).
 */
import type { DieRoll } from '../mvp/contracts';
import { drawDie, type DieAwareRandomSource } from './random';

type Dict = Record<string, unknown>;

export const D20_RULE_OPS = new Set([
  'reroll', 'set_die', 'crit_range', 'outcome', 'on_roll', 'bonus_die',
  'bonus_die_on_failure', 'minimum_total', 'minimum_die',
  'advantage_dice', 'deny_advantage', 'deny_critical', 'set_die_result', 'critical_on_hit',
]);
export const DAMAGE_RULE_OPS = new Set([
  'minimum_die', 'die_bonus', 'critical_extra_die', 'explode',
  'reroll_damage', 'reroll_healing_ones', 'maximize_dice', 'set_die_result', 'add_dice_drop_lowest',
]);
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

/** Number of independently rolled dice while advantage/disadvantage is present. */
export function advantageDiceCount(rules: Dict[]): number {
  return rules.reduce((count, rule) => rule.op === 'advantage_dice'
    ? Math.max(count, Math.min(10, Math.max(2, Math.floor(num(rule.value, 2))))) : count, 2);
}

/** A replacement changes the adjudicated face, not merely its numeric bonus. */
export function declaredDieResult(rules: Dict[], faces: number): {value: number; source: string} | undefined {
  for (const rule of rules) {
    if (rule.op !== 'set_die_result') continue;
    const die = (rule.applies_to as Dict | undefined)?.die;
    if (die !== undefined && Number(die) !== faces) continue;
    const value = Number(rule.value);
    if (Number.isInteger(value) && value >= 1 && value <= faces) {
      return {value, source: String(rule.source ?? 'Замена результата кости')};
    }
  }
  return undefined;
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
  for (const r of rules) if (r.op === 'die_bonus' && ((r.applies_to as Dict)?.die === undefined || num((r.applies_to as Dict)?.die) === faces)) b += num(r.value, 0);
  return b;
}

/** Дополнительные кости к итогу d20 (Наставление/Благословение: +1к4). */
export function rollD20BonusDice(rules: Dict[], rng: () => number): DieRoll[] {
  const dice: DieRoll[] = [];
  for (const rule of rules) {
    if (rule.op !== 'bonus_die') continue;
    const rawFaces = Math.floor(num(rule.faces ?? rule.die ?? rule.value, 0));
    if (rawFaces < 2) continue;
    const faces = rawFaces;
    const count = Math.max(1, Math.floor(num(rule.count, 1)));
    const source = typeof rule.source === 'string' && rule.source.trim()
      ? rule.source.trim()
      : undefined;
    const sign: 1 | -1 = num(rule.sign, 1) < 0 ? -1 : 1;
    for (let index = 0; index < count; index += 1) {
      const rolled = drawDie(rng, faces);
      dice.push({
        role: 'bonus',
        sides: faces,
        ...((rng as DieAwareRandomSource).lastDieDrawOrdinal===undefined?{}:{drawOrdinal:(rng as DieAwareRandomSource).lastDieDrawOrdinal}),
        result: Math.max(declaredDieResult(rules,faces)?.value ?? rolled, d20MinimumDie(rules,faces)?.value ?? 1) + d20DieBonus(rules,faces),
        ...(source ? { source } : {}),
        ...(sign < 0 ? { sign } : {}),
      });
    }
  }
  return dice;
}

/** Bonus dice whose data explicitly permits use only after the base d20 test failed. */
export function rollD20FailureBonusDice(rules: Dict[], rng: () => number): DieRoll[] {
  return rollD20BonusDice(
    rules.filter((rule) => rule.op !== 'bonus_die')
      .map((rule) => rule.op === 'bonus_die_on_failure' ? { ...rule, op: 'bonus_die' } : rule),
    rng,
  );
}

/** Highest floor requested for the final d20 total. */
export function d20MinimumTotal(rules: Dict[]): { value: number; source: string } | undefined {
  let best: { value: number; source: string } | undefined;
  for (const rule of rules) {
    if (rule.op !== 'minimum_total') continue;
    const value = Math.floor(num(rule.value ?? rule.minimum, 0));
    if (!Number.isFinite(value) || value <= (best?.value ?? -Infinity)) continue;
    best = {
      value,
      source: typeof rule.source === 'string' && rule.source.trim()
        ? rule.source.trim()
        : 'Минимальный результат',
    };
  }
  return best;
}

/** A die floor contributes a visible adjustment; the physically rolled die is
 * retained for natural 1/20 rules, replay and post-roll interventions. */
export function d20MinimumDie(rules: Dict[], faces:number): {value:number;source:string}|undefined {
  let best:{value:number;source:string}|undefined;
  for(const rule of rules){
    if(rule.op!=='minimum_die')continue;
    const applies=rule.applies_to as Dict|undefined;
    if(applies?.die!==undefined && Number(applies.die)!==faces)continue;
    const value=Math.min(faces,Math.max(1,Math.floor(num(rule.value??rule.minimum,1))));
    if(!best || value>best.value)best={value,source:String(rule.source??'Минимальный результат кости')};
  }
  return best;
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
 * minimum_die и die_bonus. Возвращает новый
 * массив костей и дельту к сумме.
 */
export function applyDamageDieRules(
  dice: DieRoll[],
  rules: Dict[],
  opts: { explodeLimit?: number; rng: () => number },
): { dice: DieRoll[]; delta: number; usedRuleKeys: string[] } {
  const drawn=(sides:number):DieRoll=>{
    const result=drawDie(opts.rng,sides),ordinal=(opts.rng as DieAwareRandomSource).lastDieDrawOrdinal;
    return {sides,result,...(ordinal===undefined?{}:{drawOrdinal:ordinal})};
  };
  let delta = 0;
  const out = dice.map((d) => ({ ...d }));
  const usedRuleKeys: string[] = [];

  for (const rule of rules) {
    if (rule.op !== 'reroll_damage') continue;
    const dieSize = num((rule.applies_to as Dict)?.die);
    const eligible = out.filter((die) => !die.discarded
      && (!dieSize || die.sides === dieSize)
      && (rule.natural == null || matchesNatural(die.result, rule.natural)));
    if (!eligible.length) continue;
    const rerolled = eligible.map((die) => drawn(die.sides));
    const originalTotal = eligible.reduce((sum, die) => sum + die.result, 0);
    const rerolledTotal = rerolled.reduce((sum, die) => sum + die.result, 0);
    const keepNew = rule.keep === 'new';
    if (keepNew || rerolledTotal > originalTotal) {
      for (const die of eligible) die.discarded = true;
      out.push(...rerolled);
      delta += rerolledTotal - originalTotal;
    } else {
      out.push(...rerolled.map((die) => ({ ...die, discarded: true })));
    }
    const key = typeof rule.once_per_turn === 'string' && rule.once_per_turn.trim()
      ? rule.once_per_turn.trim()
      : undefined;
    if (key) usedRuleKeys.push(key);
  }

  for (const rule of rules) {
    if (rule.op !== 'critical_extra_die') continue;
    const exemplar = out.find((die) => !die.discarded);
    const count = Math.max(0, Math.floor(num(rule.value, 1)));
    if (!exemplar || count === 0) continue;
    for (let index = 0; index < count; index += 1) {
      const declaredFaces=Number(rule.faces);
      const faces=Number.isInteger(declaredFaces)&&declaredFaces>=2&&declaredFaces<=100?declaredFaces:exemplar.sides;
      const die=drawn(faces);
      out.push(die);
      delta += die.result;
    }
  }

  for (const rule of rules) {
    if (rule.op !== 'add_dice_drop_lowest') continue;
    const eligible=out.filter(die=>!die.discarded);
    const exemplar=eligible[0];
    if(!exemplar)continue;
    const extra=Math.min(10,Math.max(0,Math.floor(num(rule.extra,2))));
    for(let i=0;i<extra;i++){
      const die=drawn(exemplar.sides);
      out.push(die);eligible.push(die);delta+=die.result;
    }
    const drops=Math.min(eligible.length,Math.max(0,Math.floor(num(rule.drop,1))));
    for(const die of eligible.sort((a,b)=>a.result-b.result).slice(0,drops)){die.discarded=true;delta-=die.result;}
  }

  // A spell's native maximum-face explosion and item-owned face rules retain
  // independent budgets; adding a seven-face rider must not replace native eights.
  const explosions = [
    ...(opts.explodeLimit === undefined ? [] : [{rule:{} as Dict,budget:Math.max(0,Math.floor(opts.explodeLimit))}]),
    ...rules.filter(rule=>rule.op==='explode').map(rule=>({rule,budget:Math.max(0,Math.floor(num(rule.limit??rule.value,0)))})),
  ];
  for(let i=0;i<out.length;i++){
    const die=out[i];if(die.discarded)continue;
    for(const entry of explosions){
      if(entry.budget<=0||(entry.rule.natural?!matchesNatural(die.result,entry.rule.natural):die.result<die.sides))continue;
      const extra=drawn(die.sides);out.push(extra);delta+=extra.result;entry.budget--;
      if(typeof entry.rule.once_per_turn==='string')usedRuleKeys.push(entry.rule.once_per_turn);
    }
  }

  for (const rule of rules) {
    if (rule.op !== 'minimum_die') continue;
    const dieSize = num((rule.applies_to as Dict)?.die);
    const minimum = Math.max(1, Math.floor(num(rule.value ?? rule.minimum, 0)));
    if (!minimum) continue;
    for (const die of out) {
      if (die.discarded || (dieSize && die.sides !== dieSize) || die.result >= minimum) continue;
      delta += minimum - die.result;
      die.result = minimum;
    }
  }

  for (const die of out) {
    if (die.discarded) continue;
    const replacement = declaredDieResult(rules, die.sides);
    if (!replacement) continue;
    delta += replacement.value - die.result;
    die.result = replacement.value;
    die.source = replacement.source;
  }

  for (const r of rules) {
    if (r.op !== 'die_bonus') continue;
    const declaredDie = (r.applies_to as Dict)?.die;
    const dieSize = num(declaredDie);
    const v = num(r.value, 0);
    if (!v || (declaredDie !== undefined && dieSize < 2)) continue;
    for (const d of out) if (!d.discarded && (declaredDie === undefined || d.sides === dieSize)) { d.result += v; delta += v; }
  }

  return { dice: out, delta, usedRuleKeys: [...new Set(usedRuleKeys)] };
}
