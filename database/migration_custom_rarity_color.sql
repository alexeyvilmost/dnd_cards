-- Цвет кастомной редкости для карт (редкость custom)
ALTER TABLE cards ADD COLUMN IF NOT EXISTS custom_rarity_color VARCHAR(7);
COMMENT ON COLUMN cards.custom_rarity_color IS 'HEX-цвет (#RRGGBB) для редкости custom';
