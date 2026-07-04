import {
  COLOR_BY_TYPE,
  createEmptyCharacter,
  type CreatureType,
  type InitiativeCharacter,
  type InitiativeColorId,
  type StatBlock,
} from '../types/initiative';

/** Существо, сохранённое в библиотеке (без боевого состояния — инициативы и текущих HP). */
export interface LibraryCreature {
  id: string;
  name: string;
  type: CreatureType;
  color: InitiativeColorId;
  ac: number;
  maxHp: number;
  initiativeBonus: number;
  description: string;
  sourceUrl?: string;
  statblock?: StatBlock;
}

const STORAGE_KEY = 'initiative-library-v1';

export function loadLibrary(): LibraryCreature[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeLibraryCreature);
  } catch {
    return [];
  }
}

export function saveLibrary(list: LibraryCreature[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function normalizeLibraryCreature(raw: Partial<LibraryCreature>): LibraryCreature {
  const type: CreatureType = raw.type === 'player' ? 'player' : 'monster';
  return {
    id: raw.id ?? crypto.randomUUID(),
    name: raw.name ?? 'Без имени',
    type,
    color: raw.color ?? COLOR_BY_TYPE[type],
    ac: typeof raw.ac === 'number' ? raw.ac : 10,
    maxHp: typeof raw.maxHp === 'number' ? raw.maxHp : 10,
    initiativeBonus: typeof raw.initiativeBonus === 'number' ? raw.initiativeBonus : 0,
    description: typeof raw.description === 'string' ? raw.description : '',
    sourceUrl: raw.sourceUrl,
    statblock: raw.statblock,
  };
}

/** Из боевого существа делает запись библиотеки (сбрасывает боевое состояние). */
export function characterToLibrary(character: InitiativeCharacter): LibraryCreature {
  return {
    id: crypto.randomUUID(),
    name: character.name || 'Без имени',
    type: character.type,
    color: character.color,
    ac: character.ac,
    maxHp: character.maxHp,
    initiativeBonus: character.initiativeBonus,
    description: character.description,
    statblock: character.statblock,
  };
}

/** Из записи библиотеки создаёт существо для боя. Цвет — по типу (игрок зелёный / монстр красный). */
export function libraryToCharacter(creature: LibraryCreature): InitiativeCharacter {
  return createEmptyCharacter({
    name: creature.name,
    type: creature.type,
    color: COLOR_BY_TYPE[creature.type],
    ac: creature.ac,
    maxHp: creature.maxHp,
    currentHp: creature.maxHp,
    initiativeBonus: creature.initiativeBonus,
    description: creature.description,
    statblock: creature.statblock,
    initiative: 0,
  });
}

/** Добавляет/обновляет запись; дубли (совпадение по имени и источнику) не плодятся. */
export function upsertLibraryCreature(
  list: LibraryCreature[],
  creature: LibraryCreature,
): LibraryCreature[] {
  const existingIndex = list.findIndex(
    (c) =>
      c.name.toLowerCase() === creature.name.toLowerCase() &&
      (c.sourceUrl ?? '') === (creature.sourceUrl ?? ''),
  );
  if (existingIndex >= 0) {
    const next = [...list];
    next[existingIndex] = { ...creature, id: list[existingIndex].id };
    return next;
  }
  return [...list, creature];
}
