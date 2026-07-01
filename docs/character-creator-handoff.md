# Хендофф: конструктор персонажа (CharacterForge)

Состояние на момент передачи и оставшиеся шаги. Полный дизайн-план —
`docs/character-creator-plan.md`. Этот файл — актуальный статус + что делать дальше.

## TL;DR

Строим новый конструктор персонажа, завязанный на реальные сущности
(виды/классы/предыстории/черты/заклинания → эффекты/действия + унифицированная
механика). Фазы **A, B, C сделаны и проверены**. Дальше — **Фаза D (лист
персонажа)** и **Фаза E (контент + сквозная проверка)**.

Ветка `main`. Последний коммит: `6cd9c1d`.

## Что уже сделано

### Фаза A — хранение (бэкенд) — коммит `18ba977`
- `backend/models_character_v3.go` — модель `CharacterV3` (ссылки на
  race/lineage/class/background/feats/spells + `resolved_choices` + снимок
  derived-полей). Все массивы/объекты — **jsonb** (не text[]).
- `backend/character_v3_controller.go` — CRUD.
- Миграция `040_create_characters_v3`.
- Роуты `/api/characters-v3` (POST/GET/GET:id/PUT/DELETE) в `main.go`.
- **PUT = полная замена** полей (редактор шлёт весь черновик целиком).

### Фаза B — модули сборки (фронтенд) + доступ без авторизации — коммит `5772c20`
- **Без авторизации**: `character_v3_controller.go` при отсутствии токена
  использует общего пользователя **`public`** (`getOrCreateDefaultUser`).
- **Черты получили эффекты**: у `Feat` добавлены `related_effects`/
  `related_actions` (миграция `041`), проброшены через контроллер и UI
  `FeatCreator.tsx`. Сборка учитывает эффекты вида + класса + **черт**.
- `frontend/src/character/`:
  - `types.ts` — `ForgeCharacter`, `CharacterDraft`, `STANDARD_ARRAY`,
    `ABILITY_KEYS`, `ABILITY_LABEL_RU`, `emptyDraft()`.
  - `api.ts` — `charactersV3Api` (list/get/create/update/remove).
  - `derive.ts` — `abilityMod`, `proficiencyBonusForLevel`, `computeMaxHP`,
    `savingThrowBonus`, `skillBonus`, `spellcasting`.
  - `assemble.ts` — `gatherFeatureRefs`, `loadBundle`, `loadAssembly`,
    `assemble` (собирает эффекты/действия, `pendingChoices`, derived).
- `frontend/src/mechanics/collectChoices.ts` — извлекает `choice`-интеракции
  из механики. `SKILL_ABILITY`/`abilityOfSkill` добавлены в `registries.ts`.

### Фаза C — редактор (фронтенд) — коммит `6cd9c1d`
- `frontend/src/pages/CharacterForge.tsx` + `CharacterForge.css` — полноэкранный
  тёмно-золотой конструктор на `/character-forge` и `/character-forge/:id`.
  **Роут БЕЗ `ProtectedRoute`/`Layout`** (по макету, без авторизации).
- `frontend/src/character/components.tsx` — `ForgeNav`, `SummaryPanel`,
  `EntityChoiceCard`, `ChoiceResolver`, `AbilityAssigner`.
- `frontend/src/character/forgeHelpers.ts` — `classSkillChoice`, `finalSkills/
  Tools/Languages/Saves`, `buildSavePayload`, `requiredChoiceIssues`,
  `completionIssues`.
- Секции: Общее, Вид (+подвид +выборы), Класс (+skill_choices +выборы),
  Предыстория, Черта (+выборы), Хар-тики, Владения, Заклинания.
- **Проверено сквозняком**: собран Человек+Воин+Стражник, разрешены выборы
  вида, сохранён в characters-v3 с корректными refs/abilities/skills/
  resolved_choices/снимком.

## Живое состояние (прод)

- Бэкенд: `https://backend-production-41c3.up.railway.app` — задеплоен, включает
  A/B (миграции 040/041, роуты v3, feat related_*).
- Фронтенд: `https://bagofholding.up.railway.app`.
- Засеяны минимальные классы **Воин** (`CLASS-warrior`) и **Волшебник**
  (`CLASS-wizard`) с `hit_die`/`saving_throws`/`skill_choices` (без умений L1).
- Существуют: 10 видов (вкл. Человек/Эльф), 16 предысторий (вкл. Стражник/
  Благородный), 10 origin-черт (вкл. Бдительный/Одарённый/Крепкий/Дикий
  атакующий), 163 заклинания.

## ⚠️ Блокеры / что требует внимания

