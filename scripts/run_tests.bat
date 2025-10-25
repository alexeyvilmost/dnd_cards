@echo off
REM Батник для запуска тестов на Windows
echo ========================================
echo    ТЕСТИРОВАНИЕ DND CARDS СИСТЕМЫ
echo ========================================

echo.
echo Выберите тип тестирования:
echo 1. Только бекенд
echo 2. Только фронтенд  
echo 3. Полное тестирование (бекенд + фронтенд + интеграция)
echo 4. Все тесты по очереди
echo.

set /p choice="Введите номер (1-4): "

if "%choice%"=="1" (
    echo.
    echo Запуск тестирования бекенда...
    python test_backend.py
) else if "%choice%"=="2" (
    echo.
    echo Запуск тестирования фронтенда...
    python test_frontend.py
) else if "%choice%"=="3" (
    echo.
    echo Запуск полного тестирования...
    python test_full_stack.py
) else if "%choice%"=="4" (
    echo.
    echo Запуск всех тестов по очереди...
    echo.
    echo === ТЕСТИРОВАНИЕ БЕКЕНДА ===
    python test_backend.py
    echo.
    echo === ТЕСТИРОВАНИЕ ФРОНТЕНДА ===
    python test_frontend.py
    echo.
    echo === ПОЛНОЕ ТЕСТИРОВАНИЕ ===
    python test_full_stack.py
) else (
    echo Неверный выбор!
    exit /b 1
)

echo.
echo Тестирование завершено!
pause


