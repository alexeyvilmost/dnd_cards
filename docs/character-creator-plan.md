# План-проект: конструктор персонажа + система хранения (MVP)

Версия 1.0. Дизайн и поэтапный план реализации нового «всеобъемлющего» редактора
создания персонажа и связанной с ним модели хранения. Реализацией будет заниматься
менее тяжёлая модель — план написан так, чтобы его можно было исполнить без
серьёзных доработок.

---

## 1. Цель и рамки MVP

Единый редактор создания персонажа в дизайне присланного макета (тёмно-золотой,
левая колонка-навигация с иконками, живая сводка «Основное»). Редактор собирает
персонажа из **внешних сущностей**, которые уже есть в БД:

- **вид** (`races`) + подвид (`race.lineages`),
- **класс** (`classes`) с умениями по уровням,
- **предыстория** (`backgrounds`),
- **черты происхождения** (`feats`, category `origin`),
- **заклинания и заговоры** (`spells`),

а низкоуровнево все умения/особенности этих сущностей — это **эффекты**
(`effects`) и **действия** (`actions`) с унифицированной механикой
(`mechanics`, см. `docs/unified-mechanics-schema.md`).

Результат — запись персонажа в новой таблице `characters_v3`, из которой можно
открыть **лист персонажа**.

### Содержимое MVP (обязательный набор данных)

| Категория | Значения |
|---|---|
| Классы | Воин, Волшебник |
| Предыстории | Стражник, Благородный |
| Виды | Человек; Эльф (со всеми подвидами) |
| Черты происхождения | Бдительный, Одарённый, Крепкий, Дикий Атакующий |
| Заклинания | все заговоры и заклинания из `spells` (пока без механики — просто добавляются в лист) |

### Принятые решения (согласованы)

1. **Хранение** — новая модель `characters_v3`, ссылающаяся на сущности +
   блок `resolved_choices`. Старый `characters_v2` не трогаем.
2. **Характеристики** — стандартный набор `15/14/13/12/10/8` с раскладкой по
   характеристикам + возможность ручного ввода.
3. **Предыстория ↔ черта ↔ бонусы** — независимые секции (как на макете).
   Предыстория и черта не связаны жёстко правилами 2024; бонусы характеристик
   задаются в секции «Хар-тики».
4. **Лист персонажа** — новый минимальный лист для MVP (не переиспользуем
   4000-строчный `CharacterDetailV3`).

### Явно вне рамок MVP

- Полное механическое разрешение эффектов (авто-применение бонусов, реакция на
  триггеры, боевой движок). Механика заклинаний.
- Мультиклассирование, уровни > 1, повышение уровня.
- Инвентарь/снаряжение стартовое (можно оставить ссылку на текущую систему
  инвентаря позже).

---

## 2. Анализ текущего состояния

- **Сущности готовы и единообразны.** Класс и вид привязывают умения через
  `level_progression: { "<level>": { effects: string[], actions: string[] } }`;
  вид/предыстория дополнительно имеют `related_effects` / `related_actions`;
  черта — `ability_increase` + связанные эффекты; заклинание — `level`
  (0 = заговор). API-объекты уже есть: `classesApi`, `racesApi`,
  `backgroundsApi`, `featsApi`, `spellsApi`, `effectsApi`, `actionsApi`
  (`frontend/src/api/client.ts`).
- **Механика готова.** `frontend/src/mechanics/` — блоки, реестры,
  `buildMechanics` / `deserializeMechanics`, редактор `MechanicsBuilder`.
  Эффекты рас уже засеяны (`RE-*`) и слинкованы с видами.
- **Существующий `CreateCharacterV3` НЕ подходит.** Он завязан на **захардкоженные**
  локальные данные (`utils/backstories`, `utils/races`, `utils/classes`), не
  использует таблицы сущностей и оформлен в светлой теме. Новый редактор пишем
  отдельно и подключаем к реальным сущностям. Старую страницу оставляем как есть
  (не ломаем маршруты).
- **`characters_v2`** примитивен: `race`/`class` — строки, навыки — JSON-строка,
  нет ссылок на черты/предысторию/подвид/заклинания и нет сохранённых
  результатов выборов. Поэтому — новая модель.

---

## 3. Ключевая концепция: сборка персонажа

Персонаж = **ссылки на сущности** + **разрешённые выборы** + **введённые
характеристики**. Из этого детерминированно вычисляется лист.

