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
  /** roll — цель модификатора. Помимо d20-бросков (attack/save/check/initiative) сюда входят
   *  ПРОИЗВОДНЫЕ значения (speed и т.п.): состояние «Схвачен» задаёт скорость через op:'set'. */
  applies_to: { roll: 'attack' | 'saving_throw' | 'ability_check' | 'initiative' | 'speed'; filter?: Record<string, unknown> };
  /** advantage/disadvantage — для d20; add — аддитивный бонус; set/multiply/upgrade/downgrade —
   *  не-аддитивная алгебра над значением (скорость 0 у Схвачен = op:'set', value:'0'). */
  op: 'advantage' | 'disadvantage' | 'add' | 'set' | 'multiply' | 'upgrade' | 'downgrade';
  value?: string;
  /** 'self' (по умолчанию) — на броски носителя; 'target' — на броски против носителя. */
  scope?: 'self' | 'target';
}

export interface ConditionRule {
  id: string;
  label: string;
  /** Правила состояния как scoped-модификаторы (self + target). */
  modifiers: ConditionModifier[];
  /** Напоминание о неисполнимой движком части правила. */
  note?: string;
}

const ATTACK = (extra?: Partial<ConditionModifier>): ConditionModifier => ({ applies_to: { roll: 'attack' }, op: 'disadvantage', ...extra });
/** Преимущество атак ПО носителю (проекция на атакующего) — чистые данные. */
const ADV_AGAINST: ConditionModifier = { applies_to: { roll: 'attack' }, op: 'advantage', scope: 'target' };
const DIS_AGAINST: ConditionModifier = { applies_to: { roll: 'attack' }, op: 'disadvantage', scope: 'target' };
/** Скорость 0 (не может быть увеличена) — Схвачен/Опутан/Парализован/Без сознания. */
const SPEED0: ConditionModifier = { applies_to: { roll: 'speed' }, op: 'set', value: '0' };
/** Помеха/преимущество на бросок Инициативы (Недееспособный / Невидимый). */
const INIT = (op: 'advantage' | 'disadvantage'): ConditionModifier => ({ applies_to: { roll: 'initiative' }, op });

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
    modifiers: [INIT('disadvantage')],
    note: 'Нет действий/бонусных действий/реакций; концентрация прервана; безмолвие.',
  },
  invisible: {
    id: 'invisible', label: 'Невидим',
    modifiers: [{ applies_to: { roll: 'attack' }, op: 'advantage' }, DIS_AGAINST, INIT('advantage')],
    note: 'Скрытность: вас не могут видеть без особых средств.',
  },
  paralyzed: {
    id: 'paralyzed', label: 'Парализован',
    modifiers: [ADV_AGAINST, SPEED0],
    note: 'Недееспособен; провал спасбросков СИЛ/ЛВК; атаки по вам вблизи — крит.',
  },
  poisoned: {
    id: 'poisoned', label: 'Отравлен',
    modifiers: [ATTACK(), { applies_to: { roll: 'ability_check' }, op: 'disadvantage' }],
  },
  prone: {
    id: 'prone', label: 'Распластан',
    modifiers: [ATTACK()],
    note: 'Атаки по вам вблизи — с преимуществом, издалека — с помехой (зависит от дальности). Встать — половина скорости.',
  },
  restrained: {
    id: 'restrained', label: 'Опутан',
    modifiers: [ATTACK(), { applies_to: { roll: 'saving_throw', filter: { ability: 'dex' } }, op: 'disadvantage' }, ADV_AGAINST, SPEED0],
  },
  stunned: {
    id: 'stunned', label: 'Ошеломлён',
    modifiers: [ADV_AGAINST],
    note: 'Недееспособен; провал спасбросков СИЛ/ЛВК.',
  },
  unconscious: {
    id: 'unconscious', label: 'Без сознания',
    modifiers: [ADV_AGAINST, SPEED0],
    note: 'Недееспособен, распластан; провал СИЛ/ЛВК; атаки по вам вблизи — крит.',
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

/** Все scoped-модификаторы состояния (self + target). Фильтрацию по scope делают вызывающие. */
export function conditionModifierPayloads(value: string): ConditionModifier[] {
  return registry[value]?.modifiers ?? [];
}

/** Актуальный список состояний (сид + догруженные) для селекторов UI. */
export function conditionOptions(): Array<{ id: string; label: string }> {
  return Object.values(registry).map((r) => ({ id: r.id, label: r.label }));
}

/** Совместимость: снимок встроенных состояний (устар. — используйте conditionOptions()). */
export const CONDITION_OPTIONS: Array<{ id: string; label: string }> =
  Object.values(BUILTIN_CONDITION_RULES).map((r) => ({ id: r.id, label: r.label }));

export type { RollModifier };
