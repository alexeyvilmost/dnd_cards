# Аудит производительности и структуры runtime, 4 октября 2026

Это исследовательский материал для двух итоговых отчётов. Приложение не изменялось, production не вызывался, commit/push/deploy не выполнялись. Проверены исходники текущего checkout и одна локальная production-сборка frontend. Соблюдаются `AGENTS.md` и `docs/data-driven-rules.md`.

## Проверенные измерения и их границы

Локальная сборка прошла: проверка DiceBox → TypeScript → Vite → проверка DiceBox в dist. `npm` отсутствовал в PATH, поэтому выполнены те же четыре команды через уже установленный bundled Node, без установки зависимостей. Полное время 112,16 с; Vite сообщает 30,07 с и 5040 преобразованных модулей. Это один warm-workspace запуск, а не медиана и не измерение production. Полный лог — `build.log`, машинные размеры — `runtime-build-metrics.json` в этой директории.

| Объект | Не сжато, байты | gzip, байты |
| --- | ---: | ---: |
| Входной JS | 795 117 | 231 511 |
| Входной CSS | 178 920 | 33 500 |
| Библиотека: JS страницы и все статические JS-импорты, включая входной JS | 976 267 | 294 343 |
| Лист персонажа: тот же способ подсчёта | 2 695 460 | 759 104 |
| Бой: тот же способ подсчёта | 2 852 645 | 779 700 |
| Кузница персонажа: тот же способ подсчёта | 1 521 175 | 455 855 |
| Забеги: тот же способ подсчёта | 1 486 583 | 445 275 |
| Бумажный лист: тот же способ подсчёта | 1 083 229 | 327 459 |

Статические зависимости прослежены парсером `es-module-lexer`; в них не включены динамические импорты, route CSS, шрифты, API-ответы и изображения. Сжатие посчитано отдельно для каждого файла. Это бюджет кода для холодного входа на маршрут, не записанный браузерный waterfall. Caddy уже включает `encode zstd gzip` (`infra/Caddyfile:2`). Нельзя называть raw-объём размером передачи по сети.

Весь `dist`: 589 файлов, 168 974 643 байта; все 259 JS-файлов: 13 020 491 байт raw, 3 661 500 gzip. Это объём всех маршрутов/библиотек/медиа, а не загрузка каждого посетителя. PWA precache: 21 запись, 1396,37 KiB. Фактически `assets/index-*.js` захватывает также два shared chunk, а не только основной entry; для точного shell budget нужен явный manifest, а не маска имени.

Не измерялись реальные p50/p95 команд, CPU profile браузера/worker, количество SQL на конкретном персонаже, lock wait и production latency. Ниже прямые наблюдения о коде отделены от гипотез об их доле в задержке.

## Сильные стороны, которые нужно сохранить

- `frontend/src/App.tsx:31`: маршруты уже загружаются лениво. Детальные окна сущностей тоже lazy (`components/EntityDetailProvider.tsx:13`); 3D карты и DiceBox имеют динамические границы. Совет «просто добавить code splitting» здесь недостаточен.
- `frontend/vite.config.ts:47`: PWA не предзагружает весь export/3D/Mermaid. `frontend/nginx.conf.template:21`: hashed assets immutable и сохраняется выдача старых chunks для открытых вкладок.
- `frontend/src/api/apiCache.ts:45`: GET cache дедуплицирует in-flight запросы и защищён поколениями от поздних ответов после mutation. `api/ownedItemCache.ts` изолирует каталог по пользовательской сессии.
- `character/assemblyFactory.ts:492`: независимые справочники уже загружаются параллельно. `pages/CharacterSheetMVP.tsx:297`: журнал убран с критического пути первой сборки листа.
- `backend/roguelike_worker_controller.go:61`: обычная trusted-команда боя вычисляется до write lock, затем транзакция проверяет обе ревизии и атомарно пишет результат/receipt. Это хороший шаблон для экипировки.
- `character/useSheetEquipmentSave.ts:16`: сохранение экипировки переживает reload, повтор использует тот же payload/command ID и не выполняет бросок/оплату повторно. `sheetRuntimeCommand.ts:85`: replay сначала проверяет receipt, затем получает актуальный лист.
- Worker переиспользует `createAssemblyRuntime`, `createSheetCombatRuntime`, `handleCommand`; отдельный HTTP adapter не ввозит React или браузерный transport (`frontend/worker/build.mjs:6`, `rules-core/importBoundary.test.ts:34`). Уже существует исполняемый artifact hash и возможность исполнения сохранённых боёв старым artifact (`frontend/worker/server.mjs:67`).
- Каталог новых боёв заменяет base64 изображений ссылками, сохраняя механики/текст; старые envelopes не изменяются (`backend/roguelike_worker_catalog.go:39`).