```
             ┌────────── выбранные сущности ──────────┐
  race_id, lineage_id, class_id, background_id,
  feat_ids[], spell_ids[]
             │
             ▼
   агрегатор фич (клиент):
     • race.related_effects/actions + lineage.grants
     • class.level_progression[≤level].effects/actions + class.skill_choices
     • background.related_effects/actions
     • feat.related_effects/actions + feat.ability_increase
             │
             ▼
   ┌─ гранты (пассивные эффекты, владения) ─┐   ┌─ pending-выборы ─┐
   │ навыки, спасброски, чувства, ресурсы…  │   │ choice-интеракции │
   └────────────────────────────────────────┘   │ (resolution       │
             │                                    │  on_acquire)      │
             ▼                                    └───────┬──────────┘
   вычисляемые поля листа                                  │ пользователь
   (модификаторы, КД, HP, PB, навыки, DC)                  ▼ выбирает
                                             resolved_choices[id] = [...]
```

- **Гранты** — то, что даётся автоматически (напр. `grant_sense darkvision`,
  `resource heroic_inspiration`, владение навыком).
- **Pending-выборы** — интеракции `kind:"choice"` из механики эффектов
  (напр. «Выберите навык», «Выберите черту происхождения», выбор подвида).
  Каждая имеет стабильный `id`. Их надо показать в редакторе и сохранить выбор в
  `resolved_choices`.

### Сборщик выборов

Новая чистая функция в `frontend/src/mechanics/`:

```ts
// collectChoices.ts
export type PendingChoice = {
  id: string;               // стабильный id из choice.id
  prompt: string;
  count: number;
  source: string;           // skill | feat | subfeature | language | ...
  filter?: string | string[];
  options?: { source: string; filter?: unknown; items?: any[] };
  recommended?: string[];
  origin: { kind: 'race'|'class'|'background'|'feat'; id: string; name: string };
};

export function collectChoices(
  mechanics: Record<string, unknown> | null,
  origin: PendingChoice['origin'],
): PendingChoice[];
```

Проходит по `mechanics.effects[]`: интеракция сама `kind:"choice"` **или**
`resolution:"auto"` с `result[].kind === "choice"`. Использует те же поля, что
`deserializeMechanics`/`optionsToChoiceForm`. Для подвида вида (`source:
"subfeature"`) варианты берутся из `choice.options.items`.

Разрешение выбора (`optionsForChoiceSource` уже есть в `registries.ts`) даёт
список опций для UI по `source`.

---

## 4. Модель хранения — `characters_v3`

### 4.1 Backend (Go)

Новый файл `backend/models_character_v3.go`:

