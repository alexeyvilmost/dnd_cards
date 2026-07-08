# План исправлений по итогам глубокого ревью — 2026-07-08

Источник: многоагентное ревью 2026-07-08 (92 агента: карта кода, веб-исследование правил D&D 2024 / внутренностей BG3 / архитектур эффект-систем, 7 направлений ревью, 76 адверсариальных верификаций — 0 опровергнутых). Все ссылки на файлы/строки проверены по коду на дату документа.

## 0. Как работать по этому плану (обязательно к прочтению исполнителем)

**Парадигмы проекта** (нарушение = баг):
1. **Без хардкода** — если у сущности есть конструктор и интерпретатор, новое моделируется данными. Тест: «изменит ли владелец без перевыкатки?»
2. **Превью везде** — hover-превью из данных сущности на каждом элементе, даже disabled; причина недоступности — слоем поверх.
3. **Методы расчёта** — производное значение = набор методов-кандидатов, берём максимум подходящего; набор расширяется данными.
4. **Гранулярность эффектов** — не сливать разное в один эффект; игрок видит источник каждого модификатора.

Сквозное видение: движок (`frontend/src/engine/`) — универсальный интерпретатор на всём пути персонажа (создание → лист → 2D-бой → кампания). Вдохновение — BG3 (boosts/functors/statuses/interrupts как данные).

**Гейты качества** (прогонять после каждой задачи):
- `cd frontend && npx vitest run` (обычный набор) и `npx vitest run --config vitest.mvp.config.ts` (MVP);
- `npx tsc --noEmit` — 0 ошибок;
- для контент-задач: `node scripts/lint-mechanics.mjs`;
- живые тесты по прод-контенту: `MVP_CONTENT=1 npx vitest run --config vitest.mvp.config.ts` (нужна сеть до прода). Внимание: axios-клиент в node падает на localStorage-интерсепторе — тесты уже содержат заглушку Storage, новые live-тесты писать по образцу `src/mvp/forge.sweep.mvp.test.ts`.

**Деплой:** пуш в `main` → Railway автодеплоит бэк и фронт. Владелец тестирует на проде, локальный стек не поднимает. Прод: бэк `https://backend-production-41c3.up.railway.app`, фронт `https://bagofholding.up.railway.app`. Прод-БД — единственный источник истины контента; контент правится через API (скрипты `scripts/content/*.mjs`, креды импортёра в `scripts/content/api.mjs`).

**Решения владельца — НЕ нарушать:**
- **Авторизацию не трогаем** (решение 2026-07-08): её отсутствие упрощает тестирование; о сайте знает только узкий круг. Всё связанное с auth — этап H, выполняется последним, непосредственно перед публичным запуском. До этого НЕ включать строгий middleware, НЕ разводить пользователей, НЕ прятать /login.
- shortRest = плоские +50% HP, **кости хитов не делаем** (решение №3 от 2026-07-05, закреплено MVP-тестом). Задача D6 — только по отдельной команде владельца.
- Обе темы (тёмная + светлая пергаментная) сохраняются с переключателем; полный редизайн отложен.
- Полная мобильная адаптация — не приоритет (решение №7); в плане только минимальный фикс кузницы (E6).
- Общий public-пользователь остаётся до этапа H.

**Приоритеты:** P0 — ломает MVP-сценарий («создать → вести → прокачивать без разработчика») или заметно всем; P1 — важно; P2 — полировка. Оценки: S ≤ 0.5 дня, M — 0.5–2 дня, L — 2–5 дней.

**Рекомендуемый порядок (полный, каждая задача имеет место):**
1. B1–B4 (перфоманс данных) + E1–E2 (автосейв и ошибки — независимые S-задачи, делать сразу);
2. движок, волна P0: C1, C2, C3, C9, C13, C15;
3. движок, волна P1/P2: C4–C8, C10–C14 (C11 обязателен ДО D4);
4. контент/прогрессия: D1–D4, затем D5 (после C3/C5) и C16 (после C2/C3);
5. B5–B8 (остаток перфоманса) + E3–E6;
6. A1–A9 (чистка) + F1–F5 (быстрая унификация);
7. F6–F9 (каркасы) → G1–G10 (UX; G1 после F8) → F10–F11 (большие рефакторинги);
8. H — только перед публичным запуском.

При конфликте сигналов: этот порядок главный; внутри одного блока — сначала P0. Внутри этапов задачи максимально независимы; зависимости указаны явно в заголовках.

---

## Этап A. Мёртвый код и git-гигиена

Все находки подтверждены grep-ом по всем формам ссылок (импорты, lazy, роуты, строковые пути, конфиги, тесты). Перед каждым удалением исполнителю всё равно повторить быстрый grep — код мог измениться.

### A1. Git-мусор (P1, S)
Удалить из индекса (`git rm --cached` + физически, где мусор):
- `backend/main` — 31,5 МБ скомпилированный бинарник (Windows PE; Dockerfile собирает сам — `go build -o main .`);
- корневые дампы: `dump_20251212_083829.sql` (11 МБ), `dump_correct_utf8.sql` (9 МБ), `dump_fixed_utf8.sql` (15 МБ), пустые `dump_20251212_083750.sql`, `dump_20251216_083948.sql`;
- `frontend/tsconfig.tsbuildinfo`, `frontend/tsconfig.node.tsbuildinfo`.

В `.gitignore` добавить: `backend/main`, `dump_*.sql`, `*.tsbuildinfo`.
Опционально (только с явного подтверждения владельца, т.к. переписывает историю и требует force-push при живом Railway-деплое с GitHub): `git filter-repo` для реального уменьшения клона (size-pack 62 MiB).
**Приёмка:** `git ls-files | grep -E 'backend/main$|dump_|tsbuildinfo'` пусто; бэк собирается.

### A2. Персонажи v1/v2 на бэке (P1, M)
- Удалить `backend/character_controller.go` (705 строк) и `backend/character_v2_controller.go` (1249 строк);
- в `backend/main.go` удалить регистрации 9 роутов v1 + 11 роутов v2 + 2 роута GetCharacterInventories (строки ~269–291);
- на фронте удалить `charactersV2Api` (`frontend/src/api/client.ts:457-464`, никем не импортируется) и комментарий-отсылку в `frontend/src/character/types.ts:3`;
- таблицы БД НЕ трогать (данные остаются);
- вторым проходом вычистить осиротевшие модели/DTO в `backend/models.go`;
- редирект `App.tsx:220` (`/characters-v2` → `/characters-forge`) ОСТАВИТЬ — это фронтовый роут для старых закладок, к API отношения не имеет.

Примечание: `docs/mvp-transition-plan.md:81` декларирует «v2 не трогаем» — это про запрет развития; кодовых потребителей нет, удаление согласовано ревью.
**Приёмка:** бэк компилируется, фронт работает; grep по `'/api/characters-v2'`, `'/api/characters'` (без -v3) и `charactersV2Api` в живом коде пуст (редирект-роут App.tsx не считается).

### A3. Кластер 3D-кубиков (P1, S) — даёт и перфоманс
- Удалить страницы `/dice` и `/dice-test` с роутами (`frontend/src/App.tsx:236,245` + статические импорты `App.tsx:30-31`), файлы `pages/DiceTest.tsx`, `pages/DiceRoller.tsx`, `pages/DiceRoller.css`, `components/Dice3D.tsx`, `components/Dice3D.css`, `lib/dice.js`;
- удалить `declare module 'cannon'` из `frontend/src/vite-env.d.ts:5-11`;
- из `frontend/package.json` удалить: `three`, `cannon`, `@react-three/fiber`, `@react-three/drei`, `@types/three`, `html2canvas` (последние два не импортируются нигде уже сейчас);
- боевой бросок кубов идёт через DiceDialogContext — не задет.

**Приёмка:** `npm run build` проходит; grep `three|cannon` по src пуст; суммарный размер `dist/assets` уменьшился относительно замера непосредственно перед задачей (абсолютная база 2 563 535 байт актуальна только до B4/code-splitting).

