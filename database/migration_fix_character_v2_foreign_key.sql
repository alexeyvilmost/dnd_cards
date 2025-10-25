-- Миграция для исправления внешнего ключа character_id в таблице inventories
-- Удаляем старый внешний ключ и создаем новый, ссылающийся на characters_v2

-- Удаляем старый внешний ключ
ALTER TABLE inventories DROP CONSTRAINT IF EXISTS fk_inventories_character_id;

-- Создаем новый внешний ключ, ссылающийся на characters_v2
ALTER TABLE inventories ADD CONSTRAINT fk_inventories_character_id 
    FOREIGN KEY (character_id) REFERENCES characters_v2(id) ON DELETE CASCADE;
