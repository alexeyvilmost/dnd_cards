@echo off
echo 🚀 Запуск DnD Cards Generator через Docker...

echo 📦 Сборка и запуск контейнеров...
docker compose up --build -d

echo ⏳ Ожидание запуска сервисов...
timeout /t 10 /nobreak > nul

echo ✅ Проект запущен!
echo.
echo 🌐 Доступные сервисы:
echo    Frontend: http://localhost:3000
echo    Backend API: http://localhost:8080
echo    PostgreSQL: localhost:5432
echo.
echo 📋 Полезные команды:
echo    Просмотр логов: docker compose logs -f
echo    Остановка: docker compose down
echo    Перезапуск: docker compose restart
echo.
echo 🎯 Откройте http://localhost:3000 в браузере
pause
