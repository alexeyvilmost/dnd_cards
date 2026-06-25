import { darkenHex, getRarityBorderGradientPair } from './rarityVisuals';

export const CARD_BORDER_WIDTH_PX = 6;
export const CARD_BORDER_WIDTH_CLASS = 'border-[6px]';

const CARD_BORDER_GRADIENT_ANGLE = '135deg';

const CARD_BORDER_GRADIENT_COLORS: Record<string, { top: string; bottom: string }> = {
  common: { top: '#9ca3af', bottom: '#1f2937' },
  uncommon: { top: '#22c55e', bottom: '#052e16' },
  rare: { top: '#3b82f6', bottom: '#0c1a3a' },
  very_rare: { top: '#a855f7', bottom: '#1e1033' },
  artifact: { top: '#f59e0b', bottom: '#3b1a05' },
  relic: { top: '#ef4444', bottom: '#450a0a' },
};

const CARD_BORDER_GRADIENTS: Record<string, string> = Object.fromEntries(
  Object.entries(CARD_BORDER_GRADIENT_COLORS).map(([rarity, colors]) => [
    rarity,
    `linear-gradient(${CARD_BORDER_GRADIENT_ANGLE}, ${colors.top} 0%, ${colors.bottom} 100%)`,
  ])
);

export const getCardBorderGradient = (rarity: string, customColor?: string | null): string => {
  if (rarity === 'custom' && customColor) {
    return `linear-gradient(${CARD_BORDER_GRADIENT_ANGLE}, ${customColor} 0%, ${darkenHex(customColor)} 100%)`;
  }
  return CARD_BORDER_GRADIENTS[rarity] ?? CARD_BORDER_GRADIENTS.common;
};

export const getCardBorderWrapperStyle = (rarity: string, customColor?: string | null) => ({
  padding: CARD_BORDER_WIDTH_PX,
  background: getCardBorderGradient(rarity, customColor),
});

export const getCardBorderGradientColors = (rarity: string, customColor?: string | null) => {
  return getRarityBorderGradientPair(rarity, customColor);
};
