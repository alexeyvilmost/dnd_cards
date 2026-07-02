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
  abilities: Partial<AbilityScores>;
  classSkillChoices: string[]; // выбранные навыки из class.skill_choices
  resolvedChoices: Record<string, string[]>; // выборы из механики (по id)
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
  classSkillChoices: [],
  resolvedChoices: {},
});
