export const DEFAULT_DESCRIPTION_FONT_SIZE = 13;

export const getCardDescriptionFontSize = (card: {
  text_font_size?: number | null;
  description_font_size?: number | null;
}): string => {
  if (card.text_font_size) {
    return `${card.text_font_size}px`;
  }
  if (card.description_font_size) {
    return `${card.description_font_size}px`;
  }
  return `${DEFAULT_DESCRIPTION_FONT_SIZE}px`;
};
