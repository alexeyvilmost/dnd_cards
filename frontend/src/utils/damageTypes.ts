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

// Лечение — отдельная «метка» (не тип урона, не участвует в выборе урона предмета),
// но имеет цвет, иконку и доступно в шорткатах описаний.
export const HEALING: DamageTypeInfo = {
  value: 'healing' as DamageType,
  label: 'Лечение',
  color: '#30bbbb',
  group: 'elemental',
};

// Цветные метки = типы урона + лечение (используются для окраски текста).
export const COLOR_TOKENS: DamageTypeInfo[] = [...DAMAGE_TYPES, HEALING];

export const DAMAGE_TYPE_MAP: Record<string, DamageTypeInfo> = Object.fromEntries(
  COLOR_TOKENS.map((d) => [d.value, d])
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

// ─── Ресурсы (действия, бонусные, реакции, ячейки) ────────────────────────────
// Только иконки, без привязанного цвета.
export interface ResourceInfo {
  value: string;
  label: string;
}

export const RESOURCE_ICONS: ResourceInfo[] = [
  { value: 'action', label: 'Действие' },
  { value: 'bonus_action', label: 'Бонусное действие' },
  { value: 'reaction', label: 'Реакция' },
  { value: 'spell_slot', label: 'Ячейка заклинания' },
  { value: 'warlock_spell_slot', label: 'Ячейка колдуна' },
  { value: 'ritual', label: 'Ритуал' },
];

export const getResourceIconPath = (value: string): string =>
  `/icons/resources/${value}.png`;

// ─── Реестр вставляемых иконок (для шорткатов :token: в описаниях) ────────────
export type IconGroup = 'damage' | 'heal' | 'resource';

export interface IconToken {
  token: string;
  label: string;
  path: string;
  group: IconGroup;
}

export const ICON_TOKENS: IconToken[] = [
  ...DAMAGE_TYPES.map((d): IconToken => ({
    token: d.value, label: d.label, path: getDamageIconPath(d.value), group: 'damage',
  })),
  { token: 'healing', label: 'Лечение', path: getDamageIconPath('healing'), group: 'heal' },
  ...RESOURCE_ICONS.map((r): IconToken => ({
    token: r.value, label: r.label, path: getResourceIconPath(r.value), group: 'resource',
  })),
];

export const ICON_TOKEN_MAP: Record<string, IconToken> = Object.fromEntries(
  ICON_TOKENS.map((t) => [t.token, t])
);
