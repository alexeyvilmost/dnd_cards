# Используем официальный образ Go (go.mod требует go >= 1.25 после апгрейда зависимостей)
FROM golang:1.25-alpine

ENV APP_ENV=production

RUN apk add --no-cache nodejs

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем файлы зависимостей (go.sum тоже — детерминированная загрузка)
COPY go.mod go.sum ./

# Инициализируем модуль и загружаем зависимости
RUN go mod download

# Копируем исходный код
COPY . .


# Собираем приложение
RUN go build -o main .

RUN chmod +x ./start.sh

# Открываем порт
EXPOSE 8080

# Запускаем приложение
CMD ["./start.sh"]