## R1. Самый явный приоритет: сбор зависимостей каталога

**Подтверждено кодом.** `backend/roguelike_worker_catalog.go:145` начинает с пустого каталога и базовых действий. В цикле до 16 раз посылает `/initialize`; worker возвращает `needs_content`, backend последовательно выполняет `catalog.fulfill` для каждой зависимости и отправляет растущий каталог заново (`:174–194`). `fulfill` читает обычную сущность отдельным SQL `First` (`:118`). Rest/camp-action/camp-inventory повторяют цикл до 32 раз (`:211`, `:261`, `roguelike_camp_inventory.go:87`). Верхняя граница не означает, что каждый запрос делает именно 16/32 итерации.

На каждом worker заходе `prepareRoguelikeCombatParticipant` заново строит индексы и assembler (`frontend/src/roguelike/combatCatalog.ts:33`), клонирует сущности при чтении (`:80`), а затем выполняет полный `loadSheetCombatParticipant`. При экипировке в camp inventory сборщик строит «до» и «после» (`campInventory.ts:24`, `:44`). Добавление каждой строки в Go каталог линейно проверяет дубликат и сортирует массив (`roguelike_worker_catalog.go:47–55`), а каждая итерация сериализует каталог до/после для сравнения.

**Гипотеза:** это крупная составляющая старта боя и некоторых camp actions; её необходимо подтвердить phase timing. Round trips локальны между контейнерами, но повторная сборка, JSON и множество SQL остаются.

**План R1 (высокий приоритет, 3–6 рабочих дней после baseline):**

1. Ввести счётчики `catalog_rounds`, `needs_count`, `sql_count`, `catalog_bytes`, `resolve_ms`, `assemble_ms`, `compile_ms`, `worker_ms`, отделив старт боя, отдых, действие, экипировку. Не логировать приватную entropy, токены и содержимое листов.
2. Собрать canonical bulk resolver, группирующий `needs` по типу и способу ссылки: UUID, card_number, resource_id. За одну волну делать batch SQL по каждому типу; неоднозначные spell aliases должны оставаться ошибкой. Повторные needs дедуплицировать до чтения. Использовать map при сборе каталога; сортировать один раз перед canonical hash/serialization.
3. Предварительно получить замыкание ссылок персонажа и монстров через общий реестр ссылок, но сравнить полноту с существующим needs-протоколом. Синтаксические ссылки могут не покрывать динамическую механику; сохранить bounded fallback, который достраивает пропуски тем же resolver.
4. Кэшировать только immutable catalog closure/скомпилированные определения, с ключом из artifact/rules hash, canonical content hash и build identity. Не кэшировать mutable HP/resources/pending decisions под ключом character ID. Инвалидация на обновление механики/источников обязательна.
5. Для startup использовать тот же сборщик серверной инициативы. Сейчас frontend сначала целиком собирает персонажа ради проверки инициативных приёмов (`SoloCombatPage.tsx:397`), после чего backend собирает его снова. Создать серверный read-only preparation response или общий подготовленный snapshot с выбором по ID, а execution повторно проверяет ревизию/стоимость. Не пропускать сборку по имени класса.
6. Проверить одинаковые catalog hash, разрешённые действия, pending choices и результаты на двух разных классах/предметах, на партии 1/2/6 персонажей, missing dependency, alias collision и изменении контента между prepare/commit. Для старого боя продолжает действовать pinned catalog/artifact.

Цель первой итерации: существенно уменьшить число DB round trips и assembler повторов; величину ускорения обещать только после baseline/re-run. Рабочий ориентир — большинство полных preparation за 1–2 worker round trips вместо dependency waterfall.

## R2. Экипировка: удержание DB locks во время worker-запросов

**Подтверждено.** `backend/character_runtime_command.go:558` блокирует строки персонажей; затем `:597` вызывает `validateRoguelikeCampEquipmentResources`. Если max_resources меняется из-за раскладки предметов, функция вызывает worker (`roguelike_camp_inventory.go:44`), а тот может делать цикл загрузки каталога до 32 запросов. Всё это внутри одной DB transaction. Это условная ветка, не каждый обычный equip/unequip.

