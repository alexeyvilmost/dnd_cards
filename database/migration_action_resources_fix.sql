-- Миграция для исправления constraint на колонке resource в таблице actions
-- Удаляем CHECK constraint, так как теперь храним несколько ресурсов через запятую

-- Удаляем старый CHECK constraint
ALTER TABLE actions DROP CONSTRAINT IF EXISTS actions_resource_check;

-- Меняем тип колонки на TEXT для хранения нескольких ресурсов через запятую
ALTER TABLE actions ALTER COLUMN resource TYPE TEXT;

-- Убираем NOT NULL, так как теперь может быть пустой строкой
ALTER TABLE actions ALTER COLUMN resource DROP NOT NULL;

-- Добавляем комментарий к колонке
COMMENT ON COLUMN actions.resource IS 'Ресурсы действия через запятую (action, bonus_action, reaction, free_action)';