### A4. Мёртвые data-каталоги frontend (P2, S)
- Удалить `frontend/character_rules/` (29 файлов), `frontend/backstories/` (14), `frontend/races/` (13), `frontend/tools/` (10), `frontend/classes/` (barbarian.json) — 0 ссылок из кода;
- `frontend/charges/charges.json` — ЖИВОЙ (импорт `src/utils/charges.ts:1`): перенести в `src/data/charges.json`, поправить импорт;
- PNG из `frontend/charges/` либо удалить, либо перенести в `public/charges/` (сейчас пути `/charges/*.png` в проде 404, код это обходит);
- починить битые onError-фолбэки `frontend/src/pages/CardLibrary.tsx:2030,2081` — заменить `/charges/main_action.png` на существующий `/icons/resources/action.png`.

### A5. Мёртвые ассеты public (P2, S)
- Удалить `frontend/public/images/weapons/` целиком (41 файл, вкл. `generate_weapons.sh`, попадающий в прод-статику) и 4 иконки: `icons/bow-hand.png`, `icons/heavy_defense.png`, `icons/light_defense.png`, `icons/medium_defense.png`;
- ПЕРЕД удалением прогнать по живой прод-БД: `SELECT count(*) FROM cards WHERE image_url LIKE '%images/weapons%'` (снапшот data/cards-all.json от 2026-07-03 показывает 0, но мог устареть).

### A6. Мёртвые эндпоинты и функции бэка (P2, M) — делать ВМЕСТЕ с A8
- `POST /api/cards/generate-image`, `POST /api/cards/export` (main.go:156-157; controller.go:692,748) + методы `cardsApi.generateImage/exportCards` в client.ts:131,137 (генерация идёт через imagesApi, экспорт — клиентский jspdf);
- `GET /cards/:id/battle-stats`, `POST /cards/battle-stats` + `deriveBattleKind` (controller.go:150-267) — сервис battle удалён;
- ветки `entity_type == "weapon_template"` в image_controller.go:63-66,143-147; сузить тип entityType до 'card' в imagesApi.ts/ImageGenerator/ImageUploader;
- `effects_utils.go`: оставить только ValidateEffect/ValidateEffects (2 вызова controller.go:375,629), удалить AnalyzeCardEffects/GetEffectDescription/GetEffectsSummary и словари (строки 16-197, 281+);
- `Rarity.GetColor` (models.go:555) — не вызывается;
- debug-роуты `/api/debug`, `/api/test`, `/api/test-auth`, `/api/auth/test` (main.go:110-139) — их зовёт только легаси `scripts/test_backend.py`, удаляемый в A8.

### A7. Легаси-каталоги корня (P2, S)
Удалить: `V4 System/` (нереализованный api/v4), `Способности/`, `database/` (вытеснен 70 Go-миграциями; поправить устаревший шаг в `backend/README.md:22`), `Gortak.json`, `Hara.json`, `Hara_data.json`, `Hara_full_info.json`, `dummy.json`, `example.json`, `modify_attack.json`, `rage.json`, `image.png`, корневой `site_logo.png` (байт-в-байт дубль живого `frontend/public/site_logo.png`), `fix_dump_encoding.ps1`, `fix_foreign_key.sql`, пустой корневой `package-lock.json`.
`references/` (36 МБ: 22 скриншота BG3 + мёртвый battle-spell-data-reference.js) — спросить владельца: вынести из git с сохранением локально, или удалить.

### A8. Кладбище scripts/ и backend/tests (P2, S)
- Удалить одноразовые 21 `.go` + 18 `.py` из `scripts/` вместе с `scripts/go.mod`/`go.sum`/`Makefile`/`run_tests.*` (история остаётся в git);
- удалить `backend/tests/` (pytest против удалённых роутов, маковский путь в conftest.py:75-79) и локальный пустой `backend/src/` (Java-скелет, git его не трекает);
- ЖИВЫЕ `.mjs` в scripts/ НЕ трогать (export-cards, coverage-report, lint-mechanics, audit-*, sync-mechanics-schema и весь scripts/content/);
- поправить стейл-упоминания: `scripts/audit-equipment.mjs:102` (console.log) и `.cursor/rules/new-field copy.mdc`.

### A9. Мелкий мёртвый код фронта (P2, S)
- `frontend/src/hooks/useCardTilt.ts` (67 строк), `frontend/src/utils/characterCalculationsV3.ts` (226 строк);
- оба объявления `interface WeaponTemplate` в `types/index.ts:219,288` (0 потребителей);
- CSS: `.card-border` и `.card-border-*` (index.css:12-43), `.card-preview-large` (index.css:75) вместе с всегда-ложной проверкой `className.includes('card-preview-large')` в `CardPreview.tsx:113`;
- tailwind.config.js: палитра `rarity.*` (строки 11-17) и `shadow-card` (24). `shadow-card-hover` ЖИВОЙ (CardExport.tsx:535) — оставить. Примечание: rarity.* и .card-border-* фигурируют и в F2 как 2 из «6 источников истины» редкости — можно удалить их здесь (тогда в F2 сводить остаётся 4), либо отложить их до F2; не делать дважды.

---

## Этап B. Производительность

### B1. Миграция base64-иконок в Yandex Object Storage (P0, M) — главный тормоз сайта
Факт (замер прода 2026-07-08): `GET /api/spells?limit=500` = 25,4 МБ (у 196/393 заклинаний image_url — data-URL ~125 КБ), `/api/actions?limit=50` = 5,5 МБ (25/25 по ~217 КБ), `/api/feats?limit=200` = 5,0 МБ (25/77), `/api/effects` = 1,7 МБ (13/425). Кузница при открытии качает ~32,5 МБ. Предметы (cards) — эталон: 0 base64, 50 шт = 56 КБ.

Сделать одноразовый скрипт `scripts/content/migrate-base64-images.mjs`:
- пройти spells/actions/feats/effects, у кого `image_url LIKE 'data:%'`;
- залить картинку в Yandex Object Storage (конвейер существует: `backend/yandex_storage_service.go`, эндпоинт standalone-загрузки из `gen-spell-icons.mjs`);
- PUT новую https-ссылку через публичный API (PUT для этих сущностей публичный);
- отчёт в json (сколько, какие упали) по образцу `spells2024-apply-report.json`.

**Приёмка:** `/api/spells?limit=500` < 1 МБ; ни одного `data:` в списковых ответах; иконки видны в библиотеке/кузнице/листе. Нюанс: у gpt-image-1 фон прозрачный — это не дефект.

### B2. Облегчённый списковый DTO (P1, M, после B1)
- Бэк: параметр `?fields=list` (или отдельный ToXListResponse) у cards/spells/actions/effects/feats/backgrounds — без `detailed_description` и `mechanics` (image_url после B1 лёгкий — оставить, он нужен спискам);
- фронт: использовать в CardLibrary, каталогах кузницы и в `FormattedTextarea.searchLinkTargets` (`frontend/src/components/FormattedTextarea.tsx:39-44` — сейчас автодополнение `[[...]]` качает до 2,9 МБ на ввод символа, нужны только id/name);
- заодно: верхняя граница `limit` в списковых эндпоинтах (сейчас `limit=100000` сработает).

### B3. gzip на бэке (P1, S)
`backend/main.go`: `github.com/gin-contrib/gzip`, `r.Use(gzip.Gzip(gzip.DefaultCompression))`. Замер: /api/cards?limit=30 33,8 КБ → ~4,3 КБ (−87%). Делать в паре с B1 (base64 не жмётся).

### B4. Code-splitting по роутам (P1, S)
`frontend/src/App.tsx:10-52` — все ~45 страниц импортируются жадно, ни одного React.lazy; `vite.config.ts` без manualChunks. Перевести на `React.lazy` + Suspense минимум: CardExport (jsPDF), ImageStudio, все *Creator (ajv), тяжёлые страницы. (three/cannon уйдут в A3.)
**Приёмка:** основной чанк заметно меньше 2,5 МБ; переходы работают.