На frontend любой equip/unequip предварительно делает `loadSheetCombatParticipant` (`components/SheetEquipmentPanel.tsx:157`); при активном run дополнительно GET run перед сборкой (`:156`). Сборка включает hydrate предметов, action inventory, варианты, resource projection и canonical world (`sheetCombatRuntimeFactory.ts:286–449`). Просто «убрать серверную проверку» недопустимо.

**План R2 (высокий приоритет, 2–4 дня, после R1 baseline):**

1. Перенести trusted preparation/validation до write locks по шаблону trustedCombatCommand. Внутри транзакции повторить права, принадлежность забегу/его фазу, runtime revision, rules/content fingerprint, owned item constraint и command receipt, затем записать единый результат.
2. Новая мутация должна выражать intent equip/unequip, а авторитетный вычислитель выдаёт patch; не доверять произвольным resource maps от браузера. Совместимый старый endpoint оставить до миграции клиентов.
3. Переиспользовать текущую собранную static build projection в UI, обновлять зависимые equipment/runtime projections. Ключ должен учитывать equipment, attunement, inventory ownership, content revision, build choices и active-effect зависимости. Не создавать второй упрощённый калькулятор КД/стоимости.
4. Проверить concurrent equip в двух вкладках, stale revision, сетевой обрыв после успешного commit, retry после reload, предмет с дополнительным ресурсом и второй предмет с иными декларациями. Lock timing должен показывать отсутствие worker I/O под блокировкой персонажа.

## R3. Payload боя, JSON и один CPU worker

**Подтверждено.** Каждая `/transition` передаёт целый private envelope плюс character (`backend/roguelike_worker_controller.go:150`, партия — `roguelike_party_worker.go:139`). Worker парсит JSON, клонирует `envelope.state` (`combatWorker.ts:97`), а на каждой итерации хода ИИ дважды хеширует весь state для проверки прогресса (`:203`). В `server.mjs:128` синхронный `stepRoguelikeCombat` исполняется прямо в HTTP process. Синхронный CPU участок одного запроса задерживает другие запросы этого процесса; `Promise.all` сам по себе не делает CPU параллельным.

Worker дополнительно вычисляет hash исходного/нового envelope для trace; backend сохраняет envelope, зеркальный turn_state персонажа и точный response receipt. Нельзя считать это всё ненужным: зеркала, replay и privacy имеют контракт. Размеры конкретной БД и степень дублирования должен отдельно измерить DB-аудит.

**План R3 (средний/высокий после измерений, 4–8 дней):**

1. Измерить размер полей envelope/DTO, затраты JSON parse/stringify/clone/hash, время каждого automatic turn и event-loop lag; хранить только числовые метрики без payload.
2. Отделить immutable compiled catalog/presentation от mutable state для новых schema versions. Загружать immutable данные по hash и кэшировать в bounded LRU, сохраняя исходные bytes для archived artifacts. Первое чтение/несовпадение base revision получает полный snapshot; последующие ответы могут нести проверенный patch + revision/hash.
3. Любой compact DTO должен сериализоваться из одного authoritative результата; старые receipts/журналы не переписывать. Не выдавать клиенту entropy ради сокращения серверной работы.
4. Проверку «ИИ сделал прогресс» по полному hash заменить на явный счётчик/тип событий только после доказательства эквивалентности тестами на loop/stall; пока hash оставить.
5. После измерения нагрузки вынести CPU execution в ограниченный пул worker threads/processes или масштабировать stateless replicas. Ввести queue limit, cancellation до commit, timeout budget, saturation metric. Все replicas должны иметь архив требуемых artifacts. Детерминизм, RNG cursor и command ID сохраняются.

## R4. Размер frontend и первое открытие

**Подтверждено.** Главный JS 231,5 KB gzip и CSS 33,5 KB gzip даже до lazy route. Лист/бой требуют ещё примерно 528/548 KB gzip статического JS. Глобально импортированы providers выбора и броска (`App.tsx:15–17`); `ChoiceDialogContext.tsx:9` прямо импортирует большой модуль `character/components.tsx`, который импортирует preview/UI кузницы. Это кандидат на сокращение shared graph, но вклад каждого исходного модуля нужно подтвердить bundle attribution.

