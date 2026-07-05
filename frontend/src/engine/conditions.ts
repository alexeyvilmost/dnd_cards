/**
 * Правила состояний D&D 2024 (PHB, приложение «Состояния») в терминах
 * модификаторов движка. Состояние живёт как ActiveEffectEntry с mechanics
 * {kind:'condition', value}; collectRollModifiers подтягивает отсюда его
 * влияние на броски владельца листа.
 *
 * Моделируется то, что движок умеет исполнять (свои броски персонажа);
 * влияние на атаки ПО персонажу и авто-провалы отражены подсказкой (note).
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
  /** Напоминание о неисполнимой движком части правила. */
  note?: string;
}

export const CONDITION_RULES: Record<string, ConditionRule> = {
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

export function conditionRule(value: string): ConditionRule | null {
  return CONDITION_RULES[value] ?? null;
}

export function conditionLabel(value: string): string {
  return CONDITION_RULES[value]?.label ?? value;
}

/** Модификаторы состояния к своему броску (для collectRollModifiers). */
export function conditionModifierPayloads(value: string): ConditionRule['modifiers'] {
  return CONDITION_RULES[value]?.modifiers ?? [];
}

export const CONDITION_OPTIONS: Array<{ id: string; label: string }> =
  Object.values(CONDITION_RULES).map((r) => ({ id: r.id, label: r.label }));

export type { RollModifier };
