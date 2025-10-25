# Makefile для запуска тестов DND Cards системы

.PHONY: help test-backend test-frontend test-full test-all clean

# Показать справку
help:
	@echo "Доступные команды:"
	@echo "  test-backend   - Тестировать только бекенд"
	@echo "  test-frontend  - Тестировать только фронтенд"
	@echo "  test-full      - Полное тестирование (бекенд + фронтенд + интеграция)"
	@echo "  test-all       - Все тесты по очереди"
	@echo "  clean          - Очистить временные файлы"

# Тестирование бекенда
test-backend:
	@echo "=== Тестирование бекенда ==="
	@python test_backend.py

# Тестирование фронтенда
test-frontend:
	@echo "=== Тестирование фронтенда ==="
	@python test_frontend.py

# Полное тестирование
test-full:
	@echo "=== Полное тестирование ==="
	@python test_full_stack.py

# Все тесты по очереди
test-all: test-backend test-frontend test-full
	@echo "=== Все тесты завершены ==="

# Очистка временных файлов
clean:
	@echo "Очистка временных файлов..."
	@find . -name "*.pyc" -delete
	@find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
	@echo "Готово!"

# Тестирование с кастомными URL
test-backend-prod:
	@echo "=== Тестирование production бекенда ==="
	@python test_backend.py --url https://your-backend.com

test-frontend-prod:
	@echo "=== Тестирование production фронтенда ==="
	@python test_frontend.py --url https://your-frontend.com

test-full-prod:
	@echo "=== Полное тестирование production ==="
	@python test_full_stack.py --backend https://your-backend.com --frontend https://your-frontend.com

# Быстрая проверка (только основные endpoints)
test-quick:
	@echo "=== Быстрая проверка ==="
	@python -c "import requests; print('Backend:', 'OK' if requests.get('http://localhost:8080/api/health').status_code == 200 else 'FAIL'); print('Frontend:', 'OK' if requests.get('http://localhost:3000').status_code == 200 else 'FAIL')"


