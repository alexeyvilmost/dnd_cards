/**
 * Состояния D&D 2024 как ДАННЫЕ (парадигма №1). Состояние — отдельный вид эффекта
 * (effect_type 'condition'); его поведение — набор `modifier`-правил с полем `scope`:
 *   - scope:'self'   (по умолчанию) — влияет на броски НОСИТЕЛЯ состояния;
 *   - scope:'target' — влияет на броски ПРОТИВ носителя (напр. «атаки по распластанному —
 *                      с преимуществом»). Это ДАННЫЕ внутри состояния, не код.
 *
 * Движок читает scope обобщённо: collectModifiers берёт self, projectedAgainst — target.
 * Здесь — живой реестр: все 15 встроенных состояний PHB 2024 (offline-сид,
 * зеркалит миграцию) + догруженные из
 * /api/conditions (registerConditions). Владелец добавляет/правит состояние данными.
 */
import type { ActiveEffectEntry, RollModifier, RuntimeState } from '../mvp/contracts';

type Dict = Record<string, unknown>;

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
  /** Legacy attack-category gate. PHB conditions use explicit `when` distance
   * facts instead: a ranged weapon can still attack from within 5 feet. */
  range?: 'melee' | 'ranged';
  /** Generic predicates evaluated against the active condition instance.  In
   * particular, `condition_source_*` predicates read ActiveEffectEntry.sourceId
   * and explicit board/GM facts; no condition id is hard-coded in the engine. */
  when?: Dict[];
}

export interface ConditionStackingRule {
  /** Most conditions are binary. `levels` keeps one runtime effect per level. */
  mode: 'binary' | 'levels';
  /** Optional hard ceiling for cumulative levels. */
  max?: number;
}

export interface ConditionRestRule {
  /** Number of direct condition instances removed after a completed Long Rest. */
  removeLevels?: number;
}

export interface ConditionThresholdRule {
  atLevel: number;
  outcome: 'death';
}

export interface ConditionRule {
  id: string;
  label: string;
  /** Правила состояния как scoped-модификаторы (self + target). */
  modifiers: ConditionModifier[];
  /** Non-modifier mechanics contributed by the condition.  They use the same
   * payload vocabulary as effects/actions (resistance, condition_immunity, …). */
  payloads?: Dict[];
  /** Композиция (PHB 2024): состояния, механика которых наследуется («Без сознания» → Опрокинут, Парализован …).
   *  conditionModifierPayloads раскрывает их транзитивно (со стражем циклов). */
  includes?: string[];
  /** Остаточные состояния при СНЯТИИ этого («Без сознания» окончилось → остаётесь Опрокинутым).
   *  При удалении/истечении носителя добавляются как самостоятельные состояния, если их ещё нет. */
  leaves?: string[];
  /** Data-owned cumulative/lifecycle rules (Exhaustion is the PHB exception). */
  stacking?: ConditionStackingRule;
  longRest?: ConditionRestRule;
  thresholds?: ConditionThresholdRule[];
  /** Explicit non-geometric facts available to sheets/boards even when no
   * state mutator currently consumes them. */
  worldFacts?: Dict;
  /** Напоминание о неисполнимой движком части правила. */
  note?: string;
}

