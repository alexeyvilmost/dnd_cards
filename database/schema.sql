-- База данных уже создана в docker-compose.yml
-- Подключение к базе данных
\c dnd_cards;

-- Включение расширения для UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Создание таблицы карточек
CREATE TABLE cards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    properties VARCHAR(50) NOT NULL CHECK (properties IN ('consumable', 'single_use')),
    description TEXT NOT NULL,
    image_url TEXT,
    rarity VARCHAR(50) NOT NULL CHECK (rarity IN ('common', 'uncommon', 'rare', 'very_rare', 'artifact')),
    card_number VARCHAR(20) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Создание индексов для оптимизации поиска
CREATE INDEX idx_cards_rarity ON cards(rarity);
CREATE INDEX idx_cards_properties ON cards(properties);
CREATE INDEX idx_cards_name ON cards USING gin(to_tsvector('russian', name));
CREATE INDEX idx_cards_created_at ON cards(created_at DESC);
CREATE INDEX idx_cards_deleted_at ON cards(deleted_at) WHERE deleted_at IS NOT NULL;

-- Создание триггера для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_cards_updated_at 
    BEFORE UPDATE ON cards 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Вставка тестовых данных
INSERT INTO cards (name, properties, description, rarity, card_number) VALUES
('Зелье лечения', 'consumable', 'Восстанавливает 2d4+2 очка здоровья при употреблении.', 'common', 'CARD-0001'),
('Зелье силы', 'single_use', 'Увеличивает силу на +2 на 1 час.', 'uncommon', 'CARD-0002'),
('Эликсир невидимости', 'single_use', 'Делает потребителя невидимым на 1 час.', 'rare', 'CARD-0003'),
('Зелье полета', 'consumable', 'Позволяет летать со скоростью 60 футов в течение 10 минут.', 'very_rare', 'CARD-0004'),
('Философский камень', 'single_use', 'Превращает любой металл в золото.', 'artifact', 'CARD-0005');
