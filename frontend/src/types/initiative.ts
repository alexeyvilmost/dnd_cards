export const INITIATIVE_COLORS = [
  { id: 'red', label: 'Красный', hex: '#ef4444', text: '#ffffff' },
  { id: 'orange', label: 'Оранжевый', hex: '#f97316', text: '#ffffff' },
  { id: 'yellow', label: 'Жёлтый', hex: '#eab308', text: '#1f2937' },
  { id: 'green', label: 'Зелёный', hex: '#22c55e', text: '#ffffff' },
  { id: 'blue', label: 'Синий', hex: '#3b82f6', text: '#ffffff' },
  { id: 'indigo', label: 'Индиго', hex: '#6366f1', text: '#ffffff' },
  { id: 'violet', label: 'Фиолетовый', hex: '#a855f7', text: '#ffffff' },
  { id: 'black', label: 'Чёрный', hex: '#171717', text: '#ffffff' },
  { id: 'gray', label: 'Серый', hex: '#6b7280', text: '#ffffff' },
  { id: 'white', label: 'Белый', hex: '#ffffff', text: '#1f2937' },
] as const;

export type InitiativeColorId = (typeof INITIATIVE_COLORS)[number]['id'];

/** Существо в бою — либо монстр (сам кидает инициативу), либо игрок (вводит вручную). */
export type CreatureType = 'monster' | 'player';

export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export const ABILITY_LABELS: Record<AbilityKey, string> = {
  str: 'Сил',
  dex: 'Лов',
  con: 'Тел',
  int: 'Инт',
  wis: 'Мдр',
  cha: 'Хар',
};

export interface AbilityScore {
  score: number;
  mod: number;
  save: number;
}

/** Полный статблок монстра, импортированный с ttg.club (всё опционально). */
export interface StatBlock {
  speed?: string;
  senses?: string;
  languages?: string;
  cr?: string;
  vulnerabilities?: string;
  resistances?: string;
  immunities?: string;
  saves?: string;
  skills?: string;
  abilities?: Partial<Record<AbilityKey, AbilityScore>>;
}

/** Есть ли в статблоке хоть какие-то данные для показа. */
export function hasStatBlock(sb?: StatBlock): sb is StatBlock {
  if (!sb) return false;
  return Boolean(
    sb.speed || sb.senses || sb.languages || sb.cr || sb.vulnerabilities ||
      sb.resistances || sb.immunities || sb.saves || sb.skills ||
      (sb.abilities && Object.keys(sb.abilities).length > 0),
  );
}

/** Цвет по способу добавления (см. требования): игрок — зелёный, монстр — красный, «Добавить» — синий. */
export const COLOR_BY_TYPE: Record<CreatureType, InitiativeColorId> = {
  player: 'green',
  monster: 'red',
};
export const NEUTRAL_COLOR: InitiativeColorId = 'blue';

export interface InitiativeCharacter {
  id: string;
  name: string;
  color: InitiativeColorId;
  type: CreatureType;
  ac: number;
  initiative: number;
  /** Бонус к инициативе — прибавляется к d20 при автоматическом броске монстра. */
  initiativeBonus: number;
  maxHp: number;
  currentHp: number;
  notes: string;
  description: string;
  /** Полный статблок (для монстров, импортированных с ttg.club). */
  statblock?: StatBlock;
}

export interface InitiativeTrackerState {
  characters: InitiativeCharacter[];
  activeIndex: number;
  round: number;
}

export function getInitiativeColor(colorId: InitiativeColorId) {
  return INITIATIVE_COLORS.find((c) => c.id === colorId) ?? INITIATIVE_COLORS[4];
}

/** Бросок инициативы: d20 + бонус. */
export function rollInitiativeValue(bonus = 0): number {
  return Math.floor(Math.random() * 20) + 1 + bonus;
}

/** Базовое существо. По умолчанию — нейтральный монстр синего цвета (плейн «Добавить»). */
export function createEmptyCharacter(overrides: Partial<InitiativeCharacter> = {}): InitiativeCharacter {
  return {
    id: crypto.randomUUID(),
    name: '',
    color: NEUTRAL_COLOR,
    type: 'monster',
    ac: 10,
    initiative: 0,
    initiativeBonus: 0,
    maxHp: 10,
    currentHp: 10,
    notes: '',
    description: '',
    ...overrides,
  };
}

/** Приводит частично заполненного персонажа (из хранилища/ссылки) к полной форме. */
export function normalizeCharacter(raw: Partial<InitiativeCharacter>): InitiativeCharacter {
  const base = createEmptyCharacter();
  const type: CreatureType = raw.type === 'player' ? 'player' : 'monster';
  return {
    ...base,
    ...raw,
    id: raw.id ?? base.id,
    type,
    initiativeBonus: typeof raw.initiativeBonus === 'number' ? raw.initiativeBonus : 0,
    description: typeof raw.description === 'string' ? raw.description : '',
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    color: raw.color ?? base.color,
  };
}

export function sortByInitiative(characters: InitiativeCharacter[]): InitiativeCharacter[] {
  return [...characters].sort((a, b) => {
    if (b.initiative !== a.initiative) return b.initiative - a.initiative;
    return a.name.localeCompare(b.name, 'ru');
  });
}

/** Следующий цвет для копии — отличный от исходного и по возможности свободный. */
export function pickCopyColor(
  sourceColor: InitiativeColorId,
  usedColors: InitiativeColorId[],
): InitiativeColorId {
  const used = new Set(usedColors);
  const ids = INITIATIVE_COLORS.map((c) => c.id);
  const start = (ids.indexOf(sourceColor) + 1 + ids.length) % ids.length;

  for (let offset = 0; offset < ids.length; offset += 1) {
    const candidate = ids[(start + offset) % ids.length];
    if (candidate !== sourceColor && !used.has(candidate)) {
      return candidate;
    }
  }

  return ids[(ids.indexOf(sourceColor) + 1) % ids.length];
}

export function duplicateCharacter(
  source: InitiativeCharacter,
  usedColors: InitiativeColorId[],
): InitiativeCharacter {
  return {
    ...source,
    id: crypto.randomUUID(),
    color: pickCopyColor(source.color, usedColors),
    initiative: 0,
  };
}
