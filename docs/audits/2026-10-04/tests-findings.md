# Аудит тестов и границ движка — 04.10.2026

Материал для двух итоговых отчётов. Приложение, CI, БД и production не изменялись. Изучены tracked-файлы текущего checkout; старые копии в `tmp/` и `output/` не включались в количественный инвентарь. Полный прогон, сборка приложения и live-canary не запускались.

## Вывод

Проекту нужны **два рабочих локальных набора: основной и расширенный**, а исторические сертификаты следует оставить третьим, явно ручным диагностическим архивом. Большая часть полезных проверок уже написана. Главная проблема — выбор запускаемых проверок и отсутствие единого изолированного сценария «браузер → Go API → worker → PostgreSQL» для текущего продукта. Не нужно начинать тестирование заново или возвращать многочасовую сертификационную матрицу в каждый релиз.

Общие контракты атомарности, авторизации, повтора команды, сохранённых решений и второй сущности — действующие требования, независимо от возраста или расположения тестового файла. Отмена автоматического запуска старых сертификатов не отменяет эти контракты (`docs/data-driven-rules.md:39`, `:41`, заключительный абзац раздела ручной проверки каталога).

## Проверенные факты

| ID | Наблюдение и доказательство | Следствие |
|---|---|---|
| T01 | В Git найдено 1 055 тестовых файлов: frontend 750, backend 253, scripts 52. Подсчёт по `git ls-files` с суффиксами `.test.ts/.tsx/.mjs`, `.spec.ts/.tsx`, `_test.go`, `test_*.py`. Это число файлов, не тест-кейсов и не оценка покрытия. | Нужен машинный каталог suite/owner/tier/cost, а не ещё один полный список команд в инструкции. |
| T02 | `.github/workflows/ci.yml:32`, `:68`, `:75` запускает фиксированный небольшой frontend-список, компиляцию Go и auth/manual-review tests. Выбора по изменённым продуктовым границам нет, хотя job так называется. | Обычный CI не проверяет значительную часть изменений экипировки, worker и забегов. Быстро зелёный CI не является свидетельством работоспособности основных сценариев. |
| T03 | `scripts/release/quick-gate.ps1:134` добавляет только изменённые **тестовые** файлы к трём фиксированным suites; `:145` допускает `--passWithNoTests`. | Изменение реализации без изменения её теста не запускает связанный тест. Исключённый конфигурацией тест может не проверяться ожидаемым образом. |
| T04 | `scripts/release/quick-gate.ps1:88` считает worker изменённым только при изменении `frontend/worker/*`. Но `frontend/worker/artifact.ts:1` экспортирует функции из `src/roguelike`, а `frontend/worker/build.mjs:4` собирает их транзитивно в bundle. | Изменения `engine`, `rules-core`, `character` или `roguelike` могут менять worker, не запуская его gate. Важен общий граф зависимостей сборки и тестов. |
| T05 | `frontend/playwright.config.ts:40` запускает только static preview; API перехватывается fixture. `frontend/e2e/forge-api-fixture.ts:252` обслуживает `**/api/**`. `forge-real-interaction.spec.ts:103` действительно проходит реальные элементы мастера, но поверх этого fixture. | Это ценные UI/component integration проверки; они не доказывают реальную транзакцию Go/PostgreSQL или авторитетность worker. Их следует сохранить с честным названием слоя. |
| T06 | `frontend/e2e-live/real-backend-canary.spec.ts:771` содержит реальный путь из пустого мастера в лист и бой; есть дополнительные caster/two-account сценарии. `frontend/liveCanaryTargets.ts:53` допускает явные loopback-адреса. В CI эти проверки находятся в ручном production workflow (`.github/workflows/ci.yml:224`). | Сценарии можно перенести на воспроизводимый локальный stack. Не нужно писать второй независимый UI-driver. Production-мутирующие проверки не должны быть условием обычного PR. |
| T07 | Есть отдельные локальные acceptance scripts для пресетов, магазина, роллов. Однако `templates-local-acceptance.mjs:68` пишет `{created}`, а `polish-local-acceptance.mjs:8–11` читает этот файл как `{username,password,...}` и вызывает login. | Документированная последовательность этих двух файлов не самодостаточна в текущем коде. Подтверждено чтением producer/consumer, без запуска. Нужны общие fixtures и выдача локальных credentials через env, без хранения их в отчётах. |
| T08 | `backend/tests/conftest.py:69–80`: autouse fixture исполняет `DELETE FROM cards;` в БД `dnd_cards` через Docker, использует старый абсолютный macOS cwd и проглатывает ошибки. | Этот старый Python harness нельзя включать в новый общий runner. До переноса в disposable DB пометить явно disabled/unsafe и убрать из пользовательской точки входа. Это подтверждённая опасная реализация, а не вывод из имени файла. |
| T09 | `scripts/test_frontend.py:50` проверяет текст `Vite dev server` в HTML через requests, не исполняя React. `scripts/run_tests.sh` и `.bat` ведут в эти старые Python smoke scripts. | Такие проверки не заменяют production browser acceptance; кандидат на архив после переноса оставшихся полезных API assertions. |
| T10 | Полезные PostgreSQL tests уже изолируются schema per test: `backend/canonical_session_transport_integration_test.go:47–68`, `backend/migrations/postgres_integration_test.go:19–69`. Без DSN они вызывают `t.Skip`. | Основа пригодна. В CI обязательный suite должен отдельно подтверждать запуск PostgreSQL кейсов и запрещать незамеченный полный skip. Добавить проверку допустимого локального test target перед подключением. |
| T11 | `frontend/worker/server.test.mjs:10` проверяет auth, сохранение точного старого executable artifact после restart; `worker/replay.test.mjs:11`, `:57`, `:118` — held journey check, replay/RNG/revisions и недоверие подделанному runtime output. `frontend/package.json:77` имеет готовую команду. В обычном Vitest worker исключён (`vitest.config.ts:25`). | Включить worker suite в основной набор для семантических изменений движка и worker; сохранение старых артефактов нельзя считать ненужным legacy. |
| T12 | `frontend/vitest.rules-core.config.ts:23` требует 100% покрытия четырёх небольших replay-critical модулей. `vitest.rules-primitives.config.ts` имеет отдельный исторически отобранный список и тоже 100%. | Разделить актуальные инварианты ядра и историческую проверку конкретных сущностей. 100% строк узкого ядра можно оставить, но оно не доказывает корректность фаз, транзакций или второй сущности. Не расширять 100% механически на весь UI. |

