/** Затемнение HEX-цвета для нижней грани градиента рамки. */
export function darkenHex(hex: string, factor = 0.55): string {
  const normalized = hex.trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(normalized)) {
    return '#1f2937';
  }
  const c = normalized.slice(1);
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const dr = Math.round(r * (1 - factor));
  const dg = Math.round(g * (1 - factor));
  const db = Math.round(b * (1 - factor));
  return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`;
}

export function getEffectiveRarityColor(rarity: string, customColor?: string | null): string {
  if (rarity === 'custom' && customColor) {
    return customColor;
  }
  switch (rarity) {
    case 'uncommon':
      return '#22c55e';
    case 'rare':
      return '#3b82f6';
    case 'very_rare':
      return '#a855f7';
    case 'artifact':
      return '#f59e0b';
    case 'relic':
      return '#ef4444';
    case 'common':
    default:
      return '#9ca3af';
  }
}

export function getRarityBorderGradientPair(
  rarity: string,
  customColor?: string | null
): { top: string; bottom: string } {
  if (rarity === 'custom' && customColor) {
    return { top: customColor, bottom: darkenHex(customColor, 0.55) };
  }
  switch (rarity) {
    case 'uncommon':
      return { top: '#22c55e', bottom: '#052e16' };
    case 'rare':
      return { top: '#3b82f6', bottom: '#0c1a3a' };
    case 'very_rare':
      return { top: '#a855f7', bottom: '#1e1033' };
    case 'artifact':
      return { top: '#f59e0b', bottom: '#3b1a05' };
    case 'relic':
      return { top: '#ef4444', bottom: '#450a0a' };
    case 'common':
    default:
      return { top: '#9ca3af', bottom: '#1f2937' };
  }
}
