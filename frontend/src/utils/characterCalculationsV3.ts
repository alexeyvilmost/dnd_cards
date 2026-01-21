// Утилиты для расчетов характеристик персонажа V3

import { ActiveEffect } from '../types';

export interface CharacterV3 {
  id: string;
  name: string;
  race: string;
  class: string;
  level: number;
  speed: number;
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  max_hp: number;
  current_hp: number;
  saving_throw_proficiencies: string[];
  skill_proficiencies: string[];
  active_effects?: ActiveEffect[] | null;
  resources?: Record<string, number> | null;
  max_resources?: Record<string, number> | null;
  created_at: string;
  updated_at: string;
}

// Расчет модификатора характеристики
export const getModifier = (score: number): number => {
  return Math.floor((score - 10) / 2);
};

// Расчет бонуса мастерства
export const getProficiencyBonus = (level: number): number => {
  return Math.floor((level - 1) / 4) + 2;
};

// Расчет спасброска
export const getSavingThrow = (
  statValue: number,
  isProficient: boolean,
  level: number
): number => {
  const modifier = getModifier(statValue);
  const proficiency = isProficient ? getProficiencyBonus(level) : 0;
  return modifier + proficiency;
};

// Расчет навыка
export const getSkillBonus = (
  statValue: number,
  isProficient: boolean,
  level: number
): number => {
  const modifier = getModifier(statValue);
  const proficiency = isProficient ? getProficiencyBonus(level) : 0;
  return modifier + proficiency;
};

// Расчет пассивного восприятия
export const getPassivePerception = (
  wisdom: number,
  isProficient: boolean,
  level: number
): number => {
  return 10 + getSkillBonus(wisdom, isProficient, level);
};

// Расчет модификатора инициативы
export const getInitiativeModifier = (dexterity: number): number => {
  return getModifier(dexterity);
};

// Расчет защиты (базовая)
export const getBaseAC = (dexterity: number): number => {
  return 10 + getModifier(dexterity);
};

// Получение названий характеристик на русском
export const getStatName = (stat: string): string => {
  const names: { [key: string]: string } = {
    strength: 'СИЛ',
    dexterity: 'ЛВК',
    constitution: 'ТЕЛ',
    intelligence: 'ИНТ',
    wisdom: 'МДР',
    charisma: 'ХАР',
  };
  return names[stat] || stat.toUpperCase();
};

// Получение полных названий характеристик на русском
export const getFullStatName = (stat: string): string => {
  const names: { [key: string]: string } = {
    strength: 'Сила',
    dexterity: 'Ловкость',
    constitution: 'Телосложение',
    intelligence: 'Интеллект',
    wisdom: 'Мудрость',
    charisma: 'Харизма',
  };
  return names[stat] || stat;
};

// Получение названий навыков на русском
export const getSkillName = (skill: string): string => {
  const names: { [key: string]: string } = {
    acrobatics: 'Акробатика',
    animal_handling: 'Дрессировка',
    arcana: 'Магия',
    athletics: 'Атлетика',
    deception: 'Обман',
    history: 'История',
    insight: 'Проницательность',
    intimidation: 'Запугивание',
    investigation: 'Расследование',
    medicine: 'Медицина',
    nature: 'Природа',
    perception: 'Восприятие',
    performance: 'Выступление',
    persuasion: 'Убеждение',
    religion: 'Религия',
    sleight_of_hand: 'Ловкость рук',
    stealth: 'Скрытность',
    survival: 'Выживание',
  };
  return names[skill] || skill;
};

// Получение названий спасбросков на русском
export const getSavingThrowName = (stat: string): string => {
  return getFullStatName(stat);
};

// Проверка владения навыком
export const hasSkillProficiency = (
  character: CharacterV3,
  skill: string
): boolean => {
  return character.skill_proficiencies.includes(skill);
};

// Проверка владения спасброском
export const hasSavingThrowProficiency = (
  character: CharacterV3,
  stat: string
): boolean => {
  return character.saving_throw_proficiencies.includes(stat);
};

// Получение значения характеристики
export const getStatValue = (character: CharacterV3, stat: string): number => {
  const statMap: { [key: string]: number } = {
    strength: character.strength,
    dexterity: character.dexterity,
    constitution: character.constitution,
    intelligence: character.intelligence,
    wisdom: character.wisdom,
    charisma: character.charisma,
  };
  return statMap[stat] || 0;
};

// Расчет всех производных характеристик персонажа
export const calculateDerivedStats = (character: CharacterV3) => {
  const proficiencyBonus = getProficiencyBonus(character.level);
  const dexModifier = getModifier(character.dexterity);
  const wisModifier = getModifier(character.wisdom);

  return {
    proficiencyBonus,
    baseAC: getBaseAC(character.dexterity),
    passivePerception: getPassivePerception(
      character.wisdom,
      hasSkillProficiency(character, 'perception'),
      character.level
    ),
    initiativeModifier: getInitiativeModifier(character.dexterity),

    // Спасброски
    savingThrows: {
      strength: getSavingThrow(
        character.strength,
        hasSavingThrowProficiency(character, 'strength'),
        character.level
      ),
      dexterity: getSavingThrow(
        character.dexterity,
        hasSavingThrowProficiency(character, 'dexterity'),
        character.level
      ),
      constitution: getSavingThrow(
        character.constitution,
        hasSavingThrowProficiency(character, 'constitution'),
        character.level
      ),
      intelligence: getSavingThrow(
        character.intelligence,
        hasSavingThrowProficiency(character, 'intelligence'),
        character.level
      ),
      wisdom: getSavingThrow(
        character.wisdom,
        hasSavingThrowProficiency(character, 'wisdom'),
        character.level
      ),
      charisma: getSavingThrow(
        character.charisma,
        hasSavingThrowProficiency(character, 'charisma'),
        character.level
      ),
    },

    // Модификаторы характеристик
    modifiers: {
      strength: getModifier(character.strength),
      dexterity: getModifier(character.dexterity),
      constitution: getModifier(character.constitution),
      intelligence: getModifier(character.intelligence),
      wisdom: getModifier(character.wisdom),
      charisma: getModifier(character.charisma),
    },
  };
};