## Реально выполненная локальная проверка

Из `frontend`:

```text
node node_modules/vitest/vitest.mjs run src/engine/rollInfluence.test.ts src/engine/conditionActions.test.ts src/character/sheetEquipmentCommit.test.ts src/character/useSheetEquipmentSave.test.tsx src/rules-core/importBoundary.test.ts --reporter=dot
```

Результат: **4 файла прошли, 1 файл упал; 26 тестов прошли, 1 упал; 13,97 секунды** на этой машине. Это адресный диагностический прогон, не полный health-report и не измерение времени будущего основного набора. Использованный установленный Vitest сообщил v4.1.11; `package.json` объявляет диапазон `^4.1.9`.

Падает `src/rules-core/importBoundary.test.ts:34–41`, проверка изоляции legacy imports. Найдены прямые импорты `engine/mvp` в 17 файлах `rules-core`: `activeSlotRecovery`, `attackActionBudget`, `attackRedirection`, `bondLifecycle`, `conditionsRuntime`, `damageTransfer`, `deathRecovery`, `effectReceived`, `equipmentChange`, `generalFeatDamageRuntime`, `generalFeatReactionRuntime`, `handler`, `itemWeaponLifecycle`, `magicSuppression`, `projectileReflection`, `recipientBindings`, `worldMigration`.

Это **расхождение архитектуры с собственным актуальным общим тестом**, а не доказанный дефект конкретного игрового правила. Следует определить разрешённую границу (общие примитивы либо адаптер), перенести импорты и усилить проверку транзитивных зависимостей. Нельзя просто исключить или удалить тест для зелёного CI. Например, `rules-core/handler.ts:5` напрямую импортирует `engine/execute`; в том же файле `:39` используется `legacy/engineAdapter`.

Прошедшие suites проверяют вторую сущность с иной ценой/порогом (`engine/rollInfluence.test.ts:13`, `conditionActions.test.ts:20`), сохранение неопределённого результата POST, повтор после потери ответа, смену персонажа и конкуренцию вкладок (`character/useSheetEquipmentSave.test.tsx:61–160`). Их нужно сохранить в основном наборе.

## Целевая структура двух наборов

### Основной: каждый PR и локальная проверка перед согласованным релизом

Цель после измерения — 5–8 минут на стандартном CI runner, без сети вне локального стека. Это бюджет, не обещание до профилирования.

