-- Миграция для создания библиотеки изображений
-- Выполняется автоматически при запуске docker-compose

-- Создаем таблицу для библиотеки изображений
CREATE TABLE IF NOT EXISTS image_library (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cloudinary_id VARCHAR(255) NOT NULL UNIQUE,
    cloudinary_url TEXT NOT NULL,
    original_name VARCHAR(255),
    file_size INTEGER,
    card_name VARCHAR(255),
    card_rarity VARCHAR(50),
    generation_prompt TEXT,
    generation_model VARCHAR(100),
    generation_time_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Создаем индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_image_library_card_name ON image_library USING gin(to_tsvector('russian', card_name));
CREATE INDEX IF NOT EXISTS idx_image_library_card_rarity ON image_library(card_rarity);
CREATE INDEX IF NOT EXISTS idx_image_library_created_at ON image_library(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_image_library_deleted_at ON image_library(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_image_library_cloudinary_id ON image_library(cloudinary_id);

-- Создаем триггер для обновления updated_at
CREATE TRIGGER update_image_library_updated_at 
    BEFORE UPDATE ON image_library 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
