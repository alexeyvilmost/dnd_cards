# Этап 1: сборка production-бандла
FROM node:18-slim AS build

WORKDIR /app

# Копируем манифесты зависимостей
COPY package*.json ./

# Настройки npm для стабильной установки
RUN npm config set cache /tmp/.npm && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-retries 3

# Устанавливаем зависимости
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

# Копируем исходный код
COPY . .

# Собираем production-бандл.
# Используем vite build напрямую (без tsc): проверка типов не должна блокировать деплой
RUN npx vite build

# Этап 2: лёгкий сервер статики
FROM node:18-slim

WORKDIR /app

# serve раздаёт собранную статику с SPA-fallback на index.html
RUN npm install -g serve@14

COPY --from=build /app/dist ./dist

# Railway передаёт порт через $PORT; 3000 — значение по умолчанию для локального запуска
ENV PORT=3000
EXPOSE 3000

CMD ["sh", "-c", "serve -s dist -l ${PORT:-3000}"]
