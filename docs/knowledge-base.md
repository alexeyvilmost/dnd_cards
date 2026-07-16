# База знаний проекта (единый источник)

> Этот документ заменяет разрозненные доки-ревью. Он **живой**: правки вносятся сюда, а не в новый файл.
> Срез: 2026-07-15, HEAD `e868714` (+ `9078764` той же сессии). Прод-снапшот: `officials/canon/prod-snapshot/` от 2026-07-15 16:58.

---

## 1. Как пользоваться этим документом

**Что здесь есть.** Карта проекта (§2), парадигмы и инварианты (§3), словарь механик — что моделируется данными без кода (§4), рабочие процессы (§5), сжатая сводка по трём трекам (§6), **реестр находок KB-001…KB-209 — рабочий бэклог** (§7), список проверенного и корректного (§8), грабли (§9), история ревью (§10).

**Что читать первым (агенту).**
1. §3 (парадигмы) и §4 (словарь механик) — **до** любого предложения «добавить код». В 58% случаев правило моделируется данными.
2. §9 (грабли) — до первой правки. Там мины, стоившие прошлым агентам часов.
3. §8 — **до** заведения находки. Если пункт там, он проверен и перепроверке не подлежит.
4. §7 — рабочий бэклог. Ссылаться на находки только по id `KB-NNN`.

**Три сквозных корня, объясняющих ~60% всех находок.**
| Корень | Смысл | Где бьёт |
|---|---|---|
| **R1. Разрыв «движок готов — контента нет»** | Интерпретатор реализует примитив, контент его не использует. `explode` написан с комментарием «Чародейский выброс» — сам заговор заглушка; `save_ends` написан «модель 2024: Hold Person» — у Удержания личности спас нарративом; `set_value ac_base` работает у 2 сущностей — «Защита без доспехов» narrative | 52 из 90 находок трека правил, 43 — чистый досев |
| **R2. Второй сборщик / вторая математика** | Рядом с каноническим примитивом живёт независимый обход того же пула, теряющий гейты (`activation.mode`, `when`, `filter`, `formulaCtx`) | KB-144, KB-145, KB-147, KB-149, KB-150, KB-152 |
| **R3. Движок читает не то поле, что заполнено контентом** | `bonus_value` vs `defense_type`, `type` vs `properties`, `mechanics.ammo` vs `properties:['ammunition']`, `two_handed` vs `two-handed` | KB-001, KB-002, KB-097, KB-100 |

**Как обновлять.** Находку закрыл — не удалять строку, а поставить в колонке `verdict` → `ЗАКРЫТО <sha>` и перенести в §8 одной строкой с датой. Новую находку — в конец соответствующего раздела §7 со следующим свободным id (id не переиспользуются). Опровергнутую гипотезу — в §8.5 «Опровергнуто», чтобы её не «чинили» повторно.

**Требования к находке:** конкретна (файл:строка или id сущности), проверяема (сценарий провала на конкретных входных данных), с вердиктом (ЗАКРЫТО 3ab1c74 — воспроизведено; ЗАКРЫТО 736203d — ядро верно, часть доказательств не выдержала проверки).

---

## 2. Карта проекта

