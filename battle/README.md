# battle — D&D 2024 пошаговый боевой движок

Подмодуль монорепозитория `dnd_cards`. Пока **проектно, без интеграций** с основным
сервисом (общая БД / авторизация / контракты появятся позже).

## Состав

Папка разделена на два деплой-юнита — `backend/` (Python API) и `frontend/`
(статика + nginx), у каждого свой `Dockerfile`.

| Файл / папка        | Назначение |
|---------------------|-----------|
| `backend/main.py`           | FastAPI: REST API боя (+ отдача UI в all-in-one режиме, если рядом есть `static/`) |
| `backend/engine.py`         | Боевой движок (атаки, заклинания, ходы) |
| `backend/models.py`, `spells.py`, `dice.py`, `store.py`, `char_storage.py`, `db.py` | Доменные модели, каталог заклинаний, утилиты, хранилища |
| `backend/saved_characters/` | Сохранённые персонажи (файловое хранилище-заглушка под будущую БД) |
| `backend/Dockerfile`        | Образ API (python + uvicorn) |
| `frontend/static/`          | UI: `index.html` (бой), `characters.html` (каталог), `spellbook.html` (справочник), `spell_data.js`, `icons/` |
| `frontend/nginx.conf.template` | nginx: отдаёт статику и проксирует API на бэкенд |
| `frontend/Dockerfile`       | Образ UI (nginx) |

## Локальный запуск

API (из папки `backend/`):

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn main:app --reload --port 8765
```

UI обслуживается отдельным nginx-образом (`frontend/`). Для быстрой локальной
разработки можно положить `static/` рядом с `backend/main.py` — тогда бэкенд сам
отдаст и UI (роуты `/`, `/characters`, `/spellbook` включаются автоматически).

## Деплой в Railway

Два сервиса из одной папки `battle/`. Для каждого в Railway задаётся
**Root Directory = `battle`** и свой конфиг-файл (Settings → Config-as-code):

### `battle_backend`
- Config file: `railway-battle-backend.json` → собирает `battle/backend/Dockerfile` (Python + uvicorn).
- Healthcheck: `/api/health` (возвращает и активный бэкенд хранилища: `postgres` / `files`).
- Слушает `$PORT` (Railway задаёт автоматически).
- Отдаёт только API (UI обслуживает `battle_frontend`).
- **База данных:** сохранённые персонажи пишутся в PostgreSQL, если задан
  `DATABASE_URL` (Railway Postgres-плагин предоставляет её автоматически —
  привяжите переменную через reference на сервис Postgres). Поддерживается и
  набор `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME/DB_SSLMODE` — та же
  конвенция, что и у основного Go-бэкенда. Без БД-переменных используется
  файловое хранилище (`saved_characters/`).
- Таблица создаётся автоматически при первом обращении: `battle_saved_characters`
  (`id, name, class_name, level, data JSONB, created_at, updated_at`). Схему
  основного сервиса не трогает.

### `battle_frontend`
- Config file: `railway-battle-frontend.json` → собирает `battle/frontend/Dockerfile` (nginx).
- Отдаёт статику UI и **проксирует** запросы API на бэкенд.
- Переменные окружения:
  - `PORT` — задаёт Railway.
  - `BACKEND_URL` — адрес сервиса `battle_backend`
    (например `http://battle-backend.railway.internal:8000` через приватную сеть
    Railway, либо публичный URL бэкенда). **Без слеша в конце.**

UI обращается к API по тому же origin (`location.origin`), поэтому при работающем
прокси менять код не нужно — nginx сам перенаправит `/api`, `/rooms`, `/spells`,
`/quickstart`, `/saved-characters` на `BACKEND_URL`.

> Локальный Docker-прогон фронтенда (из папки `battle/frontend`):
> `docker build -t battle-frontend . && docker run -p 8080:8080 -e BACKEND_URL=http://host.docker.internal:8765 battle-frontend`

## Дальнейшие шаги интеграции (TODO)
- Общая БД вместо файлового `saved_characters/` и in-memory комнат.
- Единая авторизация с `dnd_cards`.
- Подключение внешнего сервиса предметов к инвентарю листа персонажа.