1. Всегда: typecheck, проверка manifest test selection, запрет известных credentials/dumps, AuthContext/API auth, auth/ownership backend, архитектурная граница после её исправления.
2. По изменениям плюс обязательное небольшое ядро: availability/cost, исполнение, состояния с actions, roll influence, deterministic RNG, снапшоты КД, сериализация pending decision, идемпотентные команды, inventory conservation, paper autosave.
3. Для изменений семантики правил/worker: build worker один раз и `node --test worker/server.test.mjs worker/replay.test.mjs`.
4. Для Go/команд/миграций: изолированные PostgreSQL contracts на атомарность, CAS/replay/rollback, ownership; upgrade изменённых миграций. Компиляция всех Go packages сама по себе проверкой поведения не считается.
5. Desktop Chromium: короткие реальные full-stack сценарии создания персонажа, экипировки, одного боя/сохранённого решения и бумажного листа. При чистом изменении документации — только docs/manifest checks. При неизвестной области изменения — консервативный основной набор.

### Расширенный: ручной локальный запуск, nightly CI и перед крупными изменениями

1. Все актуальные офлайн Vitest/Go/Node suites с явным списком исключённых исторических диагностик; PostgreSQL обязателен, `-race` в Linux, миграции fresh install + upgrade нескольких поддерживаемых baseline.
2. Дополнительные браузерные пути: mobile 390px; melee/ranged/caster; два персонажа/владельца; отдых и подготовка; defeat/victory; camp/shop/loot/travel; потеря сети после принятия команды; одновременные вкладки; restart worker со старым pinned artifact; reload во всех pending фазах; 2D и fallback при отключённом WebGL; режимы иконка/строка и каноничные превью.
3. Performance-профиль на фиксированном anonymized dataset: page-ready, character-ready, combat-ready, command accepted→rendered, p50/p95 запросов, SQL count, transferred bytes, long tasks. Отдельные cold/warm прогоны; регрессионные пороги от baseline, а не произвольное абсолютное время.
4. Replay corpus для поддерживаемых версий артефактов и property-based/metamorphic invariants: один и тот же command id не меняет результат; второй ресурс/источник не требует новых UI веток; неизвестная операция отклоняется; предметы/ресурсы не создаются повторами.
5. Старые entity certification/micro-MVP matrices запускаются отдельно **только явно** при обслуживании соответствующей истории. Они не переводят ручной статус `not_verified` в `verified`.

## Конкретный начальный manifest для агентов

Создать `tests/suites.json` и один `scripts/testing/run.mjs`, используемый локально и в CI. Ниже проект структуры: новых команд пока нет; список не является заявлением о прохождении всех файлов. Перед включением выполнить каталогизацию и проверить существование/сбор каждого test selector. Для Go сначала разрешать regex в реальные имена через `go test -list`, затем fail при пустом обязательном списке.

```json
{
  "version": 1,
  "tiers": ["core", "extended", "legacy-manual"],
  "core": {
    "vitest": [
      "src/contexts/AuthContext.test.tsx",
      "src/api/authPolicy.test.ts",
      "src/api/catalogPages.test.ts",
      "src/rules-core/importBoundary.test.ts",
      "src/rules-core/determinism.test.ts",
      "src/engine/rollInfluence.test.ts",
      "src/engine/conditionActions.test.ts",
      "src/engine/itemCost.test.ts",
      "src/character/assemble.bundleDependency.test.ts",
      "src/character/sheetEquipmentCommit.test.ts",
      "src/character/useSheetEquipmentSave.test.tsx",
      "src/character/sheetAtomicWorldCommit.integration.test.ts",
      "src/character/sheetRuntimeCommand.test.ts",
      "src/paper-sheet/useSavedPaperDocument.test.tsx",
      "src/components/nativeTooltipPolicy.test.ts"
    ],
    "node": ["frontend/worker/server.test.mjs", "frontend/worker/replay.test.mjs"],
    "goPackage": ".",
    "goTestPrefixes": [
      "TestStrictAuth", "TestJWTIssuance", "TestAuthTokenLifetime",
      "TestOwnedItem", "TestCharacterTemplate", "TestRuntimeEquipmentCommand",
      "TestCharacterRuntimeCommand", "TestCanonicalTransport", "TestPaperDocument",
      "TestWorkerClient", "TestCombatJournal", "TestRunItemSale", "TestConcurrentRunSale"
    ],
    "newLocalE2E": [
      "auth-library", "forge-create-reload", "equipment-command-retry",
      "run-combat-held-roll-reload", "paper-autosave-export"
    ]
  },
  "selection": {
    "always": ["auth", "ownership", "test-manifest", "security-static"],
    "rules": ["frontend/src/engine/**", "frontend/src/rules-core/**", "frontend/src/character/**", "frontend/src/roguelike/**", "frontend/src/solo-combat/**", "frontend/worker/**"],
    "sharedBuildInputs": ["frontend/package-lock.json", "frontend/tsconfig*.json", "frontend/worker/build.mjs"],
    "unknownChanges": "core",
    "missingRequiredSuite": "fail",
    "skippedRequiredIntegration": "fail"
  }
}
```

