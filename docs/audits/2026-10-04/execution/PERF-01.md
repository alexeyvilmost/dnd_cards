# PERF-01 — пакетное разрешение каталогов

Статус: **частично реализовано**, batch resolver доступен локально за `RULES_CATALOG_BATCH_ENABLED=1`; default остаётся legacy. Shared cache и reference prefetch не включены. Production, commit/push и исторические artifacts не изменялись.

## Изменения

`backend/roguelike_catalog_batch.go` предоставляет единый `fulfillWave` для initialize/rest/camp-action/camp-inventory. Волна дедуплицирует needs, группирует UUID/card_number/resource_id по типу сущности, загружает группы через SQL IN. Effect types грузятся одним запросом и сохраняют completeness даже при пустом результате. Variables загружаются один раз. Каталог собирается через Map и сортируется при публикации волны; существующий UUID внутри frozen catalog не перезаписывается.

Все пути используют прежнюю projection inline images и одну SQL-нормализацию английских spell aliases. Exact reference имеет приоритет, ambiguity/missing/unknown needs отклоняются. Soft-deleted сущности не возвращаются. Bounded needs fallback, stall/budget checks и canonical wire ordering сохранены. `catalog_needs_count` считает исходные needs, `catalog_unique_needs_count` показывает фактически уникальные внутри волн; эти величины не смешиваются.

Для воспроизводимого сравнения camp-action выделена `executeSeededRoguelikeCampActionWorker`: production wrapper получает seed от прежнего `newRoguelikeSeed`, тест передаёт одинаковый seed обеим реализациям. HTTP клиент не задаёт seed. Исполнитель механик остаётся один, pinned JS artifact не менялся.

## Проверки

- `node scripts/performance/check-catalog.mjs --unit-only`:3/3 обязательных native PostgreSQL tests PASS; повтор после добавления soft-delete/blank-alias case — run `test_512bda3dd2a2a3e7623a8491`.
- `node scripts/performance/check-catalog.mjs`:4/4 PASS, run `test_60a480f3b6d5d19bd05e5888`. Один repeatable-read snapshot, одинаковый seed и executable, полные результаты/catalog/RNG/pins сравниваются без normalization.12 пар сравнений: initialize/rest/inventory/camp_turn на owned runs с party1/2/6. Initialize/camp_turn включают всю party; scalar rest/inventory тестируют её lead character. Реальные Go HTTP worker calls, не stub.
- Unit catalog wave:10 duplicate needs дают3SQL вместо10legacy; JSON bytes совпадают. Проверены две разные actions, effect types, variables, alias collision/exact refs, missing/unknown/blank reference, soft deletion, сохранение ранее frozen row и чтение нового content свежей подготовкой.
- Реальный API smoke с batch: initialize+end_turn+retry+reload/source isolation для1/2/6, camp_turn, ordinary/resource equipment PASS (`test_00f1b27c916c083d869af702`). Как и OBS, equipment checker не выдаёт известное отставание resource projection за правильную механику.
- Обязательный fullstack test экспортирован через `checkCatalog(stack)` для shared extended stand TEST-03. Он не должен анонимно skip в DB-only группе; это dedicated integration route, не historical certificate.

## Измерения

Первый smoke показал initialize SQL40/68/172→26/29/33 для party1/2/6; resource equip/unequip36/37→20/21; ordinary8/9 не изменились. Needs rounds остались5: batch сокращает запросы в волне, не объявляет dynamic closure заранее полной. Latency smoke не сравнивается с ранним OBS: fixture и SQL statistics менялись при доработке TEST-04.

Финальная пара 30× PASS: before `test_e9d2121d66f85d5f091d1e58`, batch after `test_c785ecdf4ef8625c2b11684b`. Совпадают полный fixture descriptor (включая source hashes, schema и `statistics=analyzed-after-seed`) и pinned executable. По 330 числовых samples, полные outcome hashes и проверки retry/reload/source isolation сохранены: [до](OBS-01-final-server-baseline.json), [после](PERF-01-batch-server-baseline.json), [сравнение](PERF-01-paired-comparison.json). Ранний `test_3aef74a250874a57fc394021` до ANALYZE исключён.

