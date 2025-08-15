# DnD Cards Backend

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
```

### 4. Запуск сервера

```bash
go run .
```

Сервер будет доступен по адресу `http://localhost:8080`

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
  "rarity": "common|uncommon|rare|very_rare|artifact",
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
