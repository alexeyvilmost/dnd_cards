-- База данных уже создана в docker-compose.yml
-- Подключение к базе данных
\c dnd_cards;

-- Включение расширения для UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Создание таблицы карточек
CREATE TABLE cards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    properties TEXT, -- Храним как JSON массив
    description TEXT NOT NULL,
    image_url TEXT,
    rarity VARCHAR(50) NOT NULL CHECK (rarity IN ('common', 'uncommon', 'rare', 'very_rare', 'artifact')),
    card_number VARCHAR(20) NOT NULL,
    price INTEGER CHECK (price >= 1 AND price <= 50000),
    weight DECIMAL(5,2) CHECK (weight >= 0.01 AND weight <= 1000),
    bonus_type VARCHAR(50) CHECK (bonus_type IN ('damage', 'defense') OR bonus_type IS NULL),
    bonus_value VARCHAR(20),
    damage_type VARCHAR(20) CHECK (damage_type IN ('slashing', 'piercing', 'bludgeoning') OR damage_type IS NULL),
    defense_type VARCHAR(20) CHECK (defense_type IN ('cloth', 'light', 'medium', 'heavy') OR defense_type IS NULL),
    description_font_size INTEGER CHECK (description_font_size >= 6 AND description_font_size <= 20) DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Создание таблицы шаблонов оружия
CREATE TABLE weapon_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    name_en VARCHAR(100) NOT NULL,
    category VARCHAR(20) NOT NULL CHECK (category IN ('simple_melee', 'martial_melee', 'simple_ranged', 'martial_ranged')),
    damage_type VARCHAR(20) NOT NULL CHECK (damage_type IN ('slashing', 'piercing', 'bludgeoning')),
    damage VARCHAR(10) NOT NULL,
    weight DECIMAL(5,2) NOT NULL CHECK (weight >= 0.01 AND weight <= 1000),
    price INTEGER NOT NULL CHECK (price >= 1 AND price <= 50000),
    properties TEXT,
    image_path VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Создаем уникальный индекс только для активных записей
CREATE UNIQUE INDEX idx_cards_card_number_active ON cards (card_number) WHERE deleted_at IS NULL;

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

-- Вставка тестовых данных карточек (только если таблица пустая)
INSERT INTO cards (name, properties, description, rarity, card_number, price, weight, bonus_type, bonus_value, damage_type, defense_type)
SELECT * FROM (VALUES
    ('Зелье лечения', '["consumable"]', 'Восстанавливает 2d4+2 очка здоровья при употреблении.', 'common', 'CARD-0001', 10, 0.5, NULL, NULL, NULL, NULL),
    ('Меч пламени', '["magical"]', 'Магический меч, излучающий тепло.', 'rare', 'CARD-0002', 500, 3.0, 'damage', '1d8', 'slashing', NULL),
    ('Кожаная броня', '["armor"]', 'Легкая кожаная броня для подвижности.', 'common', 'CARD-0003', 10, 10.0, 'defense', '11', NULL, 'light'),
    ('Тканевая броня', '["armor"]', 'Простая тканевая броня для магов.', 'common', 'CARD-0006', 5, 2.0, 'defense', '10', NULL, 'cloth'),
    ('Кольчуга', '["armor"]', 'Средняя металлическая броня из переплетенных колец.', 'common', 'CARD-0007', 50, 20.0, 'defense', '14', NULL, 'medium'),
    ('Латная броня', '["armor"]', 'Тяжелая металлическая броня для максимальной защиты.', 'rare', 'CARD-0008', 1500, 40.0, 'defense', '18', NULL, 'heavy'),
    ('Зелье полета', '["consumable"]', 'Позволяет летать со скоростью 60 футов в течение 10 минут.', 'very_rare', 'CARD-0004', 1000, 1.0, NULL, NULL, NULL, NULL),
    ('Философский камень', '["single_use"]', 'Превращает любой металл в золото.', 'artifact', 'CARD-0005', 15000, 5.0, NULL, NULL, NULL, NULL)
) AS v(name, properties, description, rarity, card_number, price, weight, bonus_type, bonus_value, damage_type, defense_type)
WHERE NOT EXISTS (SELECT 1 FROM cards LIMIT 1);

-- Вставка шаблонов оружия (только если таблица пустая)
INSERT INTO weapon_templates (name, name_en, category, damage_type, damage, weight, price, properties, image_path)
SELECT * FROM (VALUES
    ('Короткий лук', 'Shortbow', 'simple_ranged', 'piercing', '1d6', 2.0, 25, '["light","finesse","thrown"]', '/images/weapons/shortbow.png'),
    ('Длинный лук', 'Longbow', 'martial_ranged', 'piercing', '1d8', 2.0, 50, '["heavy","two-handed"]', '/images/weapons/longbow.png'),
    ('Меч', 'Sword', 'martial_melee', 'slashing', '1d8', 3.0, 15, '["versatile"]', '/images/weapons/longsword.png'),
    ('Кинжал', 'Dagger', 'simple_melee', 'piercing', '1d4', 1.0, 2, '["light","finesse","thrown"]', '/images/weapons/dagger.png'),
    ('Топор', 'Axe', 'martial_melee', 'slashing', '1d12', 7.0, 30, '["heavy","two-handed"]', '/images/weapons/battleaxe.png'),
    ('Булава', 'Mace', 'simple_melee', 'bludgeoning', '1d6', 4.0, 5, '[]', '/images/weapons/mace.png'),
    ('Копье', 'Spear', 'simple_melee', 'piercing', '1d6', 3.0, 1, '["versatile","thrown"]', '/images/weapons/spear.png'),
    ('Молот', 'Warhammer', 'martial_melee', 'bludgeoning', '1d8', 2.0, 15, '["versatile"]', '/images/weapons/warhammer.png'),
    ('Арбалет', 'Crossbow', 'simple_ranged', 'piercing', '1d8', 5.0, 50, '["heavy","loading","two-handed"]', '/images/weapons/light_crossbow.png'),
    ('Праща', 'Sling', 'simple_ranged', 'bludgeoning', '1d4', 0.1, 1, '["ammunition"]', '/images/weapons/sling.png')
) AS v(name, name_en, category, damage_type, damage, weight, price, properties, image_path)
WHERE NOT EXISTS (SELECT 1 FROM weapon_templates LIMIT 1);
