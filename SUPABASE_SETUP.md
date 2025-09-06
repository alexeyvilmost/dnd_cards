# Настройка Supabase PostgreSQL

## 1. Создание проекта в Supabase

1. Перейдите на [supabase.com](https://supabase.com/)
2. Войдите в свой аккаунт или создайте новый
3. Нажмите **"New Project"**
4. Заполните данные проекта:
   - **Name**: `dnd-cards`
   - **Database Password**: сгенерируйте надежный пароль
   - **Region**: выберите ближайший регион
5. Нажмите **"Create new project"**

## 2. Получение данных для подключения

После создания проекта:

1. Перейдите в **Settings** → **Database**
2. В разделе **Connection Info** найдите:
   - **Host**: `db.your-project-ref.supabase.co`
   - **Database name**: `postgres`
   - **Port**: `5432`
   - **User**: `postgres`
   - **Password**: ваш пароль из шага 1

## 3. Настройка переменных окружения

Создайте файл `.env` на основе `env.example`:

```bash
# Настройки базы данных для Supabase
DB_HOST=db.your-project-ref.supabase.co
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_supabase_password
DB_NAME=postgres
DB_SSLMODE=require

# Остальные настройки
JWT_SECRET=your_jwt_secret_key_here
OPENAI_API_KEY=your_openai_api_key_here
YANDEX_CLOUD_ACCESS_KEY_ID=your_access_key
YANDEX_CLOUD_SECRET_ACCESS_KEY=your_secret_key
YANDEX_CLOUD_BUCKET_NAME=dnd-cards-images
YANDEX_CLOUD_REGION=ru-central1
YANDEX_CLOUD_ENDPOINT=https://storage.yandexcloud.net
```

## 4. Создание схемы базы данных

### Вариант 1: Через Supabase Dashboard

1. Перейдите в **SQL Editor**
2. Создайте новый запрос
3. Скопируйте и выполните содержимое файлов:
   - `database/schema.sql`
   - `database/migration_auth.sql`
   - `database/add_foreign_keys.sql`
   - `database/migration_characters.sql`
   - `database/migration_images.sql`

### Вариант 2: Через psql

```bash
# Подключитесь к Supabase
psql -h db.your-project-ref.supabase.co -p 5432 -U postgres -d postgres

# Выполните миграции
\i database/schema.sql
\i database/migration_auth.sql
\i database/add_foreign_keys.sql
\i database/migration_characters.sql
\i database/migration_images.sql
```

## 5. Миграция данных с локальной БД

### Экспорт данных с локальной БД:

```bash
# Остановите приложение
docker-compose down

# Запустите локальную БД для экспорта
docker-compose up -d postgres

# Экспортируйте данные
docker-compose exec postgres pg_dump -U postgres -d dnd_cards > dnd_cards_backup.sql
```

### Импорт данных в Supabase:

```bash
# Импортируйте данные
psql -h db.your-project-ref.supabase.co -p 5432 -U postgres -d postgres -f dnd_cards_backup.sql
```

## 6. Настройка Row Level Security (RLS)

В Supabase Dashboard → **Authentication** → **Policies**:

1. Включите RLS для таблиц:
   - `users`
   - `cards`
   - `weapon_templates`
   - `groups`
   - `characters`
   - `inventories`
   - `inventory_items`

2. Создайте политики доступа (пример для таблицы `cards`):

```sql
-- Политика для чтения карточек
CREATE POLICY "Users can view all cards" ON cards
    FOR SELECT USING (true);

-- Политика для создания карточек
CREATE POLICY "Users can create cards" ON cards
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Политика для обновления карточек
CREATE POLICY "Users can update their own cards" ON cards
    FOR UPDATE USING (auth.uid() = user_id);

-- Политика для удаления карточек
CREATE POLICY "Users can delete their own cards" ON cards
    FOR DELETE USING (auth.uid() = user_id);
```

## 7. Тестирование подключения

```bash
# Запустите приложение
docker-compose up -d

# Проверьте логи
docker-compose logs backend

# Проверьте API
curl http://localhost:8080/api/cards
```

## 8. Настройка аутентификации (опционально)

Если хотите использовать Supabase Auth:

1. В **Authentication** → **Settings** настройте:
   - **Site URL**: `http://localhost:3000`
   - **Redirect URLs**: `http://localhost:3000/auth/callback`

2. Обновите frontend для использования Supabase Auth

## 9. Мониторинг и логи

В Supabase Dashboard вы можете:
- Мониторить производительность в **Database** → **Logs**
- Просматривать логи API в **Logs**
- Настраивать алерты в **Settings** → **Alerts**

## 10. Безопасность

- Используйте надежные пароли
- Настройте RLS политики
- Регулярно обновляйте пароли
- Используйте SSL соединения
- Настройте мониторинг

## 11. Резервное копирование

Supabase автоматически создает резервные копии:
- Ежедневные снимки
- Point-in-time recovery
- Настраиваемые расписания

## 12. Масштабирование

При необходимости можно:
- Увеличить размер базы данных
- Настроить read replicas
- Использовать connection pooling
- Оптимизировать запросы
