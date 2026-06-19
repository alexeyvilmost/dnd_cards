# Этап 0 — Фундамент (инфраструктура)

Статус: завершён.

## Что сделано

### Бэкенд
- Добавлено ядро БД `backend/dbcore.py`: единое подключение к PostgreSQL (через `DATABASE_URL` или `DB_*`) и раннер миграций. Все таблицы — с префиксом `battle_`.
- Реестр миграций (создаются при старте, если задана БД): `battle_saved_characters`, `battle_characters`, `battle_spells`, `battle_monsters`, `battle_runs`, плюс служебная `battle_schema_migrations`.
- Добавлен обобщённый репозиторий `backend/repo.py` (`JsonRepo`) — работает с PostgreSQL (таблица `id + data JSONB + индексируемые колонки`) или с файловым хранилищем (`backend/data/<сущность>/`) при отсутствии БД.
- `backend/db.py` переведён на общее ядро `dbcore` (единая конфигурация).
- `backend/main.py`: запуск миграций при старте, версия сервиса повышена до `1.0.0`.

### Фронтенд
- `battle/frontend` мигрирован с vanilla HTML/JS на **React + TypeScript + Vite**.
- Каркас: роутинг (`react-router-dom`), общий API-клиент с типами (`src/api/client.ts`, axios).
- Перенесены экраны: **Бой** (`CombatPage` + переиспользуемый `CombatView`), **Персонажи** (`CharactersPage`), **Заклинания/справочник** (`SpellbookPage`).
- Иконки заклинаний и `spell_data.js` перенесены в `frontend/public/`.
- `Dockerfile` фронтенда переведён на сборку Vite (`npm run build` → nginx), `nginx.conf.template` — на отдачу SPA с проксированием API.

### Инфраструктура и приёмка
- `battle/docker-compose.battle.yml`: локальный полный стек (Postgres + backend + frontend).
- Скрипт приёмки `battle/scripts/test_battle_stack.py`: health, каталог заклинаний, quickstart, прогон боя до победителя, проверка фронтенда.
- README обновлён под новую структуру.

## Как проверить

### Вариант A — без БД (быстро, файловое хранилище)
```bash
# 1. Бэкенд
cd battle/backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn main:app --port 8765

# 2. Фронтенд (в другом терминале)
cd battle/frontend
npm install
npm run dev      # http://localhost:3001

# 3. Приёмочный тест (в третьем терминале)
cd battle
python3 scripts/test_battle_stack.py --frontend http://localhost:3001
```

### Вариант B — полный стек в Docker с локальным Postgres
```bash
cd battle
docker compose -f docker-compose.battle.yml up --build
# Frontend: http://localhost:8080 ; Backend: http://localhost:8765
python3 scripts/test_battle_stack.py     # отдельным терминалом
```

### Что должно получиться
- `GET /api/health` → `{"status":"ok", "storage":"files"|"postgres"}`.
- Открывается SPA, навигация: Бой / Подземелье / Персонажи / Бестиарий / Заклинания.
- На экране «Бой» кнопка «Быстрый старт» создаёт арену с двумя воинами; бой проходится по ходам (движение, атака, завершение хода) до победителя.
- Скрипт приёмки печатает все `PASS` и завершается кодом 0.

> Примечание: экраны «Подземелье», «Бестиарий», редакторы и лист персонажа на этом этапе — заглушки; они наполняются в последующих этапах.
