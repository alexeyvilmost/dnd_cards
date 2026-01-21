// Утилита для загрузки действий класса из JSON файлов

interface ClassLevelProgression {
  [level: string]: {
    actions?: string[];
    effects?: string[];
  };
}

interface ClassData {
  level_progression?: ClassLevelProgression;
}

// Импортируем данные классов
import barbarianData from '../../classes/barbarian.json';

const classDataMap: Record<string, ClassData> = {
  barbarian: barbarianData as ClassData,
  варвар: barbarianData as ClassData,
  // Здесь можно добавить другие классы по мере необходимости
};

/**
 * Нормализует название класса для поиска в classDataMap
 */
const normalizeClassName = (className: string): string => {
  const normalized = className.toLowerCase().trim();
  // Маппинг русских названий на английские ключи
  const classMapping: Record<string, string> = {
    'варвар': 'barbarian',
    'варвара': 'barbarian',
    'barbarian': 'barbarian',
  };
  return classMapping[normalized] || normalized;
};

/**
 * Получает список action_id для класса на основе уровня персонажа
 * @param className - название класса (например, "barbarian" или "Варвар")
 * @param level - уровень персонажа
 * @returns массив action_id для данного уровня и ниже
 */
export const getClassActions = (
  className: string,
  level: number
): string[] => {
  const normalizedClass = normalizeClassName(className);
  const classData = classDataMap[normalizedClass];
  
  if (!classData || !classData.level_progression) {
    console.warn(`[getClassActions] Класс "${className}" (нормализован: "${normalizedClass}") не найден в classDataMap`);
    return [];
  }

  const actions: string[] = [];
  const progression = classData.level_progression;

  // Собираем все действия для уровней <= level
  for (let i = 1; i <= level; i++) {
    const levelKey = i.toString();
    if (progression[levelKey] && progression[levelKey].actions) {
      actions.push(...progression[levelKey].actions!);
    }
  }

  // Убираем дубликаты
  return [...new Set(actions)];
};

/**
 * Получает список effect_id для класса на основе уровня персонажа
 * @param className - название класса (например, "barbarian")
 * @param level - уровень персонажа
 * @returns массив effect_id для данного уровня и ниже
 */
export const getClassEffects = (
  className: string,
  level: number
): string[] => {
  const classData = classDataMap[className.toLowerCase()];
  
  if (!classData || !classData.level_progression) {
    return [];
  }

  const effects: string[] = [];
  const progression = classData.level_progression;

  // Собираем все эффекты для уровней <= level
  for (let i = 1; i <= level; i++) {
    const levelKey = i.toString();
    if (progression[levelKey] && progression[levelKey].effects) {
      effects.push(...progression[levelKey].effects!);
    }
  }

  // Убираем дубликаты
  return [...new Set(effects)];
};
