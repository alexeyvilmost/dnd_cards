export interface Race {
  name: string;
  russian_name: string;
  type: string;
  ability_scores?: {
    [key: string]: number;
  };
  tool_proficiencies?: string[];
  language_proficiencies?: string[];
  weapon_proficiencies?: string[];
  armor_proficiencies?: string[];
  damage_resistance?: string[];
  effects?: string[]; // ID эффектов (например, "effect_darkvision_60")
  features?: string[];
  size?: string;
  speed?: number;
}

const normalizeRaceName = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-+/g, '_');

const raceModules = import.meta.glob('../../races/*.json', {
  eager: true,
}) as Record<string, { default: Race } | Race>;

const racesMap: Record<string, Race> = {};

Object.entries(raceModules).forEach(([path, mod]) => {
  const data = (mod as { default?: Race }).default ?? (mod as Race);

  if (!data || !('name' in data)) {
    console.warn(`[races] Пропущен файл расы ${path}: отсутствует поле name`);
    return;
  }

  const normalizedName = normalizeRaceName(data.name);
  racesMap[normalizedName] = data;
});

export const getAllRaces = (): Race[] => {
  return Object.values(racesMap);
};

export const getRace = (name: string): Race | undefined => {
  const normalizedName = normalizeRaceName(name);
  return racesMap[normalizedName];
};

export const getRaceByRussianName = (russianName: string): Race | undefined => {
  return Object.values(racesMap).find(
    (race) => race.russian_name.toLowerCase() === russianName.toLowerCase()
  );
};

