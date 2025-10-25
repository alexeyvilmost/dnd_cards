export type Rarity = 'common' | 'uncommon' | 'rare' | 'very_rare' | 'artifact';
export type Property = 'consumable' | 'single_use' | 'light' | 'heavy' | 'finesse' | 'thrown' | 'versatile' | 'two-handed' | 'reach' | 'ammunition' | 'loading' | 'special' | 'shield' | 'ring' | 'necklace' | 'cloak';
export type Properties = Property[];
export type BonusType = 'damage' | 'defense';
export type ItemType = 'weapon' | 'shield' | 'helmet' | 'chest' | 'gloves' | 'cloak' | 'boots' | 'ring' | 'necklace' | 'potion' | 'scroll' | 'ammunition' | 'food' | 'tool' | 'ingredient' | 'none';
export type TemplateType = 'false' | 'template' | 'only_template';
export type EquipmentSlot = 'head' | 'body' | 'arms' | 'feet' | 'cloak' | 'one_hand' | 'versatile' | 'two_hands' | 'necklace' | 'ring';

export interface Card {
  id: string;
  name: string;
  properties: Properties | null;
  description: string;
  detailed_description?: string | null;
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
  text_alignment?: string | null;
  text_font_size?: number | null;
  show_detailed_description?: boolean | null;
  detailed_description_alignment?: string | null;
  detailed_description_font_size?: number | null;
  is_extended?: boolean | null;
  author?: string;
  source?: string | null;
  type?: ItemType | null;
  related_cards?: Properties | null;
  related_actions?: Properties | null;
  related_effects?: Properties | null;
  attunement?: string | null;
  tags?: Properties | null;
  is_template: TemplateType;
  slot?: EquipmentSlot | null;
  image_prompt_extra?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCardRequest {
  name: string;
  properties?: Properties | null;
  description: string;
  detailed_description?: string | null;
  rarity: Rarity;
  price?: number | null;
  weight?: number | null;
  bonus_type?: BonusType | null;
  bonus_value?: string | null;
  damage_type?: string | null;
  defense_type?: string | null;
  description_font_size?: number | null;
  text_alignment?: string | null;
  text_font_size?: number | null;
  show_detailed_description?: boolean | null;
  detailed_description_alignment?: string | null;
  detailed_description_font_size?: number | null;
  is_extended?: boolean | null;
  author?: string;
  source?: string | null;
  type?: ItemType | null;
  related_cards?: Properties | null;
  related_actions?: Properties | null;
  related_effects?: Properties | null;
  attunement?: string | null;
  tags?: Properties | null;
  is_template?: TemplateType;
  slot?: EquipmentSlot | null;
  image_prompt_extra?: string | null;
}

export interface UpdateCardRequest {
  name?: string;
  properties?: Properties | null;
  description?: string;
  detailed_description?: string | null;
  image_url?: string;
  rarity?: Rarity;
  price?: number | null;
  weight?: number | null;
  bonus_type?: BonusType | null;
  bonus_value?: string | null;
  damage_type?: string | null;
  defense_type?: string | null;
  description_font_size?: number | null;
  text_alignment?: string | null;
  text_font_size?: number | null;
  show_detailed_description?: boolean | null;
  detailed_description_alignment?: string | null;
  detailed_description_font_size?: number | null;
  is_extended?: boolean | null;
  author?: string;
  source?: string | null;
  type?: ItemType | null;
  related_cards?: Properties | null;
  related_actions?: Properties | null;
  related_effects?: Properties | null;
  attunement?: string | null;
  tags?: Properties | null;
  is_template?: TemplateType;
  slot?: EquipmentSlot | null;
  image_prompt_extra?: string | null;
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
  image_cloudinary_url?: string;
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
  		{ value: 'finesse', label: 'Фехтовальное' },
  { value: 'thrown', label: 'Метательное' },
  { value: 'versatile', label: 'Универсальное' },
  { value: 'two-handed', label: 'Двуручное' },
  { value: 'reach', label: 'Досягаемости' },
  { value: 'ammunition', label: 'Требует боеприпасы' },
  { value: 'loading', label: 'Зарядка' },
  { value: 'special', label: 'Особое' },
  // Свойства брони
  { value: 'cloth', label: 'Ткань' },
  { value: 'light_armor', label: 'Легкая броня' },
  { value: 'medium_armor', label: 'Средняя броня' },
  { value: 'heavy_armor', label: 'Тяжелая броня' },
  // Новые свойства
  { value: 'shield', label: 'Щит' },
  { value: 'ring', label: 'Кольцо' },
  { value: 'necklace', label: 'Ожерелье' },
  { value: 'cloak', label: 'Плащ' },
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

// Авторизация
export interface User {
  id: string;
  username: string;
  email: string;
  display_name: string;
  created_at: string;
  updated_at: string;
}

export interface AuthRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  display_name: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

// Группы
export type UserRole = 'dm' | 'player';

export interface Group {
  id: string;
  name: string;
  description: string;
  dm_id: string;
  created_at: string;
  updated_at: string;
  dm: User;
  members: GroupMember[];
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  role: UserRole;
  group: Group;
  user: User;
  created_at: string;
  updated_at: string;
}

export interface CreateGroupRequest {
  name: string;
  description?: string;
}

export interface JoinGroupRequest {
  group_id: string;
}

// Инвентарь

export interface Inventory {
  id: string;
  type: InventoryType;
  user_id?: string | null;
  group_id?: string | null;
  name: string;
  created_at: string;
  updated_at: string;
  user?: User | null;
  group?: Group | null;
  items: InventoryItem[];
}

export interface InventoryItem {
  id: string;
  inventory_id: string;
  card_id: string;
  quantity: number;
  notes: string;
  is_equipped: boolean;
  created_at: string;
  updated_at: string;
  inventory: Inventory;
  card: Card;
}

export interface CreateInventoryRequest {
  type: InventoryType;
  group_id?: string | null;
  name: string;
}

export interface AddItemToInventoryRequest {
  card_id: string;
  quantity: number;
  notes?: string;
}

export interface UpdateInventoryItemRequest {
  quantity: number;
  notes?: string;
  is_equipped?: boolean;
}

// Character - модель персонажа D&D
export interface Character {
  id: string;
  user_id: string;
  group_id?: string;
  name: string;
  data: string; // JSON строка с данными персонажа
  created_at: string;
  updated_at: string;
  
