// Функция для получения символа редкости для доступности
export const getRaritySymbol = (rarity: string): string => {
  switch (rarity) {
    case 'common':
      return '•';
    case 'uncommon':
      return ':';
    case 'rare':
      return '✦';
    case 'epic':
      return '✧';
    case 'legendary':
      return '✩';
    case 'very_rare':
      return '✪';
    case 'artifact':
      return '✫';
    case 'relic':
      return '✬';
    case 'custom':
      return '◇';
    default:
      return '•';
  }
};

export const getRaritySymbolDescription = (rarity: string): string => {
  switch (rarity) {
    case 'common':
      return 'Обычная редкость';
    case 'uncommon':
      return 'Необычная редкость';
    case 'rare':
      return 'Редкая редкость';
    case 'epic':
      return 'Эпическая редкость';
    case 'legendary':
      return 'Легендарная редкость';
    case 'very_rare':
      return 'Очень редкая редкость';
    case 'artifact':
      return 'Артефакт';
    case 'relic':
      return 'Реликвия';
    case 'custom':
      return 'Кастомная редкость';
    default:
      return 'Неизвестная редкость';
  }
};
