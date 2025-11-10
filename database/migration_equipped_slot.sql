-- Добавляем поле equipped_slot в таблицу inventory_items
ALTER TABLE inventory_items 
ADD COLUMN equipped_slot VARCHAR(50);

-- Добавляем индекс для быстрого поиска по слотам экипировки
CREATE INDEX idx_inventory_items_equipped_slot ON inventory_items(equipped_slot);

-- Добавляем комментарий к полю
COMMENT ON COLUMN inventory_items.equipped_slot IS 'Слот экипировки предмета (head, body, arms, feet, ring, necklace, cloak, one_hand, versatile)';










