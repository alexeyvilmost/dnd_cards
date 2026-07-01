// Типы новой (сущностно-ориентированной) системы персонажей — «CharacterForge».
// Название ForgeCharacter выбрано, чтобы не конфликтовать с существующим
// CharacterV3 из utils/characterCalculationsV3 (тот построен на API characters-v2).

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
  saving_throw_proficiencies?: string[] | null;
  tool_proficiencies?: string[] | null;
  languages?: string[] | null;

  resolved_choices?: Record<string, string[]> | null;

  max_hp: number;
  current_hp: number;
  speed: number;
  proficiency_bonus: number;

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
  saving_throw_proficiencies?: string[] | null;
  tool_proficiencies?: string[] | null;
  languages?: string[] | null;
  resolved_choices?: Record<string, string[]> | null;
  max_hp?: number;
  current_hp?: number;
  speed?: number;
  proficiency_bonus?: number;
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
  spellIds: string[];
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
