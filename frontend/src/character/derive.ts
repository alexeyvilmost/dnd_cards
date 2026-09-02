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

/** Fixed-average HP for a multiclass character; only character level 1 uses a maximum Hit Die. */
export function computeMulticlassMaxHP(
  classes: Array<{ id: string; hit_die?: string | null; level: number }>,
  primaryClassId: string | null | undefined,
  conScore: number | undefined,
): number {
  if (!classes.length) return computeMaxHP(null, conScore, 1);
  const conMod = abilityMod(conScore);
  let hp = 0;
  for (const entry of classes) {
    const levels = Math.max(0, Math.floor(entry.level));
    if (!levels) continue;
    const die = hitDieMax(entry.hit_die);
    const average = Math.floor(die / 2) + 1;
    const firstLevels = entry.id === primaryClassId ? 1 : 0;
    hp += firstLevels * Math.max(1, die + conMod);
    hp += Math.max(0, levels - firstLevels) * Math.max(1, average + conMod);
  }
  return Math.max(1, hp);
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

export function spellcasting(
  ability: AbilityKey | null | undefined,
  scores: Partial<AbilityScores>,
  pb: number,
): Spellcasting {
  if (!ability) return null;
  const mod = abilityMod(scores[ability]);
  return { ability, saveDC: 8 + pb + mod, attack: pb + mod };
}
