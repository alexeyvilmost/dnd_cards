-- Миграция для добавления поддержки персонажей
-- Добавление колонки character_id в таблицу inventories
ALTER TABLE inventories ADD COLUMN IF NOT EXISTS character_id UUID;

-- Добавление нового типа инвентаря для персонажей
-- (PostgreSQL не поддерживает ALTER TYPE для enum, поэтому используем CHECK constraint)
ALTER TABLE inventories DROP CONSTRAINT IF EXISTS inventories_type_check;
ALTER TABLE inventories ADD CONSTRAINT inventories_type_check 
    CHECK (type IN ('personal', 'group', 'character'));

-- Создание таблицы персонажей
CREATE TABLE IF NOT EXISTS characters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    data TEXT NOT NULL, -- JSON строка с данными персонажа
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Создание индексов для персонажей
CREATE INDEX IF NOT EXISTS idx_characters_user_id ON characters(user_id);
CREATE INDEX IF NOT EXISTS idx_characters_group_id ON characters(group_id);
CREATE INDEX IF NOT EXISTS idx_characters_name ON characters(name);
CREATE INDEX IF NOT EXISTS idx_characters_created_at ON characters(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_characters_deleted_at ON characters(deleted_at) WHERE deleted_at IS NOT NULL;

-- Создание триггера для автоматического обновления updated_at для персонажей
CREATE TRIGGER update_characters_updated_at 
    BEFORE UPDATE ON characters 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Добавление внешнего ключа для character_id в inventories
ALTER TABLE inventories ADD CONSTRAINT fk_inventories_character_id 
    FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE;

-- Создание индекса для character_id в inventories
CREATE INDEX IF NOT EXISTS idx_inventories_character_id ON inventories(character_id);

-- Вставка тестового персонажа (только если таблица пустая)
INSERT INTO characters (user_id, name, data)
SELECT 
    u.id,
    'Лортар',
    '{"name":{"value":"Лортар"},"info":{"charClass":{"name":"charClass","value":"Паладин/Колдун"},"charSubclass":{"name":"charSubclass","value":"Клятва Мести"},"level":{"name":"level","value":4},"background":{"name":"background","value":"Прислужник"},"race":{"name":"race","value":"Человек"}},"stats":{"str":{"score":15,"modifier":0},"dex":{"score":13,"modifier":0},"con":{"score":14,"modifier":0},"int":{"score":9,"modifier":0},"wis":{"score":11,"modifier":0},"cha":{"score":16,"modifier":0}}}'
FROM users u
WHERE u.username = 'testuser'
AND NOT EXISTS (SELECT 1 FROM characters LIMIT 1);