### 2.1 Фронтенд `frontend/src/` (379 файлов)
| Каталог | Что живёт | Ключевые точки входа |
|---|---|---|
| `engine/` (70 файлов, ~половина — тесты) | **Движок правил** | `execute.ts` (~1500 стр., роутер payload'ов, атаки, спасы, урон, `applyIncomingDamage:1406`), `turn.ts` (экономика хода, отдыхи, `save_ends`), `modifiers.ts` (`foldAdvantage`, `collectModifiers`), `roll.ts`, `conditions.ts` (13 состояний), `breakdown.ts`, `ac.ts`, `weapon.ts`, `hp.ts`, `concentration.ts`, `formula.ts`, `mastery.ts`, `rollRules.ts`, `freeuse.ts`, `dispatch.ts`+`events.ts` (шина), `validateMechanics.ts` |
| `character/` | **Сборка листа**: assemble → rules → runtime | `assemble.ts` (N+1 загрузка), `rules/resolveCharacterRules.ts` (build-гранты), `runtime.ts`, `actionSheet.ts`, `basicActions.ts`, `attunement.ts`, `inventory.ts`, `death.ts`, `components.tsx` (ChoiceResolver) |
| `mechanics/` | **Конструктор механик как данные** | `blocks.ts`, `registries.ts` (CONDITIONS, WEAPON_TYPES, CHOICE_SOURCES), `predicates.ts`, `expandChoices.ts`, `collectChoices.ts` |
| `canon/` | Canon-раннер (реестры сверки) | `audit.ts`, `checks.ts`, `reports.ts`, `autoBuild.ts`, `barbarian.canon.test.ts` — **единственный юнит** |
| `mvp/` | Живые/оффлайн MVP-тесты + контракты | `contracts.ts` (RuntimeState, CharacterContext, ExecuteContext), `fixtures.ts` (⚠ см. KB-135) |
| `battle/` | Онлайн-бой | `useEncounterStream.ts` (SSE), `encountersApi.ts`, `encounterReducer.ts` |
| `pages/` (47) | Кузня `CharacterForge.tsx` (~1475), лист `CharacterSheetMVP.tsx` (~1185) + `CharacterSheetV2.tsx` (opt-in кокпит), библиотека `CardLibrary.tsx` (~2754), 11 конструкторов, `EncounterBoard/List`, `SpellPage`, `MechanicsGuide`, `InitiativeTracker` |
| `components/` (96) | Превью (`ItemPreview/SpellPreview/ActionPreview/EffectPreview/Bg3Card/ConceptPreview/ResourcePreview/VariablePreview`), панели листа (`Sheet*Panel`), `HoverCard`, `EntityDetailShell`, `spellCardStyle.ts` (SPELL_CARD_CSS), `CreatorShell`, `NavRail`, `EntityRefRegistry.tsx` (единая точка резолва id→сущность) |
| `schemas/` | **КАНОН схемы механик** `mechanics.schema.json` (docs/-копия генерируется из него) |
| `constants/` | почти пуст: только `itemTypes.ts` (образцовый единственный источник) |
| `api/`, `utils/`, `contexts/`, `hooks/`, `types/` | `apiCache.ts` (`cached(path,60000)` + `bustPrefix`), `damageTypes.ts`, 7 провайдеров, `types/index.ts` (1544 стр.) |

### 2.2 Бэкенд `backend/` (Go, Gin+GORM, Railway)
`main.go` (роуты+middleware), `controller.go` (карты/действия/эффекты), `character_v3_controller.go` (**живой лист**), `character_controller.go`+`character_v2_controller.go` (**легаси, 1954 стр., мертвы**), `encounter_controller.go` (бои+SSE+LISTEN/NOTIFY; **не считает правила** — только write-through, образец разделения), `spell_controller.go`, `class_controller.go`, `race_controller.go`, `feat_background_controller.go`, `concept/resource/variable_controller.go`, `image*`, `ai_mechanics_controller.go`, `migrations/migrations.go` (~1600 стр.), `models*.go`.

### 2.3 Контент и канон
- `scripts/content/` (50 скриптов): `api.mjs` (login с закоммиченными дефолтами), `export-prod.mjs`, `batches/` (g2–g4 «классы × уровни 1–2», `data/spells2024-batch-1..13.json` = 230 из 393 заклинаний).
- `officials/canon/prod-snapshot/*.json` — офлайн-снапшот (11 файлов, 0.3–1.7 МБ; массивы объектов + `index.json` со счётчиками).
- `officials/canon/phb2024/` — **только `class-barbarian.json`**; `docs/coverage/` — только `class-barbarian.md`.
- `officials/Книга игрока 2024.txt` — полный русский PHB (**рабочий источник RAW**); `officials/Player's Handbook 2024.txt` — **испорчен OCR**, годен только для структурных признаков.
- `officials/kb/` (778 файлов, 4,9 МБ) — **живая**, читается 3 контентными скриптами.

### 2.4 Метрики контента (снапшот 2026-07-15)
карты 766 · эффекты **452** · действия 40 · заклинания 393 (391 PHB + 2 самоделки) · классы 60 (12 базовых + 48 подклассов) · виды 39 · черты 77 · предыстории 16 · ресурсы 26 · переменные 5 · понятия 3.

---

## 3. Архитектура и парадигмы

### 3.1 Семь парадигм владельца (нарушать нельзя)
| № | Парадигма | Как реализована / где проверять |
|---|---|---|
| 1 | **Без хардкода**: если у сущности есть конструктор+интерпретатор — моделируй данными | Соблюдено: `ac.ts` (методы КЗ), `conditions.ts` (`registerConditions` из БД), `rollRules.ts`. Нарушения: `utils/resources.ts:17-23` (хардкод-дубль БД), `races.lineages[]` (параллельный список поверх `is_subrace`), `blocks.ts` берёт CONDITIONS из статики вместо `conditionOptions()` |
| 2 | **Превью везде**: hover-превью из данных на каждом элементе, даже при disabled | Соблюдено в 11/12 превью на `SPELL_CARD_CSS`. Нарушения: `EquipItemDialog` не гейтит «Надеть» по `planEquip().error`; `ChoiceResolver` для `source='effect'` рендерит голые чипы без превью |
| 3 | **Методы расчёта**: значение = набор методов-кандидатов с требованиями, берём максимум подходящего | Эталон — `ac.ts:140-174` (`acBaseFormulas` + `pickBestMethod`). Потолок ASI 20 намеренно игнорируется value_method-кандидатами (Пояс силы) |
| 4 | **Гранулярность эффектов**: не сливать разное, дробить максимально | Дубли эффектов под разные `choiceInstanceId` — **приём, а не мусор** (слоты черт L4/8/12/16/19). Одноимённые сущности с разными `card_number` — законны (7 из 9 коллизий) |
| 5 | **Всё — эффект**: класс/действие/заклинание/оружие суть эффекты | Держится; `payloadsFromMechanics` — общий вход |
| 6 | **Мёртвый код**: визуально отображаемое НЕ удалять, даже без механической роли | Поэтому живут `battle_profile`, `cards.effects`, `condition_description`. **Не блокирует** §7.19–7.21: у `EntityChoiceCard`/`ItemIconRow` JSX не встречается нигде |
| 7 | **Авторизация заморожена до предзапуска** | `AuthMiddleware` = passthrough-заглушка. Не трогать (KB-198) |

### 3.2 Инварианты (что нельзя сломать)
1. **Активные/реактивные/триггерные механики не вносят пассивных модификаторов.** `collectModifiers` пропускает по `activation.mode`; триггеры живут в отдельном `ctx.triggers` (`execute.ts:1313`). Нарушители: `resistanceLevelFor`/`computeAC` (KB-150).
2. **Крит удваивает кости, но не модификаторы**; явный `on_crit` = замена, не удвоение (авторская истина).
3. **Только одно базовое КЗ** — методы-кандидаты, максимум подходящего.
4. **`foldAdvantage` порядко-независим**: преим.+помеха → none независимо от числа источников.
5. **`applyTempHp` берёт максимум, не суммирует.**
6. **Префикс id в `applyStandingPayload`-семействе не декоративен** — по нему фильтруют при снятии эффекта, сбрасывают концентрацию, используют как React key. Рефакторинг обязан сохранить его параметром.
7. **Канон схемы = `frontend/src/schemas/mechanics.schema.json`.** Синк только frontend→docs.
8. **Бэкенд не считает правила** в живом контуре боёв — только write-through полей и SSE.

---

## 4. Словарь механик: что моделируется данными БЕЗ кода

Канон — `frontend/src/schemas/mechanics.schema.json`. Машинный контракт статусов — `frontend/src/engine/validateMechanics.test.ts:45-70`.
**Правило:** если правило не выражается ничем из списка — это `needs_engine`, а не «плохой контент».

### 4.1 payload.kind — 30 примитивов
**HANDLED (23)** — исполняются полностью:
`damage` · `healing` · `reduce_damage` · `temp_hp` · `condition` · `resource` · `modifier` · `resistance` · `set_value` · `value_method` · `narrative` · `add_item` · `grant_effect` · `grant_language` · `grant_expertise` · `grant_proficiency` · `grant_feat` · `grant_spell` · `grant_ability_score` · `grant_sense` · `grant_speed` · `weapon_mastery` · `choice`

> ⚠ **Оговорка (KB-075):** `grant_speed`/`grant_sense`/`grant_proficiency` числятся HANDLED, потому что применяются резолвером **сборки**. При рантайм-касте заклинания case отсутствует → в журнал печатается английское `NOT_IMPLEMENTED payload: grant_speed`.

**PARTIAL (5):** `boon` (чип+нарратив, кость вводится вручную; `grants:'advantage'` **не читается**) · `reroll` (только нарратив) · `transform` (чип+нарратив, стат-блок не подменяется) · `movement` (лог-only, нет модели позиций) · `grant_action` (работает на листе, не в рантайм-роутере)

**PLANNED (2), no-op:** `variable` (нет `RuntimeState.variables`) · `set_die`

### 4.2 Остальные оси
- **`activation.mode`**: `active|passive|reaction|triggered`; `while`: `equipped|carried|attuned`; `consumes_self`; `cost[]`; `casting_time`/`range`/`components{v,s,m}`
- **`cost.resource`**: `action`, `bonus_action`, `reaction`, `free_action`, `movement`, `spell_slot`, `rage`, `focus`, `superiority_die`, `sorcery_points`, `bardic_inspiration`, `channel_divinity`(**пула нет — KB-062**), `wild_shape`, `lay_on_hands`, `luck_points`, `second_wind`, `action_surge`, `heroic_inspiration`, `hp`, `hit_die`(**всегда 0 — KB-047**), `item`(+`card_id`)
- **`trigger.event`** (23): `attack_roll_made`, `hit`, `miss`, `crit`, `damage_dealt`, `damage_taken`, `saving_throw_made`, `forced_save`, `ability_check_made`, `reduced_to_0_hp`, `creature_enters_reach`, `creature_leaves_reach`, `creature_moves`, `turn_start`, `turn_end`, `spell_cast`, `condition_applied`, `initiative_roll`, `short_rest`, `long_rest`, `on_acquire`, `level_gained`; `timing`: before/during/after/replaces; `subject` (**не фильтруется**)
- **`condition.kind`** (предикаты `when`): `attack_is`, `has_advantage`, `ally_within`, `creature_within`, `target_has_condition`, `save_avoids_condition`, `target_type`, `target_wears`, `wielding`, `you_have_condition`, `unseen_by_target`, `proficiency_skill_in`, `item_equipped`, `item_carried`, `attuned`, `any_of`, `all_of`, `narrative` — **8 инертны, живого контента с ними 0**
- **`interaction.resolution`**: `attack_roll` | `save` | `ability_check` | `auto`; ветки `on_hit`/`on_crit`/`on_miss`/`on_fail`/`on_success`/`result`; `mode:dc|contest` (**contest реализован**); `repeat` — **не реализован**
- **`modifier.applies_to.roll`**: `attack`, `damage`, `ability_check`, `saving_throw`, `ac`, `speed`, `size`, `spell_dc`, `initiative`, `carry`, `max_hp`, `action`, `bonus_action`, `reaction`, `concentration`, `d20` (раскрывается на все 4 d20-теста)
- **`modifier.op`**: `add`, `set`, `advantage`, `disadvantage`, `reroll`, `multiply`, `upgrade`, `downgrade`, `auto_fail`, `auto_crit`, `deny`, `set_die`, `crit_range`, `outcome`, `on_roll`, `die_bonus`, `explode`; `scope: self|target`, `natural{eq|min,max}`, `faces`, `limit`, `then[]`, `priority`, `when[]`, `duration`
- **`duration.type`**: `instantaneous`, `rounds`, `until_start_of_next_turn`, `until_end_of_turn` — **реализованы**; `minutes`, `hours`, `while_active`, `until_dispelled`, `permanent`, `until_long_rest` → схлопываются в `{expiry:'manual'}`
- **`uses`**: `count` (формула), `per`: turn/round/short_rest/long_rest/day, `recharge` (**не читается**). `uses` энфорсится через виртуальный пул `uses_<key>`. **`by_level` работает только у `class.resources`, не у `mechanics.uses`**
- **`choice.options.source`**: `ability`, `skill`, `tool`, `instrument`, `artisan_tool`, `saving_throw`, `language`, `feat`, `spell`, `damage_type`, `weapon`, `subfeature`, `explicit` + **`effect_type` (работает, но вне enum)**; `context`: build/level_up/in_play; `recommended[]`
- **`targeting`** и **`requirements[]`** — движком **не потребляются**
- **Формулы** (`formula.ts`): `prof_bonus`, `self_level`, `class_level:<id>`, `str|dex|con|int|wis|cha`, `spellcasting`, `spell_slot_above`, `rage_bonus`, `self_level dN`, арифметика, **функции `min`/`max`**. Токенизатор — **ASCII-only** (KB-004)

### 4.3 Ключевые межперсонажные факты
- **`projectedAgainst` (`execute.ts:113-157`) читает `scope:'target'` из ЛЮБОГО активного эффекта цели**, не только из состояний → Уклонение, укрытия, Blade Ward чинятся **данными**. Конвенция `filter:{against:'self'}` — **мертва** (KB-025).
- **Дефолт `who` различается по resolution**: `runAttackRoll`/`runAbilityCheck` → `'target'`; `runMechanicEffects` для `resolution:'auto'`/`kind:'choice'` → `'self'`. Грабли №1 при досеве.
- **`matchFilter` закрыт по умолчанию в обе стороны**: неизвестный ключ фильтра → молча инертный модификатор, без диагностики.

---

## 5. Рабочие процессы

| Задача | Команда / порядок |
|---|---|
| Сборка фронта | `cd frontend && npx vite build` (9,2 с) — **канонический гейт**. Code splitting работает: index 430 КБ (gzip 136) |
| Типы | `cd frontend && ./node_modules/.bin/tsc --noEmit` — **единственный живой шлюз качества фронта**, проходит чисто |
| Линт | `npm run lint` **сломан навсегда** — конфига eslint не существовало никогда (KB-206) |
| Тесты фронта | `cd frontend && npx vitest run` (95 тестовых файлов) |
| MVP-тесты | `npx vitest run --config vitest.mvp.config.ts`; живые — `$env:MVP_CONTENT='1'` (ходят в Railway) |
| Линт механик | `node scripts/lint-mechanics.mjs` **из корня репо** (ajv по `mechanics.schema.json`) |
| Go | `cd backend && go build ./...` → exit 0; `go vet ./...` чисто; `go test ./...` 0,08 с. **CI Go не собирает** (KB-205) |
| Деплой | push в `main` → Railway (бэкенд). Healthcheck `/api/health` (`railway.json:8`) — **не удалять роут** |
| Снапшот прода | `node scripts/content/export-prod.mjs` → `officials/canon/prod-snapshot/*.json`. ⚠ Тянет несуществующий `/api/conditions` (404, глушится) и **не тянет `/api/concepts`** (KB-131) |
| Досев контента | `scripts/content/*.mjs` через `scripts/content/api.mjs`. ⚠ **По умолчанию пишут в ПРОДАКШН** (KB-207); `PUT /api/actions/:id` и `/api/effects/:id` — под OptionalAuth, токен не нужен |
| Canon-раннер | `frontend/src/canon/*` + `barbarian.canon.test.ts`. Покрывает **только Варвара**; реестр канона = 1 файл |
| Анализ снапшота | `node -e "..."` (файлы 0.3–1.7 МБ, **не Read**). `export PATH="/c/Program Files/nodejs:$PATH"` |
| Синк схемы | `node scripts/sync-mechanics-schema.mjs` — **только frontend→docs** |

---

## 6. Состояние по трекам

| Трек | Находок | Сводка |
|---|---|---|
| **Правила** (§7.1–7.13) | 94 уникальных (8 critical / 24 high / 46 medium / 11 low) | 52 из 90 табличных находок трогают данные, **43 — чистый досев без единой строки кода**. Дыры сидят на стыке «корректный движок ↔ контент/UI-вызов», и **тесты их не ловят**: фикстуры кодируют словарь, которого в проде нет |
| **Контент** (§7.7–7.14) | 44 записи | Заклинания — самая качественная часть (0 расхождений по уровню/школе/времени/дистанции/компонентам на 391); подклассы 48/48 образцовы; **вся деградация — на базовых классах** (94 отсутствующие фичи) и в 163 заклинаниях, не покрытых батчами |
| **Код** (§7.15–7.21) | 68 записей (109 находок → 41 переоткрытие) | 37 из 133 роутов (28%) без потребителей; ~3900 строк мёртвого Go + 426 TS + 33 мёртвых экспорта; **84,3 МБ из 115,7 МБ дерева (73%) — удаляемый мусор**. `tsc` не видит мёртвые экспорты и члены интерфейсов — весь мусор ровно там |

**Топ-10 по влиянию на игрока (см. §7):** KB-001 (КЗ лёгких/средних доспехов), KB-002 (щиты вытесняют доспех), KB-005 (Защита без доспехов), KB-025 (Уклонение), KB-049 (94 фичи классов), KB-050 (Доп. атака), KB-051 (Скрытая атака), KB-069 (42 черты инертны), KB-072 (47 заглушек L0/L1), KB-144 (лист игнорирует `when`).

---

## 7. Реестр находок

Легенда: **kind** — data (правится контентом) / engine / code / infra / content. **effort** — S (<1ч) / M (день) / L (неделя+). **verdict** — CONFIRMED / PLAUSIBLE / ЗАКРЫТО &lt;sha&gt; / ЧАСТИЧНО &lt;sha&gt;. Колонка «трек» — исходный id для сверки с сырыми материалами.

### 7.1 КЗ и доспехи

| id | Находка (файл/сущность · сценарий провала) | sev | effort | kind | verdict | трек |
|---|---|---|---|---|---|---|
| KB-001 | **Ни один лёгкий/средний доспех не даёт ЛВК (0 из 83 карт).** `ac.ts:105-123` даёт ЛВК только по `/dex/i.test(bonus_value)`, в проде у всех 46 — плоское число. Репро: плут ЛВК+5 без доспеха 15 → «Проклёпанный кожаный» `b06d4485` → **12**. Надевание доспеха СНИЖАЕТ КЗ | critical | M | data (+engine-хвост) | ЗАКРЫТО 687b80b | AC-2/A1 |
| KB-002 | **10 из 13 щитов уезжают в слот тела и вытесняют доспех.** `type=null`+`defense_type='light'` → `isShield` false → `isBodyArmor` true (`equipment.ts:29,33`). Репро: Латы `d6c302f9` 18 → надеть «Щит +2» `3fca9bc1` → **11**, `equipError=null`. Ветка `defense_type==='shield'` мертва (0 карт) | critical | S | data | ЗАКРЫТО 3ab1c74 | AC-1/A2 |
| KB-003 | **Кап среднего доспеха `min(dex,2)` не выражен ни на одной из 26 карт.** Замаскирован KB-001; наивный фикс `14 + dex` перевернёт ошибку в перебор (Кираса при ЛВК+5 → 19 вместо 16). **Делать одной правкой с KB-001** | high | S | data | ЗАКРЫТО 687b80b | AC-3 |
| KB-004 | **Кириллическая формула `'12 + ЛВК'` роняет весь лист в белый экран.** Токенизатор ASCII-only (`formula.ts:159`) → `FormulaError` не пойман ни `computeAC`, ни `breakdownAC`; **ErrorBoundary в приложении нет вовсе** → снять предмет через UI невозможно. Карта `3534fc69`. Корень: `ABILITY_LABEL_RU` печатает «ЛВК» и провоцирует ввод её же. Тем же ломаются 7 карт с костью «1к6» в `evaluate()` | critical | S | code+data | ЗАКРЫТО c973630 | AC-4 |
| KB-005 | **«Защита без доспехов» не считается.** Эффекты Варвара `f39414a1` и Монаха `e18cf12b` — только `{kind:'narrative'}`. Движок готов: `acBaseFormulas` собирает каждый `set_value ac_base` как метод-кандидат (доказано 2 работающими сущностями). Репро: Варвар ЛВК+2/ТЕЛ+3 → КЗ **12** вместо 15. Досев: `'10 + dex + con'` / `'10 + dex + wis'` / `'13 + dex'` / `'10 + dex + cha'` | critical | S | data | ЗАКРЫТО 736203d | AC-5 |
| KB-006 | **Помеха на Скрытность и требование Силы у 21 базового доспеха отсутствуют** (`mechanics=null`), при том что 14 магических вариантов того же доспеха их несут; payload готов в `scripts/content/fix-11-items.mjs:25`. Требование Силы **невыразимо**: нет предиката `ability_at_least` и сырых значений характеристик в `FormulaContext` | medium | M | data (+engine) | CONFIRMED | ITM-2/A3 |
| KB-007 | **Хвост KB-005:** `ac.ts:142-147` гейтит безоружные методы только по наличию доспеха — щит не проверяется → RAW-оговорка Монаха «без доспеха **и Щита**» не соблюдётся даже после досева (у Варвара щит по RAW разрешён → гейт данными, не хардкодом) | low | S | engine | CONFIRMED | AC-5 |
| KB-008 | **`22596596` «Кольчужная рубаха» несёт НЕ-RAW механику** (`roll:'speed', value:-5`, +1 атлетика, +1 спас СИЛ) при том, что у 2 других копий механики нет. Вероятно самоделка — проверить до правки | low | S | data | PLAUSIBLE | A3 |

### 7.2 Атака, урон, крит, искусность

| id | Находка | sev | effort | kind | verdict | трек |
|---|---|---|---|---|---|---|
| KB-009 | **БМ прибавляется к любой атаке — владение оружием не проверяется.** Полей владения оружием/доспехом **нет в `CharacterContext` вообще**; `ruleState.proficiencies.weapons` потребляется только списком на листе. Репро: Волшебник 5 с двуручным мечом → «к20: 11 +3 СИЛ +3 БМ». Ветка `spellcasting` корректна | high | M | engine | CONFIRMED | ATK-1 |
| KB-010 | **Штрафа за доспех без владения нет** (RAW: помеха на все СИЛ/ЛВК-тесты + запрет каста); 0 упоминаний `proficien` в `ac.ts` | high | M | engine | CONFIRMED | ATK-2 |
| KB-011 | **Щит даёт КЗ без владения** (`ac.ts:169-172`) | medium | S | engine | CONFIRMED | ATK-3 |
| KB-012 | **Сопротивление и уязвимость не композируются**: `resistanceLevelFor` возвращает ОДИН уровень по максимальному рангу → 28 огня при сопр.+уязв. дают 14 вместо 28, уязвимость молча теряется и не пишется в журнал | medium | M | engine | CONFIRMED | ATK-4 |
| KB-013 | **Снижение урона применяется ПОСЛЕ сопротивления**, RAW требует до. Голиаф с сопр. огню: 28 → движок 4, RAW 9; с уязвимостью движок завышает (46 против 36). **Чинить одной переработкой с KB-012** (adjustments → Resistance → Vulnerability); тесты `goliathLegacy.test.ts` придётся пересчитать — это ожидаемо | medium | S | engine | CONFIRMED | ATK-5 |
| KB-014 | **Vex «Отвлекающее» даёт безлимитное преимущество на ВСЕ атаки по ЛЮБЫМ целям**; `stack_type:'overwrite'` + рекаст → преимущество бессрочно. 19 карт. Репро: после одного попадания атаки №2/№3 по **новым** целям дали `advantage` | high | M | engine | CONFIRMED | ATK-6 |
| KB-015 | **Sap «Ослабляющее» не тратится после одной атаки**; окно `until_start_of_next_turn` тикает в `startTurn` носителя (цели), а RAW считает от хода атакующего | medium | M | engine | CONFIRMED | ATK-7 |
| KB-016 | **Nick и Cleave объявлены `passive` и молча не исполняются** (29 карт). У обоих `mechanics` = только narrative → снятие гейта `mastery.ts:70` ничего не даст. **Разделять:** Cleave — осознанный ручной режим (нет позиций); Nick — живой пробел (Плут теряет Бонусное действие) | medium | M | data+engine | CONFIRMED | ATK-8 |
| KB-017 | **Мистический заряд — один бросок атаки вместо N лучей**; при нат.20 удваиваются все 3d10 (RAW: критует один луч). Тот же дефект у **Палящего луча** — теряется 2/3 базового урона на всех уровнях. Репро: 11 ур. нат.20 → урон 60 (6d10), RAW-максимум 4d10 | high | M | engine | CONFIRMED | ATK-9 |
| KB-018 | **`weapon.ts:330` жёстко зануляет мод характеристики к урону второй руки.** RAW: «не добавляете, **если он положительный**»; боевой стиль «Сражение двумя оружиями» 2024 модификатор **возвращает** → хардкод `0` не даст смоделировать это данными | low | S | engine | PLAUSIBLE | §5.5 |

### 7.3 Состояния

| id | Находка | sev | effort | kind | verdict | трек |
|---|---|---|---|---|---|---|
| KB-019 | **Истощение и Окаменение предлагаются конструктором (`registries.ts:99,105`), но не существуют** ни в движке (13 правил), ни в сиде, ни в проде (13 `COND-*`). `conditionRule()` → null → `[]`, тихий no-op; на русском листе появляется чип с латинской надписью «exhaustion». **Чинятся по-разному:** Окаменение выразимо сегодня; Истощение **невыразимо** (нет уровня в `ConditionModifier`, `overwrite` не даст «уровень 2») → наивный досев создаст ХУДШЕЕ состояние | medium | M | data+engine | CONFIRMED | CND-1/G1 |
| KB-020 | **Схвачен даёт помеху на ВСЕ атаки** (RAW: кроме атак по схватившему); **Испуган — безусловно** (RAW: пока источник в поле зрения). Оговорки записаны в `description` тех же данных. Путь фикса: предикат `target_is_condition_source` — `sourceId` уже работает в `SheetActionsPanel.tsx:234-239` | medium | M | engine | CONFIRMED | CND-2 |
| KB-021 | **«Без сознания» композируется через `paralyzed`**, а RAW — Incapacitated + Prone → предикат «работает по Парализованным» сработает по спящему. **ЛОВУШКА:** `unconscious.modifiers === []` — вся механика приходит транзитивно; замена `includes` **без** выписывания собственных модификаторов **тихо потеряет** ADV_AGAINST/SPEED0/AUTOFAIL/AUTOCRIT. Тест `conditions2024.test.ts:31-33` закрепляет ложное утверждение | medium | S | data | CONFIRMED | CND-3 |
| KB-022 | **Реестры RU-ярлыков разошлись трижды:** `deafened` = «Оглушён» (`registries.ts:98`, мистранслейт) vs «Оглохший» (движок+БД); `prone` = «Распластан» (`registries.ts:107`+`conditions.ts:112`+тест) vs «Опрокинутый» (БД) vs RAW «Сбитый с ног». Следствия в контенте: «Глухота/Слепота» пишет «Оглушённым» вместо «Оглохшим»; «Божественное слово» — «Оглушена» вместо «Ошеломлена» | medium | S | code | CONFIRMED | CND-4/G1 |
| KB-023 | **«Покров теней» кладёт `condition: 'Невидимый'`** — русское ИМЯ вместо ключа `'invisible'` → невидимость не наступает. Один из 3 неразрешимых ключей на 78 condition-payload'ов (2 других безвредны) | medium | S | data | CONFIRMED | G1 |
| KB-024 | **`blocks.ts:630` и `WhenEditor.tsx:38` берут состояния из статического `CONDITIONS` вместо живого `conditionOptions()`** — два источника опций, нарушение парадигмы №1, корень KB-019/KB-022 | low | S | code | CONFIRMED | G1 |

### 7.4 Базовые действия и экономика хода

| id | Находка | sev | effort | kind | verdict | трек |
|---|---|---|---|---|---|---|
| KB-025 | **«Уклонение» не даёт помеху атакам по вам** — мёртвая конвенция `filter:{against:'self'}` вместо `scope:'target'`. Обе карты (`b0085bf7` basic + дубль `070e89cf`). Репро: прод-payload → `advantage:'none'`; тот же + `scope:'target'` → `disadvantage`. **Прикрыто ложно-зелёными тестами** (`weapon.test.ts:47-58`, `runtime.mvp.test.ts:115` сами конструируют несуществующий вход). Правка в 4 местах: 2 карты + `fixtures.ts:65` + 2 теста. Самый дешёвый high трека | high | S | data | ЗАКРЫТО 5d0fa0f | ACT-1/F1 |
| KB-026 | **Захвата не существует вообще**; «Безоружный удар» `442ba733` реализует 1 из 3 опций RAW, хотя его же описание обещает Схватить/Толкнуть. Состояние `grappled` готово и работает. Фикс данными: `{resolution:'save', dc:'8 + str + prof', on_fail:[condition grappled]}`. Зависимый контент мёртв: черта «Борец» `619ea81e` **не имеет поля `mechanics` вовсе** | high | S | data | CONFIRMED | ACT-2 |
| KB-027 | **«Помощь» `2863e54d` существует с рабочей механикой, но `type=null`** → фильтр листа её отбрасывает; grant_action-моста нет. Одно поле = действие на листе | high | S | data | CONFIRMED | ACT-4/F2 |
| KB-028 | **7 действий PHB 2024 отсутствуют**: Влияние, Засада, Изучение, Использование, Магия, Подготовка, Поиск. На листе 4 концепта из 12. Реальный вес: только «Подготовка» (Ready) — несмоделированная механика; остальные — обёртки «сделай проверку навыка» | high | M | data | CONFIRMED | ACT-4/F2 |
| KB-029 | **«Помощь» даёт «Талон к6» вместо преимущества**: поля `grants` нет в схеме `boon`, `applyBoon` читает `p.die ?? 'к6'`. Чип падает на самого помогающего (`who ?? 'self'`), союзник не получает ничего; в журнал уходит ложная инструкция | medium | M | data+engine | CONFIRMED | ACT-5 |
| KB-030 | **«Толкнуть» `92a32f25` смоделировано по RAW 2014** (состязание Атлетики, `bonus_action`) и недостижимо с листа. **НЕ помечать `basic`** — в 2024 Толкание есть опция Безоружного удара, не действие; это легаси-мусор | low | S | data | CONFIRMED | ACT-3/F2 |
| KB-031 | **Дистанции нет в модели боя**: `movement` лог-only, «Отход» = чистый narrative, провоцированных атак нет, помех за стрельбу вплотную/за дальность нет — **хотя `range` в футах у карт есть** (`'150/600'`) и движком не читается | medium | L | engine | CONFIRMED | ACT-6 |
| KB-032 | **9 из 10 боевых стилей — narrative-only** (работает только «Оборона» `284c2459`). **«Сражение вслепую» `927e4cb9` чинится данными прямо сейчас** (`grant_sense` blindsight 10 фт — HANDLED, 8 живых потребителей). «Стрельба»/«Дуэлянт» блокируются багом KB-025 (`execute.ts:967` зовёт collectModifiers без filter). У «Обороны» гейт «пока в доспехе» лежит отдельной narrative-записью без `when` → Воин без доспеха получает +1 КЗ | medium | M | data | CONFIRMED | F3 |
| KB-033 | **Ни один класс не выдаёт Боевой стиль**: строки «Боевой стиль» нет ни в одном классе, `type='Боевой стиль'` нет ни у одного эффекта, 5 стилей — сироты → Воин/Следопыт/Паладин не получают стиль совсем | high | S | data | CONFIRMED | I2 |

### 7.5 Концентрация

| id | Находка | sev | effort | kind | verdict | трек |
|---|---|---|---|---|---|---|
| KB-034 | **Обрыв концентрации не снимает эффекты заклинания, conc-модификаторы вечны.** `dropConcentration` фильтрует только чип; **ни одно из 160 conc-заклинаний не имеет `mechanics.duration`**. Реально «вечных» — 30 (Ускорение, Щит веры, Аура святости…). Репро: 3 цикла каст→обрыв Щита веры → КЗ 17 вместо 11; короткий отдых не чистит; панель состояний их не снимает (фильтрует `kind==='condition'`) | high | M | engine | CONFIRMED | CNC-1 |
| KB-035 | **Недееспособность не прерывает концентрацию по движковому пути.** Данные готовы (`COND-incapacitated` несёт `deny:'concentration'`), докстринг это обещает; ручной путь (`SheetConditionsPanel.tsx:61-72`) работает, `applyCondition` — нет. Фикс: вынести data-driven проверку в `engine/applyCondition` | high | S | engine | CONFIRMED | CNC-2 |
| KB-036 | **`duration.concentration` читается только рендером текста**: концентрацию запускает исключительно UI по колонке `spell.concentration`. Эффект класса/предмета с `concentration:true` в превью пишет «, концентрация», а слот не занимает. В проде 0 таких сущностей — латентная ловушка конструктора | low | M | engine | CONFIRMED | CNC-3 |

### 7.6 Отдых, хиты, смерть

| id | Находка | sev | effort | kind | verdict | трек |
|---|---|---|---|---|---|---|
| KB-037 | **Отдых доступен при 0 HP; `death_saves` не сбрасывается.** `longRest` безусловно ставит `hp.current = hp.max`, гейт кнопок — только `disabled={busy}`; в БД остаётся `{failures:3, dead:true}` при `current_hp=20`. **Мина:** при следующем падении в 0 персонаж умирает с первого урона без единого броска | high | S | code | ЗАКРЫТО 190bbda | RST-2 |
| KB-038 | **`death_saves.dead` ни на что не влияет** — лечение поднимает погибшего; флаг читается только рендером. `applyHealing` (`execute.ts:510-529`) не проверяет `dead` → «Лечение ран» на труп воскрешает | medium | S | code | ЧАСТИЧНО 190bbda (движковый путь — J.3) | RST-3 |
| KB-039 | **Крит по бессознательному даёт 1 провал вместо 2**: `applyDamageAtZero(deathSaves)` — второй аргумент не передан (`SheetHpPanel.tsx:136`), хотя стейт `crit` в том же компоненте. Галочка «крит» кликается и молча не влияет. Расхождение = разница «жив/погиб». Тест `death.test.ts:41` покрывает параметр, которого не подаёт ни один продовый вызов | medium | S | code | ЗАКРЫТО 190bbda | RST-4 |
| KB-040 | **Мгновенной смерти от массивного урона нет** (ни при падении с >0, ни при уроне в нуле). Два разных правила, одним предикатом не чинятся; остаток урона отбрасывается clamp'ом | medium | S | engine | CONFIRMED | RST-5 |
| KB-041 | **Спасбросок смерти не катится автоматически в начале хода при 0 HP** — только вручную по кнопке в другой панели; `startTurn` не читает `hp` вообще | medium | M | engine | CONFIRMED | RST-6 |
| KB-042 | **Спасброски смерти катятся без `rules` и `advantage`** (`SheetHpPanel.tsx:260`) → Везение полурослика не срабатывает, нат.1 даёт сразу 2 провала. Образец починки — `turn.ts:122-142 rollSaveEnds` | medium | S | code | ЗАКРЫТО 190bbda | RST-7 |
| KB-043 | **Стабилизация недоступна**: нет ни «Помощи» на листе, ни проверки Медицины СЛ 10, ни правила «1 HP через 1к4 часа». Выход из правила реализован, входа нет | medium | M | data+engine | CONFIRMED | RST-8 |
| KB-044 | **`firedThisRest` сбрасывается только долгим отдыхом** → авто-триггер с `uses.per:'short_rest'` не перезаряжается коротким. **ЛОВУШКА:** дописать `next.firedThisRest = []` в `shortRest` нельзя — перезарядит 14 живых `long_rest`-триггеров; нужен учёт периода `{id, per}` | medium | M | engine | CONFIRMED | RST-9 |
| KB-045 | **`payload kind:'resource'` не имеет `per`/`recharge`** → любой ресурс, выданный эффектом (7 грантов в проде), восстанавливается только долгим отдыхом | low | M | engine | CONFIRMED | RST-10 |
| KB-046 | **`shortRest` без `resourceRecharge` восстанавливает ВСЕ ячейки** (legacy fail-open). Сегодня недостижимо, но любой новый вызывающий (онлайн-бой, кокпит V2) молча получит полное восстановление ячеек Волшебника | low | S | engine | CONFIRMED | RST-11 |
| KB-047 | **`cost.resource:'hit_die'` легализован схемой, но `canPay` читает `state.resources['hit_die']` = всегда 0** → любая механика со стоимостью «Кость хитов» навсегда недоступна, тихо. Инертны: черта «Стойкий», «Лекарь», `ACT-feat-healer-medic`, «Мистическая бодрость» `4f5e54c7`. **NB:** сами кости хитов — зафиксированное решение владельца (см. §8.4), эта находка — только про мёртвую стоимость | low | S | engine | CONFIRMED | §5.1 |
| KB-048 | **`resolveDuration` (`execute.ts:215-227`) обрабатывает 3 типа из 10** → 6 зелий с `hours` висят до долгого отдыха вместо 1 часа, «Внушение» (8 ч) не истекает. **ОПАСНО:** фильтровать `turn.ts:220` по `duration.type` **до** введения честной модели длительностей — сплошной wipe сейчас единственный путь истечения для `hours`/`manual` | low | M | engine | CONFIRMED | §5.4 |

### 7.7 Классы: прогрессия, ресурсы, фичи

| id | Находка | sev | effort | kind | verdict | трек |
|---|---|---|---|---|---|---|
| KB-049 | **Ни один базовый класс не выдаёт именных фич выше L2 — 94 отсутствующие фичи.** Диф: Монах 14, Варвар 12, Плут 11, Паладин 9, Следопыт 9, Воин 8, Колдун 7, Бард 6, Жрец 5, Друид 5, Чародей 4, Волшебник 4. Жрец L7 резолвится в «Заклинания (жрец)». Сущностей «Испепеление нежити», «Жестокий удар», «Аура защиты» **не существует вовсе**. **Считать по именам фич, а не по наличию грантов** — у 8 кастеров LP формально заполнен на 20 уровнях (только «Заклинания» + слоты черт) | critical | L | data | CONFIRMED | CLS-1/B1 |
| KB-050 | **Дополнительная атака не выдаётся ни одним из 5 воинских классов, и примитива в движке нет.** Единственный эффект `273b0d7a` — narrative, привязан только к Коллегии доблести L6 (RAW-корректно). У Воина в LP нет уровней 5/11/20. `grep extra_attack|attacksPerAction|multiattack` = 0. **Привязка эффекта не добавит ни очка урона** — экономика действий энфорсится через `canPay`. Урон занижен ~вдвое с L5, ~втрое у Воина с L11 | critical | L | engine (+data) | CONFIRMED | CLS-2/B2 |
| KB-051 | **Скрытая атака Плута — narrative + `mode:'passive'`** → `dispatch.ts:48` отсекает до проверки `trigger.event`; и нет payload урона. Плут 20 не получает ни одной доп. кости. Нужная форма используется 12 боевыми эффектами прода; фикстура `phaseA.dispatch.test.ts:33-45` буквально названа «sneak». Досев: 10 эффектов 1d6…10d6 | critical | M | data | CONFIRMED | CLS-3 |
| KB-052 | **Ярость: сопротивление дроб./кол./руб. и преимущество на СИЛ — только текст.** Исполним лишь бонус урона. `kind:'resistance'` — HANDLED, используется 26 эффектами | high | S | data | CONFIRMED | CLS-4 |
| KB-053 | **Заряды Ярости зафиксированы на 2 для всех 20 уровней** (RAW 2/3/4/5/6). Соседние ресурсы того же файла уже используют `by_level`. **Второй хардкод той же двойки — `mechanics.uses` действия `ACT-rage`**: правка только `classes.json` молча не сработает. Реестр канона уже знает: `officials/canon/phb2024/class-barbarian.json:35` печатает «БАГ» | high | S | data | CONFIRMED | CLS-5/B6 |
| KB-054 | **Вдохновение барда считается от `prof_bonus` вместо мод. Харизмы.** Знак ошибки переворачивается: L1 ХАР+3 → 2 вместо 3; L17-20 завышение. Правка `count:'max(cha,1)'` **синхронно в 2 местах** (`classes.json` + `mechanics.uses` действия `507a13bf`) | high | S | data | CONFIRMED | CLS-6/B5 |
| KB-055 | **Четыре фичи стоят не на своём уровне**: Первобытные знания L1→L3, Фокус монаха L1→L2, Ловкий исследователь L1→L2, Мистические воззвания L2→L1 | high | S | data | CONFIRMED | CLS-7 |
| KB-056 | **Колдун собран по layout 2014**: «Дар договора» `cc2aa0c1` (в 2024 упразднён — пакты стали воззваниями), воззвания на L2 с `count:2` (RAW: L1=1, L2=3), **«Магическая изворотливость» (L2) отсутствует полностью**. Пул воззваний — 3 эффекта на выбор из 2 (RAW ~23) | high | M | data | CONFIRMED | CLS-8/B3 |
| KB-057 | **`mechanics.uses` не поддерживает `by_level`** → Второе дыхание навсегда 2/короткий отдых (RAW 2/3/4), Всплеск действий 1 (RAW 2 с L17). **МИНА:** `usesFromMechanics` с `by_level` вернёт `null` → пул исчезнет, действие станет безлимитным. Обход: перенести в `class.resources` | medium | M | engine | CONFIRMED | CLS-9/B7 |
| KB-058 | **Второе дыхание полностью доливается на коротком отдыхе** (RAW: одно использование). Частичная перезарядка невыразима моделью `per` → нужен `uses.recharge_amount`. **Но:** «вернуть N» слушателем `short_rest` работает уже сегодня (см. §8.4) — Ярость/Дикая форма чинятся данными | medium | M | data+engine | CONFIRMED | CLS-10/B7 |
| KB-059 | **`wild_shape` = 2 на всех уровнях** (RAW 2/3/4; 16 из 20 уровней неверны); **`focus`/`sorcery_points` = `self_level` без гейта** → на L1 дают фантомное очко, хотя обе фичи начинаются с L2. Смягчение: `focus` сейчас полностью инертен (0 потребителей, техник монаха не существует) → чинить **до** заведения техник | medium | S | data | CONFIRMED | CLS-11/B6/B9 |
| KB-060 | **7 из 48 подклассов не имеют НИ ОДНОЙ машинной фичи** (Путь Мирового Древа, Путь фанатика, Повелитель зверей, Охотник, Вор, Прорицатель, Воплотитель). Из 241 гранта: 102 машинных / 132 narrative / 7 без `mechanics` | medium | L | data | CONFIRMED | CLS-12 |
| KB-061 | **Искусность Варвара упирается в 3 вида вместо 4** (нет гранта L10; у Воина все 4 ступени на месте) | medium | S | data | CONFIRMED | CLS-13 |
| KB-062 | **Паладин: нет «Проведения божественности» L3; ресурс `channel_divinity` не определён НИ У ОДНОГО класса** — при этом его `spend` дёргают **10 эффектов** (4 Клятвы L3 + 5 жреческих) → опции тратят несуществующий пул. Плюс «Божественное чувство» `73311806` стоит на L1 вместо L3-опции; `ACT-lay-on-hands` даёт `healing:'5'` фиксом вместо запаса 5×уровень | high | M | data | CONFIRMED | CLS-13/B4 |
| KB-063 | **Варвар: «Первобытные знания» — три дефекта в одном эффекте** `2d518b3d`: уровень L1 вместо L3 (ключа '3' в LP нет вовсе); `options.items=["Природа","Проницательность"]` вместо списка Варвара (**«Проницательность» невалидна**); вторая половина RAW (проверки как СИЛ в Ярости) не смоделирована | high | S | data | CONFIRMED | B8 |
| KB-064 | **Монах: фичи L2 названы термином Варвара.** «Быстрое передвижение» = Варвар L5; «Необычный метаболизм» в PHB не встречается вовсе (RAW: Монашеская сосредоточенность / Движение без доспехов / Феноменальный метаболизм) | medium | S | data | CONFIRMED | B9 |
| KB-065 | **Три RAW-фичи L1 отсутствуют**: «Знаток ритуалов» (Волшебник — **единственный настоящий needs_engine**, `grep ritual` по engine/ = 0), «Воровской жаргон» (Плут — упирается в отсутствие системы языков), «Друидический язык» (Друид — **чинится данными**: RAW даёт всегда подготовленное «Разговор с животными» через `grant_spell`) | medium | S | data (1 из 3 — engine) | CONFIRMED | B10 |
| KB-066 | **~13 названий фич классов расходятся с официальной RU-локализацией**: Использование→Сотворение заклинаний (40 вхожд.), Канал→Проведение божественности, Экспертиза→Экспертность, Скрытая→Коварная атака, Мистические→Таинственные воззвания, Дикая форма→Дикий облик, Прикосновение целителя→Возложение рук. **2 из 13 — в `actions.json`** (фикс по effects.json их пропустит). **Ловушка:** `EFFECT-0149` «Прикосновение целителя» — умение монаха, названо ПРАВИЛЬНО; переименовывать надо `8c248007`. Слоя локализации нет — расхождение доходит до пользователя (`execute.ts:786` внутри использует правильный термин) | medium | S | content | CONFIRMED | B11 |
| KB-067 | **Описания всех 12 базовых классов — однострочные заглушки (20–46 симв.)** против медианы 295 у подклассов; `detailed_description` пуст у **всех 60**. Спорно, куда писать (решить владельцу): де-факто основной текст живёт в `description` | medium | M | content | CONFIRMED | B12 |
| KB-068 | **46 из 319 привязанных к классам фич имеют описание <60 символов** (42 — на базовых классах, минимум 10 симв.). Частичная компенсация: `EffectPreview.tsx:114` показывает авто-описание механики при `!playerMode`, у 30 из 46 есть narrative. **Но для choice-механик компенсации нет** — `interactionPhrase` не имеет ветки `choice` → summary пуст. Реально «голых» — 16 | medium | M | content | CONFIRMED | B13 |

### 7.8 Черты

| id | Находка | sev | effort | kind | verdict | трек |
|---|---|---|---|---|---|---|
| KB-069 | **54 из 77 черт механически инертны** (general 42/43, epic_boon 12/12; origin 12/12 и fighting_style 10/10 целы). `related_effects`/`related_actions` = null — единственный канал. **ХУЖЕ, ЧЕМ ЧИСЛИЛОСЬ:** `ability_increase` **не применяется вообще** (`assemble.ts:113` «информативно (не применяется автоматически в MVP)») → «Меткий стрелок» не даёт даже +1 ЛВК, а `FeatPreview.tsx:19` рендерит «Сила +1» как обещание. Старое ревью описывало дефект неверно. Досев: `choice+grant_ability_score`, **не** оживлять `ability_increase` | high | L | data | CONFIRMED | FEAT-1/I1 |
| KB-070 | **Эпический дар физически невозможно взять**: грант L19 `f5694b06` предлагает `categories:['origin','general']`, `epic_boon` в списке нет; фильтр жёсткий, обходного пути нет. Проводка есть (`FEAT_FILTER_CATEGORY` содержит `epic_boon`), но читается только в неиспользуемой ветке | medium | S | data | CONFIRMED | FEAT-2 |
| KB-071 | **Предпосылки черт не проверяются ничем**: `f.prerequisite` — свободный текст (`*string` в БД), не читается нигде. Починка — структурированный предикат + `unavailableOptions` (UI уже умеет `disabled`+`disabledReason`). Побочно: `SheetChoicesPanel`/`ChoiceDialogContext` не передают `unavailableOptions` и не дедуплят | medium | M | data+engine | CONFIRMED | FEAT-3 |

### 7.9 Заклинания

| id | Находка | sev | effort | kind | verdict | трек |
|---|---|---|---|---|---|---|
| KB-072 | **47 заклинаний — литеральные заглушки «`<Имя>`: см. описание заклинания», и ВСЕ на L0/L1** (17/35 заговоров, 30/64 первого круга, L2+ — ни одной) — ровно то, что кастует аудитория 1-4 ур. Из них ~20 механически сломаны: Благословение, Метка охотника, Порча, Наставление, **Чародейский выброс — заговор урона, наносящий ноль**. ~27 — утилитарные, для которых narrative корректен; их дефект — бессодержательная заглушка вместо резюме | critical | L | data | CONFIRMED | SPL-1 |
| KB-073 | **177 из 393 (45%) заклинаний исполняемы; 205 (52%) narrative-only.** Метрика `with_mechanics` рапортует 393/393 — **ложно-зелёная**. Худшие школы: прорицание 1/33 (3%), преобразование 17/66, иллюзия 10/29. Действие: метрика `machine_mechanics` в `export-prod.mjs` + детектор `/см\. описание заклинания/` | medium | L | data | CONFIRMED | SPL-2 |
| KB-074 | **Заклинание «Щит» `d87f4507` — единственное из 393, не проходящее `validateMechanics`**: `trigger.event:'hit_by_attack'` отсутствует в enum схемы. Владелец не может пересохранить его в конструкторе; работает только в онлайн-бою через `own.pendingAttacks` | medium | S | engine | CONFIRMED | SPL-3 |
| KB-075 | **`grant_speed`/`grant_sense`/`grant_proficiency` при касте печатают `NOT_IMPLEMENTED payload: …` в игровой журнал.** 4 заклинания жгут ячейку и дают ноль (Паучье лазание, Тёмное зрение, Смена обличья, Охраняющая связь). Плюс `value:'equal to walking speed'` → `NaN` даже на build-пути. **NB:** `grant_proficiency{prof:'saving_throw', value:'all'}` у Охраняющей связи — сама по себе неверная модель; реализация payload'а дала бы результат **хуже** бага | high | M | engine | CONFIRMED | SPL-4 |
| KB-076 | **«Глухота/Слепота» `15901a86` накладывает `blinded` И `stunned`** вместо RAW-выбора «Ослеплённый ИЛИ Оглохший» → заклинание 2 круга даёт полный локдаун на 10 раундов. Корень — мистранслейт RU-локализации PHB («Оглушённым»), смапленный в `stunned`. Связано с KB-022 | high | S | data | CONFIRMED | SPL-5 |
| KB-077 | **«Ускорение» `1661dfe1` даёт преимущество на ВСЕ спасброски** вместо только Ловкости; соседний narrative того же заклинания это признаёт. **Самоусиливающийся** — даёт преимущество и на ТЕЛ-спас концентрации, удерживающий само Ускорение. Фикс: `+ filter:{ability:'dex'}` | high | S | data | CONFIRMED | SPL-6 |
| KB-078 | **«Паутина» `0446564e` наносит 2к4 огня каждому провалившему и масштабирует апкастом** — по RAW урона нет вовсе и апкаста у Web нет. Плюс `restrained` без `duration` → вечное состояние. Собственное описание карточки описывает правило **верно** | high | S | data | CONFIRMED | SPL-7 |
| KB-079 | **Благословение/Порча/Наставление/Сопротивление — narrative-only**, хотя `modifier op:'add' value:'1d4'` полностью выразим и даёт свежий бросок к4 на каждый бросок | high | M | data | CONFIRMED | SPL-8 |
| KB-080 | **`save_ends` реализован, но применён к 2 заклинаниям из 393.** 8 заклинаний имеют narrative, прямо требующий повторного спаса, в т.ч. **само Удержание личности**. Шире: 33 из 66 condition-payload'ов без `duration` → состояние вечное. Репро: прод-payload → 0 спасбросков на `endTurn`; тот же + `save_ends` → движок катит и снимает | high | M | data | CONFIRMED | SPL-9 |
| KB-081 | **79 заклинаний имеют текст апкаста и НОЛЬ машинного `scaling`** (`upcast_description` 155, `scaling` 78). Реально числовых из них ~8-10 | medium | M | data | CONFIRMED | SPL-10 |
| KB-082 | **«Огненный снаряд» `50626b5a` растёт костью 1d6 вместо RAW 1d10** — единственное расхождение среди 16 масштабируемых заговоров. На L17: 16.0 против 22.0 (−27%) на самом частом заговоре игры. Битые оба поля | medium | S | data | CONFIRMED | SPL-11 |
| KB-083 | **Ритуальный каст не реализован**: `ritual=true` у 31 заклинания, флаг читается только витриной; у всех 31 в `activation.cost` есть `spell_slot` без альтернативы. Черта «Ритуальный заклинатель» инертна | medium | M | engine | CONFIRMED | SPL-12 |
| KB-084 | **12 заклинаний показывают кости урона из колонки `damage`, но не имеют damage-payload** (Огненный щит, Запрет, Гейс, Радужная стена…) — `SpellPreview.tsx:62-64` делает fallback на колонку → карточка обещает механику, которой нет | medium | M | data | CONFIRMED | SPL-13 |
| KB-085 | **«Дыхание дракона» `88e84740`: весь спасбросок и урон спрятаны в `mechanics.targeting.saving_throw`** — поле, которого движок не читает. Жжёт бонусное действие + ячейку 2 круга ради строки текста. `targeting.area` тоже невалидна по схеме (`shape` вместо `kind`) | medium | S | data | CONFIRMED | SPL-14 |
| KB-086 | **SPELL-0483 «Воплощение силы» — черновой хоумбрю в живом проде**, выдаётся волшебникам как штатный контент. `dc:'10 + G'` → **`throw FormulaError`** на шаге спасброска; `Gк10` в теге урона; латинская `C` в «Сл»; термин 2014 «устойчивость» (единственный во всём наборе); `advantage`+`reroll` безусловно вместо «2 из 4». Плюс SPELL-0482 — вторая самоделка с `source=null`. Оба считаются в 393 → сверка покрытия PHB врёт на 2 | medium | S | data | CONFIRMED | SPL-15/D6 |
| KB-087 | **18 заклинаний несут фиктивный `mechanics.uses`** («1 раз в долгий отдых» поверх стоимости в ячейку; 17 из них L2). Движок `uses` у заклинаний не применяет, но блочный конструктор их читает и **консервирует** при round-trip. Мина: доведут `uses` до заклинаний — 18 заклинаний PHB станут «раз в день» | low | S | data | CONFIRMED | SPL-16 |
| KB-088 | **КОРЕНЬ R1: импортёр не склеивал перенос строки «Компоненты: … (…».** Батчи `spells2024-batch-1..13` покрыли **230 из 393**; дефектов среди покрытых — **0**, среди 163 непокрытых — **все 13**. ⚠ `apply-spells-2024.mjs` — **create-only** (`fresh = records.filter(r => !existingNames.has(...))`), повторный прогон = полный no-op. Нужны (1) батчи 14..N на 163 и (2) ветка UPDATE + guard в генераторе | — | L | infra | CONFIRMED | D0 |
| KB-089 | **[след. KB-088] 11 заклинаний: описание начинается с мусорного хвоста материала + утёкшего «Длительность:»** — «Свет» буквально с «мох) Длительность: 1 час…», «Опознание» с «100 ЗМ) Длительность:…». Видно на /spell/:id, в ховер-превью, в кузне, в библиотеке (рендер не санирует) | medium | M | data | CONFIRMED | D1 |
| KB-090 | **[след. KB-088] 13 заклинаний: `component_material=true` при `material_text=null`** → печатается голое «М». Полностью и молча потеряна стоимость только у 2 (Благословение 5 ЗМ, Волшебные уста 10 ЗМ); у остальных 11 цифра торчит в мусорном хвосте. Контроль: 201 из 214 заполнены, стоимость потеряна в 0 случаях | medium | S | data | CONFIRMED | D2 |
| KB-091 | **[след. KB-088] 6 заклинаний: `duration=null`** → строка исчезает из стат-блока (`SpellPage.tsx:118`) и из ховер-превью (`SpellPreview.tsx:73`). Информация отсутствует полностью у 2 из 393 | medium | S | data | CONFIRMED | D3 |
| KB-092 | **[след. KB-088, ЕДИНСТВЕННОЕ механическое] «Вызов Зверя» SPELL-0178: `concentration=false`** — единственное расхождение на 393. Следствия: нет вытеснения предыдущей концентрации, нет спаса ТЕЛ при уроне, нет запрета для Недееспособного, нет строки на вики, не находится фильтром библиотеки. Улика: коммит `7c6acf0` вылечил этот класс бага у 2 соседей, а «Вызов Зверя» пропустил | high | S | data | CONFIRMED | D4 |
| KB-093 | **7 заклинаний: в текст вклеена подпись к иллюстрации PHB**; у 2 подпись разрывает предложение («Ша»+подпись+«рик» у Цветного шарика). У «Щита» — подпись к **ЧУЖОМУ** заклинанию (Чёрные щупальца Эварда) → прямая дезинформация. **Реальное число может быть выше 7** — оба детектора слепы к врезкам в середину | medium | M | data | CONFIRMED | D5 |
| KB-094 | **`wish`: реальная потеря правил в «Полном описании»** (нет «за каждый день отдыха срок сокращается на 2 дня»); частично `symbol` (потерян квант 30 футов). **Не сверялись пословно:** teleport, glyph_of_warding, magic_jar, guards_and_wards, bigbys_hand, earthquake, hallow — только ручной сверкой, **не автометрикой** | low | S | content | CONFIRMED | D7 |
| KB-095 | **У ~11 заклинаний с AoE поле `area` пусто, при том что у 5 форма УЖЕ лежит в `mechanics.targeting.area`** и молча отбрасывается (`parseMechanicsStats` никогда не трогает targeting). Чинится фолбэком `area ← mechanics.targeting.area` (парадигма №1). **Не нарушение RAW** — `area` проектное поле | low | S | data+engine | CONFIRMED | D8 |
| KB-096 | **Морденкайнен: единственное расхождение классов-носителей на 391 заклинание — и ошибка живёт в батч-данных** (`spells2024-batch-1.json:331`) → правка только в проде будет откачена повторным досевом | low | S | data | CONFIRMED | D9 |