Данный initial core расширять картой dependency→suite, а не добавлением всех тестов в обязательный список. `rules` выше — консервативный начальный fallback; затем использовать сохранённый esbuild metafile worker плюс граф Vite/TS. Не ограничивать влияние изменения папкой entrypoint.

Предлагаемый публичный интерфейс runner:

```text
node scripts/testing/run.mjs --suite core --base <merge-base> --report output/test-results/core.json
node scripts/testing/run.mjs --suite extended --report output/test-results/extended.json
node scripts/testing/run.mjs --suite legacy-manual --select <explicit-suite-id>
```

Runner создаёт воспроизводимый summary: commit SHA, dirty flag/diff hash, dependency lock hash, node/go/browser versions, dataset hash, test manifest version, выбранные/пропущенные suites с причинами, duration, pass/fail/skip counts, ссылки на traces. Секреты, токены, реальные персональные данные в результат не входят. Если рабочее дерево dirty, нельзя выдавать результат за проверку одного commit SHA.

## Обязательные новые пользовательские сценарии

| Сценарий | Проверка браузера | Авторитетное подтверждение |
|---|---|---|
| Вход и библиотека | Вход, фильтр/поиск/пагинация, открытие стандартного превью, иконка/строка | Неверный/истёкший токен не даёт чужих данных; bounded response; запросы не дублируются при одном переходе |
| Создание персонажа | Пустой мастер → вид/класс/предыстория/выборы → создание → reload; отдельно копия шаблона | Реальная запись владельца, полный набор выбранных сущностей; исходный шаблон не меняется; серверные ошибки видны |
| Снаряжение | Надеть, снять, переставить предмет; недоступное действие объяснено | Изменяются только разрешённые слоты/характеристики; количество сохраняется; общий cost/availability; retry того же command id не тратит повторно |
| Бой | Создание забега → инициализация → движение/действие → решение о влиянии → reload → подтверждение → следующий ход | Один RNG stream, один расход, отсутствие финального HP до выбора, полный сохранённый расчёт КД; journal и receipt транзакционно совпадают |
| Вторая сущность | Другой источник, ресурс, порог кости и название в том же каноничном UI | Та же generic операция; подделанный выбор, устаревшая цена, неизвестная операция отклоняются |
| Бумажный лист | Создать/изменить поле, reload, скрыть/показать блок, экспорт | Сохранение revision/ownership; данные скрытого блока остаются; конфликт не молча затирает новую версию |
| Ошибка сети | Потерять ответ после успешного POST; reload/повтор; конкурирующая вкладка | Тот же receipt и результат; никакого нового броска, двойного расхода или частичного patch |

Сценарий боя начинать с минимального действующего каталога и двух альтернативных деклараций. Не ставить зависимость от конкретного старого сертификата, названия или UUID приёмочного персонажа. Существующий `forge-interaction-driver.ts` переиспользовать; игровые expected values не вычислять вторым упрощённым движком в тестах.

## Изоляция и воспроизводимость

1. Общий lifecycle: disposable PostgreSQL database/schema → минимальные fixtures → локальный Go API + worker + production frontend preview → readiness → tests → cleanup через зарегистрированные ресурсы. Cleanup выполняется и после failure; удаляется только точный ресурс этого run.
2. API и DB URL валидировать до первого запроса: loopback либо явно локальный Docker service из выданной конфигурации; обязательный test marker/name; запрет production origin. Не принимать redirect на другой origin.
3. Небольшой базовый dataset хранит только данные без credential/PII. Большой sanitized prod snapshot — отдельный расширенный профиль. Его hash и версия миграций фиксируются. Запретить автоматический live export при обычном тесте.
4. Каждому тесту собственные user IDs, run IDs и command IDs; время и RNG вводить как зависимости. Отличать state fixture setup от команды, которую проверяет тест: setup может seed данные, испытуемое действие обязательно идёт через public API.
5. В основном профиле реальные локальные API/worker/БД; mock только внешних OAuth/OpenAI/storage. В UI-profile перехват API допустим, но отчёт явно маркирует его как UI fixture, а не full-stack.
6. Повтор запуска не зависит от `outputs/.../acceptance.json`, оставленного предыдущим заданием. Учётные данные ephemeral/test-only передаются процессам через env, не сохраняются в acceptance artifacts.

