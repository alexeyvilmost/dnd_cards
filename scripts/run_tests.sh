#!/bin/bash
# Скрипт для запуска тестов на Linux/macOS

echo "========================================"
echo "   ТЕСТИРОВАНИЕ DND CARDS СИСТЕМЫ"
echo "========================================"

echo ""
echo "Выберите тип тестирования:"
echo "1. Только бекенд"
echo "2. Только фронтенд"  
echo "3. Полное тестирование (бекенд + фронтенд + интеграция)"
echo "4. Все тесты по очереди"
echo ""

read -p "Введите номер (1-4): " choice

case $choice in
    1)
        echo ""
        echo "Запуск тестирования бекенда..."
        python3 test_backend.py
        ;;
    2)
        echo ""
        echo "Запуск тестирования фронтенда..."
        python3 test_frontend.py
        ;;
    3)
        echo ""
        echo "Запуск полного тестирования..."
        python3 test_full_stack.py
        ;;
    4)
        echo ""
        echo "Запуск всех тестов по очереди..."
        echo ""
        echo "=== ТЕСТИРОВАНИЕ БЕКЕНДА ==="
        python3 test_backend.py
        echo ""
        echo "=== ТЕСТИРОВАНИЕ ФРОНТЕНДА ==="
        python3 test_frontend.py
        echo ""
        echo "=== ПОЛНОЕ ТЕСТИРОВАНИЕ ==="
        python3 test_full_stack.py
        ;;
    *)
        echo "Неверный выбор!"
        exit 1
        ;;
esac

echo ""
echo "Тестирование завершено!"