const ATTACK = (extra?: Partial<ConditionModifier>): ConditionModifier => ({ applies_to: { roll: 'attack' }, op: 'disadvantage', ...extra });
/** Преимущество атак ПО носителю (проекция на атакующего) — чистые данные. */
const ADV_AGAINST: ConditionModifier = { applies_to: { roll: 'attack' }, op: 'advantage', scope: 'target' };
/** Скорость 0 (не может быть увеличена) — Схвачен/Опутан/Парализован/Без сознания. */
const SPEED0: ConditionModifier = { applies_to: { roll: 'speed' }, op: 'set', value: '0' };
/** Помеха/преимущество на бросок Инициативы (Недееспособный / Невидимый). */
const INIT = (op: 'advantage' | 'disadvantage'): ConditionModifier => ({ applies_to: { roll: 'initiative' }, op });
/** Автопровал спасброска характеристики (Парализован/Ошеломлён/Без сознания — СИЛ/ЛВК). */
const AUTOFAIL = (ability: string): ConditionModifier => ({ applies_to: { roll: 'saving_throw', filter: { ability } }, op: 'auto_fail' });
/** Автокрит попадания рукопашной атакой (Парализован/Без сознания — вблизи ≤5 фт). Проекция на атакующего. */
const WITHIN_5_FT: Dict = {
  kind: 'distance_to_condition_owner', subject: 'roller', operator: 'lte', feet: 5,
};
const BEYOND_5_FT: Dict = {
  kind: 'distance_to_condition_owner', subject: 'roller', operator: 'gt', feet: 5,
};
const ADV_AGAINST_WITHIN_5: ConditionModifier = {
  applies_to: { roll: 'attack' }, op: 'advantage', scope: 'target', when: [WITHIN_5_FT],
};
const DIS_AGAINST_BEYOND_5: ConditionModifier = {
  applies_to: { roll: 'attack' }, op: 'disadvantage', scope: 'target', when: [BEYOND_5_FT],
};
const AUTOCRIT_WITHIN_5: ConditionModifier = {
  applies_to: { roll: 'attack' }, op: 'auto_crit', scope: 'target', when: [WITHIN_5_FT],
};
/** Запрет способности экономики хода (Недееспособный — действие/бонусное/реакция/концентрация). */
const DENY = (cap: string): ConditionModifier => ({ applies_to: { roll: cap }, op: 'deny' });
const AUTOFAIL_CHECK = (sense: 'sight' | 'hearing'): ConditionModifier => ({
  applies_to: { roll: 'ability_check', filter: { sense } }, op: 'auto_fail',
});
const SOURCE_VISIBLE: Dict = { kind: 'condition_source_in_line_of_sight' };
const TARGET_IS_SOURCE: Dict = { kind: 'roll_target_is_condition_source' };
const TARGET_IS_NOT_SOURCE: Dict = { kind: 'roll_target_is_not_condition_source' };
const ROLLER_IS_SOURCE: Dict = { kind: 'roller_is_condition_source' };
const TARGET_CANNOT_SEE_OWNER: Dict = {
  kind: 'observer_can_see_condition_owner', observer: 'roll_target', value: false,
};
const ROLLER_CANNOT_SEE_OWNER: Dict = {
  kind: 'observer_can_see_condition_owner', observer: 'roller', value: false,
};

/** 15 встроенных состояний PHB 2024 — offline-сид (production can replace every
 * rule through registerConditions; these values keep offline/recovery mode exact). */
