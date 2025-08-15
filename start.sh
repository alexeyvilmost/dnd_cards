#!/bin/bash

echo "🚀 Запуск DnD Cards Generator через Docker..."

# Проверяем, установлен ли Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker не установлен. Установите Docker и попробуйте снова."
    exit 1
fi

# Проверяем, установлен ли Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose не установлен. Установите Docker Compose и попробуйте снова."
    exit 1
fi

echo "📦 Сборка и запуск контейнеров..."
docker-compose up --build -d

echo "⏳ Ожидание запуска сервисов..."
sleep 10

echo "✅ Проект запущен!"
echo ""
echo "🌐 Доступные сервисы:"
echo "   Frontend: http://localhost:3000"
echo "   Backend API: http://localhost:8080"
echo "   PostgreSQL: localhost:5432"
echo ""
echo "📋 Полезные команды:"
echo "   Просмотр логов: docker-compose logs -f"
echo "   Остановка: docker-compose down"
echo "   Перезапуск: docker-compose restart"
echo ""
echo "🎯 Откройте http://localhost:3000 в браузере"