### 7.10 Предметы, оружие, снаряжение

| id | Находка | sev | effort | kind | verdict | трек |
|---|---|---|---|---|---|---|
| KB-097 | **`isTwoHanded` ищет `'two_handed'`, в данных `'two-handed'`** — 42 vs 0 карт; ветка мертва, вся защита на `slot==='two_hands'` (40 из 42). Жертва: **Мушкет** (`slot='versatile'`) → щит + двуручный мушкет. Вторая аномалия: «Длинный лук» `8f69b8b7` (`type=null,slot=null`) вообще не экипируется | medium | S | code+data | CONFIRMED | ITM-1 |
| KB-098 | **Требование Силы тяжёлого доспеха (−10 фт) не выражено ничем.** **Невыразимо данными**: нет предиката порога характеристики, и `FormulaContext` отдаёт только `abilityMods`, а не сырые значения (Сил 12 и 13 дают один +1) | medium | M | engine | CONFIRMED | ITM-3 |
| KB-099 | **Свойство «Тяжёлое» не читается движком** (33 карты). RAW 2024: помеха при Сил<13 рукопашным / Лвк<13 дальнобойным. Требует тех же сырых значений, что KB-098. ⚠ Правило «помеха Маленьким» — редакция **2014**, из 2024 удалено | medium | M | engine | CONFIRMED | ITM-4 |
| KB-100 | **Боеприпасы не тратятся ни одним оружием**: `mechanics.ammo` — **0 карт из 766** при 21 со свойством `ammunition`; фолбэка на свойство нет. Вся подсистема S5 (`weaponAmmoCost` + `cost{resource:'item'}`, покрытая 2 тестами) имеет 0 потребителей — лучник стреляет бесконечно. Фикс данными: `mechanics.ammo={card_id,name}` 21 оружию. **Ложный след:** «type=null мешает экипировать» неверно — боеприпас экипировать и не предполагается | medium | M | data | CONFIRMED | ITM-5/E3 |
| KB-101 | **8 карт с `versatile` не объявляют вторую кость** → двуручный хват мёртв (`weapon.ts:41-47` берёт кость только из скобочной записи). Магические молоты болезненнее всего: игрок платит за +1/+2 и теряет 1к10. Конвенция в данных плавает: `«1d8 (1d10)»` / `«1d8/1d10»` / `«1d8»` | medium | S | data | CONFIRMED | ITM-6/E2 |
| KB-102 | **«Моргенштерн» — единственное оружие PHB 2024, отсутствующее в базе**, при этом опция **жива в пикере искусности** (`registries.ts:12` из `weapon_types.json`) → игрок может потратить слот на мёртвый вариант | medium | S | data | CONFIRMED | ITM-7/E1 |
| KB-103 | **Системные RAW-ошибки статов оружия (сломаны И шаблон, И копия):** Клевец без `versatile (1к10)`; **Трезубец 1к6 вместо 1к8** (обе копии); Кавалерийское копьё 1к12 вместо 1к10 и без Тяжёлое/Двуручное; **Метательное копьё типизировано как `spear`** → искусность Ослабляющее вместо Замедляющее (при том что магические варианты типизированы **правильно** как javelin). Имя «Боевая кирка» — локализация 2014, живёт в `frontend/utils/weapon_types.json` | medium | M | data | CONFIRMED | E1 |
| KB-104 | **Одиночные битые копии при корректном шаблоне:** `e68a30ff` «Длинный меч» '1d8'; `2481665f` «Дубинка» mastery=null; `1edcfd1c` «Гоблинский короткий лук» без 'two-handed'; `c884b31f` «Длинное копьё» weapon_type='spear' + '1d12' | low | S | data | CONFIRMED | E1/ITM-8 |
| KB-105 | **Мелочи данных оружия**: 6 видов с валютой gold вместо silver/copper (**Дротик дороже канона в 100×**, Боевой посох/Дубинка/Метательное копьё/Палица/Праща — в 10×); Боевой молот 2 вместо 5 фнт, Дротик 0.2 вместо 0.25 | low | S | data | CONFIRMED | ITM-8 |
| KB-106 | **213 из 766 карт дают «Неизвестный тип предмета», из них реально сломаны ~5** (Кольцо/Ожерелье ускользания, Гоблинский кнут, Шахтерская кирка, Ломик). Остальные ~148 — «Зелье»/«Безделушка»/«Лютня», слота им не нужно. **Кнопка «Надеть» не гейтится**: `planEquip().error` не используется для disable (нарушение парадигмы №2). Побочно: `type='зелье'` (20 карт — русское значение вне union `ItemType`); `6289313d` «Меч пламени» — единственная карта с русскими properties `["Фехтовальное","Универсальное"]` → `weapon.ts:31` их не увидит | medium | M | data+code | CONFIRMED | E4 |
| KB-107 | **Начальное снаряжение 5 классов ссылается на 3 несуществующие карты (8 вхождений).** У Воина битых 3 из 5 позиций. Тихий провал: `runtimePatch.inventory_items` пишется без валидации, JSONB без FK, `getCard(id).catch(()=>null)` + `.filter` → карта молча выпадает. Вероятная причина — «дедуп 125 карт». **Смежно:** списки усечены (у Жреца 4 позиции вместо 5, у Следопыта 5 вместо 8) | high | M | data | CONFIRMED | E5 |
| KB-108 | **22 из 39 карт базовых доспехов расходятся с RAW по цене/КЗ** (Кираса 500/500/400 при RAW 400; Полулаты 1000/750/1500 при 750; Проклёпанный 60/82/94/45 при 45). Цена не косметика — `ShopDetail.tsx:124-127` гейтит покупку. **Оспорено:** заголовок «125 лишних дублей» завышен — «копии» Кирасы могут быть разными зачарованными предметами; truly identical — **1 пара «Коротких мечей»**. Решить владельцу: зачарованные варианты — дизайн или мусор | medium | L | data | PLAUSIBLE | E6 |