export const BUILTIN_CONDITION_RULES: Record<string, ConditionRule> = {
  blinded: {
    id: 'blinded', label: 'Ослеплён',
    modifiers: [AUTOFAIL_CHECK('sight'), ATTACK(), ADV_AGAINST],
    worldFacts: {
      cannot_see: true,
    },
  },
  charmed: {
    id: 'charmed', label: 'Очарован',
    modifiers: [
      // The holder cannot attack/damage the exact source of this condition.
      { applies_to: { roll: 'harm' }, op: 'deny', when: [TARGET_IS_SOURCE] },
      // The exact source gets Advantage on social checks against the holder.
      {
        applies_to: { roll: 'ability_check', filter: { interaction: 'social' } },
        op: 'advantage', scope: 'target', when: [ROLLER_IS_SOURCE],
      },
    ],
  },
  deafened: {
    id: 'deafened', label: 'Оглохший',
    modifiers: [AUTOFAIL_CHECK('hearing')],
  },
  exhaustion: {
    id: 'exhaustion', label: 'Истощение',
    // One persisted condition instance == one level. Repeating these additive
    // payloads naturally gives -2/-5 per level without an Exhaustion branch.
    modifiers: [
      { applies_to: { roll: 'd20' }, op: 'add', value: '-2' },
      { applies_to: { roll: 'speed' }, op: 'add', value: '-5' },
    ],
    stacking: { mode: 'levels', max: 6 },
    longRest: { removeLevels: 1 },
    thresholds: [{ atLevel: 6, outcome: 'death' }],
  },
  frightened: {
    id: 'frightened', label: 'Испуган',
    modifiers: [
      ATTACK({ when: [SOURCE_VISIBLE] }),
      { applies_to: { roll: 'ability_check' }, op: 'disadvantage', when: [SOURCE_VISIBLE] },
      {
        applies_to: { roll: 'movement_toward_condition_source' }, op: 'deny',
        // Unlike the D20 penalty, the prohibition on willingly approaching
        // the source remains even when the source is out of sight.
        when: [TARGET_IS_SOURCE],
      },
    ],
  },
  grappled: {
    id: 'grappled', label: 'Схвачен',
    modifiers: [ATTACK({ when: [TARGET_IS_NOT_SOURCE] }), SPEED0],
  },
  incapacitated: {
    id: 'incapacitated', label: 'Недееспособен',
    modifiers: [
      INIT('disadvantage'), DENY('action'), DENY('bonus_action'), DENY('reaction'),
      DENY('concentration'), DENY('speech'),
    ],
  },
  invisible: {
    id: 'invisible', label: 'Невидим',
    modifiers: [
      { applies_to: { roll: 'attack' }, op: 'advantage', when: [TARGET_CANNOT_SEE_OWNER] },
      {
        applies_to: { roll: 'attack' }, op: 'disadvantage', scope: 'target',
        when: [ROLLER_CANNOT_SEE_OWNER],
      },
      INIT('advantage'),
    ],
    worldFacts: {
      cannot_be_targeted_by_requires_sight_unless_seen: true,
    },
    note: 'Нельзя выбрать целью эффекта, требующего видеть цель, если создатель эффекта не способен вас видеть.',
  },
  paralyzed: {
    id: 'paralyzed', label: 'Парализован',
    modifiers: [ADV_AGAINST, SPEED0, AUTOFAIL('str'), AUTOFAIL('dex'), AUTOCRIT_WITHIN_5],
    includes: ['incapacitated'],
  },
  petrified: {
    id: 'petrified', label: 'Окаменел',
    modifiers: [ADV_AGAINST, SPEED0, AUTOFAIL('str'), AUTOFAIL('dex')],
    payloads: [
      { kind: 'resistance', damage_type: 'all', value: 'resistance' },
      { kind: 'condition_immunity', condition: 'poisoned' },
    ],
    includes: ['incapacitated'],
    worldFacts: {
      transformed_to_inanimate_substance: true,
      equipment_transformed_with_owner: 'nonmagical_worn_and_carried',
      weight_multiplier: 10,
      aging_paused: true,
    },
    note: 'Трансформация в вещество, десятикратный вес и прекращение старения остаются явными фактами мира.',
  },
  poisoned: {
    id: 'poisoned', label: 'Отравлен',
    modifiers: [ATTACK(), { applies_to: { roll: 'ability_check' }, op: 'disadvantage' }],
  },
  prone: {
    id: 'prone', label: 'Распластан',
    modifiers: [ATTACK(), ADV_AGAINST_WITHIN_5, DIS_AGAINST_BEYOND_5],
    worldFacts: {
      movement_options: ['crawl', 'stand', 'magic'],
      stand_cost: 'half_speed',
    },
    note: 'Можно ползти, потратить половину Скорости на вставание или прекратить состояние магией.',
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
    // PHB 2024 does NOT grant Paralyzed. Its mechanically similar clauses are
    // declared directly so predicates for Paralyzed never match Unconscious.
    modifiers: [ADV_AGAINST, SPEED0, AUTOFAIL('str'), AUTOFAIL('dex'), AUTOCRIT_WITHIN_5],
    includes: ['incapacitated', 'prone'],
    // Когда «Без сознания» заканчивается — вы остаётесь Опрокинутым.
    leaves: ['prone'],
    worldFacts: {
      drops_held_items: true,
      unaware_of_surroundings: true,
    },
    note: 'Вы не осознаёте окружение и роняете всё, что держите.',
  },
};