### B5. Водопад загрузки листа/кузницы (P1, M)
- `frontend/src/character/assemble.ts:189-304` (loadBundle) — ~10 последовательных сетевых стадий: распараллелить независимые (feats + origin feat :203 + subrace :211 + subclass :215 одним Promise.all; actions :293 + variables :301 тоже);
- `frontend/src/pages/CharacterSheetMVP.tsx:177-183` и `frontend/src/components/SheetEquipmentPanel.tsx:94-108` — карты экипировки грузятся for-await по одной → `Promise.all`;
- добавить кэш по id для getFeat/getAction/getEffect/getCard (по образцу кэша slug-резолва в `character/registries.ts`), чтобы смена уровня в кузнице (`CharacterForge.tsx:139-148` refsKey) не перекачивала всё;
- перспектива (отдельная задача, не блокер): батч-эндпоинт `GET /api/cards?ids=…` или отдача собранного бандла персонажа одним запросом.

### B6. Ре-рендер CardLibrary на mousemove (P1, M)
`CardLibrary.tsx:219` — mousePosition в state страницы, обновляется в onMouseMove строк list-режима (строки 1620, 1953, 2152, 2203, 2279, 2304, 2363, 2395) → полный ре-рендер 2491-строчного компонента с сотнями строк. React.memo в проекте нет вообще.
- Позиционировать превью через ref + прямую запись transform без setState, либо перевести на общий портальный примитив (связано с F8);
- React.memo на элементы сетки/строк со стабильными колбэками;
- виртуализация (react-window) — отдельно, при росте каталога.

### B7. Кэширование каталогов (P2, S)
- Клиент: модульный in-memory кэш списков (ключ URL+params, TTL 5–10 мин) — сейчас каждое переключение вкладки = повторная загрузка (`CardLibrary.tsx:616-646`, `CharacterForge.tsx:76-97`);
- бэк: `Cache-Control: private, max-age=300` на GET-списки справочников; ETag по updated_at — позже.

### B8. GET /api/characters-v3 без пагинации (P2, S)
`backend/character_v3_controller.go:143-149` — Find без Limit с Preload(User)+Preload(Group), полные jsonb (runtime, inventory_items) на каждый показ списка. Добавить page/limit и лёгкий списковый DTO (id, имя, класс, уровень, аватар). Не трогать общего public-пользователя (этап H).

---

## Этап C. Движок: доведение ширины (ядро плана)

Контекст: все 6 изменений A–F из `docs/engine-architecture-review-2026-07-07.md` уже реализованы (dispatch.ts, derivedValue.ts, circumstances.ts, stackApply, реестр состояний, describeMechanics.ts) — док устарел, НЕ реализовывать его повторно. Задачи ниже — «ширина» поверх готового фундамента.

### C1. Сбор модификаторов урона (P0, M) — Ярость в проде не работает
`collectModifiers` вызывается только с roll `attack`/`saving_throw`/`ability_check` (`frontend/src/engine/execute.ts:555,604,634,818`); `resolveDamageAmounts` (execute.ts:396-441) и `weaponAttackPreview` (`engine/weapon.ts:216-254`) модификаторы `applies_to.roll:'damage'` не запрашивают. При этом прод-контент их авторит: Ярость (`scripts/content/seed-variable-effects.mjs:148-153` — `{roll:'damage', filter:{ability:'str'}, value:'rage_damage_modifier'}`), «Свет Латандера» +3 (`fix-11-items.mjs:54`). Превью честно показывает бонус (describeMechanics.ts:24), бросок его не получает.

Сделать:
- в resolveDamageAmounts вызвать `collectModifiers(state, passives, {roll:'damage', filter:{ability, attack_kind/hand}, formulaCtx, evalCtx})` и влить результат отдельными частями в основную строку урона (гранулярность №4: игрок видит «+2 Ярость» отдельной строкой);
- ВАЖНО: matchFilter (`engine/modifiers.ts:35-42`) отсеивает эффекты с фильтром, если запрос не передал соответствующий ключ — запрос обязан передавать `ability` использованной характеристики (иначе Ярость отсеется);
- зеркально добавить в weaponAttackPreview (превью = исполнению, парадигма №2);
- golden-тест: «Ярость активна → атака СИЛ → урон +rage_damage_modifier».

### C2. Эффекты на цель: поле who (P0, L)
Схема объявляет `who:'target'|'self'` (mechanics.schema.json:158), движок его не читает нигде: applyCondition/applyHealing мутируют state ИСПОЛНИТЕЛЯ (execute.ts:328-360, 291-310) — «ошеломлён» от Hold Person ложится на кастера (зафиксировано тестом engine.coverage.mvp.test.ts:140-155 как текущая норма). UI передаёт цель-заглушку `{ac, saveMods:0}` (`SheetActionsPanel.tsx:181-186`).

Сделать:
- исполнение payload-ов в `target.runtimeState` при `who:'target'`; возвращать `targetState` в ExecuteResult;
- на листе — минимальная персистентная «виртуальная цель боя» (состояния/HP в turn_state), чтобы состояние цели жило между действиями;
- `projectedAgainst` (execute.ts:97-105): значения прогонять через `evaluate()` вместо `Number()` (формульные scope:'target'-модификаторы сейчас молча теряются);
- контент-фикс: «Уклонение» (посеяно migrations.go:730 как modifier с filter `{against:'self'}`) перевести на `scope:'target'` через API — сейчас помеха атак по уклоняющемуся мертва;
- обновить тест engine.coverage.mvp.test.ts:140-155 на новое (правильное) поведение.

### C3. Ширина шины событий + endTurn (P0, L)
Эмитятся 3 события из 22 словаря схемы: hit/crit (execute.ts:583-584), damage_taken (execute.ts:841). Функции endTurn не существует; `save_ends`/`ends_when`/`requires_each_turn`/`repeat` из схемы не потребляются никем; long_rest исполняется хардкод-сканом `applyLongRestPassives` (turn.ts:104-132, только resource+grant, мимо circumstances/uses-гейтов); в runAttackRoll нет ветки miss (и on_miss из схемы игнорируется).

Сделать:
- `endTurn(state, ctx)` в turn.ts; тик длительностей end_of_turn; исполнение save_ends активных состояний (повторный спасбросок в конце хода — модель 2024 для Hold Person/ядов);
- эмитить: turn_start, turn_end, miss (ветка промаха runAttackRoll), spell_cast, short_rest, long_rest, reduced_to_0_hp;
- applyLongRestPassives удалить, прогнав его случай через штатный runMechanicEffects слушателем long_rest;
- контрактный тест: каждый event из enum схемы либо эмитится, либо в явном allowlist `planned` с комментарием;
- добавить в DomainEvent поля `source`/`target` (сейчас их нет — dispatch.ts:20-25) и проверку `trigger.subject` из схемы в collectListeners (dispatch.ts:57-80 её игнорирует) — без этого «когда союзник атакован» невыразимо; если откладываешь — внеси subject в allowlist planned;
- UI: кнопка «Конец хода» рядом с существующим startTurn (лист уже имеет кнопку хода).

Это открывает данными: Ready, тикающие яды/горение, Graze/Vex (оружейное мастерство 2024), Recharge X–Y (C6), реакции на 0 HP.
ОТЛОЖЕНО (слой перед 2D-боем, не сейчас): `EncounterState {actors: Record<actorId, {character, runtime}>}` — «мир из N состояний» вместо одного RuntimeState; C2/C3 проектировать так, чтобы actorId лёг сверху без переписывания.

### C4. Очередь событий вместо рекурсии (P1, M) — латентный stack overflow
`emitEvent → runMechanicEffects → runAttackRoll → emitEvent('hit')` — прямая рекурсия без лимита (execute.ts:583-584, 700, 724-754). Слушатель на hit, чья механика сама содержит `resolution:'attack_roll'` («при попадании — дополнительная атака», легальные данные конструктора), рекурсирует бесконечно. Хуже: гейт uses.per:'turn' не защищает внутри каскада — `fired.add` происходит ПОСЛЕ runMechanicEffects, firedThisTurn коммитится в конце внешнего вызова (execute.ts:746,752), вложенный emitEvent видит слушателя несработавшим. В планирующем прогоне `PLANNING_RNG=0.94` (dicePlan.ts:23) — вечный nat 19 → детерминированное зацикливание при построении плана кубов.

