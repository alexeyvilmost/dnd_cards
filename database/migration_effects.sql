-- Добавляем поле effects в таблицу cards
ALTER TABLE cards 
ADD COLUMN effects JSONB;

-- Добавляем комментарий к полю
COMMENT ON COLUMN cards.effects IS 'Эффекты предмета в формате JSON: массив объектов с полями target_type, target_specific, modifier, value';

-- Добавляем индекс для быстрого поиска по эффектам (опционально)
CREATE INDEX idx_cards_effects ON cards USING GIN (effects);
