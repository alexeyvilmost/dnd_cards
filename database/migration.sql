-- Миграция для обновления поля properties
-- Удаляем старое ограничение
ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_properties_check;

-- Изменяем тип поля properties на TEXT для хранения JSON
ALTER TABLE cards ALTER COLUMN properties TYPE TEXT;

-- Добавляем новое ограничение для JSON массива (опционально)
-- ALTER TABLE cards ADD CONSTRAINT cards_properties_json_check 
-- CHECK (properties IS NULL OR properties::json IS NOT NULL);