### 7.11 Создание персонажа

| id | Находка | sev | effort | kind | verdict | трек |
|---|---|---|---|---|---|---|
| KB-109 | **Ни один персонаж не получает НИ ОДНОГО языка, включая Общий.** `grant_language` + `source:'language'` = **0 вхождений во всех 6 файлах**; у Предыстории **нет канала механики вовсе** (`assemble.ts:205-223` читает только `skill_proficiencies`/`tool_proficiency`/`origin_feat`). Машинерия готова и простаивает (реестр 12 языков, блок конструктора, зелёный тест). Смежно: «Ловкий исследователь» с `grant:{prof:'language'}` но `options.source:'skill'` → пикер предлагает **навыки**, грант пишет их в карту языков | medium | M | engine | CONFIRMED | CRT-1 |
| KB-110 | **Инструмент предыстории «Выберите один вид…» попадает в лист дословно как название владения** (5 из 16) и **персистится в БД**; выбор не предлагается нигде | medium | M | data+engine | CONFIRMED | CRT-2 |
| KB-111 | **Ни один из 12 классов не даёт владение инструментами** (`tool_proficiencies=null` у всех 60). RAW требует у 4 (Бард, Друид, Монах, Плут); у остальных 8 `null` корректен | medium | M | data | CONFIRMED | CRT-3 |
| KB-112 | **Бонусы характеристик предыстории (+2/+1) можно молча пропустить**: `bonusIssues` на пустом распределении возвращает `[]`. Один клик по «+1/+1/+1» или по чипам обнуляет `assignments` → «Создать» активна, персонаж на −3 | medium | S | code | CONFIRMED | CRT-4 |
| KB-113 | **Смена предыстории не переприменяет бонусы**: Солдат (str+2/dex+1) → Мудрец (con/int/wis) оставляет str/dex, обе вне списка Мудреца. Достигается обычной сменой предыстории. **Чинить одной точкой с KB-112** | medium | S | code | CONFIRMED | CRT-5 |
| KB-114 | **Максимум хитов может стать отрицательным** — нет RAW-клампа «минимум 1 за уровень». d6/ТЕЛ 1/L5 → **−3**, персонаж создаётся мёртвым, бэкенд не валидирует. Фикс: `l1 + (lvl-1)*Math.max(1, perLevelAvg + conMod)` | low | S | code | CONFIRMED | CRT-6 |
| KB-115 | **Размер существа не выбирается**: «Средний или Маленький» молча резолвится в Средний (`sizeToNumber` проверяет `'средн'` раньше). Механических последствий сегодня нет | low | M | data | CONFIRMED | CRT-7 |
| KB-116 | **Мелочи создания**: владения оружием Монаха и Плута шире RAW (`['simple','martial']`, корень `seed-class-training.mjs:23`); бэкенд `characters-v3` **не валидирует `level`** (легаси V2 имел min=1/max=20) → `level:999` → БМ 251; бросок хитов при левелапе не предусмотрен | low | S | data+code | CONFIRMED | CRT-8 |