Сделать: FIFO-очередь (emitEvent кладёт, обработка циклом после завершения текущего слушателя), лимит каскада (например 8 событий на действие) с narrative-логом при срезе, правило «слушатель не реагирует на события собственного исполнения» (originListenerId в DomainEvent), fired.add — ДО запуска механики слушателя.

### C5. Алгебра модификаторов: mode + priority (P1, M)
`collectFromPayload` (modifiers.ts:64-81) понимает только advantage/disadvantage/add; op `set`/`multiply`/`reroll` из enum схемы (mechanics.schema.json:369) молча отбрасываются; режимов Upgrade/Downgrade нет — «Пояс силы огра» (СИЛ не ниже 19), флагманский пример парадигмы №3, невыразим данными.

Сделать по модели Foundry ACTIVE_EFFECT_MODES + priority (Custom→Multiply→Add→Downgrade→Upgrade→Override, по умолчанию priority = mode×10): расширить RollModifier полем mode, сортировка по priority перед свёрткой, итог по GAS-формуле `(base + ΣAdd) × (1 + Σmult)`. До реализации каждого mode — narrative-лог «op не поддержан» вместо тихого сброса (сейчас контента с set/multiply нет, но схема и AI-генерация их допускают).

### C6. Единый резолвер длительностей (P1, M)
Асимметрия: applyCondition ставит roundsLeft из duration.rounds (execute.ts:348-356), applyModifierPayload — нет (execute.ts:274-289; expiryFromDuration знает только until_start_of_next_turn) → бафф «+2 на 3 раунда» висит вечно. `end_of_turn` существует только как подпись (effects.ts:35). uses.per:'round' неотличим от 'turn' (execute.ts:740,746). `uses.recharge` («5–6» у монстров) не потребляется (actionUses.ts:28-35). longRest НЕ обнуляет hp.temp (turn.ts:134-148; по RAW 2024 temp HP живут до конца длинного отдыха).

Сделать: единый `resolveDuration(duration) → {roundsLeft, expiry, tickType}` для ВСЕХ payload-kind; tickType StartTurn/EndTurn как в BG3 (обрабатывать в startTurn/endTurn из C3); minutes/hours → конвертация в раунды в бою (1 мин = 10 раундов) или expiry 'manual' с подписью — осознанно, не молча; `hp.temp = 0` в longRest; recharge X–Y — слушатель turn_start (после C3); различить per:'round' и per:'turn'.

### C7. Свёртка преимущества/помехи (P1, S)
`combineAdvantage` (modifiers.ts:27-32) — бинарная порядкозависимая свёртка: [adv,dis,adv] → advantage, [adv,adv,dis] → none. RAW 2024: adv+dis всегда полностью взаимоуничтожаются. Баг во всех трёх точках: modifiers.ts:65, execute.ts:102 (projectedAgainst), execute.ts:566 (свёртка collected+projected).
Сделать: копить hasAdvantage/hasDisadvantage за проход, сворачивать в конце. ОСТОРОЖНО: предикат has_advantage читает advantageSoFar по ходу свёртки (circumstances.ts:62-63) — сохранить его семантику.

### C8. Обобщение парадигмы №3 + имена методов (P1, M)
`pickBestMethod` (derivedValue.ts) вызывается вне тестов только из computeAC (ac.ts:147). СЛ заклинаний/инициатива/скорость — линейные суммы (breakdown.ts:147-174). Плюс баг видимости источника: acBaseOverrides (ac.ts:130-136) отбрасывает `mech.name` — каждый set_value ac_base метод подписан «Защита без доспехов» (Доспех мага получит чужое имя; удар по №2/№4).
Сделать: `derivedMethodsOf(passives, target)` с сохранением имени механики-источника; применить pickBestMethod к speed/initiative (и spell_dc при появлении данных); set_value targets speed/initiative из схемы (сейчас читается только ac_base — ac.ts:43). «Пояс силы огра» = Upgrade-модификатор (C5) или метод характеристики — оба пути валидны.

### C9. Единый расчёт КЗ + spellcasting подкласса (P0, M)
КЗ считается трижды по-разному: `assemble.ts:178` (10+dex, черновой), `resolveCharacterRules.ts:421` (10+dex+numericMods, БЕЗ брони — именно это персистится в БД через `forgeHelpers.ts:148`!), `breakdownValue('ac')` → полный computeAC с бронёй (то, что видит игрок). Персонаж в кольчуге: в БД одно число, на листе другое, в сводке кузницы третье.
Сделать:
- источник истины — breakdownValue/computeAC: resolveCharacterRules вызывает его (карты экипировки на этапе резолва доступны); assemble.derived.ac пометить @deprecated или удалить; сводка кузницы (`character/components.tsx:524`) показывает то же число, что лист (или явно подписывает «без доспеха»);
- `resolveCharacterRules.ts:454`: передать subclassName в spellcasting() (как в assemble.ts:181) — чинит null-заклинательство Мистического рыцаря/Ловкача на листе (лист читает именно ruleState.spellcasting: SheetActionsPanel.tsx:131,196,363);
- стратегически (можно отдельной задачей): `spellcasting_ability` — в данные класса/подкласса (поле в backend/models_classes.go + миграция + заполнение через API), фолбэк на карту CLASS_SPELL_ABILITY (`derive.ts:50-58`) на переходный период — сейчас новый кастер требует перевыкатки (нарушение №1);
- мультикласс — отдельный этап (НЕ сейчас), но при правках заложить расширяемость: formulaCtx строит classLevels из одного класса (resolveCharacterRules.ts:383) — структуру собирать так, чтобы будущий draft.classes лёг без переписывания формул `class_level:<id>`.

### C10. target_has_condition и prone (P1, S)
Предикат читает ctx.targetConditions (circumstances.ts:60-61), но `evalCtxOf` (execute.ts:72-79) — единственный продакшн-конструктор EvalContext — его не заполняет: в реальном исполнении «преимущество, пока цель распластана» не срабатывает никогда (тест modifiers.test.ts:42-46 заполняет поле руками).
Сделать: `targetConditions: activeConditionsOf(ctx.target?.runtimeState)` в evalCtxOf (функция принимает undefined). Плюс контент: у prone в реестре (conditions.ts:82-86) нет scope:'target' ADV_AGAINST — «атаки по распластанному с 5 футов с преимуществом» не работает ни одним путём; добавить в данные состояния. Интеграционный тест: цель с prone → атака с преимуществом.

### C11. Дальнобойное оружие (P1, S)
`pickAbility` (weapon.ts:22-30) даёт ЛВК только при finesse — лук/арбалет атакует и наносит урон от СИЛ; слова «ranged» в engine/ нет вообще, категории карт simple_ranged/martial_ranged (types/index.ts:305-306) движком не читаются.
Сделать: в pickAbility учитывать категорию/свойство карты (данные!): ranged → dex, thrown → max(str,dex), finesse → max (есть). Боеприпасы — позже, обычным ресурсом через canPay.

### C12. runAbilityCheck: владение и payload-ы (P2, S)
`execute.ts:633` прибавляет profBonus безусловно (поле ctx.character.skillProficiencies есть — contracts.ts:130); on_success исполняет только narrative/movement — condition:prone от Толчка через общий applyPayloads не применится; mode:'dc' из схемы не реализован (только contest).
Сделать: гейт БМ по владению навыком; on_success через общий applyPayloads; поддержать mode:'dc'.