## Безопасное уменьшение объёма и рефакторинг

Наиболее крупные текущие файлы: `rules-core/handler.ts` — 13 458 строк, `engine/execute.ts` — 6 618, `solo-combat/engine.ts` — 6 172, `components/SheetActionsPanel.tsx` — 3 564, `pages/CharacterForge.tsx` — 2 299. Это ориентиры связности и сложности ревью, **не доказательство медленной работы**; ускорение подтверждать profiler/benchmarks.

Последовательность:

1. Сначала вернуть общий architectural test в согласованное состояние; провести явную границу pure primitives/command orchestration/adapters/UI. Результат не должен запрещать переиспользование и провоцировать копирование механик.
2. Выделять из `handler.ts` обработчики фаз/команд небольшими переносами с сохранением публичной сигнатуры. Сохранить порядок RNG draws, events, immutable snapshots, capability markers и hashes. Сравнивать state/events/RNG до/после на replay corpus.
3. Из `solo-combat/engine.ts` отделить spatial projection, подготовку/валидацию намерения, execution/resume и presentation projection. Использовать уже выделенные `tacticalGrid`, `combatAreas`, `movementLedger`; не строить параллельный исполнитель.
4. Из `SheetActionsPanel.tsx` извлечь orchestration hooks и общее отображение решений; UI выбирает действие/показывает каноничный preview, не реализует механические ветки по имени.
5. `engine/execute.ts` разделять по универсальным effect operations и event phases; регистр операций должен отклонять неизвестную, а не считать её исполненной. Требование второй сущности применимо к каждому новому примитиву.
6. Не удалять `src/mvp/` целиком из-за названия: `engine/execute.ts:29` импортирует runtime contracts оттуда. Не удалять `src/canon/` целиком: `solo-combat/engine.ts:78` импортирует production projection. Архивировать можно выбранные тесты/генераторы после dependency inventory, но не их активные contracts.
7. Старые Python harness и локальные последовательные acceptance scripts заменить одной актуальной точкой входа; перед архивом составить таблицу assertion→replacement, сохранить уникальные транзакционные/авторизационные проверки.

## Пакеты работ для исполнения агентами

| Пакет | Зависимости | Конкретный результат | Условия приёмки |
|---|---|---|---|
| TEST-01: inventory | Нет | Каталог tracked test files: suite ID, runner, tier, owner, data/network needs, duration estimate, active/legacy reason; карта всех текущих команд | Нулевое число неклассифицированных файлов; исключение исторического теста имеет причину, общие контракты не исчезли |
| TEST-02: local harness | TEST-01 | `scripts/testing/` для запуска disposable DB/API/worker/preview, fixture/account lifecycle, report | Два последовательных запуска и прерывание в середине не оставляют чужих данных; prod target отвергается до сети; обязательная интеграция не skip |
| TEST-03: tiers/selection | TEST-01 | `tests/suites.json`, core/extended commands; CI и quick-gate читают один manifest | Изменение `engine` выбирает worker; изменение реализации выбирает suite без правки самого теста; неизвестная область запускает core; пустой selector падает |
| TEST-04: core journeys | TEST-02/03 | Пять коротких full-stack сценариев из таблицы; reuse UI drivers | Проверены реальные persistence/reload/retry; тесты живут на fresh fixture и не используют production или legacy certificates |
| TEST-05: extended | TEST-04 | Concurrency/restart/mobile/2D fallback, migration/replay matrix, perf report | Предъявлены duration/skip/flaky metrics; проведён replay старого pinned artifact; нет автоматического ручного `verified` |
| ARCH-01: contract repair | TEST-01 | Согласованная граница импорта для 17 файлов + regression test | Текущий выявленный test failure устранён осмысленным изменением, без blanket exclusion; worker остаётся headless |
| ARCH-02: incremental extraction | ARCH-01, TEST-04 | Последовательно уменьшенные command/phase/UI modules | Differential replay одинаков по events/state/RNG; canonical previews/cost остаются общими; old artifacts доступны |

Оценивать продвижение количеством защищённых пользовательских контрактов, а не числом тестов. Для каждого flaky failure сохранять причину; retries не превращают нестабильность в успех без отдельного учёта. Удаление проверок допускается после фиксации заменяющей проверки или явно прекращённого продуктового контракта.
