export type Rarity = 'common' | 'uncommon' | 'rare' | 'very_rare' | 'artifact';
export type Properties = 'consumable' | 'single_use';

export interface Card {
  id: string;
  name: string;
  properties: Properties;
  description: string;
  image_url?: string;
  rarity: Rarity;
  card_number: string;
  created_at: string;
  updated_at: string;
}

export interface CreateCardRequest {
  name: string;
  properties: Properties;
  description: string;
  rarity: Rarity;
}

export interface UpdateCardRequest {
  name?: string;
  properties?: Properties;
  description?: string;
  rarity?: Rarity;
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
] as const;
