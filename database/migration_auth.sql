-- Миграция для добавления системы авторизации, групп и инвентаря
-- Подключение к базе данных
\c dnd_cards;

-- Создание таблицы пользователей
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Создание таблицы групп
CREATE TABLE groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    dm_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Создание таблицы участников групп
CREATE TABLE group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('dm', 'player')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(group_id, user_id)
);

-- Создание таблицы инвентарей
CREATE TABLE inventories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(20) NOT NULL CHECK (type IN ('personal', 'group')),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE,
    -- Проверка: для личного инвентаря должен быть user_id, для группового - group_id
    CHECK (
        (type = 'personal' AND user_id IS NOT NULL AND group_id IS NULL) OR
        (type = 'group' AND user_id IS NULL AND group_id IS NOT NULL)
    )
);

-- Создание таблицы предметов в инвентаре (без внешнего ключа на cards, добавим позже)
CREATE TABLE inventory_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inventory_id UUID NOT NULL REFERENCES inventories(id) ON DELETE CASCADE,
    card_id UUID NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(inventory_id, card_id)
);

-- Создание индексов для оптимизации
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX idx_groups_dm_id ON groups(dm_id);
CREATE INDEX idx_groups_deleted_at ON groups(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX idx_group_members_group_id ON group_members(group_id);
CREATE INDEX idx_group_members_user_id ON group_members(user_id);
CREATE INDEX idx_group_members_role ON group_members(role);

CREATE INDEX idx_inventories_user_id ON inventories(user_id);
CREATE INDEX idx_inventories_group_id ON inventories(group_id);
CREATE INDEX idx_inventories_type ON inventories(type);
CREATE INDEX idx_inventories_deleted_at ON inventories(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX idx_inventory_items_inventory_id ON inventory_items(inventory_id);
CREATE INDEX idx_inventory_items_card_id ON inventory_items(card_id);
CREATE INDEX idx_inventory_items_deleted_at ON inventory_items(deleted_at) WHERE deleted_at IS NOT NULL;

-- Создание триггеров для автоматического обновления updated_at
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_groups_updated_at 
    BEFORE UPDATE ON groups 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_group_members_updated_at 
    BEFORE UPDATE ON group_members 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_inventories_updated_at 
    BEFORE UPDATE ON inventories 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_inventory_items_updated_at 
    BEFORE UPDATE ON inventory_items 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Вставка тестового пользователя (только если таблица пустая)
INSERT INTO users (username, email, password_hash, display_name)
SELECT 'testuser', 'test@example.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Тестовый пользователь'
WHERE NOT EXISTS (SELECT 1 FROM users LIMIT 1);

-- Вставка тестовой группы (только если таблица пустая)
INSERT INTO groups (name, description, dm_id)
SELECT 'Тестовая группа', 'Группа для тестирования системы', u.id
FROM users u
WHERE u.username = 'testuser'
AND NOT EXISTS (SELECT 1 FROM groups LIMIT 1);

-- Добавление тестового пользователя в группу как ДМ
INSERT INTO group_members (group_id, user_id, role)
SELECT g.id, u.id, 'dm'
FROM groups g, users u
WHERE g.name = 'Тестовая группа' 
AND u.username = 'testuser'
AND NOT EXISTS (SELECT 1 FROM group_members LIMIT 1);