```go
type CharacterV3 struct {
    ID      uuid.UUID  `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
    UserID  uuid.UUID  `json:"user_id" gorm:"type:uuid;not null"`
    GroupID *uuid.UUID `json:"group_id" gorm:"type:uuid"`
    Name    string     `json:"name" gorm:"not null"`
    AvatarURL string   `json:"avatar_url" gorm:"type:text"`

    // Ссылки на сущности
    RaceID       *uuid.UUID `json:"race_id" gorm:"type:uuid"`
    LineageID    *string    `json:"lineage_id" gorm:"type:varchar(100)"` // id варианта из race.lineages
    ClassID      *uuid.UUID `json:"class_id" gorm:"type:uuid"`
    BackgroundID *uuid.UUID `json:"background_id" gorm:"type:uuid"`
    Level        int        `json:"level" gorm:"not null;default:1"`

    // Списки ссылок (jsonb-массивы строковых uuid)
    FeatIDs  *Properties `json:"feat_ids" gorm:"type:jsonb"`
    SpellIDs *Properties `json:"spell_ids" gorm:"type:jsonb"`

    // Характеристики (базовые, введённые)
    Abilities *JSONMap `json:"abilities" gorm:"type:jsonb"` // {str,dex,con,int,wis,cha}

    // Владения (итоговые, jsonb-массивы)
    SkillProficiencies       *Properties `json:"skill_proficiencies" gorm:"type:jsonb"`
    SavingThrowProficiencies *Properties `json:"saving_throw_proficiencies" gorm:"type:jsonb"`
    ToolProficiencies        *Properties `json:"tool_proficiencies" gorm:"type:jsonb"`
    Languages                *Properties `json:"languages" gorm:"type:jsonb"`

    // Разрешённые выборы из механики: { "<choiceId>": ["<optId>", ...] }
    ResolvedChoices *JSONMap `json:"resolved_choices" gorm:"type:jsonb"`

    // Снимок вычисляемых полей (для простого листа; можно пересчитать из ссылок)
    MaxHP            int `json:"max_hp" gorm:"default:0"`
    CurrentHP        int `json:"current_hp" gorm:"default:0"`
    Speed            int `json:"speed" gorm:"default:30"`
    ProficiencyBonus int `json:"proficiency_bonus" gorm:"default:2"`

    CreatedAt time.Time `json:"created_at"`
    UpdatedAt time.Time `json:"updated_at"`
}
func (CharacterV3) TableName() string { return "characters_v3" }
```

> **Важно (из прошлого опыта):** все jsonb-массивы/объекты — тип `jsonb`, никогда
> не `text[]`. `Properties` и `JSONMap` уже сериализуются в JSON.

Плюс `CreateCharacterV3Request` / `UpdateCharacterV3Request` / `CharacterV3Response`
и маппинг (по образцу класса/расы). Все поля-ссылки — опциональные, чтобы
незавершённый персонаж мог сохраниться (черновик), но эндпоинт create требует
минимум `name`.

### 4.2 Контроллер и маршруты

`backend/character_v3_controller.go`: `CreateCharacterV3`, `GetCharactersV3`
(список по `user_id`), `GetCharacterV3`, `UpdateCharacterV3`, `DeleteCharacterV3`.
Маршруты в `backend/main.go` рядом с `characters-v2`:

```
protected.POST   /characters-v3
protected.GET    /characters-v3
protected.GET    /characters-v3/:id
protected.PUT    /characters-v3/:id
protected.DELETE /characters-v3/:id
```

### 4.3 Миграция

`backend/migrations/migrations.go` — `"040_create_characters_v3"` + функция
создания таблицы (все jsonb-поля с `DEFAULT`). Нумерация: последняя — 039.

---

## 5. Вычисляемые значения листа (единый модуль)

Чтобы редактор (live-сводка) и лист считали одинаково — общий модуль
`frontend/src/character/derive.ts`:

```ts
mod(score)            = Math.floor((score - 10) / 2)
proficiencyBonus(lvl) = 2 (MVP, lvl 1)
maxHP  = hitDieMax(class.hit_die) + mod(con)   // L1; +феты типа «Крепкий» — Фаза 2
savingThrow(ab) = mod(ab) + (class.saving_throws.includes(ab) ? PB : 0)
skillBonus(skill) = mod(abilityOfSkill(skill)) + (isProficient ? PB : 0)
spellcasting(class): { ability, saveDC: 8+PB+mod(ability), attack: PB+mod(ability) }
                     // Волшебник → int; для не-кастеров null
```

Списки владений = объединение:
`background` + `race`/`lineage` + разрешённые `class.skill_choices` +
разрешённые choice-выборы (`resolved_choices` → навыки/языки/инструменты) +
`feat`-гранты. Дедуплицируется.

Реестры навыков/характеристик уже есть в `mechanics/registries.ts` (ABILITIES,
SKILLS, соответствие навык→характеристика нужно добавить туда же — таблица
`SKILL_ABILITY`).

---

## 6. Редактор — фронтенд

### 6.1 Дизайн-система (по макету)

Тёмно-золотая тема. Токены (добавить в отдельный CSS-модуль
`src/pages/CharacterForge.css` или Tailwind-классы):

| Токен | Значение |
|---|---|
| Фон | `#141210` (почти чёрный), панели `#1c1813` |
| Рамка/разделители | тонкие `#6b5836` / золотой `#c9a45f` |
| Заголовки, ссылки на сущности | золотой `#d8b978` |
| Текст | `#e8e0d0`, вторичный `#a99f8b` |
| Иконки сущностей | белые контурные PNG (как у эффектов/действий) |
| Активный пункт навигации | подсветка золотой рамкой |

**Раскладка** (совпадает с макетом):

