# DnD Cards Generator

Сервис для создания и управления карточками предметов для D&D.

## 🎯 Функциональность MVP

- ✅ Конструктор карточек зелий с настраиваемыми атрибутами
- ✅ Библиотека карт с поиском и фильтрацией
- ✅ Экспорт карт на А4 лист для печати (16 карт на лист)
- ✅ Генерация изображений через ИИ (заглушка)
- ✅ Уникальные номера/QR-коды для каждой карты
- ✅ Предварительный просмотр карточек

## 🛠 Технологии

### Backend
- **Golang** + **Gin** - API сервер
- **PostgreSQL** + **GORM** - база данных
- **OpenAI API** - генерация изображений (планируется)

### Frontend
- **React** + **TypeScript** - UI приложение
- **Tailwind CSS** - стилизация
- **React Hook Form** - управление формами
- **jsPDF** - экспорт в PDF

## 🚀 Быстрый запуск через Docker (Рекомендуется)

### Требования:
- Docker
- Docker Compose

### Запуск:
```bash
# Клонируйте репозиторий
git clone <repository-url>
cd dnd_cards

# Запустите проект
./start.sh

# Или вручную:
docker compose up --build -d
```

### Доступ к приложению:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8080

### Остановка:
```bash
./stop.sh

# Или вручную:
docker compose down
```

## 📁 Структура проекта

```
dnd_cards/
├── backend/          # Golang API
│   ├── main.go       # Основной файл
│   ├── models.go     # Модели данных
│   ├── controller.go # API контроллеры
│   ├── Dockerfile    # Docker конфигурация
│   └── README.md     # Документация backend
├── frontend/         # React приложение
│   ├── src/          # Исходный код
│   ├── package.json  # Зависимости
│   ├── Dockerfile    # Docker конфигурация
│   └── README.md     # Документация frontend
├── database/         # Схемы БД
│   └── schema.sql    # SQL схема
├── docker-compose.yml # Docker Compose конфигурация
├── start.sh          # Скрипт запуска
├── stop.sh           # Скрипт остановки
└── docs/            # Документация
```

## 🔧 Ручная установка (Альтернатива)

### 1. Подготовка окружения

#### Требования:
- Go 1.21+
- Node.js 18+
- PostgreSQL 12+

#### Установка зависимостей:

**Backend:**
```bash
cd backend
go mod tidy
```

**Frontend:**
```bash
cd frontend
npm install
```

### 2. Настройка базы данных

1. Создайте базу данных PostgreSQL:
```sql
CREATE DATABASE dnd_cards;
```

2. Выполните SQL скрипт:
```bash
psql -d dnd_cards -f database/schema.sql
```

### 3. Настройка переменных окружения

**Backend** (`backend/.env`):
```env
DATABASE_URL=host=localhost user=postgres password=postgres dbname=dnd_cards port=5432 sslmode=disable
PORT=8080
OPENAI_API_KEY=your_openai_api_key_here
```

**Frontend** (`frontend/.env`):
```env
VITE_API_URL=http://localhost:8080/api
```

### 4. Запуск приложения

**Backend:**
```bash
cd backend
go run .
```

**Frontend:**
```bash
cd frontend
npm run dev
```

### 5. Доступ к приложению

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8080

## 📋 Размеры карточек

- **Размер**: 52.5мм x 74.25мм
- **Расположение**: 4x4 на А4 листе
- **Стиль**: Фэнтези-минималистичный
- **Цвета рамок**: по редкости
  - Обычное: белый
  - Необычное: зеленый
  - Редкое: синий
  - Очень редкое: фиолетовый
  - Артефакт: оранжевый

## 🎨 Атрибуты карточек

### Обязательные поля:
- **Название** - название зелья
- **Редкость** - один из 5 уровней
- **Свойства** - Расходуемое/Одноразовое
- **Описание** - полный текст эффекта

### Автоматически генерируемые:
- **Уникальный номер** - формат CARD-XXXX
- **QR-код** - для быстрого поиска в библиотеке
- **Изображение** - через ИИ (планируется)

## 🔧 API Endpoints

### Карточки
- `GET /api/cards` - список карточек с фильтрацией
- `GET /api/cards/:id` - карточка по ID
- `POST /api/cards` - создание карточки
- `PUT /api/cards/:id` - обновление карточки
- `DELETE /api/cards/:id` - удаление карточки

### Дополнительные функции
- `POST /api/cards/generate-image` - генерация изображения
- `POST /api/cards/export` - экспорт для печати

## 📝 TODO для полной версии

- [ ] Интеграция с OpenAI API для генерации изображений
- [ ] Реализация экспорта в PDF с разметкой для резки
- [ ] Система пользователей и авторизации
- [ ] Загрузка собственных изображений
- [ ] Редактирование карточек
- [ ] Категории и коллекции карт
- [ ] Статистика по коллекции
- [ ] Импорт карт из файлов

## 🤝 Разработка

### Добавление новых типов карт

1. Обновите модели в `backend/models.go`
2. Добавьте новые поля в базу данных
3. Обновите frontend формы и отображение
4. Добавьте валидацию

### Стилизация карточек

- Используйте CSS классы в `frontend/src/index.css`
- Следуйте фэнтези-минималистичному стилю
- Поддерживайте адаптивность

## 📄 Лицензия

MIT License
