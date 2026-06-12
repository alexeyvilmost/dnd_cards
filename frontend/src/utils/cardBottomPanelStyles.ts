export const BOTTOM_PANEL_FONT_FAMILY = "'Pangolin', 'Inter', sans-serif";

export const bottomPanelFontStyle = {
  fontFamily: BOTTOM_PANEL_FONT_FAMILY,
} as const;

export const bottomPanelStatInlineStyle = {
  fontSize: '8.5px',
  fontFamily: BOTTOM_PANEL_FONT_FAMILY,
  fontWeight: '500' as const,
  fontVariantNumeric: 'tabular-nums' as const,
};

export const bottomPanelPriceInlineStyle = {
  ...bottomPanelStatInlineStyle,
  color: '#d97706',
  fontWeight: 'bold' as const,
};

export const bottomPanelValueInlineStyle = {
  ...bottomPanelStatInlineStyle,
  color: '#111827',
};
