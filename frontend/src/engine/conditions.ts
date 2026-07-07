/**
 * Правила состояний D&D 2024. Фаза D: состояния — ДАННЫЕ (сущность Condition,
 * /api/conditions), а не хардкод. Здесь — живой реестр: 13 встроенных (сид/фолбэк,
 * совпадает с миграцией 064 — движок работает и без сети) + догруженные из API через
 * registerConditions. Владелец добавляет состояние данными, без перевыкатки (парадигма №1).
 *
 * Моделируется то, что движок исполняет (свои броски владельца, `modifiers`).
 * `projected` — влияние состояния на атакующего/окружающих (двусторонний бой, фаза E).
 * Неисполнимая движком часть — в `note`.
 */
import type { RollModifier } from '../mvp/contracts';

export interface ConditionRule {
  id: string;
  label: string;
  /** Модификаторы к СВОИМ броскам (формат applies_to как у kind:'modifier'). */
  modifiers: Array<{
    applies_to: { roll: 'attack' | 'saving_throw' | 'ability_check'; filter?: Record<string, unknown> };
    op: 'advantage' | 'disadvantage' | 'add';
    value?: string;
  }>;
  /** Модификаторы, которые состояние ПРОЕЦИРУЕТ на атакующего/окружающих (фаза E). */
  projected?: ConditionRule['modifiers'];
  /** Напоминание о неисполнимой движком части правила. */
  note?: string;
}

/** 13 встроенных состояний PHB 2024 — сид/фолбэк (совпадает с миграцией 064). */
export const BUILTIN_CONDITION_RULES: Record<string, ConditionRule> = {
  blinded: {
    id: 'blinded', label: 'Ослеплён',
    modifiers: [{ applies_to: { roll: 'attack' }, op: 'disadvantage' }],
    note: 'Атаки по вам — с преимуществом; вы проваливаете проверки, требующие зрения.',
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
    modifiers: [
      { applies_to: { roll: 'attack' }, op: 'disadvantage' },
      { applies_to: { roll: 'ability_check' }, op: 'disadvantage' },
    ],
    note: 'Помеха, пока источник страха в поле зрения; нельзя приближаться к нему.',
  },
  grappled: {
    id: 'grappled', label: 'Схвачен',
    modifiers: [{ applies_to: { roll: 'attack' }, op: 'disadvantage' }],
    note: 'Скорость 0; помеха на атаки по всем, кроме схватившего.',
  },
  incapacitated: {
    id: 'incapacitated', label: 'Недееспособен',
    modifiers: [],
    note: 'Нет действий/бонусных действий/реакций; концентрация прервана; помеха на инициативу.',
  },
  invisible: {
    id: 'invisible', label: 'Невидим',
    modifiers: [{ applies_to: { roll: 'attack' }, op: 'advantage' }],
    note: 'Преимущество на инициативу; атаки по вам — с помехой.',
  },
  paralyzed: {
    id: 'paralyzed', label: 'Парализован',
    modifiers: [],
    note: 'Недееспособен; провал спасбросков СИЛ/ЛВК; атаки по вам с преимуществом, вблизи — крит.',
  },
  poisoned: {
    id: 'poisoned', label: 'Отравлен',
    modifiers: [
      { applies_to: { roll: 'attack' }, op: 'disadvantage' },
      { applies_to: { roll: 'ability_check' }, op: 'disadvantage' },
    ],
  },
  prone: {
    id: 'prone', label: 'Распластан',
    modifiers: [{ applies_to: { roll: 'attack' }, op: 'disadvantage' }],
    note: 'Атаки по вам вблизи — с преимуществом, издалека — с помехой. Встать — половина скорости.',
  },
  restrained: {
    id: 'restrained', label: 'Опутан',
    modifiers: [
      { applies_to: { roll: 'attack' }, op: 'disadvantage' },
      { applies_to: { roll: 'saving_throw', filter: { ability: 'dex' } }, op: 'disadvantage' },
    ],
    note: 'Скорость 0; атаки по вам — с преимуществом.',
  },
  stunned: {
    id: 'stunned', label: 'Ошеломлён',
    modifiers: [],
    note: 'Недееспособен; провал спасбросков СИЛ/ЛВК; атаки по вам — с преимуществом.',
  },
  unconscious: {
    id: 'unconscious', label: 'Без сознания',
    modifiers: [],
    note: 'Недееспособен, распластан; провал СИЛ/ЛВК; атаки по вам с преимуществом, вблизи — крит.',
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

/** Модификаторы состояния к своему броску (для collectModifiers). */
export function conditionModifierPayloads(value: string): ConditionRule['modifiers'] {
  return registry[value]?.modifiers ?? [];
}

/** Проецируемые модификаторы (влияние на атакующего/окружающих — фаза E). */
export function conditionProjectedModifiers(value: string): ConditionRule['modifiers'] {
  return registry[value]?.projected ?? [];
}

/** Актуальный список состояний (сид + догруженные) для селекторов UI. */
export function conditionOptions(): Array<{ id: string; label: string }> {
  return Object.values(registry).map((r) => ({ id: r.id, label: r.label }));
}

/** Совместимость: снимок встроенных состояний (устар. — используйте conditionOptions()). */
export const CONDITION_OPTIONS: Array<{ id: string; label: string }> =
  Object.values(BUILTIN_CONDITION_RULES).map((r) => ({ id: r.id, label: r.label }));

export type { RollModifier };
