-- Миграция для добавления расширенных полей к картам и шаблонам
-- Добавляем новые поля для карт
ALTER TABLE cards ADD COLUMN IF NOT EXISTS author VARCHAR(255) DEFAULT 'Admin';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS source VARCHAR(255);
ALTER TABLE cards ADD COLUMN IF NOT EXISTS type VARCHAR(50);
ALTER TABLE cards ADD COLUMN IF NOT EXISTS related_cards TEXT; -- JSON массив ID
ALTER TABLE cards ADD COLUMN IF NOT EXISTS related_actions TEXT; -- JSON массив ID (плейсхолдер)
ALTER TABLE cards ADD COLUMN IF NOT EXISTS related_effects TEXT; -- JSON массив ID (плейсхолдер)
ALTER TABLE cards ADD COLUMN IF NOT EXISTS attunement TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS tags TEXT; -- Массив тегов

-- Добавляем новые поля для шаблонов оружия
ALTER TABLE weapon_templates ADD COLUMN IF NOT EXISTS author VARCHAR(255) DEFAULT 'Admin';
ALTER TABLE weapon_templates ADD COLUMN IF NOT EXISTS source VARCHAR(255);
ALTER TABLE weapon_templates ADD COLUMN IF NOT EXISTS type VARCHAR(50);
ALTER TABLE weapon_templates ADD COLUMN IF NOT EXISTS related_cards TEXT; -- JSON массив ID
ALTER TABLE weapon_templates ADD COLUMN IF NOT EXISTS related_actions TEXT; -- JSON массив ID (плейсхолдер)
ALTER TABLE weapon_templates ADD COLUMN IF NOT EXISTS related_effects TEXT; -- JSON массив ID (плейсхолдер)
ALTER TABLE weapon_templates ADD COLUMN IF NOT EXISTS attunement TEXT;
ALTER TABLE weapon_templates ADD COLUMN IF NOT EXISTS tags TEXT; -- Массив тегов

-- Создаем индексы для новых полей
CREATE INDEX IF NOT EXISTS idx_cards_author ON cards(author);
CREATE INDEX IF NOT EXISTS idx_cards_source ON cards(source);
CREATE INDEX IF NOT EXISTS idx_cards_type ON cards(type);
CREATE INDEX IF NOT EXISTS idx_weapon_templates_author ON weapon_templates(author);
CREATE INDEX IF NOT EXISTS idx_weapon_templates_source ON weapon_templates(source);
CREATE INDEX IF NOT EXISTS idx_weapon_templates_type ON weapon_templates(type);
