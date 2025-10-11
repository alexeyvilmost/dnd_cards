# Инструкция по деплою на Railway

## Подготовка проекта

### 1. Создайте health check endpoint для backend

Добавьте в `backend/main.go`:

```go
// Health check endpoint
r.GET("/api/health", func(c *gin.Context) {
    c.JSON(200, gin.H{"status": "ok"})
})
```

### 2. Создайте .env.example файл

```bash
# Database
DATABASE_URL=postgresql://user:password@host:port/database

# JWT
JWT_SECRET=your-secret-key

# OpenAI
OPENAI_API_KEY=your-openai-key

# Yandex Storage
YANDEX_ACCESS_KEY_ID=your-access-key
YANDEX_SECRET_ACCESS_KEY=your-secret-key
YANDEX_BUCKET_NAME=your-bucket-name
YANDEX_REGION=ru-central1
```

## Деплой на Railway

### Вариант 1: Деплой фронтенда и бекенда отдельно

#### 1. Подготовьте репозиторий
```bash
git add .
git commit -m "Prepare for deployment"
git push origin main
```

#### 2. Деплой бекенда
1. Зайдите на [railway.app](https://railway.app)
2. Нажмите "New Project" → "Deploy from GitHub repo"
3. Выберите ваш репозиторий
4. В настройках проекта:
   - **Root Directory:** `backend`
   - **Build Command:** `go build -o main .`
   - **Start Command:** `./main`
5. Добавьте переменные окружения в настройках проекта
6. Railway автоматически определит, что это Go проект

#### 3. Деплой фронтенда
1. Создайте новый проект в Railway
2. Выберите тот же репозиторий
3. В настройках:
   - **Root Directory:** `frontend`
   - **Build Command:** `npm run build`
   - **Start Command:** `npm run preview` (для Vite)
4. Добавьте переменную окружения:
   - `VITE_API_URL=https://your-backend-url.railway.app`

### Вариант 2: Деплой через Docker Compose (рекомендуется)

#### 1. Создайте railway.toml
```toml
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile"

[deploy]
startCommand = "docker-compose up"
```

#### 2. Обновите docker-compose.yml для продакшена
```yaml
version: '3.8'
services:
  backend:
    build: ./backend
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - JWT_SECRET=${JWT_SECRET}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - YANDEX_ACCESS_KEY_ID=${YANDEX_ACCESS_KEY_ID}
      - YANDEX_SECRET_ACCESS_KEY=${YANDEX_SECRET_ACCESS_KEY}
      - YANDEX_BUCKET_NAME=${YANDEX_BUCKET_NAME}
      - YANDEX_REGION=${YANDEX_REGION}
    ports:
      - "8080:8080"

  frontend:
    build: ./frontend
    environment:
      - VITE_API_URL=${VITE_API_URL}
    ports:
      - "3000:3000"
    depends_on:
      - backend
```

## Переменные окружения для Railway

### Backend:
- `DATABASE_URL` - URL вашей Supabase БД
- `JWT_SECRET` - секретный ключ для JWT
- `OPENAI_API_KEY` - ключ OpenAI
- `YANDEX_ACCESS_KEY_ID` - ключ Yandex Storage
- `YANDEX_SECRET_ACCESS_KEY` - секрет Yandex Storage
- `YANDEX_BUCKET_NAME` - имя bucket'а
- `YANDEX_REGION` - регион (ru-central1)

### Frontend:
- `VITE_API_URL` - URL вашего бекенда (https://your-backend.railway.app)

## Настройка домена

1. В Railway перейдите в настройки проекта
2. В разделе "Domains" добавьте ваш домен
3. Настройте DNS записи согласно инструкциям Railway

## Мониторинг

Railway предоставляет:
- Логи в реальном времени
- Метрики производительности
- Автоматические перезапуски при ошибках

## Альтернативные варианты

### Render.com
1. Подключите GitHub репозиторий
2. Выберите "Web Service"
3. Настройте build и start команды
4. Добавьте переменные окружения

### DigitalOcean App Platform
1. Создайте новый App
2. Подключите GitHub репозиторий
3. Настройте сервисы для frontend и backend
4. Добавьте переменные окружения

## Troubleshooting

### Проблемы с CORS
Убедитесь, что в backend настроен CORS для вашего домена:
```go
config := cors.DefaultConfig()
config.AllowOrigins = []string{"https://your-frontend-domain.com"}
```

### Проблемы с БД
Убедитесь, что DATABASE_URL корректный и БД доступна из интернета.

### Проблемы с файлами
Проверьте, что все статические файлы правильно копируются в Docker контейнер.
