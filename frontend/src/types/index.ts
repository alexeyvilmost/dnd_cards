export type Rarity = 'common' | 'uncommon' | 'rare' | 'very_rare' | 'artifact';
export type Property = 'consumable' | 'single_use' | 'light' | 'heavy' | 'finesse' | 'thrown' | 'versatile' | 'two-handed' | 'reach' | 'ammunition' | 'loading' | 'special';
export type Properties = Property[];
export type BonusType = 'damage' | 'defense';

export interface Card {
  id: string;
  name: string;
  properties: Properties | null;
  description: string;
  image_url?: string;
  rarity: Rarity;
  card_number: string;
  price?: number | null;
  weight?: number | null;
  bonus_type?: BonusType | null;
  bonus_value?: string | null;
  damage_type?: string | null;
  defense_type?: string | null;
  description_font_size?: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCardRequest {
  name: string;
  properties?: Properties | null;
  description: string;
  rarity: Rarity;
  price?: number | null;
  weight?: number | null;
  bonus_type?: BonusType | null;
  bonus_value?: string | null;
  damage_type?: string | null;
  defense_type?: string | null;
  description_font_size?: number | null;
}

export interface UpdateCardRequest {
  name?: string;
  properties?: Properties | null;
  description?: string;
  rarity?: Rarity;
  price?: number | null;
  weight?: number | null;
  bonus_type?: BonusType | null;
  bonus_value?: string | null;
  damage_type?: string | null;
  defense_type?: string | null;
  description_font_size?: number | null;
}

export interface CardsResponse {
  cards: Card[];
  total: number;
  page: number;
  limit: number;
}

export interface GenerateImageRequest {
  card_id: string;
  prompt?: string;
}

export interface ExportCardsRequest {
  card_ids: string[];
}

export interface ApiError {
  error: string;
}

export const RARITY_OPTIONS = [
  { value: 'common', label: 'Обычное', color: '#FFFFFF' },
  { value: 'uncommon', label: 'Необычное', color: '#00FF00' },
  { value: 'rare', label: 'Редкое', color: '#0080FF' },
  { value: 'very_rare', label: 'Очень редкое', color: '#8000FF' },
  { value: 'artifact', label: 'Артефакт', color: '#FF8000' },
] as const;

export const PROPERTIES_OPTIONS = [
  { value: 'consumable', label: 'Расходуемое' },
  { value: 'single_use', label: 'Одноразовое' },
  { value: 'light', label: 'Легкое' },
  { value: 'heavy', label: 'Тяжелое' },
  { value: 'finesse', label: 'Изящное' },
  { value: 'thrown', label: 'Метательное' },
  { value: 'versatile', label: 'Универсальное' },
  { value: 'two-handed', label: 'Двуручное' },
  { value: 'reach', label: 'Досягаемости' },
  { value: 'ammunition', label: 'Требует боеприпасы' },
  { value: 'loading', label: 'Зарядка' },
  { value: 'special', label: 'Особое' },
] as const;

export const BONUS_TYPE_OPTIONS = [
  { value: 'damage', label: 'Урон' },
  { value: 'defense', label: 'Защита' },
] as const;

// Шаблоны оружия
export interface WeaponTemplate {
  id: number;
  name: string;
  name_en: string;
  category: string;
  damage_type: string;
  damage: string;
  weight: number;
  price: number;
  properties: string[];
  image_path: string;
  description_font_size?: number | null;
}

export const WEAPON_CATEGORIES = [
  { value: 'simple_melee', label: 'Простое рукопашное' },
  { value: 'martial_melee', label: 'Воинское рукопашное' },
  { value: 'simple_ranged', label: 'Простое дальнобойное' },
  { value: 'martial_ranged', label: 'Воинское дальнобойное' }
];

export const DAMAGE_TYPES = [
  { value: 'slashing', label: 'Рубящий' },
  { value: 'piercing', label: 'Колющий' },
  { value: 'bludgeoning', label: 'Дробящий' }
];

export const DEFENSE_TYPES = [
  { value: 'cloth', label: 'Тканевая' },
  { value: 'light', label: 'Легкая' },
  { value: 'medium', label: 'Средняя' },
  { value: 'heavy', label: 'Тяжелая' }
];
