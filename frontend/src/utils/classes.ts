export interface ClassLevelProgression {
  [level: string]: {
    effects?: string[];
    actions?: string[];
  };
}

export interface Class {
  name: string;
  russian_name: string;
  description?: string;
  hit_dice?: string;
  armor_proficiencies?: string[];
  weapon_proficiencies?: string[];
  saving_throws?: string[];
  skills?: {
    count: number;
    variants: string[];
  };
  equipment?: string[]; // UUID карт снаряжения
  level_progression?: ClassLevelProgression;
}

const normalizeClassName = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-+/g, '_');

const classModules = import.meta.glob('../../classes/*.json', {
  eager: true,
}) as Record<string, { default: Class } | Class>;

const classesMap: Record<string, Class> = {};

Object.entries(classModules).forEach(([path, mod]) => {
  const data = (mod as { default?: Class }).default ?? (mod as Class);

  if (!data || !('name' in data)) {
    console.warn(`[classes] Пропущен файл класса ${path}: отсутствует поле name`);
    return;
  }

  const normalizedName = normalizeClassName(data.name);
  classesMap[normalizedName] = data;
});

export const getAllClasses = (): Class[] => {
  return Object.values(classesMap);
};

export const getClass = (name: string): Class | undefined => {
  const normalizedName = normalizeClassName(name);
  return classesMap[normalizedName];
};

export const getClassByRussianName = (russianName: string): Class | undefined => {
  return Object.values(classesMap).find(
    (cls) => cls.russian_name.toLowerCase() === russianName.toLowerCase()
  );
};

