# Используем официальный образ Node.js
FROM node:18-slim

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package.json и package-lock.json (если есть)
COPY package*.json ./

# Создаем пользователя для npm кэша
RUN npm config set cache /tmp/.npm && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-retries 3

# Устанавливаем зависимости с кэшированием
RUN npm ci --only=production --no-audit --no-fund || npm install --no-audit --no-fund

# Копируем исходный код
COPY . .

# Открываем порт
EXPOSE 3000

# Запускаем приложение в режиме разработки
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