### 7.12 Виды

| id | Находка | sev | effort | kind | verdict | трек |
|---|---|---|---|---|---|---|
| KB-117 | **Человек получает эльфийскую черту «Острые чувства»** (`1ef48eda`, `choice.id='elf_skill'`) → **два визуально идентичных блока «Выберите навык · Человек»**. Единственный из 39 видов, у кого `related_effects` больше, чем `traits`. Правка — в данных прода, сид-файла с этой связью в репо нет | medium | S | data | CONFIRMED | C1 |
| KB-118 | **Эльф не получает «Транс»** — эффект `39d35d6b` существует, но осиротел (встречается ровно 1 раз — своё определение); у Эльфа 4 черты из 5. **Текст эффекта — редакция 2014**, привязывать как есть нельзя. Механического провала нет (движок сон не моделирует); канонический образец — narrative у Кованого | low | S | data+content | CONFIRMED | C2 |
| KB-119 | **`lineages[]` рассинхронизирован у 7 из 12 видов**: Дворф/Полурослик несут подвиды 2014 (в 2024 их нет), Человек — Variant Human 2014, **Драконорождённый пуст при 10 подвидах**, у Тифлинга/Аасимара/Голиафа расходятся имена. **Корень — хардкод `STATIC_LINEAGES`** в `scripts/content/batches/g5-races-lineages.mjs:31-90` → правка данных без правки сидера регрессирует. Механика не страдает (`resolveLineageName` ищет по UUID подвида). Фикс по парадигме №1: генерировать из `is_subrace` | medium | M | data | CONFIRMED | C3 |
| KB-120 | **9 из 22 `lineages[].description` содержат служебное имя payload-примитива** («Дроу. grant_sense», «Тифлинг Бездны. resistance»). **Видно прямо сейчас**: `RaceDetailModal.tsx:63` рендерит дословно. **Самовоспроизводится**: `cleanTraits` пропускает и повторно персистит при любом сохранении вида | medium | S | content | CONFIRMED | C4 |

### 7.13 Ссылки, глоссарий, понятия

| id | Находка | sev | effort | kind | verdict | трек |
|---|---|---|---|---|---|---|
| KB-121 | **Парсер понимает 5 типов ссылок из 7**: `LINK_RE` (`formattedText.tsx:61`) не знает `resource`/`variable`, хотя резолвер, `FETCHERS`, `EntityRefPreview`, `EntityDetailProvider` и `DELETERS` их содержат. Коммит `9c0cec2` утверждал обратное: три регистрации — исчерпывающие `Record<EntityRefType,…>` (TS их потребовал), парсер — единственное неисчерпываемое место. Тест `formattedText.test.ts:48` закрепляет разрыв. **Текущий ущерб 0** (ссылок в проде нет). **Делать вместе с KB-122** | low | S | code | CONFIRMED | H1 |
| KB-122 | **`FormattedTextarea` объявляет метки для 7 типов, но ищет по 5** → вставить ссылку на ресурс/переменную из UI невозможно. `resourcesApi`/`variablesApi` существуют (фикс по образцу `conceptsApi`) | low | S | code | CONFIRMED | H2 |
| KB-123 | **`ResourceCreator`/`VariableCreator` — единственные 2 из 11 конструкторов с голой textarea**, при том что их превью рендерят описание через `FormattedText` | low | S | code | CONFIRMED | H3 |
| KB-124 | **`detailed_description` у черт и предысторий редактируется голой textarea**, хотя `description` строкой выше идёт через FormattedTextarea. Поле пусто у 77/77 и 16/16 — прямой выгоды нет, снимает ловушку. **Опровергнуто в обосновании:** «отсюда 0 ссылок» — ложная причинность | low | S | code | CONFIRMED | H4 |
| KB-125 | **219 голых упоминаний «Преимущество»/«Помеха» против 1 ссылки.** Механизм не спит (190 ссылок в снапшоте), состояния линкуются массово — понятия почти никогда. **Риск омонимов близок к нулю** → один из немногих безопасных кандидатов на автозамену | low | S | data | CONFIRMED | H5 |
| KB-126 | **Ссылки на состояния проставлены только в заклинаниях**: spells 91% (111/122), effects **2%** (1/49), feats **0%** (0/9). Из 7 cond-ссылок в effects.json шесть — внутри самих состояний. Пробелов: 48 пар в effects, 9 в feats. Безопасный старт — 47 упоминаний рядом со словом «состояни»/«Иммунитет» | medium | M | data | CONFIRMED | H6 |
| KB-127 | **Ссылка проставлена только на первое упоминание**: 30 заклинаний содержат и ссылку, и голые повторы того же состояния (36 пар, 44 вхождения). **Не политика** — «Дружба» линкует один uuid дважды. Самый безопасный класс автозамены (UUID уже подтверждён автором). ⚠ Исключить ложные: «Знак» (заголовок опции), «Вызов Нежити» (перечень иммунитетов), «Вызов Небожителя» (школа магии) | low | S | data | CONFIRMED | H7 |
| KB-128 | **17 эффектов «Заклинания <домена/патрона>» перечисляют имена голым текстом** — 0 ссылок (из 25 восемь имён не перечисляют вовсе). Структурный контекст → хороший кандидат для скрипта. **ОТДЕЛЬНАЯ И БОЛЕЕ ВЕСОМАЯ:** у Домена обмана/войны/жизни/света и Круга земли **уровни 5/7/9 остались `kind:'narrative'` — заклинания не выдаются механически** | medium | M | data | CONFIRMED | H8 |
| KB-129 | **Словарный автолинковщик по именам заклинаний ОПАСЕН — 106 из 427 упоминаний топ-имён являются омонимами** (Сопротивление 72/72, Изготовление 15/15, Тёмное зрение 12/12, Сотворение 7/7). Автолинковщика в коде НЕТ — это **превентивное ограничение**. Допустим только с белым списком контекстов (KB-127, KB-125, KB-128, состояния рядом с «состояни») | low | L | data | CONFIRMED | H9 |
| KB-130 | **Линтера текстовых ссылок не существует**; 190 ссылок → 25 целей, 176 на 13 UUID состояний. `scripts/audit-refs.mjs` существует, но `collectRefs` парсит только `grant_spell`/`type:'feat'`. **Нет гейта на удалении**: `DeleteEffect` — голый `db.Delete` без проверки входящих; обратного индекса нет. **СЦЕНАРИЙ УЖЕ РЕАЛИЗОВАЛСЯ**: `9078764` — чистка приняла эффекты слотов черт за дубликаты. Фикс: расширить `collectRefs` регуляркой. **Блокер: сначала KB-131** | medium | S | infra | CONFIRMED | H10 |
| KB-131 | **`export-prod.mjs` тянет несуществующий `/api/conditions` (404, глушится, exit 0) и НЕ тянет `/api/concepts`** → офлайн-снапшот не даёт проверить ни одну concept-ссылку (**дал реальную ложную тревогу в этом аудите**). ⚠ **Ловушка №1:** цель ссылки — slug `concept_id`, а НЕ `id` → индексировать по `concept_id`. ⚠ **Ловушка №2:** `GetConcepts` игнорирует page/limit → при >200 понятий бесконечный цикл. Половина про conditions данных не теряет (состояния лежат в `effects.json`) | medium | S | infra | CONFIRMED | H12 |
| KB-132 | **Документированный в 8 местах пример `[[Спасбросок|concept:saving_throw]]` указывает на несуществующее понятие** — 3 из них живые подсказки в UI (`ConceptCreator.tsx:83`, `CardLibrary.tsx:1788`, `FormattedTextarea.tsx:290`). Пример из официальной подсказки продукта создаёт битую ссылку. Ущерб сейчас 0 | low | S | data/content | CONFIRMED | H11 |
| KB-133 | **Глоссарий понятий покрывает 3 термина из ~25**, которые контент реально употребляет: спасбросок 486 упоминаний, ячейка заклинаний 268, преимущество 132-188, долгий отдых 162, скорость 149, помеха 87-111. Таблица `concepts` создаётся миграцией 070 **пустой**, сида нет | medium | M | content | CONFIRMED | G2 |
| KB-134 | **Пикер ссылок не различает одноимённые сущности** (5 пар действий из 40); `LinkResult` не содержит ни `card_number`, ни `type`. Паттерн решения в проекте есть (`LevelProgressionEditor.tsx:86-87` показывает card_number). **Ущерб не доказан:** порядок детерминирован (`created_at DESC`), каноничная копия первая во всех 5 парах | low | M | data | PLAUSIBLE | H13 |

### 7.14 Схема механик, валидация, гигиена контента

| id | Находка | sev | effort | kind | verdict | трек |
|---|---|---|---|---|---|---|
| KB-135 | **Фикстуры кодируют несуществующий словарь → тесты зелёные при сломанном проде.** `properties:['heavy','two_handed']` (в данных `two-handed`: 42 vs 0), `bonus_value:'11+dex'` (0 из 46), щит `type:'shield'` (в проде 0). **Снапшот прода лежит в репо и не используется ни одним тестом экипировки/КЗ**; `engine/ac.test.ts` **не существует**; `content.readiness.mvp.test.ts:113-121` считает только длины массивов | high | M | infra | CONFIRMED | SCH-1 |
| KB-136 | **`choice` на уровне `effects[]` не валидируется схемой**: `topLevelChoice.options` = `{type:'object'}` без ограничений; **55 из 76 выборов прода (72%)** идут этим путём. Инцидентность 0 — дыра в страховке. Реальная поверхность риска: сид-скрипты, ручная правка JSON, вывод `ai_mechanics_controller.go` | low | M | infra | CONFIRMED | SCH-2 |
| KB-137 | **enum `source` устарел относительно движка**: `effect_type` реально поддержан и рекламируется автору в UI, но вне enum. **ПОРЯДОК ФИКСА ОБЯЗАТЕЛЕН**: сперва добавить `effect_type`/`effect` в enum, только потом сводить `topLevelChoice` на `$defs/choice` — иначе Дар договора и Воззвания перестанут сохраняться. Смежно: `ability`/`instrument`/`artisan_tool` есть в enum, но нет в `CHOICE_SOURCES` → дропдаун не может воспроизвести существующий контент | low | S | infra | CONFIRMED | SCH-3 |
| KB-138 | **Легаси-дубли базовых действий**: 5 пар тёзок + «Безоружная атака»/«Безоружный удар». Матчинг по имени в canon-раннере даёт неоднозначность 2:1 на пяти именах. **Не парадигма №6** — это вторая запись той же сущности | medium | S | data | CONFIRMED | SCH-4 |
| KB-139 | **27 эффектов-сирот + 9 задублированных имён (19 экземпляров).** **7 из 9 коллизий ЗАКОННЫ** (Тёмное зрение 60/120, Искусное владение -2/-3, Сотворение заклинаний разных классов) — схлопывать нельзя. Замены нет у 2 групп → это дыры контента: Транс (KB-118) и 5 боевых стилей (KB-033). Библиотека показывает **ТРИ** карточки «Защита без доспехов». **Фикс — не удаление, а слияние** (парадигма №6): текст сироты → `detailed_description` живого | medium | M | data | CONFIRMED | I2 |
| KB-140 | **10 действий-сирот, 4 — точные дубликаты базовых.** **`requirements` мертво ДВАЖДЫ:** (1) движок не читает (`registries.ts:258` — «словарь для будущей реализации»); (2) поле лежит на `mechanics.requirements`, а тип и конструктор читают `activation.requirements` → пересохранение через конструктор **молча потеряет**. **Опасность:** привязка `7d5ac189` «Ярость» или `703f0357` «Второе дыхание» (mechanics=NULL) даст молча неработающую фичу. Ресурс `main_action` мёртв (4 потребителя — все сироты) + продублирован хардкодом `utils/resources.ts:19` | low | S | data | CONFIRMED | I3 |
| KB-141 | **`name_en` заполнен у 2 сущностей из 10**: spells 392/393, backgrounds 16/16; **effects 0/452, actions 0/40, classes 0/60, races 0/39, feats 0/77, cards 1/766, resources 0/26, variables 0/5**. Не дефект кода, а незаконченный ролл-аут (`e391fe2` ограничил объём заголовком). Настройка по умолчанию выключена → дефолтный пользователь не видит. Приоритет досева: feats → classes → races → базовое снаряжение | low | M–L | data | CONFIRMED | J1 |
| KB-142 | **8 из 26 ресурсов с пустым описанием, 7 с пустым `recharge`.** Механического влияния нет (реальное восстановление из `class.resources[id].per`); дефект живёт **в библиотеке**, не на листе. **`focus`/`channel_divinity`/`sorcery_points` — 0 потребителей** (пул есть, тратить нечем). Побочно: хардкод `actionDefaults` (`utils/resources.ts:17-23`) дублирует БД — нарушение парадигмы №1 | low | S | data | CONFIRMED | J2 |
| KB-143 | **Эффекты-заглушки в пользовательском выборе**: `2023be11` → **`description='Desc'`** (единственный <10 симв. из 452); `567f000b` → «Pact Magic.»; воззвания и договоры описаны по-английски/по-итальянски («Grimorio с ритуалами»). `567f000b` и `2023be11` выдаются **без всякого выбора**. **ОТДЕЛЬНАЯ находка:** для `source='effect'` `ChoiceResolver` рендерит голые чипы без превью (в отличие от `'feat'`) — нарушение парадигмы №2 | medium | M | content | CONFIRMED | J3 |

