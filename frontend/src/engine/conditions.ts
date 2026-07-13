/**
 * Состояния D&D 2024 как ДАННЫЕ (парадигма №1). Состояние — отдельный вид эффекта
 * (effect_type 'condition'); его поведение — набор `modifier`-правил с полем `scope`:
 *   - scope:'self'   (по умолчанию) — влияет на броски НОСИТЕЛЯ состояния;
 *   - scope:'target' — влияет на броски ПРОТИВ носителя (напр. «атаки по распластанному —
 *                      с преимуществом»). Это ДАННЫЕ внутри состояния, не код.
 *
 * Движок читает scope обобщённо: collectModifiers берёт self, projectedAgainst — target.
 * Здесь — живой реестр: 13 встроенных (offline-сид, зеркалит миграцию) + догруженные из
 * /api/conditions (registerConditions). Владелец добавляет/правит состояние данными.
 */
import type { RollModifier } from '../mvp/contracts';

export interface ConditionModifier {
  /** roll — цель модификатора: d20-броски (attack/saving_throw/ability_check/initiative),
   *  ПРОИЗВОДНЫЕ значения (speed) и «способности» экономики хода (action/bonus_action/reaction/
   *  concentration) — для op:'deny'. Строка, чтобы состояния расширялись данными. */
  applies_to: { roll: string; filter?: Record<string, unknown> };
  /** advantage/disadvantage — для d20; add — аддитивный бонус; set/multiply/upgrade/downgrade —
   *  алгебра над значением (скорость 0 = op:'set',value:'0'); auto_fail — автопровал спаса;
   *  auto_crit — попадание становится критом; deny — запрет способности (экономика хода). */
  op: 'advantage' | 'disadvantage' | 'add' | 'set' | 'multiply' | 'upgrade' | 'downgrade'
    | 'auto_fail' | 'auto_crit' | 'deny';
  value?: string;
  /** 'self' (по умолчанию) — на броски носителя; 'target' — на броски против носителя. */
  scope?: 'self' | 'target';
  /** Дистанционный гейт для target-проекции (Распластан/Парализован): 'melee' — только рукопашные
   *  атаки (в пределах 5 фт), 'ranged' — только дальнобойные. undefined — любые. */
  range?: 'melee' | 'ranged';
}

export interface ConditionRule {
  id: string;
  label: string;
  /** Правила состояния как scoped-модификаторы (self + target). */
  modifiers: ConditionModifier[];
  /** Композиция (PHB 2024): состояния, механика которых наследуется («Без сознания» → Недееспособен …).
   *  conditionModifierPayloads раскрывает их транзитивно (со стражем циклов). */
  includes?: string[];
  /** Напоминание о неисполнимой движком части правила. */
  note?: string;
}

const ATTACK = (extra?: Partial<ConditionModifier>): ConditionModifier => ({ applies_to: { roll: 'attack' }, op: 'disadvantage', ...extra });
/** Преимущество атак ПО носителю (проекция на атакующего) — чистые данные. */
const ADV_AGAINST: ConditionModifier = { applies_to: { roll: 'attack' }, op: 'advantage', scope: 'target' };
const DIS_AGAINST: ConditionModifier = { applies_to: { roll: 'attack' }, op: 'disadvantage', scope: 'target' };
/** Проекция с дистанционным гейтом (Распластан): рукопашные атаки по вам — преимущество, дальнобойные — помеха. */
const ADV_AGAINST_MELEE: ConditionModifier = { applies_to: { roll: 'attack' }, op: 'advantage', scope: 'target', range: 'melee' };
const DIS_AGAINST_RANGED: ConditionModifier = { applies_to: { roll: 'attack' }, op: 'disadvantage', scope: 'target', range: 'ranged' };
/** Скорость 0 (не может быть увеличена) — Схвачен/Опутан/Парализован/Без сознания. */
const SPEED0: ConditionModifier = { applies_to: { roll: 'speed' }, op: 'set', value: '0' };
/** Помеха/преимущество на бросок Инициативы (Недееспособный / Невидимый). */
const INIT = (op: 'advantage' | 'disadvantage'): ConditionModifier => ({ applies_to: { roll: 'initiative' }, op });
/** Автопровал спасброска характеристики (Парализован/Ошеломлён/Без сознания — СИЛ/ЛВК). */
const AUTOFAIL = (ability: string): ConditionModifier => ({ applies_to: { roll: 'saving_throw', filter: { ability } }, op: 'auto_fail' });
/** Автокрит попадания рукопашной атакой (Парализован/Без сознания — вблизи ≤5 фт). Проекция на атакующего. */
const AUTOCRIT_MELEE: ConditionModifier = { applies_to: { roll: 'attack' }, op: 'auto_crit', scope: 'target', range: 'melee' };
/** Запрет способности экономики хода (Недееспособный — действие/бонусное/реакция/концентрация). */
const DENY = (cap: 'action' | 'bonus_action' | 'reaction' | 'concentration'): ConditionModifier => ({ applies_to: { roll: cap }, op: 'deny' });

