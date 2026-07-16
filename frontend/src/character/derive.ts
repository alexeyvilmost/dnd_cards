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
  // RAW 2024 (KB-114): на каждом уровне выше 1-го персонаж получает НЕ МЕНЬШЕ 1 хита, даже при
  // сильно отрицательном модификаторе ТЕЛ. Без клампа d6/ТЕЛ 1/L5 давал −3 (персонаж «мёртв»
  // при создании). Итог тоже не ниже 1.
  const perLevel = Math.max(1, perLevelAvg + conMod);
  return Math.max(1, die + conMod + (lvl - 1) * perLevel);
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
  // Треть-кастеры: подклассы со своим заклинательством (INT, как у волшебника).
  'мистический рыцарь': 'int', 'eldritch knight': 'int',
  'мистический ловкач': 'int', 'arcane trickster': 'int',
};

export function spellcasting(
  className: string | undefined,
  scores: Partial<AbilityScores>,
  pb: number,
  subclassName?: string | null,
): Spellcasting {
  const ability = [className, subclassName]
    .map((n) => (n ? CLASS_SPELL_ABILITY[n.trim().toLowerCase()] : undefined))
    .find(Boolean);
  if (!ability) return null;
  const mod = abilityMod(scores[ability]);
  return { ability, saveDC: 8 + pb + mod, attack: pb + mod };
}