### C13. Синхронизация схема ↔ рантайм (P0, S) — валидатор бракует рабочий контент
Enum payload.kind (mechanics.schema.json:181) не знает `variable` (исполняется: variables.ts:37), `grant_effect` (assemble.ts:335), `grant_language`/`grant_expertise` (resolveCharacterRules.ts:203-213) — validateMechanics блокирует сохранение в креаторах (ActionCreator.tsx:195-199), lint-mechanics бракует сид переменных. Обратно: set_die/grant_action в enum есть, но не исполняются (it.todo); grant_ability_score/sense/speed валидны и молча игнорируются. cost.resource — закрытый enum 22 строк против data-driven справочника /api/resources (нарушение №1).
Сделать:
- дополнить enum недостающими kind; править В ОРИГИНАЛЕ `docs/mechanics.schema.json` и прогнать `scripts/sync-mechanics-schema.mjs` (схема в двух копиях!);
- cost.resource → type:string + examples (существование валидировать по справочнику ресурсов);
- контрактный тест двусторонней полноты: каждый kind рантайма есть в схеме; каждый kind схемы либо исполняется, либо в явном allowlist planned;
- резолверу — narrative-конфликт «payload не поддержан» вместо молчания (честная деградация; см. также D3);
- ОБНОВИТЬ системный промпт AI-механик (`backend/ai_mechanics_controller.go:36-75`) — он дублирует enum схемы.

### C14. Ручные броски листа: полный путь модификаторов (P1, S)
`CharacterSheetMVP.tsx:326` и `CharacterSheetV2.tsx:88` зовут @deprecated collectRollModifiers без formulaCtx/evalCtx (modifiers.ts:126-132): when-условия не гейтят, формульные значения пропускаются, а литеральные модификаторы ЗАДВАИВАЮТСЯ (parts из breakdownValue + collected.modifiers суммируются без дедупликации).
Сделать: передать formulaCtx/evalCtx (на листе уже строятся для breakdown), устранить двойной счёт, удалить deprecated-обёртку и её реэкспорт из contracts.ts:208 (обновить тесты runtime.mvp.test.ts / weapon.test.ts / engine.coverage.mvp.test.ts, которые сидят на реэкспорте).

### C15. applyIncomingDamage в UI (P0, M)
Полный конвейер входящего урона — сопротивление/иммунитет/уязвимость, авто-концентрация с помехой при крите, damage_taken → реакции (Адское возмездие) — реализован (execute.ts:790-844) и покрыт тестами, но вызывается ТОЛЬКО из тестов. `SheetHpPanel.tsx:86` зовёт голый applyDamage из hp.ts (без типа урона), концентрацию дублирует локально (:94-113, беднее движковой: без collectModifiers и помехи при крите).
Сделать: селектор типа урона + чекбокс «крит» в панели HP; заменить ветку на applyIncomingDamage; удалить локальный дубль концентрации; pendingReactions — через существующий ReactionPromptContext (тот же поток, что SheetActionsPanel.tsx:232-242). Нюанс: проверка концентрации интерактивна (диалог кубов) — пробросить rng через ctx.

### C16. Зоны/эманации и призывы (P1, L, после C2/C3)
Секция `targeting` с шестью формами AoE, включая новую в 2024 Emanation и aura, описана схемой (mechanics.schema.json:104-119), но в движке единственная ссылка — транзит в validateMechanics.ts:32; area/shape/max_targets не влияют ни на что (actionNeedsTarget смотрит только на resolution — `character/actionSheet.ts:221-228`). Payload kind `summon` отсутствует и в схеме, и в applyPayloads (resolution 'summon' → NOT_IMPLEMENTED, тест engine.coverage.mvp.test.ts:117-121). Модель 2024 «зона тикает при входе/конце хода» (Spirit Guardians — эманация, движется с носителем; Conjure Animals — подвижная зона) нереализуема.
Сделать по образцу BG3 (зона = статус с TickType и функторами):
- зона — ActiveEffectEntry с trigger-механикой (turn_end/creature_enters_area), которую слушает шина из C3; emanation — aura-эффект носителя со scope:'target';
- призыв — payload `{kind:'summon', statblock_ref, scaling}`, создающий вторичный RuntimeState; у InitiativeTracker уже есть подобие статблоков — унифицировать, не плодить третью модель;
- минимальный первый шаг (можно отдельно, S): потреблять `targeting.max_targets` и `needsTarget` из данных вместо resolution-эвристики.
Полная реализация упирается в многоакторность (см. «ОТЛОЖЕНО» в C3) — допустимо сделать только «минимальный первый шаг» сейчас и вернуться к зонам вместе с EncounterState; решение зафиксировать в PR.

---

## Этап D. Контент и прогрессия (в основном — данные, без перевыкатки)

### D1. Слоты кастеров + апкаст (P0, M) — стена 3 уровня
Факт (прод-БД): у полных кастеров (Бард/Волшебник/Друид/Жрец/Чародей) в class.resources только `spell_slot_1` с формулой min(self_level+1,3); у Колдуна min(self_level,2) без роста круга. 64 заклинания 2 круга стоят `{resource:'spell_slot', level:2}` → costKey `spell_slot_2` (cost.ts:16-20) не существует → заклинание навсегда серое. Апкаст движком поддержан (execute.ts:179-182), но UI никогда не передаёт ctx.spell (SheetActionsPanel.tsx:190-191, runtime.ts:82-94).
Сделать:
- данные: by_level-таблицы `spell_slot_1..9` у полных кастеров и Колдуна по PHB 2024 (образец формата УЖЕ в проде у Паладина/Следопыта/EK/AT); правится через API;
- UI: пикер уровня слота при касте (если доступен слот выше базового), прокинуть `spell:{baseLevel, castLevel}` в ExecuteContext;
- опционально: canPay/pay «заплатить старшим слотом» при отсутствии базового;
- опционально (RAW 2024 «один слот заклинаний за ход»): флаг spentSlotThisTurn в RuntimeState, проверка в canPay для resource:'spell_slot', сброс в startTurn — сейчас правило не гейтится вовсе;
- live-тест: волшебник 5 уровня кастует заклинание 2 и 3 круга.

### D2. ASI / черта на 4 уровне (P0, M, после D3)
Факт: ни один из 12 базовых классов не имеет level_progression["4"]; кузница хранит ровно одну черту (toggleFeat, CharacterForge.tsx:269-270 — [fid] заменяет массив).
Сделать:
- данные: эффект уровня 4 (и 8/12/16/19 — сразу, тем же паттерном) в level_progression каждого класса с choice: грант черты категории general ИЛИ grant_ability_score +2/+1+1 (ASI в 2024 — сама черта категории general, можно смоделировать чертой);
- кузница: множественные featIds в драфте;
- резолвер: grant_ability_score (D3).

### D3. Грант-тройка: ability_score / sense / speed (P0, M)
grantFromPayload (resolveCharacterRules.ts:201-244) знает только language/expertise/feat/spell/proficiency; grant_ability_score/grant_sense/grant_speed возвращают null БЕЗ конфликта (тест resolveCharacterRules.test.ts:268-283 фиксирует молчание). В проде 12 эффектов grant_sense (тёмное зрение дроу и др.) + 5 grant_speed (Лесной эльф +5 — на листе 30 вместо 35) не работают.
Сделать:
- grant_ability_score → модификация scores до расчёта модов (гранулярно, с источником в appliedGrants);
- grant_speed → канал numericMods.speed (уже существует);
- grant_sense → новое поле ruleState.senses + строка «Чувства» на листе (сейчас тёмное зрение — захардкоженный прочерк, CharacterSheetV2.tsx:267);
- для любого НЕ поддержанного kind — warning-конфликт «не поддерживается» вместо молчания (см. C13);
- тесты на конкретные числа (урок свипов: проверять значения и видимость в UI, а не только «0 issues»).

### D4. Ремеханизация ядровых способностей (P1, M, после C1/C3/C11)
Факт (прод-БД): Скрытая атака (EFF-sneak-attack) — narrative-текст; Хитрое действие (EFF-cunning-action) — narrative (+ опечатка «Засada» — починить при любом исходе); из 10 боевых стилей механизирована только Оборона (fs_defense), 9 — narrative, включая Стрельбу (+2 атаки) и Дуэлянта (+2 урона).
Сделать контент-батчем (по образцу `scripts/content/batches/apply-g8-quality.mjs`; отчёты — в `scripts/content/batches/data/`):
- Стрельба = modifier roll:'attack' + фильтр ranged (нужен C11 для фильтра по типу оружия; до C11 — честная деградация с narrative-пометкой, как у Дуэлянта);
- Дуэлянт = modifier roll:'damage' с условием «одноручное, вторая рука свободна» (предикат wielding — если не реализован, честная деградация с narrative-пометкой);
- Скрытая атака = triggered on-hit + uses per:'turn' + roll:'damage' формулой от уровня (движок поддерживает triggered/firedThisTurn уже сейчас);
- Ярость: после C1 заработает сама; добавить duration rounds:10 (истечение — после C6);
- Хитрое действие — требует исполнения grant_action (it.todo движка): либо реализовать grant_action в applyPayloads, либо оставить narrative с явной пометкой.