// Живой реестр: сид + догруженные из /api/conditions.
let registry: Record<string, ConditionRule> = { ...BUILTIN_CONDITION_RULES };

export type ConditionRegistryAuthority =
  | { mode: 'offline_fixture'; reason: string }
  | { mode: 'database_release'; setHash: string; loadedAt: string };

let registryAuthority: ConditionRegistryAuthority = {
  mode: 'offline_fixture',
  reason: 'application_start',
};

/** Догрузить/переопределить состояния из данных (вызывается после /api/conditions). */
export function registerConditions(defs: ConditionRule[]): void {
  for (const d of defs) {
    if (d && d.id) registry[d.id] = d;
  }
}

/** Atomically replace the live registry with one complete database release.
 * Validation happens in the loader before this call; no partial set is ever
 * observable by the engine. */
export function replaceConditionsFromDatabase(
  defs: ConditionRule[],
  setHash: string,
): void {
  registry = Object.fromEntries(defs.map((definition) => [definition.id, definition]));
  registryAuthority = {
    mode: 'database_release',
    setHash,
    loadedAt: new Date().toISOString(),
  };
}

/** Explicit offline/recovery mode. It is observable rather than a silent
 * merge of stale database rows with source-code defaults. */
export function resetConditionsToOfflineFixture(reason: string): void {
  registry = { ...BUILTIN_CONDITION_RULES };
  registryAuthority = { mode: 'offline_fixture', reason };
}

export function conditionRegistryAuthority(): ConditionRegistryAuthority {
  return { ...registryAuthority };
}

export function conditionRule(value: string): ConditionRule | null {
  return registry[value] ?? null;
}

export function conditionLabel(value: string): string {
  return registry[value]?.label ?? value;
}

const CONDITION_ROLL_LABELS: Record<string, string> = {
  attack: 'броски атак',
  saving_throw: 'спасброски',
  ability_check: 'проверки характеристик',
  initiative: 'инициативу',
  speed: 'скорость',
  action: 'действие',
  bonus_action: 'бонусное действие',
  reaction: 'реакцию',
  concentration: 'концентрацию',
  speech: 'речь',
  harm: 'нанесение вреда',
  movement_toward_condition_source: 'движение к источнику состояния',
};

