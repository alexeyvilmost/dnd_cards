# Battle Service — полный функционал и проверка

Статус документа: актуален для реализованных этапов 0-5.

## 1) Что умеет сервис сейчас

### 1.1 Инфраструктура
- Backend: FastAPI (`battle/backend`), frontend: React + TS + Vite (`battle/frontend`).
- Поддержка двух режимов хранения:
  - PostgreSQL (если задан `DATABASE_URL` или `DB_*`);
  - файловый fallback (`battle/backend/data`), если БД не настроена.
- Автомиграции `battle_*` таблиц на старте backend.
- Локальный compose-стек: `battle/docker-compose.battle.yml`.

### 1.2 Бой (базовый движок)
- Комнаты/арены, постановка персонажей, старт/стоп боя.
- Инициатива, пошаговость, передвижение, melee-атаки, эффекты состояний.
- Действия персонажа: атака, перемещение, завершение хода, каст заклинаний и т.д.
- Авто-ходы монстров для PvE.

### 1.3 Листы персонажей и прогрессия (Fighter/Wizard 1-3)
- Персистентные листы в `battle_characters`.
- Создание персонажа (человек, без traits), point-buy 27.
- Fighter:
  - стиль боя, мастерства оружия, снаряжение;
  - lvl2 Action Surge, lvl3 subclass (в т.ч. Champion crit 19-20).
- Wizard:
  - выбор cantrips/prepared spells;
  - progression до уровня 3, выборы на level-up.
- XP:
  - ручное начисление через API/UI;
  - автоначисление после PvE-победы над монстрами.

### 1.4 Заклинания (БД + CRUD)
- Заклинания хранятся в `battle_spells`.
- Первый запуск сидирует ~64 базовых заклинания из кода.
- Полный CRUD заклинаний через API и UI.
- Поддержка "заклинаний с выбором эффекта" (`effect_options` + `effect_choice` при касте).
- Флаг `battle_ready`.

### 1.5 Монстры / бестиарий (БД + CRUD + PvE)
- Монстры хранятся в `battle_monsters`.
- CRUD монстров через API и UI.
- Добавление монстров в бой.
- Простой AI для авто-ходов.
- XP за монстров (по CR или явному `xp`) с выдачей в лист персонажа.

### 1.6 Интеграция предметов с `dnd_cards`
- В `dnd_cards` у карт добавлено поле `battle_profile` (JSONB).
- Новые API в `dnd_cards`:
  - `GET /api/cards/:id/battle-stats`
  - `POST /api/cards/battle-stats`
- В `battle`:
  - импорт предмета по `card_id` в лист персонажа;
  - применение бонусов предмета при материализации в бой (AC/attack/damage и т.д.).
- В UI:
  - в `dnd_cards` редактор `battle_profile`;
  - в `battle` импорт предмета в лист и управление импортом.

### 1.7 Dungeon Crawl MVP
- Запуски (runs) в `battle_runs`.
- Поток:
  1) старт забега,
  2) генерация следующей комнаты (с ростом сложности),
  3) бой,
  4) резолв (victory/defeat),
  5) награды (gold/XP),
  6) магазин между комнатами.
- Магазин:
  - берёт офферы из `dnd_cards` API, если доступен;
  - при покупке предмет сразу импортируется в экипировку листа.

---

## 2) Основные API (кратко)

### 2.1 Health/мета
- `GET /api/health`
- `GET /spells`

### 2.2 Листы персонажей
- `GET /characters-api`
- `POST /characters-api`
- `GET /characters-api/{id}`
- `PUT /characters-api/{id}`
- `DELETE /characters-api/{id}`
- `GET /characters-api/meta/create-options`
- `GET /characters-api/{id}/level-up/options`
- `POST /characters-api/{id}/level-up`
- `POST /characters-api/{id}/award-xp`
- `POST /characters-api/{id}/equipment/import-card`
- `DELETE /characters-api/{id}/equipment/{card_id}`