### D5. Состояния: 15/15 и «сильные» половины (P1, L, после C3/C5)
Факт: в реестре 13 состояний (conditions.ts:37-102, сид migrations.go:667-679) — нет Exhaustion и Petrified; ConditionModifier ограничен модификаторами трёх видов бросков — «скорость 0» (grappled/restrained), авто-провал спасов СИЛ/ЛВК (paralyzed/stunned/unconscious), блокировка действий (incapacitated), авто-крит с 5 футов живут только в note-тексте: ошеломлённый персонаж на листе спокойно действует (disabledInfo проверяет только экипировку и ресурсы — SheetActionsPanel.tsx:255-263).
Сделать (данными + новые kind в словаре правил состояний):
- `{applies_to:{roll:'speed'}, op:'set', value:0}` (нужен C5 set-mode), `{kind:'auto_fail_save', ability:[...]}`, `{kind:'block_resource', resource:[action,bonus_action,reaction]}` (canPay уже умеет ресурсы — блокировка ложится естественно), `{kind:'auto_crit_within', range:5}`;
- Exhaustion — состояние со stack_type:'stack' и значением-формулой от числа стеков (BG3-паттерн SG_X.Amount; −2 d20-тесты, −5 фт за уровень; сейчас cond:<value> имеет политику overwrite — execute.ts:232-237 — второй уровень перезапишет первый);
- Petrified — по правилам 2024;
- посеять оба в /api/conditions; помеха на инициативу от incapacitated/surprised.

### D6. Кости хитов (ОТЛОЖЕНО решением владельца)
НЕ делать без явной команды. Решение №3 от 2026-07-05: короткий отдых = +50% HP, костей хитов нет; закреплено MVP-тестом. Если владелец передумает: hit_die_dX как обычный ресурс (count = уровень, recharge long_rest — в 2024 ВСЕ кости), «потратить кость хитов» — действие данными.

---

## Этап E. MVP-полировка (первый контакт игрока)

### E1. Автосейв черновика кузницы (P0, S)
CharacterForge.tsx:53 — весь черновик в useState; F5/свайп назад = потеря 15 минут выборов. Автосохранять draft в localStorage (debounce по patch), при входе предлагать «Продолжить создание?», чистить по успешному save. Редактирование по editId безопасно уже сейчас.

### E2. Ошибки сети + 404 (P0, S)
- CharacterForge.tsx:80-84: пять каталогов глотают reject `.catch(() => [])` — при недоступном бэке игрок видит враньё «Нет видов в базе.» (:805) / «Нет классов в базе.» (:904). Показать баннер «Не удалось загрузить справочники» + кнопка повтора;
- App.tsx: нет Route path="*" — опечатка в URL = пустой белый экран. Добавить страницу «не найдено» со ссылками на / и /characters-forge.

### E3. Сохранение кузницы лечит до полного HP (P1, S)
buildSavePayload безусловно ставит current_hp = maxHP (forgeHelpers.ts:144-145), save() шлёт это и при update (CharacterForge.tsx:344-347) — правка языка посреди сессии восстанавливает хиты. Передавать current_hp = min(старый current, новый max); ресурсы уже делаются правильно (syncRuntimeResources) — выровнять симметрично.

### E4. Два независимых поля «КЗ цели» (P1, S)
targetAc — локальный useState инстанса панели (SheetActionsPanel.tsx:100), поле не гейтится spellsOnly (:329-341), классический лист монтирует панель дважды (CharacterSheetMVP.tsx:440 и :735) — атака оружием и заклинание могут целиться в разные КЗ. Поднять targetAc в состояние страницы/контекст.

### E5. Спас-модификатор цели (P2, S)
SheetActionsPanel.tsx:181-185 жёстко передаёт saveMods нулями — Огненные ладони против огра считаются от +0. Добавить рядом с «КЗ цели» поле «Спас цели» (один модификатор достаточно для MVP) и передавать по ability механики.

### E6. Минимальная мобильная кузница (P2, S; полная адаптация — не приоритет, решение №7)
.forge-nav 104px + .forge-summary flex:0 0 390px (CharacterForge.css:57-63, 101-107) = ~495px несжимаемой ширины при `.forge { position:fixed; inset:0; overflow:hidden }` (:13-20) — на телефоне сводка обрезается БЕЗ прокрутки. Один media query ≤820px: сводка вниз (одна колонка), навигация горизонтальной лентой.

---

## Этап F. Унификация (ускорение разработки)

Порядок: F1–F5 — быстрые победы (суммарно 2–3 дня, −800 строк, риск минимальный) → F6–F9 каркасы → F10–F11 большие. Не пере-обобщать: поля форм/модалок реально разные — обобщается каркас, различия остаются JSX-детьми/конфигом.

### F1. Фабрика API-клиентов (P1, S)
client.ts:89-444 — 11 неймспейсов × одинаковая пятёрка get/getAll/create/update/delete (~356 строк). `makeCrudApi<T, CreateReq, ListParams>(path, listKey)` ~25 строк; неймспейс = 1 строка + экстра-методы поверх. Типы: `type UpdateXRequest = Partial<CreateXRequest>` (7 из 11 уже так) и generic `ListResponse<K, T>`. Нюанс: UpdateCardRequest содержит image_url, которого нет в Create (используется: CardDetailModal.tsx:101) — для Card будет `Partial<Create> & {image_url?}`.

### F2. Единый модуль редкости + починка живого бага (P1, S)
6 источников истины: tailwind.config.js:11-17, types/index.ts:233+ (RARITY_OPTIONS), index.css .card-border-*, cardStyles.ts:8-15 (дословный дубль rarityVisuals.ts:45-59), rarityColors.ts (switch с фантомными ключами epic/legendary), raritySymbols.ts. ЖИВОЙ БАГ: getRarityColorValue (CardPreview.tsx:10-25) не знает very_rare/artifact/relic → серый #6b7280 на лицевой стороне карты (строка 187); те же фантомные ключи в getRarityBorderColor (CardLibrary.tsx:1066-1071, ShopDetail.tsx:144-149).
Сделать: `utils/rarity.ts` — таблица `Record<Rarity, {label, color, gradientPair, symbol, ...}>`; существующие функции — обёртки; удалить мёртвые ветки epic/legendary и дубль в cardStyles.ts. Проверить визуально карточку каждой редкости.

### F3. generateNumber: убрать 4 копии (P2, S)
Обобщённый generateNumber(db, model, prefix) существует (feat_background_controller.go:429-446). Заменить generateCardNumber (controller.go:776), generateActionNumber (:1203), generateEffectNumber (:1550), generateSpellNumber (spell_controller.go:389 — с нарезкой [6:10], сломается на SPELL-10000). Конкурентная небезопасность (SELECT max + INSERT без блокировки) — отдельной задачей уже в одном месте (advisory lock).

