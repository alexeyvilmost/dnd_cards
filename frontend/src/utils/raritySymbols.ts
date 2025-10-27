// Функция для получения символа редкости для доступности
export const getRaritySymbol = (rarity: string): string => {
  switch (rarity) {
    case 'common':
      return '•'; // Точка
    case 'uncommon':
      return ':'; // Двоеточие
    case 'rare':
      return '✦'; // Звезда
    case 'epic':
      return '✧'; // Пустая звезда
    case 'legendary':
      return '✩'; // Звезда с тенью
    case 'very_rare':
      return '✪'; // Звезда в круге
    case 'artifact':
      return '✫'; // Звезда с лучами
    default:
      return '•'; // По умолчанию точка
  }
};

// Функция для получения описания символа редкости для screen readers
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
    default:
      return 'Неизвестная редкость';
  }
};
