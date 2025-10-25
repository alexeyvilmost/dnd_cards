-- Миграция для создания таблицы персонажей V2

-- Создание таблицы персонажей V2
CREATE TABLE IF NOT EXISTS characters_v2 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    race VARCHAR(50) NOT NULL,
    class VARCHAR(50) NOT NULL,
    level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1 AND level <= 20),
    speed INTEGER NOT NULL DEFAULT 30 CHECK (speed >= 1),
    
    -- Характеристики
    strength INTEGER NOT NULL DEFAULT 10 CHECK (strength >= 1 AND strength <= 30),
    dexterity INTEGER NOT NULL DEFAULT 10 CHECK (dexterity >= 1 AND dexterity <= 30),
    constitution INTEGER NOT NULL DEFAULT 10 CHECK (constitution >= 1 AND constitution <= 30),
    intelligence INTEGER NOT NULL DEFAULT 10 CHECK (intelligence >= 1 AND intelligence <= 30),
    wisdom INTEGER NOT NULL DEFAULT 10 CHECK (wisdom >= 1 AND wisdom <= 30),
    charisma INTEGER NOT NULL DEFAULT 10 CHECK (charisma >= 1 AND charisma <= 30),
    
    -- Хиты
    max_hp INTEGER NOT NULL DEFAULT 1 CHECK (max_hp >= 1),
    current_hp INTEGER NOT NULL DEFAULT 1 CHECK (current_hp >= 0),
    
    -- Массивы навыков
    saving_throw_proficiencies TEXT[] DEFAULT '{}',
    skill_proficiencies TEXT[] DEFAULT '{}',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Создание индексов для персонажей V2
CREATE INDEX IF NOT EXISTS idx_characters_v2_user_id ON characters_v2(user_id);
CREATE INDEX IF NOT EXISTS idx_characters_v2_group_id ON characters_v2(group_id);
CREATE INDEX IF NOT EXISTS idx_characters_v2_name ON characters_v2(name);
CREATE INDEX IF NOT EXISTS idx_characters_v2_created_at ON characters_v2(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_characters_v2_deleted_at ON characters_v2(deleted_at) WHERE deleted_at IS NOT NULL;

-- Создание триггера для автоматического обновления updated_at для персонажей V2
CREATE TRIGGER update_characters_v2_updated_at 
    BEFORE UPDATE ON characters_v2 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