### F4. Подключить дизайн-токены (P1, S) — разблокирует весь редизайн
docs/design/tokens.css (145 строк) не импортируется нигде; --forge-* объявлены только под .forge (CharacterForge.css:2-21); #d8b978 захардкожен в 9 файлах / 20 вхождениях (DiceDialog.css, SheetToasts.css, usePinMode.tsx:55, index.css:189, ConceptPreview.tsx, spellCardStyle.ts, spellPageStyle.ts — там целая копия палитры как --sp-*, CharacterSheetV2.css, CharacterForge.css).
Сделать: перенести tokens.css в frontend/src/styles/tokens.css, импортировать первым в index.css (:root; бумажная тема — классом на корне); объявить --forge-* и --sp-* алиасами токенов; заменить hex в оверлеях (DiceDialog, SheetToasts, usePinMode, index.css) на var(). Значения не менять — риск низкий. Заодно: CharacterSheetV2.css:208-226 ссылается на несуществующие переменные с неверными фолбэками (--forge-gold fallback #c9a227 ≠ #d8b978) — заменить на реальные токены.

### F5. Одна BG3-карточка вместо двух копий (P1, S)
.sp-tip (spellCardStyle.ts:4-18) и .bg3-tip (Bg3Card.tsx:33-47) совпадают посимвольно с точностью до префикса и уже дрейфуют (margin-bottom .9 vs .8rem, align-items, min-width srow). Стили инжектятся `<style>` на КАЖДЫЙ инстанс (Bg3Card.tsx:32-64, SpellPreview.tsx:110, ActionPreview.tsx:55) — N карточек = N копий CSS в DOM.
Сделать: один статический CSS (или модуль-синглтон, вставляющий style в head один раз) с базовым классом; sp-специфика (кубы урона, апкаст, костбар) — модификаторами; свести префикс sp → bg3.

### F6. EntityDetailShell для 9 модалок (P1, M)
1625 строк на 9 модалок; Esc-хендлер/бэкдроп/шапка/футер Edit-Trash построчно идентичны (ActionDetailModal.tsx:28-41,55-73,181-196 = EffectDetailModal = ...). Дивергенция уже дала регресс: EntityImageEditor есть только у 3 из 9 (Action/Effect/Feat); SpellDetailModal несёт собственную inline-реализацию через ImageUploader (ещё один дубль под унификацию), CardDetailModal — свою старую inline-генерацию; у Class/Race/Background/Concept смены изображения нет вовсе.
Сделать: `EntityDetailShell({title, editHref, onDelete, imageEditor, children})`; поля — JSX-детьми (data-driven здесь оверинжиниринг). Бонус: смена изображения появится у всех сущностей автоматически. Совместить с G6 (клавиатура/фокус) — один примитив.

### F7. useEntityEditor + CreatorLayout для 11 конструкторов (P1, M)
4363 строки; скелет react-hook-form + ?edit= + submit + живое превью повторён 11 раз (diff ActionCreator/EffectCreator = 211 дословно общих строк). Режим редактирования непоследователен: предметы — роут /edit/:id (App.tsx:98), остальные — ?edit=.
Сделать: хук useEntityEditor(api, {toForm, toCreateReq, toUpdateReq}) — ?edit=, загрузка, submit, тосты, навигация (~40 строк, −100–150 на конструктор) + CreatorLayout (форма слева / липкое превью справа). Свести предметы к ?edit=. Поля форм НЕ обобщать.

### F8. Один ховер-примитив (P1, M, инкрементально)
Портальный HoverCard.tsx используется только ссылками [[...]] (formattedText.tsx:3), а 14 файлов вручную реализуют mouse-follow (useState pos + onMouseMove + fixed div): EntitySquareCard, ForgeAbilityDisplay, ForgeAbilityLine, ForgeFeatLine, ForgeSpellIconGrid, SheetActionLine, SheetEntityRow, SheetEquipmentPanel, SheetItemRow, RelatedItems, BackgroundEquipment, CardLibrary, CharacterForge, CharacterSheetV2; pin-логика (prevPin) скопирована 4 раза.
Сделать: `useFollowHover()` → {hoverProps, portal} с клэмпом к вьюпорту и встроенным pin; мигрировать 14 мест инкрементально по мере касания файлов (bulk-замена рискованна). Сюда же — тач-протокол из G1 (делать в примитиве один раз).

### F9. Один TemplateSelector вместо пяти (P2, M)
Potion/Ingredient/Trinket/Weapon/EquipmentSelector — 1106 строк, diff соседей ~90 строк; категории с эмодзи и фильтрами-подстроками description захардкожены (PotionSelector.tsx:35-80 — 'лечение', 'невидимость'…; нарушение №1), хотя слоты potion_healing и т.п. уже существуют в данных. Нюансы: WeaponSelector (tags) и EquipmentSelector (slot + захардкоженный UUID щита :8) отличаются сильнее — параметризовать режим. Плюс 5 страниц-обёрток по 8 строк.

### F10. Реестр сущностей в CardLibrary (P1, L)
2491 строка: 9 списочных useState (:146-154), 8 selected + 8 isOpen + 6 hovered (:188-218), 9 load-функций (~334 строки почти-близнецов), 54 ветки `contentType ===`, 8 модалок смонтированы одновременно (:2428-2486); цена новой сущности по git: +175…316 строк.
Сделать: ENTITY_REGISTRY {key, api.list, listKey, Preview, DetailModal, editRoute, filters: FilterDef[]} — один generic-стейт, одна load-функция, один modal-host (рендерить только активную), фильтры декларативно (select/checkbox/поиск). Мигрировать по одному contentType, старый код держать до паритета. Вкладка новой сущности = ~10 строк конфига (парадигма №1). Заодно: ENTITY_DISPLAY_KEY покрывает 4 из 9 типов — распространить настройку отображения на все.

### F11. Generic-CRUD на Go (P1, L) — только со страховкой
3347 строк в 8 файлах; Update-цепочки по 75–220 строк; сброс Mechanics `len(*req.Mechanics)==0` продублирован в 4 местах (controller.go:608,1112,1459; spell_controller.go:342); Delete несогласован (Spell/Race → 200 для несуществующего id, Card/Concept → 404).
Сделать: пакет crud на дженериках Go 1.21: List[T](filters, toResp) / Get[T] / Delete[T] (унифицировать 404) / скелет Update с per-entity функцией применения полей; сброс Mechanics — хелпером. ~3350 → ~1600 строк; новая сущность ~100 строк вместо ~400.
**КРИТИЧНО: Go-тестов ноль.** Перед рефакторингом снять контрактные smoke-тесты на каждый эндпоинт (vitest против прода или локального docker), мигрировать по одной сущности с самых маленьких (races/classes). Попутные находки для этого же этапа: query.Count без проверки ошибок; regexp card_number перекомпилируется на каждый вызов (готовая cardNumberRe есть в feat_background_controller.go:16); ILIKE '%…%' не использует созданные GIN-индексы to_tsvector (мёртвые индексы); мёртвый wildcard-CORS (AllowWildcard не включён — main.go:59-62); эмодзи-логирование в CreateAction.

---

## Этап G. UX/UI

### G1. Тач-протокол превью (P0, M, после F8) — парадигма №2 не работает на планшете
Во всём frontend/src ни одного onTouch*/onPointer*/long-press (34 использования onMouseEnter в 18 файлах); pin — только физическая клавиша T (usePinMode.tsx:35). Тап по строке действия = onClick = runAction (SheetActionLine.tsx:74,91 → SheetActionsPanel.tsx:369) — исполнение с тратой ресурсов без чтения; бескубовые действия при выключенном diceDialog резолвятся мгновенно.
Сделать: на pointer:coarse первый тап = превью (с кнопкой «Использовать» внутри), второй/явный — исполнение. Реализовать в SheetActionLine + ховер-примитиве (F8), не в 14 местах — поэтому F8 делать ПЕРЕД G1; если G1 нужен срочно, допустима минимальная самостоятельная реализация только в SheetActionLine с последующей миграцией в примитив F8. Плюс обнаружимость pin: подсказка «T — закрепить» в углу открытого превью + кнопка-pin на превью (usePinMode.tsx:48-61 сейчас показывает подсказку только когда режим уже включён).

### G2. Единый стиль строк библиотеки + контраст (P1, M)
В list-режиме одной страницы: предметы белые (CardLibrary.tsx:1626), эффекты slate-800 с чёрной рамкой (:1776), действия amber-900 (:1858), заклинания/классы — тёмный BG3-градиент (:1954, :2408) на светлом фоне Layout. Заголовки групп заклинаний text-[#a59886] на белом при 12px (:1945) — контраст ≈2.8:1 (WCAG AA требует 4.5:1; в grid-режиме тот же заголовок text-gray-500 проходит — list-вариант регрессия).
Сделать: один стиль строки (SheetEntityRow-подобный, на токенах из F4) для всех 9 типов; тип передавать акцентом/иконкой; заголовкам — цвет из светлой палитры.

### G3. Дыры парадигмы №2 (P1, M)
- Эффекты и действия в list-режиме библиотеки БЕЗ ховер-превью (строки-кнопки :1772-1815, :1854-1897 — только onClick в модалку); добавить hovered-превью как у остальных;
- магазин: list-режим (ShopDetail.tsx:312-343) — без превью И без клика (полную карту не увидеть); повесить превью+клик;
- черты на листе: классика — голый SheetEntityRow без клика/ховера (CharacterSheetMVP.tsx:631-638), V2 — текстовые чипы (CharacterSheetV2.tsx:293-297), при готовом FeatPreview (используется в кузнице). Обернуть в ховер-паттерн;
- активные эффекты (SheetActionsPanel.tsx:378-397) — имя+срок+крестик без превью источника; дать превью исходной сущности;
- диспетчер [[...]] знает 5 типов из 9 (EntityRefRegistry.tsx:10) — расширить на race/class/feat/background (formattedText.tsx:121 кастит тип без валидации).

### G4. V2-лист: заклинания (P1, S)
Секция «Заклинания» V2 (CharacterSheetV2.tsx:348-373) — кнопки с ховером, но БЕЗ onClick (кастовать нельзя), при этом те же заклинания кастуемы внутри «Действий» (embedded без spellsOnly → группа spell дублируется). Классика делает правильно (SheetActionsPanel spellsOnly, CharacterSheetMVP.tsx:735-744). Заменить самописную секцию V2 на SheetActionsPanel spellsOnly и исключить группу spell из embedded-панели.

### G5. Словарь терминов (P1, S)
Один стат: «КД» в шапках (CharacterSheetMVP.tsx:503, CharacterSheetV2.tsx:166, components.tsx:523, registries.ts:111) и «КЗ» в журнале/вводе цели (engine/events.ts:99, roll.ts:45, SheetActionsPanel.tsx:331) — на одном экране оба. «DC» (CharacterSheetMVP.tsx:538) против «СЛ» (V2:180). Англицизмы: «Temp HP» (SheetHpPanel.tsx:224), «Max HP» (CharacterSheetMVP.tsx:511), «Point-buy» (components.tsx:264), «ADV» (CardLibrary.tsx:1686).
Сделать: файл-глоссарий UI-терминов; выбрать: везде КЗ (или КД — одно из двух), СЛ, «Врем. хиты»; grep-ревизия по обоим вариантам.

### G6. Клавиатура и фокус в диалогах (P2, M, вместе с F6)
DiceDialogContext.tsx:72-121: нет Esc/Enter, автофокуса, focus trap, aria-modal; клик по бекдропу молча отменяет действие. Esc-обработчик скопирован в 9 модалок, но фокус нигде не управляется. Эталон уже в проекте — ValueBreakdownTip (tabIndex/onFocus/onBlur). Общий примитив Dialog (Esc/Enter, trap, автофокус, возврат фокуса, aria-modal) → диалог кубов + 9 модалок (через F6).

### G7. Видимость фильтров библиотеки (P2, S)
Панель скрыта за toggle (CardLibrary.tsx:1188-1198); при закрытой панели активные фильтры невидимы (ни чипов, ни счётчика, ни «Сбросить» — grep пуст); спец-фильтры spells/feats/backgrounds (строки 174-186) не входят в URL-синхронизацию (libraryUrlParams.ts:4-18) — теряются при копировании ссылки/«Назад».
Сделать: чипы применённых фильтров над результатами (с крестиками), счётчик на кнопке, «Сбросить всё», расширить URL-синхронизацию.

### G8. Единая тема (P2, S)
Кузница хранит тему в 'forge-theme' (CharacterForge.tsx:62-71), лист — в 'sheet-theme' (CharacterSheetMVP.tsx:97-106): один персонаж открывается в разных темах. /settings о теме не знает. В светлой теме --forge-gold переозначен в чернильный #2a251d (CharacterForge.css:873) — семантика сломана (в docs/design/tokens.css:112 светлое золото #b8912f).
Сделать: один ключ темы в settings.ts (событие 'site-settings-changed' уже есть) + пункт в /settings; кнопки Sun/Moon — шорткаты общего значения; светлой теме — настоящее золото из токенов (после F4).

### G9. Магазин (P2, S)
ShopNew.tsx:44-74 — модал-ловушка выбора торговца: fixed inset-0 z-50 без крестика/Esc/клика по бекдропу; выход только «Назад» браузера. 7 торговцев захардкожены на фронте (ShopNew.tsx:5-13) И на бэке (shop_controller.go:129-158) — нарушение №1; CreateShop грузит ВСЕ карты в память и хранит полные снимки в shops.data.
Сделать: закрытие модалки (или обычная страница выбора); торговцев отдавать с бэка (данные из БД); оптимизацию CreateShop — по остаточному принципу.

### G10. Навигация и мелочи (P2, S)
- Дублирующиеся иконки меню (BookOpen ×2, Swords ×2 — Layout.tsx:15-41); подменю «Предметы» содержит «Создать ресурс»/«Создать понятие» — переименовать в «Создание»;
- нативный confirm() в 23 местах (9 в CardLibrary.tsx:830-1010) → общий ConfirmDialog (после F6/G6);
- /login с тестовыми кредами и /dice-test в боевом роутере: /dice-test уходит в A3; /login НЕ трогать до этапа H (решение владельца);
- кузница грузит заклинания limit:500 — в проде уже 393, после 500 список тихо обрежется: ленивая загрузка по шагу «Заклинания» с серверным фильтром, либо явная пагинация (частично закрывается B2/B7).

---

## Этап H. Перед публичным запуском (НЕ ДЕЛАТЬ СЕЙЧАС — решение владельца 2026-07-08)

Выполнять единым блоком непосредственно перед запуском:
1. Включить строгий AuthMiddleware (backend/middleware.go:18-48 — проверка закомментирована) минимум на DELETE и мутирующие PUT контента;
2. развести пользователей: вместо общего public (character_v3_controller.go:24-57) — хотя бы анонимный токен устройства в localStorage → свой user_id; списки/удаление персонажей становятся персональными;
3. перестать отдавать User (username/email) в ответах characters-v3 (Preload("User") → DTO);
4. убрать fallback JWT_SECRET "default-secret-key" (auth_service.go:101-103,127-129);
5. спрятать/убрать тестовые креды на /login (Login.tsx:53-124), включить редирект на 401 в интерцепторе (client.ts:81), оживить ProtectedRoute;
6. сменить закоммиченные креды импортёра (scripts/content/api.mjs:36-37 — importer_user/importer_pass123, любой знающий их пишет в прод);
7. настроить регулярные бэкапы прод-БД (удаление — soft delete GORM, но восстановления в продукте нет);
8. пересмотреть публичные PUT «для смены изображения» (main.go:163-196).

---

## Приложение: сводная таблица приоритетов

| P0 (ломает MVP-сценарий) | P1 | P2 |
|---|---|---|
| B1 base64→S3 | A1–A3, B2–B6 | A4–A9, B7–B8 |
| C1 damage-модификаторы | C4–C8, C10, C11, C14, C16 | C12 |
| C2 who:'target' | D4, D5 | E5, E6 |
| C3 шина+endTurn | E3, E4 | F3, F9, G6–G10 |
| C9 единый КЗ + subclass | F1, F2, F4–F8, F10, F11 | |
| C13 схема↔рантайм | G2–G5 | |
| C15 applyIncomingDamage в UI | | |
| D1 слоты+апкаст, D2 ASI, D3 грант-тройка | | |
| E1 автосейв, E2 ошибки+404 | | |
| G1 тач-протокол | | |

Зависимости: D2←D3; D4←C1,C3(частично),C11; D5←C3,C5; C16←C2,C3; C9 включает фикс треть-кастеров; G1←F8 (или минимальная реализация в SheetActionLine); B6 удобно делать через F8; G6 через F6; G8 после F4. Отложено решением владельца: D6 (кости хитов), полная мобильная адаптация, весь этап H. Отложено техническим решением: EncounterState/многоакторность и полные зоны (C16) — слой перед 2D-боем.
