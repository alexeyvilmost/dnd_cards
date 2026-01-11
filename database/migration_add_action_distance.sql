-- Миграция для добавления поля distance в таблицу actions
ALTER TABLE actions ADD COLUMN IF NOT EXISTS distance VARCHAR(100);

-- Добавляем комментарий к колонке
COMMENT ON COLUMN actions.distance IS 'Дальность действия (например, "5 футов", "30 футов", "На себя")';
