// Единый источник истины для типов урона: значение, русская подпись, цвет, группа.
// Иконки — предраскрашенные PNG в /public/icons/damage_types/<value>.png (НЕ перекрашивать).

export type DamageType =
  | 'bludgeoning'
  | 'piercing'
  | 'slashing'
  | 'acid'
  | 'cold'
  | 'fire'
  | 'force'
  | 'lightning'
  | 'necrotic'
  | 'poison'
  | 'psychic'
  | 'radiant'
  | 'thunder';

export type DamageGroup = 'physical' | 'elemental';

export interface DamageTypeInfo {
  value: DamageType;
  label: string;
  color: string;
  group: DamageGroup;
}

// Закреплённая палитра (см. требования заказчика).
const PHYSICAL = '#47473A';

export const DAMAGE_TYPES: DamageTypeInfo[] = [
  { value: 'bludgeoning', label: 'Дробящий', color: PHYSICAL, group: 'physical' },
  { value: 'piercing', label: 'Колющий', color: PHYSICAL, group: 'physical' },
  { value: 'slashing', label: 'Рубящий', color: PHYSICAL, group: 'physical' },
  { value: 'acid', label: 'Кислота', color: '#7fb000', group: 'elemental' },
  { value: 'cold', label: 'Холод', color: '#3399cc', group: 'elemental' },
  { value: 'fire', label: 'Огонь', color: '#ee4e0a', group: 'elemental' },
  { value: 'force', label: 'Сила', color: '#cc3333', group: 'elemental' },
  { value: 'lightning', label: 'Молния', color: '#3366ca', group: 'elemental' },
  { value: 'necrotic', label: 'Некротический', color: '#40ae4d', group: 'elemental' },
  { value: 'poison', label: 'Яд', color: '#44bb0b', group: 'elemental' },
  { value: 'psychic', label: 'Психический', color: '#a2669e', group: 'elemental' },
  { value: 'radiant', label: 'Излучение', color: '#c2990e', group: 'elemental' },
  { value: 'thunder', label: 'Гром', color: '#8844b9', group: 'elemental' },
];

export const DAMAGE_TYPE_MAP: Record<string, DamageTypeInfo> = Object.fromEntries(
  DAMAGE_TYPES.map((d) => [d.value, d])
);

export const PHYSICAL_DAMAGE_TYPES = DAMAGE_TYPES.filter((d) => d.group === 'physical');
export const ELEMENTAL_DAMAGE_TYPES = DAMAGE_TYPES.filter((d) => d.group === 'elemental');

export const isDamageType = (t: string): t is DamageType => t in DAMAGE_TYPE_MAP;

export const getDamageColor = (type: string): string =>
  DAMAGE_TYPE_MAP[type]?.color ?? '#374151';

export const getDamageLabel = (type: string): string =>
  DAMAGE_TYPE_MAP[type]?.label ?? type;

export const getDamageIconPath = (type: string): string =>
  `/icons/damage_types/${type}.png`;
