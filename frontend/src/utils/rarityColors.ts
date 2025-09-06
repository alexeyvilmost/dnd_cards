// Цвета редкости для предметов D&D
export const getRarityColor = (rarity: string): string => {
  switch (rarity?.toLowerCase()) {
    case 'common':
    case 'обычное':
      return 'text-gray-900'; // Черный
    case 'uncommon':
    case 'необычное':
      return 'text-green-600'; // Зеленый
    case 'rare':
    case 'редкое':
      return 'text-blue-600'; // Синий
    case 'epic':
    case 'эпическое':
      return 'text-purple-600'; // Фиолетовый
    case 'legendary':
    case 'легендарное':
      return 'text-orange-600'; // Оранжевый
    case 'artifact':
    case 'артефакт':
      return 'text-red-600'; // Красный
    default:
      return 'text-gray-900'; // По умолчанию черный
  }
};

// Цвета фона для редкости (для карточек)
export const getRarityBgColor = (rarity: string): string => {
  switch (rarity?.toLowerCase()) {
    case 'common':
    case 'обычное':
      return 'bg-gray-50 border-gray-200';
    case 'uncommon':
    case 'необычное':
      return 'bg-green-50 border-green-200';
    case 'rare':
    case 'редкое':
      return 'bg-blue-50 border-blue-200';
    case 'epic':
    case 'эпическое':
      return 'bg-purple-50 border-purple-200';
    case 'legendary':
    case 'легендарное':
      return 'bg-orange-50 border-orange-200';
    case 'artifact':
    case 'артефакт':
      return 'bg-red-50 border-red-200';
    default:
      return 'bg-gray-50 border-gray-200';
  }
};

// Цвета для бейджей редкости
export const getRarityBadgeColor = (rarity: string): string => {
  switch (rarity?.toLowerCase()) {
    case 'common':
    case 'обычное':
      return 'bg-gray-100 text-gray-800';
    case 'uncommon':
    case 'необычное':
      return 'bg-green-100 text-green-800';
    case 'rare':
    case 'редкое':
      return 'bg-blue-100 text-blue-800';
    case 'epic':
    case 'эпическое':
      return 'bg-purple-100 text-purple-800';
    case 'legendary':
    case 'легендарное':
      return 'bg-orange-100 text-orange-800';
    case 'artifact':
    case 'артефакт':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
};