/** 13 встроенных состояний PHB 2024 — offline-сид (совпадает с миграцией). */
export const BUILTIN_CONDITION_RULES: Record<string, ConditionRule> = {
  blinded: {
    id: 'blinded', label: 'Ослеплён',
    modifiers: [ATTACK(), ADV_AGAINST],
    note: 'Вы проваливаете проверки, требующие зрения.',
  },
  charmed: {
    id: 'charmed', label: 'Очарован',
    modifiers: [],
    note: 'Нельзя атаковать очаровавшего; у него преимущество на социальные проверки против вас.',
  },
  deafened: {
    id: 'deafened', label: 'Оглохший',
    modifiers: [],
    note: 'Вы проваливаете проверки, требующие слуха.',
  },
  frightened: {
    id: 'frightened', label: 'Испуган',
    modifiers: [ATTACK(), { applies_to: { roll: 'ability_check' }, op: 'disadvantage' }],
    note: 'Помеха, пока источник страха в поле зрения; нельзя приближаться к нему.',
  },
  grappled: {
    id: 'grappled', label: 'Схвачен',
    modifiers: [ATTACK(), SPEED0],
    note: 'Помеха на атаки по всем, кроме схватившего.',
  },
  incapacitated: {
    id: 'incapacitated', label: 'Недееспособен',
    modifiers: [INIT('disadvantage'), DENY('action'), DENY('bonus_action'), DENY('reaction'), DENY('concentration')],
    note: 'Безмолвие: нельзя говорить.',
  },
  invisible: {
    id: 'invisible', label: 'Невидим',
    modifiers: [{ applies_to: { roll: 'attack' }, op: 'advantage' }, DIS_AGAINST, INIT('advantage')],
    note: 'Скрытность: вас не могут видеть без особых средств.',
  },
  paralyzed: {
    id: 'paralyzed', label: 'Парализован',
    modifiers: [ADV_AGAINST, SPEED0, AUTOFAIL('str'), AUTOFAIL('dex'), AUTOCRIT_MELEE],
    includes: ['incapacitated'],
  },
  poisoned: {
    id: 'poisoned', label: 'Отравлен',
    modifiers: [ATTACK(), { applies_to: { roll: 'ability_check' }, op: 'disadvantage' }],
  },
  prone: {
    id: 'prone', label: 'Распластан',
    modifiers: [ATTACK(), ADV_AGAINST_MELEE, DIS_AGAINST_RANGED],
    note: 'Встать — половина скорости.',
  },
  restrained: {
    id: 'restrained', label: 'Опутан',
    modifiers: [ATTACK(), { applies_to: { roll: 'saving_throw', filter: { ability: 'dex' } }, op: 'disadvantage' }, ADV_AGAINST, SPEED0],
  },
  stunned: {
    id: 'stunned', label: 'Ошеломлён',
    modifiers: [ADV_AGAINST, AUTOFAIL('str'), AUTOFAIL('dex')],
    includes: ['incapacitated'],
  },
  unconscious: {
    id: 'unconscious', label: 'Без сознания',
    modifiers: [ADV_AGAINST, SPEED0, AUTOFAIL('str'), AUTOFAIL('dex'), AUTOCRIT_MELEE],
    includes: ['incapacitated'],
    note: 'Вы роняете всё, что держите; распластаны.',
  },
};

// Живой реестр: сид + догруженные из /api/conditions.
const registry: Record<string, ConditionRule> = { ...BUILTIN_CONDITION_RULES };

/** Догрузить/переопределить состояния из данных (вызывается после /api/conditions). */
export function registerConditions(defs: ConditionRule[]): void {
  for (const d of defs) {
    if (d && d.id) registry[d.id] = d;
  }
}

export function conditionRule(value: string): ConditionRule | null {
  return registry[value] ?? null;
}

export function conditionLabel(value: string): string {
  return registry[value]?.label ?? value;
}

/**
 * Все scoped-модификаторы состояния (self + target), включая унаследованные от `includes`
 * (композиция PHB 2024: «Без сознания» → Недееспособен и т.д.). Раскрытие ТРАНЗИТИВНОЕ со стражем
 * циклов. Фильтрацию по scope/дальности делают вызывающие (collectModifiers / projectedAgainst).
 */
export function conditionModifierPayloads(value: string, seen: Set<string> = new Set()): ConditionModifier[] {
  if (seen.has(value)) return [];
  seen.add(value);
  const rule = registry[value];
  if (!rule) return [];
  const out = [...rule.modifiers];
  for (const inc of rule.includes ?? []) out.push(...conditionModifierPayloads(inc, seen));
  return out;
}

/** Множество состояний носителя, раскрытое по композиции (для предикатов you_have/target_has_condition). */
export function expandConditionSet(values: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const visit = (v: string): void => {
    if (out.has(v)) return;
    out.add(v);
    for (const inc of registry[v]?.includes ?? []) visit(inc);
  };
  for (const v of values) visit(v);
  return out;
}

/** Актуальный список состояний (сид + догруженные) для селекторов UI. */
export function conditionOptions(): Array<{ id: string; label: string }> {
  return Object.values(registry).map((r) => ({ id: r.id, label: r.label }));
}

/** Совместимость: снимок встроенных состояний (устар. — используйте conditionOptions()). */
export const CONDITION_OPTIONS: Array<{ id: string; label: string }> =
  Object.values(BUILTIN_CONDITION_RULES).map((r) => ({ id: r.id, label: r.label }));

export type { RollModifier };