```
┌──────────────────────────── Создание персонажа ─────────────────────────────┐
│ левая нав │            [Заголовок активной секции]                            │
│  (иконки) │  ┌───── левая колонка: живая сводка «Основное» ─────┬─ правая ──┐ │
│  Общее    │  │  Имя: …                                          │  редактор │ │
│  Вид      │  │  Вид: Человек                                    │  активной │ │
│  Класс    │  │    • Находчивый (ссылка на эффект)               │  секции   │ │
│  Предыст. │  │  Класс: Воин, 1                                  │           │ │
│  Черта    │  │    • Второе дыхание …                            │           │ │
│  Хар-тики │  │  Предыстория: Стражник                           │           │ │
│  Владения │  │  Черта: Крепкий                                  │           │ │
│  Заклин.* │  └──────────────────────────────────────────────────┴───────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

Левая колонка — всегда собранная сводка (read-only, ссылки на сущности с
hover-превью через существующие `RacePreview`/`FeatPreview`/`SpellPreview`).
Правая колонка — редактор выбранной в навигации секции. Секция «Общее» может
показывать сводку на всю ширину.

### 6.2 Секции навигации

1. **Общее** — имя персонажа + итоговая сводка (та же, что в левой колонке).
2. **Вид** — выбор вида (карточки Человек/Эльф) → при наличии `lineages` выбор
   подвида. Показать гранты вида и pending-выборы вида.
3. **Класс** — выбор класса (Воин/Волшебник) → разрешение `class.skill_choices`
   (выбрать N навыков из списка) → показать умения L1.
4. **Предыстория** — выбор (Стражник/Благородное) → гранты предыстории.
5. **Черта** — выбор одной или нескольких черт происхождения (мультивыбор из 4).
   Разрешить их pending-выборы (напр. «Одарённый» → выбрать навыки).
6. **Хар-тики** — стандартный набор `[15,14,13,12,10,8]`: назначение значений
   характеристикам (select/распределение) + переключатель «ручной ввод». Показать
   итоговые модификаторы.
7. **Владения** — сводка владений (навыки/спасброски/инструменты/языки) —
   read-only агрегат для проверки.
8. **Заклинания*** (добавить к макету) — выбор заговоров и заклинаний из `spells`
   (поиск + фильтр по уровню). Пока просто список `spell_ids`. Показывать всегда
   (или подсвечивать для кастеров — Волшебник); в MVP доступно всем.

### 6.3 Состояние и файлы

- Страница `frontend/src/pages/CharacterForge.tsx` (маршрут `/character-forge`,
  и `/character-forge/:id` для редактирования черновика).
- Хук `useCharacterDraft` — единый стейт черновика:
  `{ name, raceId, lineageId, classId, backgroundId, level, featIds[], spellIds[],
     abilities, classSkillChoices[], resolvedChoices, }`.
- Загрузка сущностей: `classesApi/racesApi/backgroundsApi/featsApi/spellsApi`,
  фильтрация к MVP-набору (по `card_number`/названию — см. §8).
- Агрегатор: `frontend/src/character/assemble.ts` — из черновика собирает
  `{ grantedEffects: Effect[], grantedActions: Action[], pendingChoices:
  PendingChoice[], derived }`. Использует `collectChoices` (§3) и `derive.ts` (§5).
- Компоненты: `EntityChoiceCard` (карточка выбора сущности с превью),
  `ChoiceResolver` (разрешение одного pending-выбора — переиспользует
  `optionsForChoiceSource`), `AbilityAssigner` (раскладка характеристик),
  `SummaryPanel` (левая сводка), `ForgeNav` (левая навигация с иконками).

### 6.4 Валидация «любое сочетание работает»

Кнопка **«Создать»** активна, когда выполнены обязательные условия:
- `name` не пустой;
- выбраны вид, класс, предыстория;
- назначены все 6 характеристик;
- **разрешены все обязательные pending-выборы** (choice, у которых не выбрано
  нужное `count`).

Черты и заклинания — опциональны. Всё остальное имеет дефолты. Незавершённый
персонаж может быть сохранён как черновик (PUT), но «создать/перейти в лист» —
только при выполненных условиях. При сохранении вычисляем снимок
(`max_hp`, `speed`, `proficiency_bonus`, итоговые владения) и шлём в
`POST /characters-v3`.

---

## 7. Лист персонажа (минимальный, MVP)

Новая страница `frontend/src/pages/CharacterSheetMVP.tsx`
(`/characters-v3/:id`). В едином тёмно-золотом дизайне. Блоки:

- Шапка: имя, «Вид • Подвид • Класс N», предыстория.
- Характеристики (6) с модификаторами; спасброски (с PB, если владение).
- Боевое: КД (10+dex mod — базово), HP (max/current), скорость, бонус мастерства,
  инициатива.
- Навыки: список с итоговым бонусом и отметкой владения.
- Черты и способности: собранные `grantedEffects` + `grantedActions` (иконки +
  ссылки на детали, hover-превью).
- Заклинания: список выбранных `spells`, сгруппированный по уровню
  (заговоры отдельно). Для кастера — строка DC/атака заклинаний.
- Разрешённые выборы: отображаются как часть навыков/владений (через
  `resolved_choices`).

Данные листа считаются тем же `assemble.ts` + `derive.ts` из ссылок и
`resolved_choices` (снимок в БД используется как быстрый кэш/фолбэк).

---

## 8. Контент MVP (данные в БД)

Проверить/досоздать сущности (скрипт-сидер по образцу `_races_seed.mjs`,
идемпотентный, с явными `card_number`). Всё через реальные API.

- **Виды:** Человек (готов, `RE-human-*`), Эльф с подвидами
  (drow/high/wood — `RE-elf-*`, lineage-выбор). Проверить, что `lineages`
  заполнены и подвидный choice присутствует.
- **Классы:** Воин, Волшебник. Нужны:
  - `hit_die` (Воин d10, Волшебник d6), `saving_throws`, `primary_abilities`,
    `skill_choices` (Воин: 2 из списка; Волшебник: 2 из списка),
  - `level_progression["1"].effects/actions`: Воин — «Второе дыхание» (action),
    «Боевой стиль» (choice-эффект), Волшебник — «Использование заклинаний»,
    «Магическое восстановление» (по мере готовности; для MVP достаточно
    минимального набора умений как эффекты/действия).
- **Предыстории:** Стражник, Благородное — гранты навыков/инструментов через
  `related_effects` (или поля предыстории).
- **Черты происхождения (origin):** Бдительный (Alert), Одарённый (Skilled),
  Крепкий (Tough), Дикий Атакующий (Savage Attacker) — с `related_effects` и,
  где нужно, choice (Одарённый → выбор навыков) и `ability_increase`.
- **Заклинания:** уже присутствующие `spells` подходят (нужен только выбор и
  сохранение id). Механику не трогаем.

Чек-лист контента вести в отдельном файле или задачами; сидер положить в
`scratchpad` и удалить после прогона (как раньше).

---

## 9. Порядок реализации (фазы и задачи)

**Фаза A — хранение (backend).**
1. `models_character_v3.go` (модель + request/response + маппинг).
2. `character_v3_controller.go` (CRUD) + маршруты в `main.go`.
3. Миграция `040_create_characters_v3`.
4. Сборка `go build ./...`, деплой (push в main), проверка round-trip через API
   (curl `--data-binary @file` для кириллицы).

**Фаза B — общие модули (frontend).**
5. `mechanics/collectChoices.ts` + `SKILL_ABILITY` в `registries.ts`.
6. `character/derive.ts` (модификаторы, PB, HP, DC, навыки).
7. `character/assemble.ts` (агрегатор фич/выборов/derived).
8. `api/client.ts` → `charactersV3Api`; типы в `types/index.ts`.

**Фаза C — редактор (frontend).**
9. `CharacterForge.tsx` + `ForgeNav` + `SummaryPanel` + дизайн-токены.
10. Секции: Вид, Класс (+skill_choices), Предыстория, Черта, Хар-тики, Владения,
    Заклинания. Компоненты `EntityChoiceCard`, `ChoiceResolver`,
    `AbilityAssigner`.
11. Валидация завершённости + сохранение (`POST/PUT /characters-v3`).

**Фаза D — лист.**
12. `CharacterSheetMVP.tsx` (`/characters-v3/:id`), считает через `assemble/derive`.
13. Маршрут-переход из редактора «Создать → лист».

**Фаза E — контент + проверка.**
14. Сидер MVP-контента (классы с умениями, предыстории, черты) + проверка эльфа/
    подвидов.
15. `npx vite build`, деплой, браузер-проверка: создать по одному персонажу из
    **каждого** класса × вид × предыстория × набор черт, разрешить все выборы,
    перейти в лист, убедиться, что HP/навыки/владения/заклинания отображаются.

**Точки верификации** — после Фазы A (API), после Фазы C (создание сохраняется),
после Фазы E (полный сквозной сценарий в браузере на Railway).

---

## 10. Риски и решения

- **Лоссовые/незаполненные механики умений класса.** Если у класса нет готовых
  эффектов L1 — редактор всё равно должен собирать персонажа (умения
  показываются списком, гранты применяются best-effort). HP считается по
  `hit_die`; отсутствие механики феты «Крепкий» не ломает создание.
- **Обязательные vs опциональные choice.** Пока `count` не выбран — считать выбор
  обязательным и блокировать «Создать». Дефолт — не выбирать за пользователя
  (кроме `recommended`, который можно предвыбрать).
- **Совместимость.** Ничего в `characters_v2`/`CreateCharacterV3` не меняем; всё
  новое — параллельные маршруты и таблица.
- **Кириллица в API-проверках** — писать JSON в файл и `curl --data-binary @file`.

---

## 11. Дальнейшее расширение (после MVP)

- Механическое разрешение эффектов (авто-бонусы, HP от фетов, сопротивления) —
  «resolution engine», Фаза 2 из плана механики.
- Уровни > 1 и левелап (уже есть `level_progression`), мультикласс.
- Стартовое снаряжение (интеграция с инвентарём/`starting_equipment`).
- Подготовка заклинаний (slots, prepared vs known) и механика заклинаний.
- Перенос листа на полноценный `CharacterDetailV3` при необходимости.