### 7.15 Код: движок

| id | Находка | sev | effort | kind | verdict | трек |
|---|---|---|---|---|---|---|
| KB-144 | **Лист игнорирует `when`-предикаты: дворф/полурослик/эльф получают преимущество на ВСЕ спасброски.** Два конкурирующих сборщика: строгий `execute.ts:1066` (с `evalCtx`) и листовой `collectRollModifiers` (`CharacterSheetMVP.tsx:815-816`, `CharacterSheetV2.tsx:92-93`) — **без `evalCtx`** → `circumstances.ts:116` `if (!ctx) return true`. Затронуты ровно 3 эффекта (Дворфская стойкость `d7048169`, Храбрость `e3202b50`, Происхождение фей `9a663d1f`). Репро: путь листа → `advantage`, путь боя → `none` на одном персонаже. **ГРАБЛИ:** при ручном клике движок не знает, против чего спас; пустой `savedConditions` **перевернёт баг**. Нужен ввод намерения в диалоге кубов. Инициатива и breakdown/AC имеют тот же паттерн, но латентно | high | M | engine | CONFIRMED | 1.1 |
| KB-145 | **`weaponAttackPreview` — вторая математика атаки; превью врёт против броска.** `weapon.ts:335` = `atkAbilityMod + prof + attackEnchant` против `runAttackRoll` с `collectModifiers`. Репро: с «Перчатками защитника» (+2) exec = 6, preview = 4. Для урона дубль уже закрыт. **⚠ БЛОКЕР:** ~16 из 24 payload'ов — само оружие, несущее И `enchant_bonus`, И `modifier` на ту же атаку → в `runAttackRoll` бонус приходит **дважды** («Свет Латандера» +6 вместо +3 — **ошибается сам бросок**). Наивное добавление `collectModifiers` в превью **узаконит двойной счёт**. Чинить оба конца | medium | S | engine | CONFIRMED | 1.2 |
| KB-146 | **Диалог хитов кокпита V2 не получает `sheetCtx` — урон мимо движка.** `CharacterSheetV2.tsx:395-404` не прокидывает, **хотя оба значения у него в пропсах**. Теряются: сопротивления, `opts.damageReduction` (Каменная стойкость Голиафа), события `damage_taken`/`reduced_to_0_hp`, полная проверка концентрации. V2 — **opt-in** (`localStorage['sheet-layout']`), дефолт classic | medium | S | code | CONFIRMED | 1.3 |
| KB-147 | **Десять расходящихся конструкторов `FormulaContext`.** `formula.ts` резолвит отсутствующее поле **молча в 0**, а неизвестную переменную бросает `MissingVariableError`, который `computeAC` **не ловит** (ни одного try/catch по цепочке до рендера листа). Репро: `set_value ac_base='10 + spellcasting'` → КЗ 12 вместо 14 (**подмена незаметна — значение правдоподобно**); `'10 + martial_arts_die'` → лист падает. Латентно (в проде 2 формулы `ac_base`), выстрелит на первом же методе из штатного конструктора — **прямое нарушение парадигмы №1**. Фикс: один `formulaContextOf()` | medium | M | engine | CONFIRMED | 1.4 |
| KB-148 | **`engine/resources.ts:formulaCtx` не передаёт `variables`** → `resolveCount` ловит `MissingVariableError`, деградирует в `Number(raw)` = NaN → **0**, панель ресурсов пуста, все действия заблокированы `canPay`, **ни одной ошибки в консоли**. Латентно. **ГРАБЛИ:** `martial_arts_die` — переменная типа `dice`, `resolveId` на ней делает `rollDice` → даже после починки такой `count` дал бы **случайный размер пула**; не-number типы отбрасывать явно | low | S | engine | CONFIRMED | 1.5 |
| KB-149 | **`projectedAgainst` — второй сборщик**: `when`/`filter` игнорируются (ложное срабатывание), `roll:'d20'` не поддержан | low | L | engine | CONFIRMED | 1.6 |
| KB-150 | **`resistanceLevelFor` и `computeAC` читают пассивки без гейта по `activation.mode`** — нарушение инварианта §3.2.1 | low | S | engine | CONFIRMED | 1.7 |
| KB-151 | **`describeMechanics` знает 15 из 30 payload-kind'ов схемы** → превью половины примитивов молчит | low | M | engine | CONFIRMED | 1.8 |
| KB-152 | **Три байт-в-байт одинаковые функции постановки «стоячего» эффекта.** ⚠ Рефакторинг обязан сохранить префикс id параметром (инвариант §3.2.6) | medium | S | engine | CONFIRMED | 1.9 |
| KB-153 | **Два реестра состояний** — см. KB-022 (дубль записи из трека кода) | medium | S | engine | CONFIRMED | 1.10 |
| KB-154 | **Мёртвый `combineAdvantage` с порядко-зависимой свёрткой** (`modifiers.ts:33`, 0 потребителей). Удаление закрывает C7 remediation-дока | low | S | engine | CONFIRMED | 1.11 |
| KB-155 | **`buildTargetFromCharacter` строит урезанный `CharacterContext`** | low | S | engine | CONFIRMED | 1.12 |
| KB-156 | **`abilityMod` / `proficiencyBonusForLevel` продублированы; `resolveCharacterRules` тянет из обеих копий.** `characterCalculationsV3.ts:35` на level=0 даёт 1 вместо 2 | low | S | code | CONFIRMED | 1.13 |
| KB-157 | **Go-бэкенд считает КЗ и модификаторы своей копией — усечение к нулю вместо floor** (только легаси v1/v2 + `effects_utils.go:16 AnalyzeCardEffects` — третий слой на легаси-структуре, мёртв) | low | S | code | CONFIRMED | 1.14 |
| KB-158 | **`classLevels` не согласован по неймспейсу**: резолвер кладёт **строчное русское** имя класса (`{"воин":5}`), а `breakdown.ts:27,32` читает `ctx.classLevels?.fighter` и токен `class_level:rogue` ждёт слаг. Несогласованность уже сейчас + мина под мультикласс | low | S | code | CONFIRMED | §5.3 |

### 7.16 Схема БД и бутстрап

| id | Находка | sev | effort | kind | verdict | трек |
|---|---|---|---|---|---|---|
| KB-159 | **На чистой БД бэкенд не стартует**: `CREATE TABLE cards`/`users` живёт только в `database/*.sql`, барьера два (миграции 002 и 009), fail-fast → крэш-луп. **⚠ КАПКАН: этап A7 старого плана предписывает удалить `database/`** → сперва миграция `000_base_schema`, потом A7 | high | M | infra | CONFIRMED | 2.1 |
| KB-160 | **`cards_rarity_check` никем не расширен**: `relic`/`custom` невозможно сохранить, миграция 029 мертва. Прецедент 071 доказывает, что класс уже стрелял в проде. **Перед починкой:** `SELECT conname FROM pg_constraint WHERE conrelid='cards'::regclass AND conname='cards_rarity_check'` — если прод поднимали из `schema_supabase.sql:14` (rarity без CHECK), баг бы не стрелял | high | S | infra | PLAUSIBLE | 2.2 |
| KB-161 | **10 каталожных таблиц держат обычный UNIQUE при soft-delete** → soft-удалённая строка навсегда занимает `card_number`; блокер восстановления инцидента `pf_`. У concepts/variables/resources ещё и 500 вместо 400. Фикс: частичные UNIQUE `WHERE deleted_at IS NULL` | high | M | infra | CONFIRMED | 2.3 |
| KB-162 | **`author`/`source`/`related_*` пишутся, но не возвращаются ни одним Response** → «поля нет в снапшоте» ≠ «колонки нет в БД» (на этом ошиблось старое ревью с тезисом «source=null у 761») | medium | S | code | CONFIRMED | 2.4 |
| KB-163 | **Редактирование любого предмета молча затирает `cards.author` на `'Admin'`.** Чинить одной правкой с KB-162 | medium | S | code | CONFIRMED | 2.5 |
| KB-164 | **`actions`/`effects`: колонки `tags`/`properties`/`related_*` объявлены `TEXT[]`, а `Properties.Value()` пишет JSON.** У cards совместимо (TEXT), проблема только у actions/effects. Комментарий миграции 031 — по сути зафиксированное авторами воспроизведение того же дефекта | low | M | infra | PLAUSIBLE | 2.6 |
| KB-165 | **`image_prompt_extra` — живое поле ввода без колонки в БД и поля в Go-модели** | low | S | code | CONFIRMED | 2.7 |
| KB-166 | **`classes.related_effects`/`related_actions` читаются только для ПОДКЛАССА** → у всех 12 базовых классов поле мертво (единственный канал — `level_progression`) | low | S | engine | CONFIRMED | 2.8 |
| KB-167 | **Колонка `script` — легаси удалённой подсистемы + 6 строк-сирот** (effects 5, actions 1) | low | S | data | CONFIRMED | 2.9 |
| KB-168 | **Прочий дрейф схемы (сводка):** колонки, заведённые миграцией и пустые в снапшоте — `battle_profile` 0/766, `starting_equipment` 0/60, `extra_speeds` 0/39, `image_url_spent` 0/26, `subclasses` 0/393, `tags` 0/885 | low | S | infra | CONFIRMED | 2.10 |

### 7.17 Производительность

| id | Находка | sev | effort | kind | verdict | трек |
|---|---|---|---|---|---|---|
| KB-169 | **Apply боя читает и пишет `seq`/`state` без блокировки — lost update.** `encounter_controller.go:411` `newSeq := enc.Seq + 1`, ни одного `FOR UPDATE`/`clause.Locking` во всём бэкенде; индекс `(encounter_id, seq)` **НЕ UNIQUE** → одновременные действия молча теряют операцию + дубль `seq` навсегда портит журнал (`?since=` не восстановит) | high | M | code | CONFIRMED | 3.1 |
| KB-170 | **Полный журнал персонажа (без LIMIT) перекачивается на каждый входящий удар** (`character_v3_controller.go:303`). Цифры («40 ударов = 11,2 МБ») — модель, не замер | high | S | code | CONFIRMED | 3.2 |
| KB-171 | **Кузня грузит 5 каталогов ~4,9 МБ на маунт; 77% веса — base64-картинки**, `?fields=list` спасает 1,6% (режет только JSON). Защитимые цифры: 2,9 МБ gzip по проводу, ~1,0-1,2 с чистого RTT | high | M | code | CONFIRMED | 3.3 |
| KB-172 | **16 компонентов независимо тянут `/api/resources` без кеша; 97% payload'а — base64.** `apiCache` есть — ресурсы единственные, кого забыли подключить | medium | M | code | CONFIRMED | 3.4 |
| KB-173 | **Маунт листа: ~45–50 GET в ~10–11 последовательных волн (водопад)** | medium | L | code | CONFIRMED | 3.5 |
| KB-174 | **`getCardsIndex` качает весь каталог карт 8 последовательными запросами на каждую загрузку SPA.** «Блокирующий эффект» отсутствует — loading-гейта нет, индекс нужен только как фолбэк имени | medium | S | code | PLAUSIBLE | 3.6 |
| KB-175 | **`GET /api/characters-v3` отдаёт всех персонажей без LIMIT и полными телами** | medium | S | code | CONFIRMED | 3.7 |
| KB-176 | **Три диалоговых контекста передают новый объект в `value` на каждом рендере** (нет `useMemo`). Дешёвая победа | medium | S | code | CONFIRMED | 3.8 |
| KB-177 | **Иконки 1024×1024 по 1,4–2,0 МБ отдаются как элементы 12–20px** | medium | S | infra | CONFIRMED | 3.9 |
| KB-178 | **SSE-реплей боя без LIMIT** — усечение реплея сломало бы корректность; на штатном пути `since = enc.seq` → реплей ~0 строк. Размеры реальных журналов неизвестны | low | S | code | CONFIRMED | 3.10 |
| KB-179 | **Изображения карт грузятся без `loading="lazy"` — 120 из 120 тегов `<img>`** | low | S | code | CONFIRMED | 3.11 |
| KB-180 | **Библиотека карт: 10 `console.log` в горячем пути загрузки** | low | S | code | CONFIRMED | 3.12 |
| KB-181 | **`React.memo` не используется нигде** (grep по `pages/`+`components/` = 0); 24 немемоизированных `breakdownValue`; CardLibrary без виртуализации | low | M | code | CONFIRMED | ревью-07-12 |

### 7.18 Превью и отображение

| id | Находка | sev | effort | kind | verdict | трек |
|---|---|---|---|---|---|---|
| KB-182 | **Не-PHB термины типов урона**: «Молния»/«Гром»/«Сила» вместо «Электричество»/«Звук»/«Чистая сила» | medium | S | code | CONFIRMED | 4.1 |
| KB-183 | **Палитра редкости объявлена в 13+ местах; `CardPreview` красит текст 13 карт серым.** `constants/rarity.ts` так и не создан; палитры разбросаны по `rarityColors`, `rarityVisuals`, `cardStyles`, `rarityGlow`, `SheetItemRow`, `CardLibrary`, `ShopDetail`, `InventoryDetail`, `AddItemToInventory`. Мёртв блок `colors.rarity` в tailwind | medium | M | code | CONFIRMED | 4.2 |
| KB-184 | **`ImageGenerator`: локальные копии подписи и цвета не знают `relic`** — в интерфейс утекает английский идентификатор | low | S | code | CONFIRMED | 4.3 |
| KB-185 | **`SheetHpPanel` держит локальный список типов урона** — «Силовой» против «Сила» в одном компоненте | low | S | code | CONFIRMED | 4.4 |
| KB-186 | **`diceRu` (d→к) продублирован в 6 файлах**; форматирование знака модификатора — **9 дословных копий под 3 именами**, одна печатает U+2212 + пробел | low | S | code | CONFIRMED | 4.5+4.6 |
| KB-187 | **`SpellPreview` — единственное превью, где иконка типа урона не скрывается при ошибке загрузки** | low | S | code | CONFIRMED | 4.7 |
| KB-188 | **`ConceptPreview` — единственное тёмное tooltip-превью вне обеих стилевых систем**; проп `disableHover` игнорируется | low | M | code | CONFIRMED | 4.8 |
| KB-189 | **`ValueBreakdownTip` рендерит разбивку дважды**: нативный `title=` и свой popover. Всего в .tsx **196 нативных `title=`**; `HoverCard` имеет 1 потребителя из 19 возможных | low | S | code | CONFIRMED | 4.9 |
| KB-190 | **`EQUIPMENT_SLOTS` экспортируется из двух модулей с одним именем, но разными словарями**; `ENTITY_TYPE_LABEL` мёртв в `EntityRefRegistry`, а `FormattedTextarea` рядом объявляет идентичную копию | low | M | code | CONFIRMED | 4.10+4.11 |
| KB-191 | **`docs/design/tokens.css` не импортируется ничем** — фундамент редизайна не подключён | low | S | infra | CONFIRMED | ревью-07-12 |

### 7.19 Мёртвый код: фронтенд

> Метод: полный граф импортов по 379 файлам, 3 прохода, каждый кандидат перепроверен grep-ом. Бареллей `export *` нет, `import.meta.glob`/`require.context` нет. **Парадигма №6 не блокирует ничего из перечисленного** (проверено поимённо). Vite тришейкает — рантайм-стоимости нет, цена в поддержке.

