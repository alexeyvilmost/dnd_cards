# Bag of Holding Backend

Backend API для сервиса создания карточек D&D на Golang.

## Требования

- Go 1.21+
- PostgreSQL 12+
- OpenAI API ключ (опционально)

## Установка и запуск

### 1. Установка зависимостей

```bash
go mod tidy
```

### 2. Настройка базы данных

1. Создайте базу данных PostgreSQL
2. Выполните SQL скрипт из `../database/schema.sql`
3. Скопируйте `env.example` в `.env` и настройте параметры

### 3. Настройка переменных окружения

```bash
cp env.example .env
```

Отредактируйте `.env` файл:
```env
DATABASE_URL=host=localhost user=postgres password=postgres dbname=dnd_cards port=5432 sslmode=disable
PORT=8080
OPENAI_API_KEY=your_openai_api_key_here
JWT_SECRET=replace_with_at_least_32_random_characters
ENCOUNTER_INVITE_SECRET=replace_with_an_independent_random_secret
CONTENT_ADMIN_USER_IDS=00000000-0000-4000-8000-000000000001
CONTENT_CERTIFICATION_KEY=replace_with_an_independent_random_secret
```

`ENCOUNTER_INVITE_SECRET` опционален, но для production рекомендуется отдельный
случайный ключ длиной не менее 32 байт. Если переменная отсутствует, 15-минутные
подписанные приглашения в бой используют доменно-разделённый HMAC на
`JWT_SECRET`; явно заданный короткий/пустой ключ закрывает invite endpoints.

`CONTENT_ADMIN_USER_IDS` — список UUID через запятую. Только эти пользователи
с валидным строгим JWT могут изменять глобальные каталоги и связанные
изображения; публичное чтение и игровые character/encounter routes от этого
allowlist не зависят. При этом `/api/characters-v3/**` и `/api/encounters/**`
всегда требуют валидный JWT. Авторизованный пользователь читает свои и legacy
`public`-листы, но legacy-листы доступны только для чтения; новые листы всегда
принадлежат создавшему их пользователю. Ответ явно сообщает `access_mode`, а
начальный runtime входит в атомарный POST создания. Пустая или невалидная
настройка закрывает глобальную запись с HTTP 503. Certification/migration
endpoints дополнительно требуют `CONTENT_CERTIFICATION_KEY`. Используйте
отдельного content-admin пользователя:
не сохраняйте в allowlist UUID учётной записи с известным, тестовым или когда-либо
попадавшим в репозиторий паролем. Скрипты импорта не имеют встроенных credentials,
не регистрируют пользователя автоматически и требуют `API_TOKEN` либо явно
заданные `CONTENT_ADMIN_USERNAME`/`CONTENT_ADMIN_PASSWORD`.

### 4. Запуск сервера

```bash
go run .
```

Сервер будет доступен по адресу `http://localhost:8080`

`GET /api/health` возвращает `status`, Unix-время и `source_commit`. Для
Timecloud deployment commit передаётся runner-ом через `SOURCE_COMMIT`;
отсутствующее или невалидное значение возвращается как `unavailable`.
Production release evidence требует точного совпадения этого SHA с проверенным
release commit.

## API Endpoints

### Карточки

- `GET /api/cards` - Получение списка карточек с фильтрацией
- `GET /api/cards/:id` - Получение карточки по ID
- `POST /api/cards` - Создание новой карточки
- `PUT /api/cards/:id` - Обновление карточки
- `DELETE /api/cards/:id` - Удаление карточки

### Дополнительные функции

- `POST /api/cards/generate-image` - Генерация изображения для карточки
- `POST /api/cards/export` - Экспорт карточек для печати

## Параметры запросов

### Фильтрация карточек

- `?rarity=common` - фильтр по редкости
- `?properties=consumable` - фильтр по свойствам
- `?search=зелье` - поиск по названию
- `?page=1&limit=20` - пагинация

## Структура данных

### Карточка (Card)

```json
{
  "id": "uuid",
  "name": "Название зелья",
  "properties": "consumable|single_use",
  "description": "Описание эффекта",
  "image_url": "URL изображения",
  "rarity": "common|uncommon|rare|very_rare|artifact|relic|custom",
  "card_number": "CARD-0001",
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

### Редкость (Rarity)

- `common` - Обычное (белый)
- `uncommon` - Необычное (зеленый)
- `rare` - Редкое (синий)
- `very_rare` - Очень редкое (фиолетовый)
- `artifact` - Артефакт (оранжевый)

### Свойства (Properties)

- `consumable` - Расходуемое
- `single_use` - Одноразовое
