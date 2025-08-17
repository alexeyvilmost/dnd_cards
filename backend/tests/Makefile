.PHONY: install test test-verbose test-html test-parallel clean

# Установка зависимостей
install:
	pip install -r requirements.txt

# Запуск тестов
test:
	pytest -v

# Запуск тестов с подробным выводом
test-verbose:
	pytest -v -s

# Запуск тестов с генерацией HTML отчета
test-html:
	pytest --html=test_report.html --self-contained-html

# Запуск тестов параллельно
test-parallel:
	pytest -n auto

# Запуск конкретного теста
test-specific:
	pytest -v -k "$(TEST_NAME)"

# Очистка
clean:
	rm -f test_report.html
	rm -rf __pycache__
	rm -rf .pytest_cache

# Запуск всех тестов с отчетом
test-all: test-html test-parallel
