#!/bin/bash

echo "🛑 Остановка DnD Cards Generator..."

# Останавливаем контейнеры
docker-compose down

echo "✅ Проект остановлен!"
echo ""
echo "📋 Для полной очистки выполните:"
echo "   docker-compose down -v  # удалит также volumes"
echo "   docker system prune     # очистит неиспользуемые образы"

