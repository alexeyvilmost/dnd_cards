import { getEffectiveRarityColor } from './rarityVisuals';

/** Цвет свечения под картой в детальном просмотре — совпадает с цветом редкости. */
export const getRarityGlowColor = (rarity: string, customColor?: string | null): string => {
  return getEffectiveRarityColor(rarity, customColor);
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
    case 'relic':
      return { idleOpacity: 0.4, hoverOpacity: 0.85, blur: 48, spread: 1.05 };
    case 'custom':
      return { idleOpacity: 0.3, hoverOpacity: 0.7, blur: 40, spread: 1 };
    case 'common':
    default:
      return { idleOpacity: 0.12, hoverOpacity: 0.35, blur: 22, spread: 0.8 };
  }
};
