import type { AbilityKey, AbilityScores, CharacterDraft } from '../types';
import type { AssembledCharacter } from '../assemble';

export type RuleSourceType =
  | 'character_base'
  | 'species'
  | 'class'
  | 'background'
  | 'feat'
  | 'item'
  | 'temporary_effect'
  | 'condition'
  | 'action_result'
  | 'other';

export type ProficiencyKind = 'skill' | 'saving_throw' | 'tool' | 'language' | 'weapon' | 'armor';
export type GrantKind = ProficiencyKind | ExpertiseKind | 'spell' | 'feat';
export type ExpertiseKind = 'skill' | 'tool';
export type GrantMode = 'proficiency' | 'expertise';

export interface RuleSource {
  type: RuleSourceType;
  id: string;
  name: string;
}

export interface AppliedGrant {
  id: string;
  source: RuleSource;
  kind: GrantKind;
  value: string;
  mode: GrantMode;
  choiceId?: string;
  label?: string;
}

export interface RuleConflict {
  code: 'duplicate_proficiency' | 'duplicate_spell' | 'duplicate_feat' | 'missing_proficiency_for_expertise' | 'unsupported_grant';
  message: string;
  severity: 'error' | 'warning';
  kind?: GrantKind;
  value?: string;
  source?: RuleSource;
  existingSource?: RuleSource;
  choiceId?: string;
}

export interface RuntimeRuleSource {
  source: RuleSource;
  mechanics?: Record<string, unknown> | null;
}

export interface RuleInput {
  draft: CharacterDraft;
  assembled: AssembledCharacter;
  runtimeSources?: RuntimeRuleSource[];
}

export interface CharacterRuleState {
  version: 1;
  abilities: Partial<AbilityScores>;
  abilityMods: Record<AbilityKey, number>;
  proficiencyBonus: number;
  proficiencies: {
    skills: string[];
    savingThrows: string[];
    tools: string[];
    languages: string[];
    weapons: string[];
    armor: string[];
  };
  expertise: {
    skills: string[];
    tools: string[];
  };
  spells: {
    known: string[];
    cantrips: string[];
    leveled: string[];
  };
  skillBonuses: Record<string, number>;
  savingThrowBonuses: Record<AbilityKey, number>;
  maxHP: number;
  armorClass: number;
  speed: number;
  initiativeBonus: number;
  passivePerception: number;
  spellcasting: AssembledCharacter['derived']['spellcasting'];
  appliedGrants: AppliedGrant[];
  conflicts: RuleConflict[];
  /** Переменные персонажа (martial_arts_die и т.п.) для формул листа/боя. */
  variables: Record<string, number | { sides: number; count: number }>;
}
