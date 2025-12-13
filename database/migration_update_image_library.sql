-- Скрипт для обновления существующих записей в библиотеке изображений
-- на основе данных из таблицы cards
-- Выполнить напрямую в базе данных

-- Обновляем item_type, weapon_type, slot из карт
UPDATE image_library il
SET
    item_type = c.type,
    weapon_type = c.weapon_type,
    slot = c.slot,
    updated_at = CURRENT_TIMESTAMP
FROM cards c
WHERE il.cloudinary_id = c.image_cloudinary_id
  AND c.deleted_at IS NULL
  AND il.deleted_at IS NULL
  AND (
    c.type IS NOT NULL
    OR c.weapon_type IS NOT NULL
    OR c.slot IS NOT NULL
  );

-- Обновляем armor_type из properties карт
-- Используем безопасный подход с обработкой обоих типов данных (TEXT и TEXT[])

-- Создаем вспомогательную функцию для безопасной проверки наличия значения в properties
CREATE OR REPLACE FUNCTION check_property_contains(prop_value TEXT, search_val TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    prop_text TEXT;
BEGIN
    -- Если значение пустое, возвращаем false
    IF prop_value IS NULL OR prop_value = '' THEN
        RETURN FALSE;
    END IF;
    
    -- Приводим к тексту для анализа
    prop_text := prop_value::TEXT;
    
    -- Пробуем как JSON массив (начинается с [)
    IF prop_text LIKE '[%' THEN
        BEGIN
            RETURN prop_text::jsonb @> ('["' || search_val || '"]')::jsonb;
        EXCEPTION WHEN OTHERS THEN
            -- Если не удалось распарсить как JSON, продолжаем
        END;
    END IF;
    
    -- Пробуем как PostgreSQL массив (начинается с {)
    IF prop_text LIKE '{%' THEN
        BEGIN
            RETURN ARRAY[search_val]::text[] <@ prop_text::text[];
        EXCEPTION WHEN OTHERS THEN
            -- Если не удалось распарсить как массив, продолжаем
        END;
    END IF;
    
    -- Простая проверка строки (fallback)
    RETURN prop_text LIKE '%"' || search_val || '"%' OR prop_text LIKE '%' || search_val || '%';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Ткань
UPDATE image_library il
SET
    armor_type = 'cloth',
    updated_at = CURRENT_TIMESTAMP
FROM cards c
WHERE il.cloudinary_id = c.image_cloudinary_id
  AND c.deleted_at IS NULL
  AND il.deleted_at IS NULL
  AND c.properties IS NOT NULL
  AND check_property_contains(c.properties::TEXT, 'cloth');

-- Легкая броня
UPDATE image_library il
SET
    armor_type = 'light_armor',
    updated_at = CURRENT_TIMESTAMP
FROM cards c
WHERE il.cloudinary_id = c.image_cloudinary_id
  AND c.deleted_at IS NULL
  AND il.deleted_at IS NULL
  AND c.properties IS NOT NULL
  AND check_property_contains(c.properties::TEXT, 'light_armor');

-- Средняя броня
UPDATE image_library il
SET
    armor_type = 'medium_armor',
    updated_at = CURRENT_TIMESTAMP
FROM cards c
WHERE il.cloudinary_id = c.image_cloudinary_id
  AND c.deleted_at IS NULL
  AND il.deleted_at IS NULL
  AND c.properties IS NOT NULL
  AND check_property_contains(c.properties::TEXT, 'medium_armor');

-- Тяжелая броня
UPDATE image_library il
SET
    armor_type = 'heavy_armor',
    updated_at = CURRENT_TIMESTAMP
FROM cards c
WHERE il.cloudinary_id = c.image_cloudinary_id
  AND c.deleted_at IS NULL
  AND il.deleted_at IS NULL
  AND c.properties IS NOT NULL
  AND check_property_contains(c.properties::TEXT, 'heavy_armor');

-- Удаляем вспомогательную функцию после использования (опционально, можно оставить для будущего использования)
-- DROP FUNCTION IF EXISTS check_property_contains(TEXT, TEXT);
