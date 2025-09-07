-- Миграция для добавления колонки is_extended в локальную БД
-- Выполняется автоматически при запуске docker-compose

-- Добавляем колонку is_extended в таблицу cards
ALTER TABLE cards ADD COLUMN IF NOT EXISTS is_extended BOOLEAN;

-- Добавляем колонку is_extended в таблицу weapon_templates  
ALTER TABLE weapon_templates ADD COLUMN IF NOT EXISTS is_extended BOOLEAN;
