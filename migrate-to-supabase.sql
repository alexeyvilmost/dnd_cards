-- Миграция схемы для Supabase
-- Выполните этот скрипт в SQL Editor в Supabase

-- Создание таблицы карточек
CREATE TABLE IF NOT EXISTS cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    properties TEXT[] DEFAULT '{}',
    description TEXT NOT NULL,
    image_url TEXT DEFAULT '',
    rarity VARCHAR(20) NOT NULL CHECK (rarity IN ('common', 'uncommon', 'rare', 'very_rare', 'artifact')),
    card_number VARCHAR(20) UNIQUE NOT NULL,
    price INTEGER CHECK (price >= 1 AND price <= 50000),
    weight DECIMAL(5,2) CHECK (weight >= 0.01 AND weight <= 1000),
    bonus_type VARCHAR(50) CHECK (bonus_type IN ('damage', 'defense')),
    bonus_value VARCHAR(20),
    damage_type VARCHAR(20) CHECK (damage_type IN ('slashing', 'piercing', 'bludgeoning') OR damage_type IS NULL),
    defense_type VARCHAR(20) CHECK (defense_type IN ('cloth', 'light', 'medium', 'heavy') OR defense_type IS NULL),
    description_font_size INTEGER CHECK (description_font_size >= 6 AND description_font_size <= 20) DEFAULT NULL,
    is_extended BOOLEAN DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Создание таблицы шаблонов оружия
CREATE TABLE IF NOT EXISTS weapon_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    name_en VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL,
    damage_type VARCHAR(20) NOT NULL,
    damage VARCHAR(20) NOT NULL,
    weight DECIMAL(5,2) NOT NULL,
    price INTEGER NOT NULL,
    properties TEXT[] DEFAULT '{}',
    image_path TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Вставка тестовых данных для карточек
INSERT INTO cards (name, properties, description, rarity, card_number, price, weight, bonus_type, bonus_value, damage_type) VALUES
('Длинный лук', ARRAY['Тяжелое', 'Фехтовальное', 'Универсальное', 'Двуручное', 'Досягаемости'], 'Длинный лук - это воинское дальнобойное оружие.', 'common', 'CARD-0001', 50, 3.0, 'damage', '1d8', 'piercing'),
('Меч пламени', ARRAY['Фехтовальное', 'Универсальное'], 'Магический меч, окутанный вечным пламенем.', 'rare', 'CARD-0002', 500, 3.0, 'damage', '1d8+1d6', 'slashing'),
('Философски', ARRAY['Особое'], 'Древний артефакт, содержащий мудрость веков.', 'artifact', 'CARD-0003', 15000, 1.0, 'defense', '5', NULL),
('Простая тканевая броня для магов', ARRAY['Легкое'], 'Легкая броня из ткани, усиленная магией.', 'common', 'CARD-0004', 10, 1.0, 'defense', '2', NULL),
('Кольчуга', ARRAY['Среднее'], 'Средняя металлическая броня из переплетенных колец.', 'common', 'CARD-0007', 50, 20.0, 'defense', '14', NULL),
('Кожаная броня', ARRAY['Легкое'], 'Легкая броня из обработанной кожи.', 'common', 'CARD-0008', 10, 10.0, 'defense', '11', NULL),
('Латная броня', ARRAY['Тяжелое'], 'Тяжелая металлическая броня.', 'rare', 'CARD-0009', 1500, 65.0, 'defense', '18', NULL);

-- Вставка тестовых данных для шаблонов оружия
INSERT INTO weapon_templates (name, name_en, category, damage_type, damage, weight, price, properties) VALUES
('Меч', 'Sword', 'simple_melee', 'slashing', '1d6', 3.0, 15, ARRAY['Универсальное']),
('Топор', 'Axe', 'simple_melee', 'slashing', '1d6', 4.0, 10, ARRAY['Тяжелое']),
('Кинжал', 'Dagger', 'simple_melee', 'piercing', '1d4', 1.0, 2, ARRAY['Легкое', 'Метательное']);

-- Создание индексов для улучшения производительности
CREATE INDEX IF NOT EXISTS idx_cards_rarity ON cards(rarity);
CREATE INDEX IF NOT EXISTS idx_cards_bonus_type ON cards(bonus_type);
CREATE INDEX IF NOT EXISTS idx_weapon_templates_rarity ON weapon_templates(rarity);

