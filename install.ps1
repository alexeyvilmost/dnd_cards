# Скрипт установки зависимостей для DnD Cards Generator

Write-Host "Установка зависимостей для DnD Cards Generator..." -ForegroundColor Green

# Установка зависимостей для frontend
Write-Host "Устанавливаем зависимости для frontend..." -ForegroundColor Yellow
Set-Location frontend
npm install
Set-Location ..

# Установка зависимостей для backend
Write-Host "Устанавливаем зависимости для backend..." -ForegroundColor Yellow
Set-Location backend
go mod tidy
Set-Location ..

Write-Host "Установка завершена!" -ForegroundColor Green