**План R4 (средний приоритет, 2–5 дней):**

1. Сохранить Vite manifest и build size отчёт в CI; budget считать для entry и transitive static route closure, а не только route chunk и не всего dist. Предварительный целевой бюджет entry — ≤180 KB gzip; окончательно утвердить после attribution, это цель, не обещание.
2. Разделить контексты/API диалогов и тяжёлые lazy hosts; вынести ChoiceResolver из общего файла кузницы, сохранив каноничные карточки/превью. Инициировать загрузку host при намерении пользователя, с корректным suspense и отменой.
3. Scope RulesAuthority bootstrap к игровым маршрутам. Сейчас запрос состояний запускается и на login/settings/library, кроме специально исключённых home/paper/lab (`App.tsx:115`); библиотека не блокируется этим boundary, но лишний запрос конкурирует за сеть. Игровые действия обязаны дождаться авторитета.
4. Не добавлять ручной vendor chunk без замера: он может втянуть тяжёлые зависимости в entry. Не удалять lazy страницы ради гипотетического ускорения initial load: сначала показать реальное пересечение graph.
5. Зафиксировать cold/warm login→library, characters→sheet, run→combat, paper reload на обычном и ограниченном CPU/сети. Собрать LCP, INP, long tasks, request count, JS/CSS bytes. Согласовать UX budget отдельно от сетевого подтверждения команды.

## R5. Проверки и hover-превью боя

**Подтверждено.** `TacticalBattleMap.tsx:402` строит все клетки, освещение и длинные подписи в render. При перемещении hover обновляются state и anchor (`:476`), поэтому этот массив строится снова. Основные геометрические превью уже `useMemo` (`:276–334`), однако родитель создаёт новый `displayState` и новый map токенов на каждом render (`SoloCombatPage.tsx:1260`), что меняет dependency identity у дочернего компонента.

Для hit preview используется точный executor на disposable clone (`solo-combat/engine.ts:2423–2437`), который прерывается до первой кости. Это обеспечивает совпадение с правилами, но полное clone при каждом новом target может быть дорогим. Это кандидат для CPU profile, не измеренный дефект.

**План R5 (средний приоритет, 2–4 дня):**

1. Стабилизировать `displayState` по фактическому presented state и изменениям портретов; memoize board-static/lighting projections по board revision и соответствующим источникам света.
2. Разделить статический слой карты, token layer, highlights/path/hover. Update hover не должен пересчитывать освещение неизменных клеток.
3. Кэшировать readonly preview по world/board revision, actor, action, targets и choices. Не cache по одному action ID. Авторитетный execution всё равно заново проверяет стоимость и условия.
4. Если profile подтверждает clone/executor bottleneck, выделить общую чистую операцию plan/validate из того же исполнителя; preview и execution вызывают её. Запрещён параллельный «быстрый» калькулятор с другими правилами.
5. Проверка на большой карте, множестве существ, световых областях, крупном footprint, укрытии и второй способности с другими данными; видимые правила и tooltip-компоненты сохраняются.

## R6. Библиотека и общие индексы

**Подтверждено.** При `showReviewStatus` CardLibrary загружает все страницы каталога через последовательный `loadCatalogPages`, хотя обычный режим использует 50-строчную пагинацию (`CardLibrary.tsx:417`, `:591`; `api/catalogPages.ts:14`). И фильтр, и summary считают всё на клиенте. Infinite scroll накопленных карточек не виртуализирован: каждый загруженный объект остаётся в DOM.

`utils/cardsIndex.ts:50` последовательно собирает весь public индекс страницами по 100 и затем private индекс; DTO уже облегчён `fields: 'list'`, но индекс инвалидируется на любой mutation `/api/characters-v3` и `/api/roguelike` (`:21`). Бой вне trusted ветки и rest используют этот общий индекс (`SoloCombatPage.tsx:447/480`, `SheetRestButtons.tsx:343/497`). Поэтому сокращение DTO уже сделано; следующий шаг — устранение ненужного полного обхода.

**План R6 (средний приоритет, 2–4 дня):**

1. Перенести review-status filter и агрегат counts в backend, вернуть page + summary при тех же правах видимости. Нельзя менять публичность личных сущностей.
2. Виртуализировать длинные grids/rows после замера DOM; сохранять keyboard focus, каноничные entity components/preview и положение при Back.
3. Для runtime запросить bulk hydration только owned/equipped/referenced IDs; полный индекс оставить сценариям каталога, которым он действительно нужен.
4. Разделить invalidation inventory ownership/catalog identity и HP/turn changes. Узкая инвалидация не должна оставлять stale private acquisition после покупок, reward или смены пользователя.