1. **Фронтенд на Railway не задеплоил Фазу C** (пуш `6cd9c1d`) за ~15 мин —
   авто-деплой фронта, похоже, не срабатывает или завис (бэкенд деплоится
   стабильно на push). **Нужно вручную передеплоить фронтенд** в Railway.
   Пока не задеплоено — проверять локально (см. ниже).
2. **Предыстории**: `skill_proficiencies` засеяны русскими названиями
   («Атлетика»), а не skill-id — нормализовать в Фазе E (иначе итоговые навыки
   смешивают id и рус-строки).

## Рецепт локальной проверки (пока прод-фронт не задеплоен)

```bash
cd frontend
"/c/Program Files/nodejs/npx" vite build              # или npx vite build
"/c/Program Files/nodejs/npx" vite preview --port 5173 --host 127.0.0.1
```
API по умолчанию бьёт в прод-бэкенд (`src/api/client.ts`,
`VITE_API_URL` не задан). CORS разрешает `localhost:5173` (`main.go`).
Открыть `http://localhost:5173/character-forge` (именно `localhost`, не
`127.0.0.1` — иначе CORS-origin не совпадёт). Драйвить через Claude-in-Chrome.

Сборки: бэкенд `go build ./...`; фронт `npx vite build` (**не** `npm run build`
— в репо есть преждевременные tsc-ошибки; деплой использует vite). Тулчейн:
`C:\Program Files\Go\bin`, `C:\Program Files\nodejs`.

API round-trip без токена (доступ открыт): `curl --data-binary @file` для
кириллицы. Список видов/классов и т.п. — обычные GET.

## Оставшиеся шаги

### Фаза D — минимальный лист персонажа
- Новая страница `frontend/src/pages/CharacterSheetMVP.tsx`, роут
  `/characters-v3/:id` (в `App.tsx`, тоже без ProtectedRoute/Layout, тёмно-
  золотой стиль — переиспользовать `CharacterForge.css` токены). Кнопка
  «Открыть лист» в конструкторе уже ведёт на `/characters-v3/:id`.
- Грузить персонажа `charactersV3Api.get(id)`; собрать лист тем же
  `loadAssembly`/`assemble` + `derive.ts` (данные считаются из ссылок и
  `resolved_choices`; снимок в БД — быстрый кэш).
- Блоки: шапка (имя, Вид·Подвид·Класс N, предыстория); 6 характеристик +
  модификаторы; спасброски (PB если владение); КД/HP/скорость/PB/инициатива;
  навыки с бонусом и отметкой владения; черты+способности (эффекты+действия,
  ссылки/иконки); заклинания по уровням (для кастера — строка DC/атака через
  `spellcasting`).
- Проверить: открыть созданного персонажа, убедиться, что всё отображается.

### Фаза E — контент + сквозная проверка
- Обогатить **Воин**/**Волшебник** умениями L1 как эффекты/действия и привязать
  через `class.level_progression["1"].{effects,actions}` (Воин: Второе дыхание
  (action), Боевой стиль (choice-эффект); Волшебник: Использование заклинаний
  и т.п.). Использовать существующий конструктор механики.
- При желании — привязать эффекты к 4 origin-чертам (механизм готов:
  `feat.related_effects`; напр. Одарённый → choice на навыки).
- **Нормализовать** `background.skill_proficiencies` к skill-id.
- Проверить Эльфа с подвидами (subfeature-выбор синхронит `lineage_id`).
- Сквозной прогон: создать персонажа из **каждого** класса × вид × предыстория,
  разрешить все выборы, перейти в лист.

### Полировка (по возможности)
- Наведение/превью сущностей в карточках (есть `RacePreview`/`FeatPreview`/
  `SpellPreview`/`ClassPreview`).
- Список персонажей v3 / вход в конструктор из основного меню (сейчас только по
  прямому URL `/character-forge`).
- Ability-бонусы от предыстории/черт (сейчас характеристики строго ручные; в
  плане §5 это «best-effort/Фаза 2»).

## Ключевые подводные камни (не потерять)

- **Коллизия имени**: `CharacterV3` уже занят в `utils/characterCalculationsV3`
  (старый лист на API **v2**). Новый тип — **`ForgeCharacter`**.
- **Доступ без авторизации** держится на fallback-пользователе `public` в
  v3-контроллере. `AuthMiddleware` глобально = no-op (`optionalAuth`).
- **jsonb, не text[]** для любых массивов/объектов (иначе malformed array).
- **PUT характеристик = полная замена** — редактор всегда шлёт полный черновик.
- Choice `on_acquire` в механике эмитится buildMechanics как **top-level
  интеракция** (не в `resolution:auto/result`) — `collectChoices` и
  `deserializeMechanics` это уже учитывают.

## Память
`~/.claude/.../memory/character-forge.md` — краткий статус проекта и гоча.