| Сценарий | p50 до/после, ms | p95 до/после, ms | SQL до/после |
|---|---:|---:|---:|
| combat_initialize_party_1 | 133.88 / 154.20 | 217.17 / 201.41 | 40 / 26 |
| combat_continue_party_1 | 118.85 / 120.36 | 148.96 / 173.93 | 14 / 14 |
| combat_initialize_party_2 | 232.10 / 220.09 | 323.36 / 317.87 | 68 / 29 |
| combat_continue_party_2 | 201.75 / 180.78 | 300.00 / 311.55 | 17 / 17 |
| combat_initialize_party_6 | 716.99 / 592.28 | 1252.12 / 1246.46 | 172 / 33 |
| combat_continue_party_6 | 663.68 / 491.36 | 1371.86 / 1155.38 | 21 / 21 |
| camp_turn_party_1 | 68.97 / 85.48 | 74.98 / 109.19 | 40 / 26 |
| equipment_ordinary_equip | 23.52 / 18.79 | 37.26 / 33.33 | 8 / 8 |
| equipment_ordinary_unequip | 32.19 / 19.31 | 39.85 / 34.33 | 9 / 9 |
| equipment_resource_equip | 85.53 / 71.83 | 107.10 / 103.12 | 36 / 20 |
| equipment_resource_unequip | 90.23 / 70.79 | 105.51 / 100.62 | 37 / 21 |

Пять needs rounds и шесть worker calls initialize сохранены. Средний catalog fulfillment для party6 снизился с 48.56 до 8.42ms; SQL172→33 — воспроизводимое структурное сокращение. Общая latency шумная: camp_turn p95 вырос, хотя SQL снизились; continue и ordinary equipment вообще не меняют catalog path, но тоже заметно меняются. Поэтому прирост общего p95 не объявляется доказанным и не служит production SLA. Прогоны последовательные, остальная локальная нагрузка не контролировалась; seeds новых encounters независимы. Эквивалентность механик подтверждается отдельным полным differential на одинаковых inputs/seed, а не нормализацией случайных outcomes этой серии.

## Остаток после первоначального batch этапа

Нет общего кеша между запросами/пользователями и нет предварительного полного обхода reference registry. Текущие DB inputs не имеют устойчивого versioned content+rights revision контракта. Сам факт одинакового ID, raw access token или удобный TTL не делает reuse безопасным. Batch использует тот же DB/access scope, что legacy; он не объявляет новый контракт авторизации.

Prerequisite для shared immutable cache — DB-03 versioned immutable catalog с canonical content hash, pinned artifact/schema, build identity там, где она влияет на результат, и principal/tenant/access scope с revision прав. Cache hit допустим только после проверки текущих прав; mutable HP/resources/equipment/pending нельзя хранить в shared cache. Затем нужны bytes/entry limits, LRU/in-flight dedup, eviction/revocation tests и измеренный выигрыш. Reference prefetch должен сохранять dynamic needs fallback и проверку неполной/изменившейся closure. Эти требования не закрыты текущим batch patch.

Тестовый corpus использует поддержанные fighter presets; полная межклассовая и cross-principal cache матрица остаётся дальнейшей работой. Не заявляется выполнение всех acceptance PERF-01. Production flag не включён. Откат локального batch: убрать `RULES_CATALOG_BATCH_ENABLED=1`; старые envelopes, receipts, hashes и сохранённые решения остаются прежними.

Следующий реализованный opt-in этап для authoritative equipment/initiative preparation описан отдельно: [immutable input cache, проверки и границы](PERF-01-cache.md). Он переиспользует identity DB-03, но доказывает актуальность содержимого и прав fresh query каждого запроса, без xmin-only или TTL authority. Предыдущие baseline artifacts сохранены.
