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

export interface InitiativeCharacter {
  id: string;
  name: string;
  color: InitiativeColorId;
  ac: number;
  initiative: number;
  maxHp: number;
  currentHp: number;
  notes: string;
  description: string;
}

export interface InitiativeTrackerState {
  characters: InitiativeCharacter[];
  activeIndex: number;
  round: number;
}

export function getInitiativeColor(colorId: InitiativeColorId) {
  return INITIATIVE_COLORS.find((c) => c.id === colorId) ?? INITIATIVE_COLORS[4];
}

export function createEmptyCharacter(): InitiativeCharacter {
  return {
    id: crypto.randomUUID(),
    name: '',
    color: 'blue',
    ac: 10,
    initiative: 0,
    maxHp: 10,
    currentHp: 10,
    notes: '',
    description: '',
  };
}

export function sortByInitiative(characters: InitiativeCharacter[]): InitiativeCharacter[] {
  return [...characters].sort((a, b) => {
    if (b.initiative !== a.initiative) return b.initiative - a.initiative;
    return a.name.localeCompare(b.name, 'ru');
  });
}
