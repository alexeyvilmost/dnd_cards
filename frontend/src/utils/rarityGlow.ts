/** Цвет свечения под картой в детальном просмотре — совпадает с цветом редкости. */
export const getRarityGlowColor = (rarity: string): string => {
  switch (rarity?.toLowerCase()) {
    case 'uncommon':
      return '#22c55e';
    case 'rare':
      return '#3b82f6';
    case 'very_rare':
      return '#a855f7';
    case 'artifact':
      return '#f59e0b';
    case 'common':
    default:
      return '#9ca3af';
  }
};

/** Интенсивность свечения растёт от обычной к артефактной редкости. */
export const getRarityGlowSettings = (rarity: string) => {
  switch (rarity?.toLowerCase()) {
    case 'uncommon':
      return { idleOpacity: 0.2, hoverOpacity: 0.5, blur: 28, spread: 0.85 };
    case 'rare':
      return { idleOpacity: 0.25, hoverOpacity: 0.6, blur: 34, spread: 0.9 };
    case 'very_rare':
      return { idleOpacity: 0.35, hoverOpacity: 0.75, blur: 42, spread: 1 };
    case 'artifact':
      return { idleOpacity: 0.45, hoverOpacity: 0.9, blur: 52, spread: 1.1 };
    case 'common':
    default:
      return { idleOpacity: 0.12, hoverOpacity: 0.35, blur: 22, spread: 0.8 };
  }
};
