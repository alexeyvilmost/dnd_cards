-- Схема для Supabase PostgreSQL
-- База данных postgres уже создана в Supabase

-- Включение расширения для UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Создание таблицы карточек
CREATE TABLE cards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    properties TEXT[],
    description TEXT,
    image_url TEXT,
    rarity VARCHAR(50) NOT NULL DEFAULT 'common',
    card_number VARCHAR(50) UNIQUE,
    price INTEGER DEFAULT 0,
    weight DECIMAL(10,2) DEFAULT 0,
    bonus_type VARCHAR(50),
    bonus_value VARCHAR(100),
    damage_type VARCHAR(50),
    defense_type VARCHAR(50),
    description_font_size INTEGER,
    is_extended BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Создание таблицы шаблонов оружия
CREATE TABLE weapon_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    properties TEXT[],
    description TEXT,
    image_url TEXT,
    rarity VARCHAR(50) NOT NULL DEFAULT 'common',
    card_number VARCHAR(50) UNIQUE,
    price INTEGER DEFAULT 0,
    weight DECIMAL(10,2) DEFAULT 0,
    bonus_type VARCHAR(50),
    bonus_value VARCHAR(100),
    damage_type VARCHAR(50),
    defense_type VARCHAR(50),
    description_font_size INTEGER,
    is_extended BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Создание индексов для улучшения производительности
CREATE INDEX idx_cards_rarity ON cards(rarity);
CREATE INDEX idx_cards_name ON cards(name);
CREATE INDEX idx_weapon_templates_rarity ON weapon_templates(rarity);
CREATE INDEX idx_weapon_templates_name ON weapon_templates(name);

-- Создание функции для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Создание триггеров для автоматического обновления updated_at
CREATE TRIGGER update_cards_updated_at BEFORE UPDATE ON cards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_weapon_templates_updated_at BEFORE UPDATE ON weapon_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