| id | Находка | sev | effort | kind | verdict | трек |
|---|---|---|---|---|---|---|
| KB-192 | **Три полностью мёртвых файла (426 строк):** `hooks/useCardTilt.ts` (67, осиротел в `1c9efac` — осознанное удаление фичи владельцем); `utils/characterCalculationsV3.ts` (226, 16 экспортов, 0 импортёров, дублирует `derive.ts`/`ac.ts`/`breakdown.ts`); `utils/dndSuBestiary.ts`+тест+фикстуры (133+28, ~220 КБ — живой путь `ttgClubBestiary`, прокси на dnd.su не существует). ⚠ `ttg-skeleton.html` **не трогать** | low | S | code | CONFIRMED | 5.1 |
| KB-193 | **33 экспорта без единой ссылки нигде** (`CONDITION_OPTIONS`, `combineAdvantage`, `isShieldCard`, `abilityForWeapon`, `buildRuleInput` — литеральная identity-функция, `charactersV2Api`, `clearApiCache`, …). **Перед удалением сверить:** `abilityForWeapon` и `resolveSpellsForCharacter` старое ревью помечает как задел под C11. **Инструментальный корень:** `tsc` не смотрит на экспорты → ставить knip/ts-prune **одновременно** с зачисткой | low | M | code | CONFIRMED | 5.2 |
| KB-194 | **19 мёртвых экспортов `types/index.ts` (≈15% файла) + `WeaponTemplate` объявлен дважды** — TS молча сливает (declaration merging) в аддитивном случае. `weaponTemplatesApi` → 0 вхождений | low | M | code | CONFIRMED | 5.3 |
| KB-195 | **8 мёртвых пропсов в 7 компонентах** (`cardCreator/*Section.tsx` — `errors`/`setValue`/`watch`/`showImageLibrary`, деструктуризация их не берёт, call-site исправно передаёт) — единственный остаток фаз A/B/C | low | S | code | CONFIRMED | 5.4 |
| KB-196 | **`spellsByLevel`: мёртвый useMemo + проп + импорт типа** | low | S | code | CONFIRMED | 5.5 |
| KB-197 | **Orphan-ассеты: 67 orphan-JSON, 13 МБ PNG.** `public/design_preview.html` — пограничный случай (доступен по прямому URL) → перенос, не удаление | low | S | infra | CONFIRMED | 5.6 |

### 7.20 Мёртвый код: бэкенд

| id | Находка | sev | effort | kind | verdict | трек |
|---|---|---|---|---|---|---|
| KB-198 | **`AuthMiddleware` функционально идентичен `OptionalAuthMiddleware` — 84 «защищённых» роута открыты анонимно.** Как **факт** — CONFIRMED; как **находка** — это парадигма №7 (решение владельца). Ценность — только коррекция `project-review-2026-07-12.md:158` | low | S | code | PLAUSIBLE | 6.1 |
| KB-199 | **`character_controller.go` — 705 строк, 8 роутов v1, полностью мёртв** | low | M | code | CONFIRMED | 6.2 |
| KB-200 | **`character_v2_controller.go` — 1249 строк, 11 роутов, мёртв.** ⚠ **`API characters-v2` НЕ удалён**: `client.ts:485` живьём дёргает `/api/characters-v2/{id}/active-effects` | low | M | code | CONFIRMED | 6.3 |
| KB-201 | **37 из 133 роутов (28%) без потребителей** + `effects_utils.go AnalyzeCardEffects`. ⚠ battle-stats: комментарий `controller.go:183` «для сервиса battle» намекает на **внешнего** потребителя вне репо — подтвердить до снятия | low | S | code | CONFIRMED | 6.4 |
| KB-202 | **`POST /api/images/upload-base64` под `OptionalAuthMiddleware` — анонимная неограниченная запись в публичный S3** (`main.go:197`). Живая поверхность абьюза + расходы. Удалить | high | S | code | ЗАКРЫТО 972d732 | 6.5 |

### 7.21 Гигиена репозитория, сборка, CI

| id | Находка | sev | effort | kind | verdict | трек |
|---|---|---|---|---|---|---|
| KB-203 | **Закоммичен 30-МБ Windows-бинарник `backend/main`** | medium | S | infra | CONFIRMED | 7.1 |
| KB-204 | **34,4 МБ SQL-дампов в корне, два нулевого размера; содержат PII и bcrypt-хэши.** Вместе с KB-203 — 73% веса репо (84,3 из 115,7 МБ) | medium | S | infra | CONFIRMED | 7.2 |
| KB-205 | **CI никогда не собирает Go-бэкенд** (оффлайн-гейт на PR = tsc + оба vitest; ночной живой прогон + дифф дрейфа снапшота) | medium | S | infra | CONFIRMED | 7.3 |
| KB-206 | **`npm run lint` сломан навсегда: 5 devDependencies-сирот, конфига не было НИКОГДА** (`git log --diff-filter=D` пуст) | low | S | infra | CONFIRMED | 7.4 |
| KB-207 | **Контентные скрипты по умолчанию пишут в ПРОДАКШН**; `api.mjs` содержит login с закоммиченными дефолтами (`importer_user/importer_pass123`) | medium | M | infra | CONFIRMED | 7.5 |
| KB-208 | **Прод-URL захардкожен как fallback в 4 файлах фронта (46 по репо)** | low | S | code | CONFIRMED | 7.6 |
| KB-209 | **Прочая гигиена:** корневой мусор A7 (`Gortak.json`, `Hara*.json`×3, `dummy.json`, `example.json`, `rage.json`, `modify_attack.json`, `image.png`, `site_logo.png`, `fix_dump_encoding.ps1`, `fix_foreign_key.sql`, `V4 System/`, `Способности/`, `all_cards.json`), 8 стейл-.md, `tsconfig.tsbuildinfo` ×2, `DEPLOYMENT.md`, `docker-compose.prod.yml`. ⚠ Безопасно удалять **только** `railway-backend.json` — `railway-frontend.json` может быть привязан кастомным config path в дашборде | low | S | infra | CONFIRMED | 7.7 |

**Итого в реестре: 209 находок** (KB-001…KB-209).

### 7.22 Рекомендуемый порядок работ

**Волна 0 — S, чистые данные, максимальный эффект (13 правок, закрывает 3 critical + 6 high, без единой строки кода):**
KB-025 (Уклонение → `scope:'target'`) · KB-005 (`set_value ac_base` ×4 класса) · KB-002 (`type='shield'` 10 щитам) · KB-004 (`'12 + ЛВК'` → `'12 + dex'`) · KB-052 (Ярость: 3 `resistance` + 2 `advantage`) · KB-053 (`rage_charge` by_level **+ синхронно `mechanics.uses`**) · KB-054 (`bardic_inspiration` → `'max(1, cha)'` **+ синхронно**) · KB-055 (перенос 4 эффектов между ключами LP) · KB-077 (`filter:{ability:'dex'}` Ускорению) · KB-076 (Глухота/Слепота → choice) · KB-078 (Паутина) · KB-082 (Огненный снаряд `1d10`) · KB-022 (`deafened` → «Оглохший»).

**Волна 1 — код, критичное:**
1. KB-144 — `evalCtx` в 3 листовых вызова + ввод намерения спаса (M)
2. KB-159 — миграция `000_base_schema` → **затем** разминирован A7 (M)
3. KB-161 — частичные UNIQUE на 10 таблиц (M)
4. KB-169 — блокировка/optimistic в Apply + UNIQUE на `encounter_events` (M)
5. KB-202 — удалить `upload-base64` (S)
6. KB-160 — `cards_rarity_check` на 7 значений (S)
7. KB-162+KB-163 — `Author`/`Source`/`related_*` в 3 Response, одной правкой (S)
8. KB-170 — `.Limit()` + `?since=` (S)

**Волна 1b — данные + мелкий код:** KB-001+KB-003 (**одной правкой**, иначе перебор) · KB-006 · KB-026 · KB-027 · KB-051 · KB-079 · KB-080 · KB-021 (**выписать модификаторы**) · KB-037/038/039/042 · KB-112/113 · KB-114 · KB-097 · KB-070 · KB-137 (**сначала enum**) · KB-092 · KB-131 → KB-130.

**Волна 2 — примитивы движка (разблокируют по 3-6 находок каждый):**
1. Одноразовый модификатор (**новое поле**, `limit` занят `explode`) → KB-014, KB-015, KB-029
2. N бросков атаки за исполнение → KB-050 (Extra Attack ×5), KB-017, Nick, `loading`
3. `DeathSaveState` в `RuntimeState` → KB-038, KB-040, KB-041, KB-043
4. Гейт владения (поля в `CharacterContext` по образцу `attunedIds`) → KB-009, KB-010, KB-011; блокер данных: у 27 из 141 оружия нет категории
5. Предикат `target_is_condition_source` → KB-020, привязка Vex к цели
6. Порядок урона (три флага вместо ранга) → KB-012 + KB-013 одной переработкой
7. Сырые значения характеристик в `FormulaContext` → KB-098, KB-099
8. Канал механики на «Предыстории» → KB-109, KB-110 одним слайсом
9. Единый `formulaContextOf()` → KB-147, KB-148

**Волна 3 — крупный досев:** KB-049 (~94 фичи L5-L20; приоритет L5 → L6 Аура → L7 Evasion) · KB-069 (42 черты) · KB-072 (47 заглушек) · KB-088 (163 заклинания одним досевом) · KB-060 (7 подклассов) · KB-056 (Колдун целиком) · KB-141 (name_en). **Единый эпик:** KB-049 + KB-067 + KB-068 — три измерения одного недосева, делать одним проходом.

**Инфраструктура — параллельно волне 1, иначе всё нечем гейтить:** KB-135 (подключить снапшот к тестам + расширить canon-раннер за пределы Варвара) · метрика `machine_mechanics` · снять сетевой гейт с `mechanics.sweep.mvp.test.ts` · линт ключей `applies_to.filter` (поймал бы KB-025 автоматически) · аудит ложно-зелёных тестов · KB-205 (Go в CI) · KB-203+KB-204 (`.gitignore`, −73% веса) · KB-193 (knip/ts-prune одновременно с зачисткой).

**Не делать:** массовый автолинковщик по словарю имён заклинаний (KB-129).

---

## 8. Проверено и корректно — НЕ перепроверять

Всё ниже проверено **2026-07-15** (если не указано иное) исполнением или дословной сверкой с RAW.

### 8.1 Движок
- **Крит удваивает кости** (`0a02eba`, `execute.ts:1004-1011`); модификаторы прибавляются один раз; явный `on_crit` не удваивается. P0#1 старого ревью **закрыт**.
- **Состояния 2024** (`7676530`/`9272605`/`a42560c`) построчно сверены с глоссарием: Grappled, Prone (включая range-гейт), Restrained, Paralyzed, Stunned, Blinded, Frightened, Poisoned, Invisible. Композиция `includes`/`leaves` транзитивна со стражем циклов. Расхождения только KB-020/KB-021.
- **`foldAdvantage`** порядко-независим; все продовые точки переведены (`85b5d49`).
- **СЛ концентрации** `min(30, max(10, floor(damage/2)))`; помеха при крите.
- **Урон второй рукой** без модификатора характеристики — RAW-корректно; зачарование на обе руки — верно.
- **Гейт настройки универсален**: `itemGate` режет механику любого предмета без настройки; MAX_ATTUNED=3.
- **`mode:'contest'` реализован** (`execute.ts:1171-1187`) — часть ENG-12 закрыта.
- **«Только одно базовое КЗ»** — `ac.ts:140-174`, парадигма №3, RAW соблюдён.
- **Спасброски смерти, ядро** (`death.ts:33-51`): нат.20 → 1 HP, нат.1 → 2 провала, 3/3, сброс при лечении. Сломана только обвязка (KB-038…042).
- **`longRest` эмитит `long_rest` ДО восстановления** — осознанно.
- **`applyTempHp` берёт максимум**; `hp.temp = 0` на долгом, короткий не трогает.
- **`resolveCount` поддерживает формулы и `min`/`max`** — старое ревью ошибочно считало «минимум 1» невыразимым.
- **`turn.ts:122-142 rollSaveEnds`** — образцовый спасбросок, шаблон для KB-042.
- **Боевая истина не искажена**: `runSave` и `resolveIncomingSave` передают `evalCtx` и гейтятся верно.
- **Урон применяется одним примитивом** — `applyIncomingDamage`; `hp.ts:applyDamage` — фолбэк одной панели, не параллельная реализация.
- **Резолв сущностей единый**: `registry.ts` + `apiResolver.ts` + `cardRegistry.ts` + `spellRefs.ts` — 4 слоя одного конвейера, не конкуренты.
- **Бэкенд не дублирует движок в живом контуре боёв** — образец разделения.
- **`expandEffectGrants` даёт 0 волн и 0 запросов**: `"grant_effect"` — 0 вхождений во всём снапшоте.
- **`applyGrantEffect` — НЕ копия `applyModifierPayload`.**
- **Синтетическая обёртка выбора** (`resourceInit.ts:30-32`) без `activation` законно проходит гейты — не «чинить».
- **`uses` энфорсится** через виртуальный пул `uses_<key>`; пустой `Воин.resources = {}` — **не баг**. Гипотеза «Всплеск действий бесконечен» опровергнута.

### 8.2 Контент
- **Заклинания — 391 PHB 2024 + 2 самоделки; 0 пропусков, 0 дублей.** Сверка всех 391 против RAW: уровень 0 расхождений, школа 0, время 0, дистанция 0, длительность (текст) 0, компоненты 0, ритуал 0; классы-носители 1 (KB-096), концентрация 1 (KB-092).
- **Текст заклинаний — это 2024, не 2014**; отсебятины в числах нет (сверены ВСЕ кости). Единственный термин 2014 — «устойчивость» в хоумбрю SPELL-0483.
- **`upcast_description` идеально**: все 154 заклинания PHB с абзацем апкаста заполнены, 0 пропусков и 0 лишних. Претензия «разрыв 73» относится к машинному `scaling`.
- **165 ссылок `[[…|effect:id]]` в заклинаниях резолвятся все**; 190/190 ссылок валидны (25 целей) — **baseline будущего линтера**.
- **Ячейки заклинаний — все три сетки верны посимвольно**, включая Pact Magic Колдуна (`per:'short_rest'` + обнуление через `by_level`). Старая находка «Колдун сеется обычными слотами» устарела.
- **Подклассы: 48/48 привязаны к правильным RAW-уровням, 0 пропусков.** Вся деградация — на базовых классах.
- **Weapon Mastery — 100% соответствие** у всех 38 видов оружия; «Сеть» без mastery верно; карт с `mastery` без `weapon_type` — 0. Коммиты `458f44b`/`d562b9d`/`64d016e` тему закрыли.
- **Прогрессия костей верна**: Бонус урона Ярости 2/3/4 (L1/9/16), Кость Вдохновения d6…d12, Кость боевых искусств d6…d12.
- **Слоты черт на 4/8/12/16/19 у всех 12 классов работают** (+ Воин L6/L14, Плут L10); дубли эффектов — осознанный приём.
- **Категории черт на L4 (`['origin','general']`) — не баг** (RAW: «no category specified → any category»). Проблема только на L19 (KB-070).
- **Виды**: все 10 PHB 2024 + Табакси/Кованый; подвиды точны; **виды не дают бонусов характеристик** — правильно для 2024; darkvision точны.
- **Предыстории 16/16**: все тройки ASI совпали, все origin feat резолвятся.
- **Черты 77 = 10 origin + 2 варианта + 43 general + 10 fighting_style + 12 epic_boon** — точно по таблице. **Имена черт выверены по RU-локализации идеально** (Одарённый/Везунчик/Дебошир/Лекарь/Самоделкин — ожидания «Умелый/Счастливчик/Драчун» ОШИБОЧНЫ).
- **Спасброски, skill_choices, armor_training/weapon_proficiencies всех 12 классов** совпадают с RAW.
- **Point-buy 27 реализован верно**; потолок ASI 20 соблюдён.
- **Стартовое снаряжение материализуется** (слияние по `card_id`, золото складывается, только при создании); **левелап продуман** (база блокируется, дифф по `prevRefs`, подкласс только на пороге).
- **Предметы**: обрезанных описаний 0; `image_url` 766/766; `rarity` 766/766; веса и базовые КЗ 13 доспехов совпадают с PHB; все 4 живых магических щита через `type='shield'` работают (18+2=20).
- **Кириллическая «к» в костях — не баг для оружия** (`weapon.ts:44` ловит), но в `evaluate()` = FormulaError.
- **13 `COND-*` корректно проброшены** через `registerConditions`; модификаторы совпадают со встроенными.
- **`cards.battle_profile`: 0 непустых** (легаси мёртв в данных).