## R7. Рефакторинг по контрактам, не переписывание движка

Текущие физические размеры: `rules-core/handler.ts` — 13 458 строк, `solo-combat/engine.ts` — 6172, `engine/execute.ts` — 6618, `components/SheetActionsPanel.tsx` — 3564, `pages/CardLibrary.tsx` — 2958. Размер файла сам по себе не доказывает медленную работу, но усложняет независимые изменения и обзор фаз/инвариантов. Разделение файлов без удаления дублирования не уменьшит bundle автоматически.

1. Зафиксировать импортную границу `rules-core`, общий runtime builder, intent API, immutable catalog, persistence adapters и presentation. `engine/execute` пока используется через legacy adapter; не удалять его только из-за слова legacy.
2. Выносить цельные общие операции: costs/availability → roll resolution → damage/effects → reactions/continuations → turn/movement/rest. Каждая операция возвращает явные результаты/события, UI только отображает каноничные сущности и отправляет IDs.
3. Разделить SoloCombatPage на загрузку/командный lifecycle, presentation, target selection и dialog hosts; SheetActionsPanel — на общий action model и renderer. Не делать вторую упрощённую реализацию для мобильного/бумажного/боевого контекста.
4. CardLibrary: типизированный registry конфигурации сущностей и общий loader/filter/pagination, но renderer/preview каждого типа остаётся каноничным. Это убирает повторяющиеся loadCards/loadActions/loadEffects/... и однотипные ошибки.
5. Форматировать затронутые файлы малым scope: код с несколькими операциями на одной строке делает просмотр review и поддержку плохими. Не смешивать массовое форматирование, удаление legacy и изменение механики в одном PR.
6. На каждом этапе нужен replay-equivalence corpus: те же исходные snapshot/command/RNG → те же events/final hash/pending resolution. Если меняется семантика — новая capability/schema/artifact с явной совместимостью, а не молчаливое обновление старого боя.

## Предлагаемая очередь агентских задач

| ID | Результат | Зависимости | Обязательная приёмка |
| --- | --- | --- | --- |
| PERF-00 | Локальный reproducible scenario runner, frontend/network/SQL/worker phase timings | Нет | 1/2/6 персонажей; cold/warm; нет production mutations; baseline JSON |
| PERF-01 | Bulk dependency resolver + dedupe + один stable serialization pass | PERF-00 | Тот же catalog hash, alias/missing tests, второй набор данных |
| PERF-02 | Revision-safe immutable catalog/build cache | PERF-01 | content invalidation, права/сессия, старый artifact, cache miss fallback |
| PERF-03 | Equip preparation вне транзакционного lock | PERF-00, PERF-01 | concurrent/retry/reload, ни одного worker вызова под character lock |
| PERF-04 | Серверная preparation инициативы без повторной полной UI сборки | PERF-02 | правильные общие entity choices, повторная проверка ресурсов/CAS |
| PERF-05 | Разделение immutable/mutable runtime transport v2 | PERF-00 | byte/timing сравнение, replay hash, старые schemas/receipts сохранены |
| PERF-06 | Bounded CPU worker pool/replicas | PERF-00; после PERF-05 предпочтительно | 1/4/16 конкурентных пользователей, queue saturation, artifact availability |
| PERF-07 | Shared frontend graph + lazy dialog hosts | PERF-00 | cold-route bytes и browser flow, каноничные previews сохранены |
| PERF-08 | Стабильные map projections и hover cache | PERF-00 | CPU trace, deterministic previews, geometry regression |
| PERF-09 | Серверные фильтры библиотеки и targeted hydration | PERF-00 | page totals, visibility, keyboard, cache invalidation |
| REFACTOR-01 | Небольшие извлечения модулей вокруг общих фаз | PERF-00; параллельно после фиксации границ | import boundary, replay-equivalence, две сущности с разными данными |

Ориентиры сроков выше — оценки инженерной работы, не измерение и не обещание. Первую практическую отдачу ожидается получить от каталога и экипировки; сложное изменение transport/worker parallelism имеет смысл после измерения оставшегося bottleneck.
