import { ItemType } from '../types';

export const ITEM_TYPE_OPTIONS = [
  { value: 'weapon', label: 'Оружие' },
  { value: 'shield', label: 'Щит' },
  { value: 'helmet', label: 'Головной убор' },
  { value: 'chest', label: 'Торс' },
  { value: 'gloves', label: 'Перчатки' },
  { value: 'cloak', label: 'Плащ' },
  { value: 'boots', label: 'Обувь' },
  { value: 'ring', label: 'Кольцо' },
  { value: 'necklace', label: 'Ожерелье' },
  { value: 'potion', label: 'Зелье' },
  { value: 'scroll', label: 'Свиток' },
  { value: 'ammunition', label: 'Боеприпас' },
  { value: 'food', label: 'Еда' },
  { value: 'tool', label: 'Инструмент' },
  { value: 'ingredient', label: 'Ингредиент' },
  { value: 'none', label: 'Без типа' },
] as const;

export const getItemTypeLabel = (type: ItemType): string => {
  const option = ITEM_TYPE_OPTIONS.find(opt => opt.value === type);
  return option?.label || type;
};
