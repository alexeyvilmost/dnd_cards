#!/bin/bash

# Скрипт для миграции данных с локальной PostgreSQL на Supabase

set -e

echo "🚀 Начинаем миграцию данных на Supabase..."

# Проверяем наличие переменных окружения
if [ -z "$DB_HOST" ] || [ -z "$DB_USER" ] || [ -z "$DB_PASSWORD" ]; then
    echo "❌ Ошибка: Не установлены переменные окружения для Supabase"
    echo "Убедитесь, что в файле .env установлены:"
    echo "  DB_HOST=db.your-project-ref.supabase.co"
    echo "  DB_USER=postgres"
    echo "  DB_PASSWORD=your_supabase_password"
    echo "  DB_NAME=postgres"
    echo "  DB_SSLMODE=require"
    exit 1
fi

# Создаем резервную копию локальной БД
echo "📦 Создаем резервную копию локальной БД..."
docker-compose up -d postgres
sleep 5
docker-compose exec postgres pg_dump -U postgres -d dnd_cards > dnd_cards_backup.sql

if [ ! -f "dnd_cards_backup.sql" ]; then
    echo "❌ Ошибка: Не удалось создать резервную копию"
    exit 1
fi

echo "✅ Резервная копия создана: dnd_cards_backup.sql"

# Проверяем подключение к Supabase
echo "🔍 Проверяем подключение к Supabase..."
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT version();" > /dev/null

if [ $? -eq 0 ]; then
    echo "✅ Подключение к Supabase успешно"
else
    echo "❌ Ошибка: Не удалось подключиться к Supabase"
    echo "Проверьте настройки подключения в .env файле"
    exit 1
fi

# Создаем схему в Supabase
echo "🏗️  Создаем схему в Supabase..."
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f database/schema.sql
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f database/migration_auth.sql
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f database/add_foreign_keys.sql
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f database/migration_characters.sql
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f database/migration_images.sql

echo "✅ Схема создана в Supabase"

# Импортируем данные
echo "📥 Импортируем данные в Supabase..."
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f dnd_cards_backup.sql

if [ $? -eq 0 ]; then
    echo "✅ Данные успешно импортированы в Supabase"
else
    echo "❌ Ошибка: Не удалось импортировать данные"
    exit 1
fi

# Проверяем количество записей
echo "🔍 Проверяем количество записей в таблицах..."
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
SELECT 
    'users' as table_name, COUNT(*) as count FROM users
UNION ALL
SELECT 
    'cards' as table_name, COUNT(*) as count FROM cards
UNION ALL
SELECT 
    'weapon_templates' as table_name, COUNT(*) as count FROM weapon_templates
UNION ALL
SELECT 
    'groups' as table_name, COUNT(*) as count FROM groups
UNION ALL
SELECT 
    'characters' as table_name, COUNT(*) as count FROM characters;
"

echo "🎉 Миграция завершена успешно!"
echo ""
echo "📋 Следующие шаги:"
echo "1. Обновите .env файл с настройками Supabase"
echo "2. Остановите локальную PostgreSQL: docker-compose stop postgres"
echo "3. Запустите приложение: docker-compose up -d"
echo "4. Проверьте работу приложения: curl http://localhost:8080/api/cards"
echo ""
echo "💾 Резервная копия сохранена в файле: dnd_cards_backup.sql"
echo ""
echo "🔒 Не забудьте настроить Row Level Security (RLS) в Supabase Dashboard!"
