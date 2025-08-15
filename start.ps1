Write-Host "🚀 Запуск DnD Cards Generator через Docker..." -ForegroundColor Green

# Проверяем, установлен ли Docker
try {
    $dockerVersion = docker --version
    Write-Host "✅ Docker найден: $dockerVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker не установлен. Установите Docker и попробуйте снова." -ForegroundColor Red
    exit 1
}

# Проверяем, установлен ли Docker Compose
try {
    $composeVersion = docker compose version
    Write-Host "✅ Docker Compose найден" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker Compose не установлен. Установите Docker Compose и попробуйте снова." -ForegroundColor Red
    exit 1
}

Write-Host "📦 Сборка и запуск контейнеров..." -ForegroundColor Yellow
docker compose up --build -d

Write-Host "⏳ Ожидание запуска сервисов..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

Write-Host "✅ Проект запущен!" -ForegroundColor Green
Write-Host ""
Write-Host "🌐 Доступные сервисы:" -ForegroundColor Cyan
Write-Host "   Frontend: http://localhost:3000" -ForegroundColor White
Write-Host "   Backend API: http://localhost:8080" -ForegroundColor White
Write-Host "   PostgreSQL: localhost:5432" -ForegroundColor White
Write-Host ""
Write-Host "📋 Полезные команды:" -ForegroundColor Cyan
Write-Host "   Просмотр логов: docker compose logs -f" -ForegroundColor White
Write-Host "   Остановка: docker compose down" -ForegroundColor White
Write-Host "   Перезапуск: docker compose restart" -ForegroundColor White
Write-Host ""
Write-Host "🎯 Откройте http://localhost:3000 в браузере" -ForegroundColor Green
