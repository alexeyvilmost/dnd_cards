-- Миграция для добавления поддержки изображений
-- Подключение к базе данных
\c dnd_cards;

-- Добавляем поля для хранения изображений в таблицу cards
ALTER TABLE cards ADD COLUMN IF NOT EXISTS image_cloudinary_id VARCHAR(255);
ALTER TABLE cards ADD COLUMN IF NOT EXISTS image_cloudinary_url TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS image_generated BOOLEAN DEFAULT FALSE;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS image_generation_prompt TEXT;

-- Добавляем поля для хранения изображений в таблицу weapon_templates
ALTER TABLE weapon_templates ADD COLUMN IF NOT EXISTS image_cloudinary_id VARCHAR(255);
ALTER TABLE weapon_templates ADD COLUMN IF NOT EXISTS image_cloudinary_url TEXT;
ALTER TABLE weapon_templates ADD COLUMN IF NOT EXISTS image_generated BOOLEAN DEFAULT FALSE;

-- Создаем индексы для оптимизации поиска по изображениям
CREATE INDEX IF NOT EXISTS idx_cards_image_cloudinary_id ON cards(image_cloudinary_id);
CREATE INDEX IF NOT EXISTS idx_cards_image_generated ON cards(image_generated);
CREATE INDEX IF NOT EXISTS idx_weapon_templates_image_cloudinary_id ON weapon_templates(image_cloudinary_id);
CREATE INDEX IF NOT EXISTS idx_weapon_templates_image_generated ON weapon_templates(image_generated);

-- Создаем таблицу для хранения истории генерации изображений
CREATE TABLE IF NOT EXISTS image_generation_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('card', 'weapon_template')),
    entity_id UUID NOT NULL,
    cloudinary_id VARCHAR(255) NOT NULL,
    cloudinary_url TEXT NOT NULL,
    generation_prompt TEXT,
    generation_model VARCHAR(100),
    generation_time_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Создаем индексы для таблицы логов
CREATE INDEX IF NOT EXISTS idx_image_generation_log_entity ON image_generation_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_image_generation_log_created_at ON image_generation_log(created_at DESC);

-- Добавляем комментарии к полям
COMMENT ON COLUMN cards.image_cloudinary_id IS 'ID изображения в Cloudinary';
COMMENT ON COLUMN cards.image_cloudinary_url IS 'URL изображения в Cloudinary';
COMMENT ON COLUMN cards.image_generated IS 'Флаг, указывающий что изображение было сгенерировано ИИ';
COMMENT ON COLUMN cards.image_generation_prompt IS 'Промпт, использованный для генерации изображения';

COMMENT ON COLUMN weapon_templates.image_cloudinary_id IS 'ID изображения в Cloudinary';
COMMENT ON COLUMN weapon_templates.image_cloudinary_url IS 'URL изображения в Cloudinary';
COMMENT ON COLUMN weapon_templates.image_generated IS 'Флаг, указывающий что изображение было сгенерировано ИИ';

COMMENT ON TABLE image_generation_log IS 'Лог генерации изображений для аудита и аналитики';
