import { ABILITIES, SKILLS, SKILL_ABILITY } from '../../mechanics/registries';
import type { AbilityKey } from '../types';

export { ABILITIES, SKILLS, SKILL_ABILITY };

export const abilityMod = (score: number | undefined): number =>
  Math.floor(((score ?? 10) - 10) / 2);

export const proficiencyBonusForLevel = (level: number): number =>
  2 + Math.floor((Math.max(1, level) - 1) / 4);

export const abilityOfSkill = (skill: string): AbilityKey =>
  (SKILL_ABILITY[skill] || 'str') as AbilityKey;

export const SKILL_IDS = SKILLS.map((s) => s.id);
export const ABILITY_IDS = ABILITIES.map((a) => a.id as AbilityKey);