/** Short player-facing rules summary used wherever an active condition is shown. */
export function conditionInstructions(value: string): string[] {
  const rule = conditionRule(value);
  if (!rule) return [];
  const rows = conditionModifierPayloads(value).map((modifier) => {
    const roll = CONDITION_ROLL_LABELS[modifier.applies_to.roll] ?? modifier.applies_to.roll;
    const ability = modifier.applies_to.filter?.ability
      ? ` (${String(modifier.applies_to.filter.ability).toUpperCase()})`
      : '';
    const subject = modifier.scope === 'target' ? ' по носителю состояния' : '';
    const range = modifier.range === 'melee'
      ? ' в ближнем бою'
      : modifier.range === 'ranged' ? ' в дальнем бою' : '';
    if (modifier.op === 'advantage') return `Преимущество на ${roll}${subject}${range}${ability}.`;
    if (modifier.op === 'disadvantage') return `Помеха на ${roll}${subject}${range}${ability}.`;
    if (modifier.op === 'auto_fail') return `Автоматический провал: ${roll}${ability}.`;
    if (modifier.op === 'auto_crit') return `Попадание становится критическим${subject}${range}.`;
    if (modifier.op === 'deny') return `Запрещено: ${roll}.`;
    if (modifier.op === 'set') return `${roll}: ${modifier.value}.`;
    if (modifier.op === 'multiply') return `${roll}: ×${modifier.value}.`;
    if (modifier.op === 'add') return `${roll}: ${modifier.value}.`;
    return `${roll}: ${modifier.op}${modifier.value == null ? '' : ` ${modifier.value}`}.`;
  });
  return [...new Set([...rows, ...(rule.note ? [rule.note] : [])])];
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

/** All non-modifier runtime payloads supplied by a condition and its includes. */
export function conditionRuntimePayloads(value: string, seen: Set<string> = new Set()): Dict[] {
  if (seen.has(value)) return [];
  seen.add(value);
  const rule = registry[value];
  if (!rule) return [];
  const out = [...(rule.payloads ?? [])];
  for (const inc of rule.includes ?? []) out.push(...conditionRuntimePayloads(inc, seen));
  return out;
}

/** Number of direct runtime instances. Binary conditions still report 0/1;
 * levelled conditions (Exhaustion) report their cumulative level. */
export function conditionLevel(state: RuntimeState, value: string): number {
  const count = state.activeEffects.filter((entry) => {
    const mechanics = entry.mechanics as Dict;
    return mechanics.kind === 'condition' && String(mechanics.value ?? '') === value;
  }).length;
  return registry[value]?.stacking?.mode === 'levels' ? count : Math.min(1, count);
}

export function conditionStacking(value: string): ConditionStackingRule {
  return registry[value]?.stacking ?? { mode: 'binary' };
}

export function conditionWorldFacts(value: string): Dict {
  return { ...(registry[value]?.worldFacts ?? {}) };
}

/** Values of one engine-owned world-fact primitive contributed by every
 * active condition, including composed conditions. The engine branches on the
 * primitive key, never on a condition id, so new conditions remain data. */
export function activeConditionWorldFactValues(
  state: RuntimeState,
  key: string,
): unknown[] {
  const direct = state.activeEffects.flatMap((entry) => {
    const mechanics = entry.mechanics as Dict;
    return mechanics.kind === 'condition' && typeof mechanics.value === 'string'
      ? [mechanics.value]
      : [];
  });
  const conditions = expandConditionSet(direct);
  return [...conditions].flatMap((value) => {
    const facts = registry[value]?.worldFacts;
    return facts && Object.prototype.hasOwnProperty.call(facts, key) ? [facts[key]] : [];
  });
}

/** Convenience predicate for boolean world-fact capabilities. */
export function activeConditionWorldFactEnabled(state: RuntimeState, key: string): boolean {
  return activeConditionWorldFactValues(state, key).some((value) => value === true);
}

/** Data-declared terminal outcomes reached by cumulative condition levels. */
export function conditionThresholdOutcomes(state: RuntimeState): Array<{
  condition: string; level: number; outcome: ConditionThresholdRule['outcome'];
}> {
  return Object.values(registry).flatMap((rule) => {
    const level = conditionLevel(state, rule.id);
    return (rule.thresholds ?? [])
      .filter((threshold) => level >= threshold.atLevel)
      .map((threshold) => ({ condition: rule.id, level, outcome: threshold.outcome }));
  });
}

/** Apply condition-owned Long Rest transitions before ordinary temporary
 * effects are cleared. Returns the retained level entries and their removals. */
export function conditionLongRestEntries(activeEffects: ActiveEffectEntry[]): {
  retained: ActiveEffectEntry[];
  removed: ActiveEffectEntry[];
} {
  const retained: ActiveEffectEntry[] = [];
  const removed: ActiveEffectEntry[] = [];
  const byCondition = new Map<string, ActiveEffectEntry[]>();
  for (const entry of activeEffects) {
    const mechanics = entry.mechanics as Dict;
    if (mechanics.kind !== 'condition') {
      retained.push(entry);
      continue;
    }
    const value = String(mechanics.value ?? '');
    const current = byCondition.get(value) ?? [];
    current.push(entry);
    byCondition.set(value, current);
  }
  for (const [value, entries] of byCondition) {
    const declaredRemoval = registry[value]?.longRest?.removeLevels;
    // A Long Rest does not generically cure conditions. The source duration,
    // a save, magic, or an explicit condition lifecycle rule must end one.
    const removeLevels = Math.max(0, Math.floor(declaredRemoval ?? 0));
    const split = Math.min(removeLevels, entries.length);
    removed.push(...entries.slice(0, split));
    retained.push(...entries.slice(split));
  }
  return { retained, removed };
}

/** Остаточные состояния, которые ОСТАЮТСЯ при снятии данного (Без сознания → Опрокинут). */
export function conditionLeaves(value: string): string[] {
  return registry[value]?.leaves ?? [];
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
