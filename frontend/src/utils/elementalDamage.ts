export type ElementalDamageType =
  | 'fire'
  | 'cold'
  | 'acid'
  | 'poison'
  | 'necrotic'
  | 'lightning'
  | 'psychic'
  | 'radiant'
  | 'thunder'
  | 'force';

export const ELEMENTAL_DAMAGE_OPTIONS: { value: ElementalDamageType; label: string }[] = [
  { value: 'fire', label: 'Огонь' },
  { value: 'cold', label: 'Холод' },
  { value: 'acid', label: 'Кислота' },
  { value: 'poison', label: 'Яд' },
  { value: 'necrotic', label: 'Некротический' },
  { value: 'lightning', label: 'Молния' },
  { value: 'psychic', label: 'Психический' },
  { value: 'radiant', label: 'Излучение' },
  { value: 'thunder', label: 'Гром' },
  { value: 'force', label: 'Сила' },
];

const ELEMENTAL_DAMAGE_COLORS: Record<ElementalDamageType, string> = {
  fire: '#E25822',
  cold: '#2563EB',
  acid: '#65A30D',
  poison: '#22C55E',
  necrotic: '#166534',
  lightning: '#06B6D4',
  psychic: '#C026D3',
  radiant: '#EAB308',
  thunder: '#5B21B6',
  force: '#800020',
};

export const getElementalDamageColor = (type: string): string =>
  ELEMENTAL_DAMAGE_COLORS[type as ElementalDamageType] ?? '#374151';

export const getElementalDamageLabel = (type: string): string =>
  ELEMENTAL_DAMAGE_OPTIONS.find((option) => option.value === type)?.label ?? type;

export const getElementalDamageIconPath = (type: string): string =>
  `/icons/damage_types/${type}.png`;

export const hasElementalDamage = (card: {
  elemental_damage_value?: string | null;
  elemental_damage_type?: string | null;
}): boolean =>
  Boolean(card.elemental_damage_value?.trim() && card.elemental_damage_type?.trim());