### 8.3 Фронтенд и инфраструктура
- **МИНА синка схем МЕРТВА**: `diff docs/mechanics.schema.json frontend/src/schemas/mechanics.schema.json` пуст (21393 Б обе); `sync-mechanics-schema.mjs:6-9` направлен frontend→docs.
- **Инцидент `pf_` закрыт** (`9078764`, миграция `078_restore_feat_slot_effects`): effects 445→452, битых ссылок в LP всех 60 классов — **0**.
- **Все 45 страниц `pages/` имеют импортёра**; сирот нет.
- **Хвостов фаз A/B/C аудита конструкторов НЕТ** (`455dd82`, `ce1f155`) — единственный остаток KB-195.
- **`tsc --noEmit` проходит чисто** при `noUnusedLocals`+`noUnusedParameters`.
- **Закомментированного кода нет** (grep = 0); TODO/FIXME без потребителя нет.
- **Code splitting работает**; **бандл — не проблема**, проблема исключительно в данных.
- **HTTP-кэш клиента есть** (`apiCache.ts`, 60 с + `bustPrefix`); ресурсы — единственные, кого забыли (KB-172).
- **Каскад SSE→лист корректно загейчен** (сравнение `combatantSig`, ранний return).
- **`constants/itemTypes.ts` — образцовый единственный источник**; `utils/damageTypes.ts` структурно образцов (проблема в label и в трёх манифестах вокруг).
- **`EntityRefRegistry.tsx` — единственная точка резолва id→сущность** с кэшем и дедупликацией.
- **Двойная сборка payload в `CardCreator` ЗАКРЫТА** (`buildCardPayload`); `ActionHoverCard`/`EffectHoverCard` удалены (`99a0831`); `EffectPreview` переведён на `SPELL_CARD_CSS`.
- **`CardPreview` вне общих стилевых систем НАМЕРЕННО** (правило «интерфейс да / пергаментная карточка нет»).
- **`go build ./...` exit 0; `go vet` чисто; `go test` 0,08 с.** npm-зависимости фронта: сирот нет, кроме eslint-стека. **Tailwind ЖИВОЙ** вопреки `grep tailwindcss src` → 0 (подключён через `@tailwind` в `index.css`) — **не удалять**.
- **`officials/kb` (778 файлов) — ЖИВАЯ**, держать отслеживаемой обязательно.
- **`GET /api/health` — ЖИВОЙ** (`railway.json:8`), удаление уронит деплой.
- **Индексы под горячие запросы на месте**; дыр по индексам нет.
- **`api/conditionsApi.ts` НЕ бьёт в `/api/conditions`** — ложноположительное совпадение по имени файла.
- **Живая поверхность бэкенда (не трогать):** CRUD 10 справочных сущностей, encounters (7 + SSE), characters-v3 (8), groups (6), inventories (7 из 8), shops (2), images upload/generate, `/api/ai/mechanics`, auth.
- **Модели, которые ВЫГЛЯДЯТ мёртвыми, но живы:** `TemplateType`, `CardRefList`, `SpellDamage`, `BackgroundEquipmentOptions`, `RoleDM`, `WeaponProficiencies`, `Character`, `CharacterV2`.
- **Over-export ≠ мёртвый код**: `journalRowToText`, `pickCopyColor`, `EquipPlan`/`planEquip`, `PROPERTY_ICONS`, `skillTranslations`, `staticResourceOptions`/`mergeResources` — используются внутри своего файла. **Test-only экспорты движка** (`projectedAgainst`, `EMITTED_EVENTS`, …) — осознанные тестовые швы.
- **`canon/*` и `mvp/fixtures.ts` недостижимы от `App.tsx`, но это легитимная тест-инфраструктура.**
- **Метрики миграций UI:** `EntityDetailShell` 10/11, `Bg3Card`+`SPELL_CARD_CSS` 11/12, `CreatorShell` 4/11, `HoverCard` 1/19 (последние две — самые недоделанные).

### 8.4 Зафиксированные решения владельца (не дефекты)
1. **Кости хитов не делаем; короткий отдых = плоские +50% max HP.** Решение №3 от 2026-07-05, закреплено `remediation-plan-2026-07-08.md:25`, MVP-тестом `runtime.mvp.test.ts:68-74` и честно раскрыто в UI. Задача D6 — **только по отдельной команде владельца**. Живой остаток заведён отдельно как KB-047.
2. **Мультиклассирование — задокументированная отсрочка**, не дефект. Требование расширяемости **выполнено**: `classLevels` — `Record<string,number>`, токены `class_level:<id>` резолвятся, тест гоняет два класса. Неверного состояния возникнуть не может — его невозможно ввести. Живой остаток — KB-158.
3. **Авторизация заморожена до предзапуска** (парадигма №7) — KB-198 не заводить как дефект.
4. **Частичное восстановление на коротком отдыхе — модель существует и работает сегодня**: слушатель `{mode:'triggered', trigger:{event:'short_rest'}, result:[{kind:'resource', op:'restore', amount:1}]}` возвращает ровно 1 и не переполняет; паттерн уже в проде. Диагноз «невыразимо» **опровергнут**. Остаётся KB-058 — дыра **контента**. ⚠ `usesPer` такому эффекту задавать **нельзя** (KB-044); чинить через `per:'short_rest'` в `resourceRecharge` **нельзя** (вернёт все заряды).
5. **Дубли эффектов под разные `choiceInstanceId` — приём**, а не мусор.
6. **`card.mastery` — структурная связь ВМЕСТО текстовой ссылки** `[[Мастерство|concept:weapon_mastery]]` (зафиксировано `migrations.go:3330`) → не переносить логику KB-125 на weapon_mastery.

### 8.5 ОПРОВЕРГНУТО — в план не вносить, «чинить» нельзя
1. **«51 битая ссылка / 6 UUID в level_progression»** — BROKEN = **0**, проверено 4 способами 3 агентами. Все 6 UUID резолвятся («Получение черты · слот 2…7»); это осознанные дубли под `choiceInstanceId`. Дефект был реален и **закрыт** `9078764`. Причина ошибки фундамента — stale-копия effects.json (445 против 452).
2. **«Нат. 20/1 не действуют на спасброски/проверки»** — **НЕ ДЕФЕКТ**. PHB 2024: правило ограничено **бросками атаки** («If you roll a 20 on the d20 … for an attack roll»); авто-успех спаса — опциональное правило DMG. `engine/roll.ts:104-111` RAW-корректен. Спасброски смерти реализованы отдельно и верно. **Если это «починить» — уедем от правил.**
3. **«Правило „одно заклинание с ячейкой за ход“ не реализовано»** — **в 2024 правила нет**. Остаток — узкое ограничение метамагии «Ускоренное заклинание» под Чародея.
4. **«ENG-11: `uses` не читается движком»** — устарело, реализовано полностью (`actionUses.ts` + `actionSheet.ts:340-366`). Ограничение — только `by_level` (KB-057).
5. **«6 воззваний/даров — сироты»** — достижимы через `choice(source:'effect_type')`. Реальных сирот-эффектов **27**, не 33.
6. **«13 из 33 detailed_description — выжимки»** — завышено в ~6 раз; реально 1 (`wish`) + 1 частично (`symbol`). Пословный Жаккар меряет перефраз, а не потерю.
7. **«Договор талисмана отсутствует»** — **Pact of the Talisman в PHB 2024 не существует**. 3 договора — корректно.
8. **«Extra Attack: описание содержит текст Мистического рыцаря»** — это дословный RAW Коллегии доблести.
9. **«EFFECT-0149 „Прикосновение целителя“ = Возложение рук паладина»** — это умение **монаха**, названо правильно; переименование сломает верное имя.
10. **«125 лишних дублей карт»** — оспорено (KB-108). Выживает: 22/39 доспехов с неверной ценой + 1 пара «Коротких мечей».
11. **«Ссылка на действие уходит на легаси-копию с вероятностью 50%»** — опровергнуто: порядок детерминирован, каноничная копия первая во всех 5 парах, ссылок `[[…|action:…]]` в проде **0**.
12. **«Превращение» — омоним»** — опровергнуто: 2 из 4 упоминаний = буквально Polymorph.
13. **«Лунный луч: `polymorphed` = сломанное наложение»** — там `op:'remove'` → безвредный no-op.
14. **«Свойства оружия не читаются движком вообще»** — живы **4 из 8**: `ammunition`, `finesse`, `versatile` (через скобочную кость), `two-handed` (через `slot`). RAW `heavy` процитирован автором по редакции 2014.
15. **«Долгий отдых стирает ВСЕ эффекты» → фильтровать `turn.ts:220`** — **ОПАСНО**: `permanent`/`until_dispelled` в проде 0; сплошной wipe — единственный путь истечения для `hours`/`manual`; правка **сделает хуже**. Корень в другом месте (KB-048).
16. **«/api/conditions выгружает состояния»** — состояния уже в `effects.json`; 404 данных не теряет. Теряет только пропуск `concepts` (KB-131).
17. **«FeatCreator textarea → отсюда 0 ссылок в feats.json»** — ложная причинность.
18. **«Мастер большого оружия = −5/+10»** — редакция 2014. RAW 2024: +1 Сила / доп. урон = БМ / Сечь.
19. **«Кираса при ЛВК+5 → 19»** — то, что получится, если сделать KB-001 **без** KB-003.

---

## 9. Грабли

**Схема и синк**
- Канон схемы — `frontend/src/schemas/mechanics.schema.json`. `docs/mechanics.schema.json` — **генерируемая копия**. Мина «синк docs→frontend откатывал боевую схему» **мертва**, но правьте только frontend-копию.
- **`tsc` — не гейт качества, а `vite build` — канонический.** `tsc --noEmit` проходит чисто, но не видит мёртвые экспорты, дубли деклараций (`WeaponTemplate` ×2 сливается молча) и члены интерфейсов пропсов. eslint-конфига **не существовало никогда**.

**Данные и БД**
- **`database/schema.sql` — единственный источник `CREATE TABLE` базовых таблиц.** Удалять `database/` только после миграции `000_base_schema` (KB-159).
- **Go + jsonb: алфавитный порядок ключей.** При сравнении/диффе jsonb-полей ключи сортируются — не полагаться на порядок.
- **gofmt** обязателен: непрогнанный файл валит сборку.
- **`Properties.Value()` пишет JSON в колонки, объявленные `TEXT[]`** у actions/effects (у cards — TEXT, совместимо).
- **Soft-delete + обычный UNIQUE** = удалённая строка навсегда занимает `card_number`. Пересоздание с новым UUID необратимо.
- **Прод-снапшот не отражает всю схему**: собирается через публичные list-эндпоинты → колонок, которых нет в Response (`author`/`source`/`related_*`), в снапшоте физически нет. **«Поля нет в снапшоте» ≠ «колонки нет в БД».**
- **Снапшот большой** (0.3–1.7 МБ) — анализировать `node -e`, не `Read`. `export PATH="/c/Program Files/nodejs:$PATH"`.
- **Двойной гейт «ресурс + `uses`»** у Ярости, Дикого облика, Вдохновения барда: правка только `classes.json` молча не сработает — пул `uses_<key>` удержит старый кап. Чинить **оба места**.
- **Двойное хранение**: `races.lineages[]` — ручной список поверх `is_subrace` (разошёлся у 7 из 12); хардкод `STATIC_LINEAGES` в сидере регрессирует любую правку данных.
- **`defense_type` — чисто декоративное поле**; вся математика доспеха живёт в `bonus_value`, парсимой `/dex/i`. **`weapon_type` — гейт искусности**: null → искусность мертва (20 карт).
- **`apply-spells-2024.mjs` — create-only**: повторный прогон = полный no-op.
- **Контентные скрипты по умолчанию пишут в ПРОДАКШН**; `PUT /api/actions/:id` и `/api/effects/:id` — под OptionalAuth, токен не нужен.

**RAW и локализация**
- **`officials/Player's Handbook 2024.txt` испорчен OCR** («Me/f's Acid Arrow») — непригоден для сверки имён/чисел. Пользоваться русским файлом; английский — только для структурных признаков.
- **Числовые колонки в русском PHB-txt смещены OCR-ом**: строка Варвара L1 читается как «1 2 2». Имена фич и текстовые абзацы надёжны, колонки — нет.
- **RU-локализация PHB внутренне непоследовательна**: «Оглохший» в глоссарии vs «Оглушённым» в статье «Глухота/Слепота» → пайплайн смапил в `stunned` (KB-076).
- **`\b` в JS не работает с кириллицей** — первый прогон линковщика дал 3 совпадения вместо 2340. Использовать Unicode-классы.
- **RAW-реестр таблиц (для canon-раннера):** «Умения <класс>» — Бард 4028, Варвар 4737, Воин 5229, Волшебник 6026, Друид 6891, Жрец 7766, Колдун 8511, Монах 9383, Паладин 9923, Плут 10600, Следопыт 11241, Чародей 11893; «Список черт» 13650; оружие 14809-14868; доспехи 15033-15046; действия 1160-1199; состояния 2270-2274.

**Движок**
- **Дефолт `who` различается по resolution** (`'target'` у attack/check, `'self'` у auto/choice) — грабли №1 при досеве.
- **`matchFilter` закрыт по умолчанию**: неизвестный ключ фильтра → молча инертный модификатор.
- **`formula.ts` резолвит отсутствующее поле контекста молча в 0**, а неизвестную переменную бросает — и `computeAC` её не ловит. **ErrorBoundary в приложении нет.**
- **Токенизатор формул — ASCII-only**; `ABILITY_LABEL_RU` печатает «ЛВК» и провоцирует ввод её же.
- **Префикс id в `applyStandingPayload`** не декоративен (см. §3.2.6).
- **`martial_arts_die` — переменная типа `dice`**: `resolveId` на ней делает `rollDice` → в `count` дала бы случайный размер пула.
- **`limit` в `$defs` принадлежит `explode`/`reroll`** — добавление `limit:1` в payload модификатора будет тихим no-op; под одноразовый модификатор нужно **новое** поле.

**Тесты**
- **Ложно-зелёные тесты — системный риск.** Паттерн «тест изобретает вход, которого нет в проде»: `weapon.test.ts:47-59` (конструирует `filter:{against:'self'}`), `death.test.ts:41` (покрывает `crit`, которого не подаёт ни один продовый вызов), `runtime.mvp.test.ts:61-67` (озаглавлен «per:short_rest», идёт по legacy-ветке), `conditions2024.test.ts:31-33` (закрепляет ложное `unconscious→paralyzed`).
- **Фикстуры кодируют несуществующий словарь**; снапшот прода лежит в репо и **не используется ни одним тестом экипировки/КЗ**; `engine/ac.test.ts` не существует.
- **`mechanics.sweep.mvp.test.ts` закрыт гейтом `process.env.MVP_CONTENT` и ходит в сеть** — из-за этого KB-074 и KB-136 жили незамеченными.
- При починке KB-012/KB-013 тесты `goliathLegacy.test.ts` придётся пересчитать — **это ожидаемо, не регресс**.

---

## 10. История ревью

| Док | Статус | Чем заменён |
|---|---|---|
| `docs/project-review-2026-07-12.md` (130 находок) | **УСТАРЕЛО.** Секции «конструкторы» и «превью этап 2» закрыты; P0#1 закрыт; тезис «source=null у 761» неверифицируем; «нат.20/1 на спасах» — опровергнут. «51 битая ссылка» — дефект был **реален**, обнаружен и закрыт в этой же сессии (`9078764`); опровергнут лишь его ТЕКУЩИЙ статус (BROKEN=0), см. §8.5 п.1 | §7 (реестр), §8.5 (опровержения) |
| `docs/rules-coverage-plan-2026-07-11.md` | **УСТАРЕЛО.** ENG-08 частично, ENG-12 частично, ENG-11 полностью закрыты; МИНА синка схем мертва | §4 (словарь), §7.1–7.13 |
| `docs/remediation-plan-2026-07-08.md` (92 агента) | **УСТАРЕЛО** как план. **Сохраняет силу** раздел «Решения владельца» → перенесён в §8.4 | §7.22 (порядок), §8.4 |
| `docs/remediation-progress-2026-07-08.md` | Устарело: раздел «Что осталось» — D1/D2/D3 закрыты | §8 |
| `docs/engine-architecture-review-2026-07-07.md` | Устарело: **все 6 изменений A–F реализованы** | §3 |
| `docs/content-mechanics-backlog.md` | **УСТАРЕЛО.** Поглощён §7.9/§7.10 | §7 |
| `docs/constructors-audit-2026-07-13.md` | Актуален исторически; **все фазы A/B/C закрыты**, остаток — KB-195 | §8.3 |
| `docs/coverage/class-barbarian.md` + `officials/canon/phb2024/class-barbarian.json` | **Живые и единственные.** Реестр канона покрывает 1 класс из 12 → ни одна находка §7.1/7.10/7.4/7.3 не ловится canon-раннером | KB-135 |
| `docs/mechanics.schema.json` | Генерируемая копия. Править только frontend-оригинал | §3.2.7 |

Прочие доки (`character-creator-plan`, `unified-choices-design`, `variables.md`, `design/`, `battle-design-reference`) — **дизайн-фундамент**, не ревью; сохраняют силу.

---

**Дата: 2026-07-15. Метод: 3 трека (код / правила / контент), 23 суб-аудитора + 3 синтезатора + адверсариальная верификация каждой находки; 293 сырые находки → 209 уникальных записей в реестре; 19 гипотез прошлых ревью опровергнуто и вынесено в §8.5.**
