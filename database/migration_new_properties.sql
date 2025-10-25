-- Миграция для добавления новых свойств: shield, ring, necklace, cloak

-- Обновление ограничения для defense_type
ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_defense_type_check;
ALTER TABLE cards ADD CONSTRAINT cards_defense_type_check 
    CHECK (defense_type IN ('cloth', 'light', 'medium', 'heavy', 'cloth', 'light_armor', 'medium_armor', 'heavy_armor', 'shield', 'ring', 'necklace', 'cloak') OR defense_type IS NULL);

-- Обновление ограничения для weapon_templates если оно существует
ALTER TABLE weapon_templates DROP CONSTRAINT IF EXISTS weapon_templates_defense_type_check;
ALTER TABLE weapon_templates ADD CONSTRAINT weapon_templates_defense_type_check 
    CHECK (defense_type IN ('cloth', 'light', 'medium', 'heavy', 'cloth', 'light_armor', 'medium_armor', 'heavy_armor', 'shield', 'ring', 'necklace', 'cloak') OR defense_type IS NULL);
