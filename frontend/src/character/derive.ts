import { abilityOfSkill } from '../mechanics/registries';
import type { AbilityKey, AbilityScores } from './types';

// Чистые вычисления листа персонажа. Используются и редактором, и листом.

export const abilityMod = (score: number | undefined): number =>
  Math.floor(((score ?? 10) - 10) / 2);

// Бонус мастерства по уровню (2 на 1–4, +1 каждые 4 уровня).
export const proficiencyBonusForLevel = (level: number): number =>
  2 + Math.floor((Math.max(1, level) - 1) / 4);

// Максимум кости хитов из строки вида "d10"/"1d8".
export function hitDieMax(hitDie?: string | null): number {
  if (!hitDie) return 8;
  const m = /d(\d+)/i.exec(hitDie);
  return m ? parseInt(m[1], 10) : 8;
}

// Максимум HP: L1 = макс кости + мод тел; далее среднее (die/2+1)+модтел за уровень.
export function computeMaxHP(
  hitDie: string | null | undefined,
  conScore: number | undefined,
  level: number,
): number {
  const die = hitDieMax(hitDie);
  const conMod = abilityMod(conScore);
  const perLevelAvg = Math.floor(die / 2) + 1;
  const lvl = Math.max(1, level);
  return die + conMod + (lvl - 1) * (perLevelAvg + conMod);
}

export const savingThrowBonus = (
  ability: AbilityKey,
  scores: Partial<AbilityScores>,
  proficient: boolean,
  pb: number,
): number => abilityMod(scores[ability]) + (proficient ? pb : 0);

export const skillBonus = (
  skill: string,
  scores: Partial<AbilityScores>,
  proficient: boolean,
  pb: number,
): number => abilityMod(scores[abilityOfSkill(skill) as AbilityKey]) + (proficient ? pb : 0);

export type Spellcasting = { ability: AbilityKey; saveDC: number; attack: number } | null;

// Характеристика заклинаний по названию класса (MVP).
const CLASS_SPELL_ABILITY: Record<string, AbilityKey> = {
  волшебник: 'int', wizard: 'int',
  жрец: 'wis', cleric: 'wis', друид: 'wis', druid: 'wis', следопыт: 'wis', ranger: 'wis',
  бард: 'cha', bard: 'cha', колдун: 'cha', warlock: 'cha',
  чародей: 'cha', sorcerer: 'cha', паладин: 'cha', paladin: 'cha',
};

export function spellcasting(
  className: string | undefined,
  scores: Partial<AbilityScores>,
  pb: number,
): Spellcasting {
  if (!className) return null;
  const ability = CLASS_SPELL_ABILITY[className.trim().toLowerCase()];
  if (!ability) return null;
  const mod = abilityMod(scores[ability]);
  return { ability, saveDC: 8 + pb + mod, attack: pb + mod };
}
