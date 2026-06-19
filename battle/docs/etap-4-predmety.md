# Этап 4 — Интеграция предметов с `dnd_cards`

Статус: завершён.

## Что сделано

### `dnd_cards` (Go backend + frontend)
- В модель карты добавлено новое поле `battle_profile` (JSONB):
  - `backend/models.go`: `Card`, `CreateCardRequest`, `UpdateCardRequest`, `CardResponse`.
- Добавлена миграция:
  - `028_add_battle_profile_field` в `backend/migrations/migrations.go`.
- Контроллер карт расширен:
  - поле `battle_profile` проходит через create/update/get/list/export;
  - новый API подготовки предмета к бою:
    - `GET /api/cards/:id/battle-stats`
    - `POST /api/cards/battle-stats` (batch).
- В `backend/main.go` добавлены маршруты этих эндпоинтов.
- В UI конструктора карт:
  - `frontend/src/types/index.ts` — `battle_profile` добавлен в типы;
  - `frontend/src/components/cardCreator/EquipmentSection.tsx` — редактор `battle_profile` (JSON);
  - `frontend/src/pages/CardCreator.tsx` — поле подключено в `defaultValues`, загрузку, шаблоны, `onSubmit`;
  - `frontend/src/components/CardDetailModal.tsx` — отображение `battle_profile` в деталях карты.

### `battle` (Python backend + frontend)
- Добавлен мост к API предметов:
  - `backend/item_bridge.py` (`GET /api/cards/{id}/battle-stats`, batch).
- Добавлены endpoints для импорта/экипировки в лист персонажа:
  - `POST /characters-api/{id}/equipment/import-card` (`card_id`)
  - `DELETE /characters-api/{id}/equipment/{card_id}`
- `progression.build_combat_character` применяет импортированную экипировку к боевому персонажу:
  - бонус КД, атаки/урона, замена урона оружия (если задано).
- В `models.Character` добавлены поля `item_attack_bonus`, `item_damage_bonus`.
- На фронтенде `battle`:
  - `CharacterSheetPage` — блок «Экипировка из dnd_cards»: импорт по `Card ID`, список, удаление.
  - `api/client.ts` — методы `importEquipmentCard/removeEquipmentCard`.

### Приёмка/тесты
- `battle/scripts/test_battle_stack.py` дополнен блоком `Item bridge`:
  - если `dnd_cards` API доступен на `http://localhost:8080/api` — проверяется реальный импорт;
  - если недоступен — тест помечается как `PASS skipped` (чтобы не ломать локальную battle-приёмку).

## Как проверить

## A. Проверка battle (локально, даже без `dnd_cards`)
```bash
cd battle
python3 scripts/test_battle_stack.py --no-frontend
```

Ожидаемо:
- блоки `Backend`, `Character sheets`, `Spells`, `Monsters` — `PASS`;
- блок `Item bridge`:
  - либо `PASS ... skipped` (если `dnd_cards` не поднят),
  - либо полноценный `PASS` импорт.

## B. Полная проверка интеграции предметов (рекомендуется)
1. Поднимите `dnd_cards` backend на `http://localhost:8080`.
2. Создайте/обновите карту с заполненным `battle_profile` (через `CardCreator`).
3. Поднимите `battle` backend на `http://localhost:8765`.
4. В `battle`:
   - откройте лист персонажа,
   - вставьте `Card ID`,
   - нажмите «Импортировать предмет».
5. Проверьте:
   - предмет появился в блоке экипировки листа;
   - при входе в бой применились бонусы (`ac_bonus`, `to_hit_bonus`, `damage_dice` и т.д.).

## C. Проверка API напрямую
```bash
# dnd_cards
curl http://localhost:8080/api/cards/<card_id>/battle-stats

# battle import
curl -X POST http://localhost:8765/characters-api/<sheet_id>/equipment/import-card \
  -H "Content-Type: application/json" \
  -d '{"card_id":"<card_id>"}'
```

## Важно
- `battle_profile` — расширяемый JSON, можно добавлять новые ключи без смены схемы.
- Полный `scripts/test_full_stack.py` в корне `dnd_cards` сейчас требует отдельно поднятые сервисы (`:8080`, `:3000`) и окружение с `requests`; без этого ожидаемо падает по `connection refused`.

