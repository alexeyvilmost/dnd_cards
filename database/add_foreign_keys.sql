-- Добавление внешних ключей после создания всех таблиц
-- Подключение к базе данных
\c dnd_cards;

-- Добавляем внешний ключ на таблицу cards
ALTER TABLE inventory_items ADD CONSTRAINT fk_inventory_items_card_id 
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE;
