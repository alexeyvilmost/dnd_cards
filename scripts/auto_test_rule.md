# Правило автоматического тестирования

## Описание правила
После внесения изменений в проект (бекенд или фронтенд) необходимо запускать автоматические тесты для проверки работоспособности основных функций.

## Когда применять правило
- После изменений в бекенде (Go код, миграции, конфигурация)
- После изменений во фронтенде (React компоненты, API интеграция, стили)
- После изменений в Docker конфигурации
- Перед коммитом важных изменений
- После деплоя на staging/production

## Команды для тестирования

### Быстрая проверка (рекомендуется)
```bash
cd scripts
python test_full_stack.py
```

### Детальная проверка по компонентам
```bash
cd scripts

# Только бекенд
python test_backend.py

# Только фронтенд  
python test_frontend.py

# Полное тестирование
python test_full_stack.py
```

### Интерактивный выбор (Windows)
```bash
cd scripts
run_tests.bat
```

### Интерактивный выбор (Linux/macOS)
```bash
cd scripts
./run_tests.sh
```

## Ожидаемые результаты

### Успешное тестирование
- ✅ **Бекенд**: Health endpoints (4/4), основные API работают
- ✅ **Фронтенд**: Основные страницы загружаются (8-9/9), производительность в норме
- ✅ **Интеграция**: Фронтенд может обращаться к бекенду

### Критические ошибки (требуют исправления)
- ❌ Health endpoints не отвечают
- ❌ Основные страницы фронтенда не загружаются
- ❌ Время загрузки > 10 секунд
- ❌ Критические API endpoints возвращают 500 ошибки

### Некритические предупреждения (можно игнорировать)
- ⚠ Favicon.ico возвращает 404 (нормально для dev)
- ⚠ Некоторые API требуют авторизации (ожидаемое поведение)
- ⚠ Mobile-first проверки могут не проходить в dev режиме

## Интеграция в workflow

### Перед коммитом
```bash
# Запустить полное тестирование
cd scripts && python test_full_stack.py

# Если тесты провалились - исправить ошибки
# Если тесты прошли - можно коммитить
```

### После деплоя
```bash
# Проверить production endpoints
cd scripts
python test_backend.py --url https://your-backend.com
python test_frontend.py --url https://your-frontend.com
```

### В CI/CD pipeline
```bash
# Добавить в .github/workflows/ или аналогичный CI
- name: Run tests
  run: |
    cd scripts
    python test_full_stack.py
    if [ $? -ne 0 ]; then
      echo "Tests failed, deployment cancelled"
      exit 1
    fi
```

## Настройка для разных окружений

### Development (localhost)
```bash
python test_full_stack.py
```

### Staging
```bash
python test_full_stack.py --backend https://staging-backend.com --frontend https://staging-frontend.com
```

### Production
```bash
python test_full_stack.py --backend https://api.yoursite.com --frontend https://yoursite.com
```

## Расширение тестов

Для добавления новых тестов:
1. Откройте соответствующий файл (`test_backend.py` или `test_frontend.py`)
2. Добавьте новый метод в класс тестера
3. Вызовите метод в `run_all_tests()`
4. Обновите документацию

## Устранение неполадок

### Тесты не запускаются
- Проверьте, что Python установлен: `python --version`
- Установите зависимости: `pip install requests`
- Проверьте, что сервисы запущены: `docker-compose ps`

### Ложные срабатывания
- Проверьте URL endpoints в скриптах
- Убедитесь, что сервисы полностью запустились
- Проверьте логи контейнеров: `docker-compose logs`

### Медленные тесты
- Увеличьте timeout в скриптах (по умолчанию 5-10 сек)
- Проверьте производительность сервисов
- Рассмотрите возможность параллельного запуска тестов

---

**Важно**: Это правило должно применяться последовательно для обеспечения качества кода и стабильности системы.


