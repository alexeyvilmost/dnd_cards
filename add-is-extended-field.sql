-- Добавление поля is_extended в таблицу cards
ALTER TABLE cards ADD COLUMN IF NOT EXISTS is_extended BOOLEAN DEFAULT NULL;

-- Обновление существующих карточек
-- Устанавливаем is_extended = true для карточек с длинным описанием (>100 символов)
UPDATE cards SET is_extended = true WHERE LENGTH(description) > 100;

-- Устанавливаем is_extended = false для карточек с коротким описанием (<=100 символов)
UPDATE cards SET is_extended = false WHERE LENGTH(description) <= 100;
