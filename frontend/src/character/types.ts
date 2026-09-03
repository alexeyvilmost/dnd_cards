// Типы новой (сущностно-ориентированной) системы персонажей — «CharacterForge».
// Название ForgeCharacter подчёркивает принадлежность к сущностной системе
// CharacterForge и не смешивает её с серверной моделью CharacterV3.

import type { CharacterRuleState } from './rules/types';

export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export type AbilityScores = Record<AbilityKey, number>;
export type CharacterType = 'free' | 'campaign' | 'dungeon_crawl';
export type CharacterAccessMode = 'owner' | 'legacy_public_readonly';

export const DEFAULT_CHARACTER_SYSTEM_ID = 'dnd5e-2024';
export const DEFAULT_CHARACTER_RULESET_VERSION = '2024';
export const DEFAULT_CHARACTER_TYPE: CharacterType = 'free';
export const CURRENT_CHARACTER_SCHEMA_VERSION = 1;

export const CHARACTER_TYPE_LABELS: Record<CharacterType, string> = {
  free: 'Свободный лист',
  campaign: 'Персонаж кампании',
  dungeon_crawl: 'Dungeon Crawl',
};

// Персонаж, как он хранится в characters_v3 (ответ бэкенда).
export interface ForgeCharacter {
  id: string;
  user_id: string;
  group_id?: string | null;
  name: string;
  avatar_url?: string;
  description?: string;
  notes?: string;
  system_id: string;
  ruleset_version: string;
  character_type: CharacterType;
  character_schema_version: number;

  race_id?: string | null;
  lineage_id?: string | null;
  class_id?: string | null;
  /** Per-class levels keyed by class UUID. Legacy rows fall back to class_id + level. */
  class_levels?: Record<string, number> | null;
  /** Selected subclass UUID keyed by its owning base-class UUID. */
  subclass_ids?: Record<string, string> | null;
  background_id?: string | null;
  level: number;

  feat_ids?: string[] | null;
  spell_ids?: string[] | null;
  action_ids?: string[] | null;
  effect_ids?: string[] | null;
  resource_ids?: string[] | null;

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
  inventory_items?: Array<{ card_id: string; qty: number; container_id?: string }> | null;
  resources?: Record<string, number> | null;
  max_resources?: Record<string, number> | null;
  active_effects?: unknown[] | null;
  turn_state?: Record<string, unknown> | null;
  currency?: Record<string, number> | null;
  /** Monotonic CAS token for every engine-owned runtime mutation. */
  runtime_revision?: number;

  // Онлайн-бой: id текущего боя (nil = не в бою). Ставит/снимает сервер при add/remove
  // комбатанта с этим characterId. Основа индикатора «в бою» и правила «один бой на персонажа».
  current_encounter_id?: string | null;

  /** Explicit server authorization projection; never infer write access from user_id. */
  access_mode: CharacterAccessMode;

  created_at: string;
  updated_at: string;
}

export type ForgeCharacterPreview = Pick<
  ForgeCharacter,
  | 'id'
  | 'name'
  | 'avatar_url'
  | 'system_id'
  | 'ruleset_version'
  | 'character_type'
  | 'race_id'
  | 'class_id'
  | 'level'
  | 'max_hp'
  | 'current_hp'
  | 'current_encounter_id'
  | 'access_mode'
>;

export function isCharacterReadOnly(
  character: Pick<ForgeCharacter, 'access_mode'>,
): boolean {
  // Fail closed: only an explicit server-owned projection enables mutations.
  return character.access_mode !== 'owner';
}

export function characterMetadataLabel(character: Pick<
  ForgeCharacter,
  'system_id' | 'ruleset_version' | 'character_type'
>): string {
  const systemId = character.system_id || DEFAULT_CHARACTER_SYSTEM_ID;
  const rulesetVersion = character.ruleset_version || DEFAULT_CHARACTER_RULESET_VERSION;
  const characterType = character.character_type || DEFAULT_CHARACTER_TYPE;
  const system = systemId === DEFAULT_CHARACTER_SYSTEM_ID
    ? 'D&D 5e'
    : systemId;
  const type = CHARACTER_TYPE_LABELS[characterType] ?? characterType;
  return `${system} · ${rulesetVersion} · ${type}`;
}

// Тело запроса create/update. Редактор держит полное состояние и шлёт его целиком
// (update на бэкенде — полная замена полей).
export interface SaveForgeCharacterRequest {
  name: string;
  avatar_url?: string;
  description?: string;
  notes?: string;
  system_id?: string;
  ruleset_version?: string;
  character_type?: CharacterType;
  character_schema_version?: number;
  race_id?: string | null;
  lineage_id?: string | null;
  class_id?: string | null;
  class_levels?: Record<string, number> | null;
  subclass_ids?: Record<string, string> | null;
  background_id?: string | null;
  level?: number;
  feat_ids?: string[] | null;
  spell_ids?: string[] | null;
  action_ids?: string[] | null;
  effect_ids?: string[] | null;
  resource_ids?: string[] | null;
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
  // Creation-time runtime snapshot. The create endpoint persists these fields
  // in the same INSERT so a failed second request cannot leave an orphan draft.
  equipment?: Record<string, string | null> | null;
  inventory_items?: Array<{ card_id: string; qty: number; container_id?: string }> | null;
  resources?: Record<string, number> | null;
  max_resources?: Record<string, number> | null;
  active_effects?: unknown[] | null;
  turn_state?: Record<string, unknown> | null;
  currency?: Record<string, number> | null;
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
  description?: string;
  notes?: string;
  systemId: string;
  rulesetVersion: string;
  characterType: CharacterType;
  characterSchemaVersion: number;
  raceId: string | null;
  lineageId: string | null;
  classId: string | null;
  /** Per-class levels keyed by class UUID. Includes classId for every complete character. */
  classLevels: Record<string, number>;
  /** One subclass per owning class. subclassId mirrors the primary class for legacy callers. */
  subclassIds?: Record<string, string>;
  /** Подкласс (UUID класса-подкласса); хранится в resolved_choices['builder:subclass']. */
  subclassId: string | null;
  backgroundId: string | null;
  level: number;
  featIds: string[];
  /** Добавленные игроком напрямую сущности листа. */
  actionIds?: string[];
  effectIds?: string[];
  resourceIds?: string[];
  /** UUID заклинаний, выбранных игроком (не slug из grant_spell). */
  spellIds: string[];
  /** UUID заклинаний, явно добавленных с листа через «+ Добавить». */
  manualSpellIds?: string[];
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
  /** Вариант стартового снаряжения класса (А/Б/В); хранится в resolved_choices['builder:class_equipment']. */
  classEquipmentOption: 'a' | 'b' | 'c';
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
  description: '',
  notes: '',
  systemId: DEFAULT_CHARACTER_SYSTEM_ID,
  rulesetVersion: DEFAULT_CHARACTER_RULESET_VERSION,
  characterType: DEFAULT_CHARACTER_TYPE,
  characterSchemaVersion: CURRENT_CHARACTER_SCHEMA_VERSION,
  raceId: null,
  lineageId: null,
  classId: null,
  classLevels: {},
  subclassIds: {},
  subclassId: null,
  backgroundId: null,
  level: 1,
  featIds: [],
  actionIds: [],
  effectIds: [],
  resourceIds: [],
  spellIds: [],
  abilities: {},
  abilityMethod: 'point_buy',
  abilityBonuses: emptyBonuses(),
  equipmentOption: 'a',
  classEquipmentOption: 'a',
  classSkillChoices: [],
  resolvedChoices: {},
});
