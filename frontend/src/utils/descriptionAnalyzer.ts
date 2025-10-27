import type { Effect } from '../types';

// Мапа характеристик для быстрого поиска
const CHARACTERISTIC_MAP = new Map([
  // Основные названия
  ['сила', 'strength'],
  ['ловкость', 'dexterity'],
  ['телосложение', 'constitution'],
  ['интеллект', 'intelligence'],
  ['мудрость', 'wisdom'],
  ['харизма', 'charisma'],
  // Альтернативные названия
  ['силы', 'strength'],
  ['ловкости', 'dexterity'],
  ['телосложения', 'constitution'],
  ['интеллекта', 'intelligence'],
  ['мудрости', 'wisdom'],
  ['харизмы', 'charisma'],
  // Сокращения
  ['сил', 'strength'],
  ['ловк', 'dexterity'],
  ['тел', 'constitution'],
  ['инт', 'intelligence'],
  ['мудр', 'wisdom'],
  ['хар', 'charisma'],
]);

// Мапа навыков для быстрого поиска
const SKILL_MAP = new Map([
  // Сила
  ['атлетика', 'athletics'],
  ['атлетики', 'athletics'],
  
  // Ловкость
  ['акробатика', 'acrobatics'],
  ['акробатики', 'acrobatics'],
  ['ловкость рук', 'sleight_of_hand'],
  ['ловкости рук', 'sleight_of_hand'],
  ['скрытность', 'stealth'],
  ['скрытности', 'stealth'],
  
  // Интеллект
  ['магия', 'arcana'],
  ['магии', 'arcana'],
  ['история', 'history'],
  ['истории', 'history'],
  ['расследование', 'investigation'],
  ['расследования', 'investigation'],
  ['природа', 'nature'],
  ['природы', 'nature'],
  ['религия', 'religion'],
  ['религии', 'religion'],
  
  // Мудрость
  ['дрессировка', 'animal_handling'],
  ['дрессировки', 'animal_handling'],
  ['обращение с животными', 'animal_handling'],
  ['проницательность', 'insight'],
  ['проницательности', 'insight'],
  ['медицина', 'medicine'],
  ['медицины', 'medicine'],
  ['восприятие', 'perception'],
  ['восприятия', 'perception'],
  ['выживание', 'survival'],
  ['выживания', 'survival'],
  
  // Харизма
  ['обман', 'deception'],
  ['обмана', 'deception'],
  ['запугивание', 'intimidation'],
  ['запугивания', 'intimidation'],
  ['выступление', 'performance'],
  ['выступления', 'performance'],
  ['убеждение', 'persuasion'],
  ['убеждения', 'persuasion'],
]);

// Функция для нормализации текста (убираем знаки препинания, приводим к нижнему регистру)
const normalizeText = (text: string): string => {
  return text.toLowerCase()
    .replace(/[.,!?;:]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

// Функция для извлечения эффектов из описания
export const analyzeDescriptionForEffects = (description: string): Effect[] => {
  if (!description || description.trim() === '') {
    return [];
  }

  const effects: Effect[] = [];
  const normalizedDescription = normalizeText(description);
  const words = normalizedDescription.split(' ');

  for (let i = 0; i < words.length - 1; i++) {
    const currentWord = words[i];
    const nextWord = words[i + 1];

    // Проверяем, является ли следующее слово модификатором (+N или -N)
    const modifierMatch = nextWord.match(/^([+-])(\d+)$/);
    if (!modifierMatch) {
      continue;
    }

    const [, sign, value] = modifierMatch;
    const modifierValue = parseInt(value, 10);
    const modifier = sign === '+' ? '+' : '-';

    // Специальная проверка для "рук" - если есть "рук +-N", считаем это "Ловкость рук +-N"
    if (currentWord === 'рук') {
      effects.push({
        targetType: 'skill',
        targetSpecific: 'sleight_of_hand',
        modifier: modifier as '+' | '-',
        value: modifierValue
      });
      continue;
    }

    // Проверяем составные навыки (например, "ловкость рук")
    if (i < words.length - 1) {
      const compoundSkill = `${currentWord} ${words[i + 1]}`;
      const compoundSkillKey = SKILL_MAP.get(compoundSkill);
      if (compoundSkillKey) {
        effects.push({
          targetType: 'skill',
          targetSpecific: compoundSkillKey,
          modifier: modifier as '+' | '-',
          value: modifierValue
        });
        // Пропускаем следующее слово, так как мы уже обработали составной навык
        i++;
        continue;
      }
    }

    // Проверяем, является ли текущее слово характеристикой
    const characteristicKey = CHARACTERISTIC_MAP.get(currentWord);
    if (characteristicKey) {
      effects.push({
        targetType: 'characteristic',
        targetSpecific: characteristicKey,
        modifier: modifier as '+' | '-',
        value: modifierValue
      });
      continue;
    }

    // Проверяем, является ли текущее слово навыком
    const skillKey = SKILL_MAP.get(currentWord);
    if (skillKey) {
      effects.push({
        targetType: 'skill',
        targetSpecific: skillKey,
        modifier: modifier as '+' | '-',
        value: modifierValue
      });
      continue;
    }
  }

  return effects;
};

// Функция для получения статистики анализа
export const getAnalysisStats = (description: string) => {
  const effects = analyzeDescriptionForEffects(description);
  const characteristicEffects = effects.filter(e => e.targetType === 'characteristic');
  const skillEffects = effects.filter(e => e.targetType === 'skill');
  
  return {
    totalEffects: effects.length,
    characteristicEffects: characteristicEffects.length,
    skillEffects: skillEffects.length,
    effects: effects
  };
};