### 2.3 Бой/комнаты
- `POST /rooms`
- `GET /rooms/{id}`
- `POST /rooms/{id}/combat/start`
- `GET /rooms/{id}/combat`
- `POST /rooms/{id}/combat/end-turn`
- `POST /rooms/{id}/combat/auto-turn`
- `POST /rooms/{id}/actions/*`
- `POST /rooms/{id}/characters/from-sheet`
- `POST /rooms/{id}/monsters`

### 2.4 Заклинания
- `GET /spells`
- `GET /spells/{id}`
- `POST /spells`
- `PUT /spells/{id}`
- `DELETE /spells/{id}`

### 2.5 Монстры
- `GET /monsters`
- `GET /monsters/default`
- `GET /monsters/{id}`
- `POST /monsters`
- `PUT /monsters/{id}`
- `DELETE /monsters/{id}`

### 2.6 Dungeon runs
- `GET /runs`
- `POST /runs/start`
- `GET /runs/{id}`
- `POST /runs/{id}/next-room`
- `POST /runs/{id}/resolve`
- `GET /runs/{id}/shop`
- `POST /runs/{id}/shop/buy`

---

## 3) Как поднять локально

## Вариант A: быстро (backend + frontend отдельно)
```bash
# backend
cd battle/backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn main:app --port 8765

# frontend (новый терминал)
cd battle/frontend
npm install
npm run dev
# frontend: http://localhost:3001
```

## Вариант B: через Docker Compose
```bash
cd battle
docker compose -f docker-compose.battle.yml up --build
# backend:  http://localhost:8765
# frontend: http://localhost:8080
```

---

## 4) Автопроверка (рекомендуется)

```bash
cd battle
python3 scripts/test_battle_stack.py --no-frontend
```

Ожидаемые блоки `PASS`:
- Backend
- Character sheets & progression
- Spells CRUD & effect choice
- Monsters / PvE / XP
- Item bridge (либо `PASS`, либо `PASS skipped`, если `dnd_cards` API не поднят)
- Dungeon Crawl MVP

Для проверки frontend-URL:
```bash
python3 scripts/test_battle_stack.py --frontend http://localhost:3001
# или без параметра (если frontend на 8080)
```

---

## 5) Ручная проверка (чек-лист)

### 5.1 Персонажи
1. `/characters` -> создать Fighter.
2. Начислить XP, выполнить level-up до 2 и до 3 (Champion).
3. Проверить отображение класса/уровня/features.

### 5.2 Заклинания
1. `/spellbook` -> создать новое заклинание.
2. Добавить `effect_options`.
3. В бою выбрать это заклинание и переключить вариант эффекта.

### 5.3 Монстры/PvE
1. `/bestiary` -> создать/отредактировать монстра.
2. `/` (Бой) -> PvE: выбрать лист + монстра.
3. Проверить авто-ходы монстра и рост XP после победы.

### 5.4 Предметы (интеграция)
1. Поднять `dnd_cards` backend на `http://localhost:8080`.
2. В `dnd_cards` у карты заполнить `battle_profile`.
3. В `battle` на листе персонажа импортировать `Card ID`.
4. Проверить применение бонусов в бою.

### 5.5 Dungeon Crawl
1. `/dungeon` -> старт забега.
2. Войти в следующую комнату, провести бой.
3. Проверить резолв: статус, gold, XP.
4. Между комнатами проверить магазин и покупку.

---

## 6) Диагностика типовых проблем

- `Item bridge ... skipped` в тесте:
  - это нормально, если не поднят `dnd_cards` API на `:8080`.
- `test_full_stack.py` в корне `dnd_cards` падает:
  - скрипт ожидает отдельно поднятые сервисы `dnd_cards` backend/frontend;
  - для battle используйте `battle/scripts/test_battle_stack.py`.
- Backend не стартует из-за порта:
  - освободите порт `8765` и перезапустите `uvicorn`.

