// Типы новой (сущностно-ориентированной) системы персонажей — «CharacterForge».
// Название ForgeCharacter выбрано, чтобы не конфликтовать с существующим
// CharacterV3 из utils/characterCalculationsV3 (тот построен на API characters-v2).

import type { CharacterRuleState } from './rules/types';

export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export type AbilityScores = Record<AbilityKey, number>;

// Персонаж, как он хранится в characters_v3 (ответ бэкенда).
export interface ForgeCharacter {
  id: string;
  user_id: string;
  group_id?: string | null;
  name: string;
  avatar_url?: string;

  race_id?: string | null;
  lineage_id?: string | null;
  class_id?: string | null;
  background_id?: string | null;
  level: number;

  feat_ids?: string[] | null;
  spell_ids?: string[] | null;

  abilities?: Partial<AbilityScores> | null;

  skill_proficiencies?: string[] | null;
  skill_expertise?: string[] | null;
  saving_throw_proficiencies?: string[] | null;
  tool_proficiencies?: string[] | null;
  tool_expertise?: string[] | null;
  languages?: string[] | null;

  resolved_choices?: Record<string, string[]> | null;
  rule_state?: CharacterRuleState | null;

  max_hp: number;
  current_hp: number;
  speed: number;
  proficiency_bonus: number;
  armor_class?: number;
  initiative_bonus?: number;
  passive_perception?: number;

  equipment?: Record<string, string | null> | null;
  inventory_items?: Array<{ card_id: string; qty: number }> | null;
  resources?: Record<string, number> | null;
  max_resources?: Record<string, number> | null;
  active_effects?: unknown[] | null;
  turn_state?: Record<string, unknown> | null;
  currency?: Record<string, number> | null;

  created_at: string;
  updated_at: string;
}

// Тело запроса create/update. Редактор держит полное состояние и шлёт его целиком
// (update на бэкенде — полная замена полей).
export interface SaveForgeCharacterRequest {
  name: string;
  avatar_url?: string;
  race_id?: string | null;
  lineage_id?: string | null;
  class_id?: string | null;
  background_id?: string | null;
  level?: number;
  feat_ids?: string[] | null;
  spell_ids?: string[] | null;
  abilities?: Partial<AbilityScores> | null;
  skill_proficiencies?: string[] | null;
  skill_expertise?: string[] | null;
  saving_throw_proficiencies?: string[] | null;
  tool_proficiencies?: string[] | null;
  tool_expertise?: string[] | null;
  languages?: string[] | null;
  resolved_choices?: Record<string, string[]> | null;
  rule_state?: CharacterRuleState | null;
  max_hp?: number;
  current_hp?: number;
  speed?: number;
  proficiency_bonus?: number;
  armor_class?: number;
  initiative_bonus?: number;
  passive_perception?: number;
}

// Метод генерации характеристик (решение владельца 2026-07-05: point-buy — основной).
export type AbilityGenMethod = 'point_buy' | 'manual';

// Бонусы характеристик от предыстории (+2/+1 или +1/+1/+1, PHB 2024).
export interface AbilityBonuses {
  mode: 'two_one' | 'one_one_one';
  /** ability → 2 | 1 */
  assignments: Partial<Record<AbilityKey, number>>;
  /** true — можно назначать на любые характеристики, не только из предыстории. */
  anyAbilities: boolean;
}

export const emptyBonuses = (): AbilityBonuses => ({
  mode: 'two_one',
  assignments: {},
  anyAbilities: false,
});

// Черновик персонажа в состоянии редактора (до/во время создания).
export interface CharacterDraft {
  id?: string; // если редактируется уже сохранённый черновик
  name: string;
  avatarUrl?: string;
  raceId: string | null;
  lineageId: string | null;
  classId: string | null;
  backgroundId: string | null;
  level: number;
  featIds: string[];
  /** UUID заклинаний, выбранных игроком (не slug из grant_spell). */
  spellIds: string[];
  /** Slug-и заклинаний из rule_state / grant_spell (только для загрузки). */
  grantedSpellSlugs?: string[];
  /** ИТОГОВЫЕ значения (база point-buy + бонусы предыстории). */
  abilities: Partial<AbilityScores>;
  /** true — игрок правил характеристики вручную; смена класса их не трогает. */
  abilitiesTouched?: boolean;
  abilityMethod: AbilityGenMethod;
  abilityBonuses: AbilityBonuses;
  /** Вариант стартового снаряжения предыстории (a — предметы, b — золото). */
  equipmentOption: 'a' | 'b';
  classSkillChoices: string[]; // выбранные навыки из class.skill_choices
  resolvedChoices: Record<string, string[]>; // выборы из механики (по id)
  /** «Сменить черту происхождения» в предыстории → показывает вкладку «Черта». */
  swapFeat?: boolean;
}

export const STANDARD_ARRAY: number[] = [15, 14, 13, 12, 10, 8];

export const ABILITY_KEYS: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const ABILITY_LABEL_RU: Record<AbilityKey, string> = {
  str: 'Сила',
  dex: 'Ловкость',
  con: 'Телосложение',
  int: 'Интеллект',
  wis: 'Мудрость',
  cha: 'Харизма',
};

export const emptyDraft = (): CharacterDraft => ({
  name: '',
  raceId: null,
  lineageId: null,
  classId: null,
  backgroundId: null,
  level: 1,
  featIds: [],
  spellIds: [],
  abilities: {},
  abilityMethod: 'point_buy',
  abilityBonuses: emptyBonuses(),
  equipmentOption: 'a',
  classSkillChoices: [],
  resolvedChoices: {},
});