  // Связанные данные
  user?: User;
  group?: Group;
  inventories?: Inventory[];
}

// CreateCharacterRequest - запрос на создание персонажа
export interface CreateCharacterRequest {
  name: string;
  group_id?: string;
  data: string; // JSON строка с данными персонажа
}

// UpdateCharacterRequest - запрос на обновление персонажа
export interface UpdateCharacterRequest {
  name?: string;
  group_id?: string;
  data?: string;
}

// ImportCharacterRequest - запрос на импорт персонажа из JSON
export interface ImportCharacterRequest {
  character_data: string; // JSON строка с данными персонажа
  group_id?: string;
}

// ExportCharacterResponse - ответ с экспортом персонажа
export interface ExportCharacterResponse {
  character_data: string; // JSON строка с данными персонажа
}

// CharacterData - структура данных персонажа из JSON
export interface CharacterData {
  name: {
    value: string;
  };
  info: {
    charClass: {
      name: string;
      value: string;
    };
    charSubclass: {
      name: string;
      value: string;
    };
    level: {
      name: string;
      value: number;
    };
    background: {
      name: string;
      value: string;
    };
    race: {
      name: string;
      value: string;
    };
    playerName?: {
      name: string;
      value: string;
    };
    alignment?: {
      name: string;
      value: string;
    };
    experience?: {
      name: string;
      value: number;
    };
  };
  stats: {
    str: {
      name: string;
      score: number;
      modifier: number;
    };
    dex: {
      name: string;
      score: number;
      modifier: number;
    };
    con: {
      name: string;
      score: number;
      modifier: number;
    };
    int: {
      name: string;
      score: number;
      modifier: number;
    };
    wis: {
      name: string;
      score: number;
      modifier: number;
    };
    cha: {
      name: string;
      score: number;
      modifier: number;
    };
  };
  vitality: {
    'hp-current': {
      value: number;
    };
    'hp-max': {
      value: number;
    };
    'hp-temp': {
      value: number;
    };
    ac: {
      value: number;
    };
    speed: {
      value: number;
    };
  };
  coins: {
    gp: {
      value: number;
    };
  };
  weaponsList?: Array<{
    id: string;
    name: {
      value: string;
    };
    mod: {
      value: string;
    };
    dmg: {
      value: string;
    };
    isProf: boolean;
    notes: {
      value: string;
    };
    ability?: string;
  }>;
  feats?: {
    value: {
      data: {
        type: string;
        content: Array<{
          type: string;
          content?: Array<{
            type: string;
            text?: string;
            marks?: Array<{
              type: string;
            }>;
          }>;
        }>;
      };
    };
  };
}

// Константы для опций шаблонов
export const TEMPLATE_TYPE_OPTIONS = [
  { value: 'false', label: 'Обычная карта' },
  { value: 'template', label: 'Карта и шаблон' },
  { value: 'only_template', label: 'Только шаблон' },
] as const;

// Инвентарь
export type InventoryType = 'personal' | 'group' | 'character';

export interface InventoryItem {
  id: string;
  inventory_id: string;
  card_id: string;
  quantity: number;
  notes: string;
  created_at: string;
  updated_at: string;
  card: Card;
}

export interface Inventory {
  id: string;
  type: InventoryType;
  user_id?: string;
  group_id?: string;
  character_id?: string;
  name: string;
  created_at: string;
  updated_at: string;
  items: InventoryItem[];
}

// Утилиты для EquipmentSlot
export const EQUIPMENT_SLOTS: { value: EquipmentSlot; label: string }[] = [
  { value: 'head', label: 'Голова' },
  { value: 'body', label: 'Тело' },
  { value: 'arms', label: 'Наручи' },
  { value: 'feet', label: 'Обувь' },
  { value: 'cloak', label: 'Плащ' },
  { value: 'one_hand', label: 'Одна рука' },
  { value: 'versatile', label: 'Универсальное' },
  { value: 'two_hands', label: 'Две руки' },
  { value: 'necklace', label: 'Ожерелье' },
  { value: 'ring', label: 'Кольцо' },
];

export const getEquipmentSlotLabel = (slot: EquipmentSlot): string => {
  const slotConfig = EQUIPMENT_SLOTS.find(s => s.value === slot);
  return slotConfig ? slotConfig.label : slot;
};
