-- Создание индексов для ускорения операций с инвентарем
-- Миграция: 013_add_performance_indexes

-- Индексы для таблицы inventories
CREATE INDEX IF NOT EXISTS idx_inventories_character_id ON inventories(character_id);
CREATE INDEX IF NOT EXISTS idx_inventories_type ON inventories(type);
CREATE INDEX IF NOT EXISTS idx_inventories_character_type ON inventories(character_id, type);

-- Индексы для таблицы inventory_items
CREATE INDEX IF NOT EXISTS idx_inventory_items_inventory_id ON inventory_items(inventory_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_card_id ON inventory_items(card_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_inventory_card ON inventory_items(inventory_id, card_id);

-- Индексы для таблицы cards
CREATE INDEX IF NOT EXISTS idx_cards_id_deleted ON cards(id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cards_template_deleted ON cards(is_template, deleted_at);

-- Индексы для таблицы characters_v2
CREATE INDEX IF NOT EXISTS idx_characters_v2_user_id ON characters_v2(user_id);
CREATE INDEX IF NOT EXISTS idx_characters_v2_id_user ON characters_v2(id, user_id);

-- Индексы для таблицы users
CREATE INDEX IF NOT EXISTS idx_users_id_deleted ON users(id) WHERE deleted_at IS NULL;
