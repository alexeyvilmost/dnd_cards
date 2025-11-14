export interface Backstory {
  name: string;
  russian_name: string;
  type: string;
  skill_proficiencies?: string[];
  tool_proficiencies?: string[];
  equipment?: string[];
  gold?: number;
}

const normalizeBackstoryName = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-+/g, '_');

const backstoryModules = import.meta.glob('../../backstories/*.json', {
  eager: true,
}) as Record<string, { default: Backstory } | Backstory>;

const backstoriesMap: Record<string, Backstory> = {};

Object.entries(backstoryModules).forEach(([path, mod]) => {
  const data = (mod as { default?: Backstory }).default ?? (mod as Backstory);

  if (!data || !('name' in data)) {
    console.warn(`[backstories] Пропущен файл предыстории ${path}: отсутствует поле name`);
    return;
  }

  const normalizedName = normalizeBackstoryName(data.name);
  backstoriesMap[normalizedName] = data;
});

export const getAllBackstories = (): Backstory[] => {
  return Object.values(backstoriesMap);
};

export const getBackstory = (name: string): Backstory | undefined => {
  const normalizedName = normalizeBackstoryName(name);
  return backstoriesMap[normalizedName];
};

export const getBackstoryByRussianName = (russianName: string): Backstory | undefined => {
  return Object.values(backstoriesMap).find(
    (backstory) => backstory.russian_name.toLowerCase() === russianName.toLowerCase()
  );
};

