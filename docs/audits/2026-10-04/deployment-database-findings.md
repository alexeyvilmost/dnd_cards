# Аудит выкатки и хранения данных — 04.10.2026

Это материал для двух итоговых отчётов. Приложение, БД и сервер не изменялись. Изучены локальные исходники, миграции, CI и release runner. `.env`, ключи и значения секретов не читались. SSH, prod-запросы, Docker build, миграции, commit и push не запускались. Вызов чтения локального списка Docker-контейнеров завершился ошибкой отсутствующего Docker Desktop daemon. Фактический размер PostgreSQL, планы production SQL, длительность текущего релиза и доступные ресурсы TimeWeb не измерены.

Обозначения: **факт** — подтверждено кодом/локальным измерением; **гипотеза** — требуется замер; **вариант** — предлагаемый способ реализации. Локальные размеры ниже относятся к существующим tracked-файлам рабочего дерева, а не к размеру образов, Git history или production БД.

## 1. Что уже сделано хорошо

- Отдельные backend, frontend и rules-worker уже определены в `infra/compose.prod.yml:4`, `:32`, `:56`; Caddy — отдельный edge. Для разделения выкатки не нужны Kubernetes и разбиение на новые сервисы.
- Runner принимает полный Git SHA и архив, сериализует выкладки `flock`, хранит несколько релизов и откатывает приложение после ошибки health/identity: `infra/deploy-release:4`, `:27`, `:41`, `:232`, `:266`.
- Перед новым backend делается PostgreSQL dump (`infra/deploy-release:156`); application rollback не восстанавливает БД. Expand/contract совместимость уже является необходимым инвариантом.
- Зависимости Docker копируются до исходников: `backend/Dockerfile:4`, `frontend/Dockerfile:6`, `infra/Dockerfile.rules-worker:3`. Слой зависимостей уже можно переиспользовать; рекомендация «добавить кеш вообще» была бы неточной.
- Старые исполняемые артефакты правил сохраняются вне образов: `infra/deploy-release:166`, `infra/compose.prod.yml:43`, `frontend/worker/server.mjs:70`. Их байты проверяются по SHA-256, старый бой вызывает закреплённый artifact hash.
- Старые hashed assets доступны старым вкладкам в течение предусмотренного окна: `infra/deploy-release:188`, `:207`, `frontend/nginx.conf.template:28`.
- Боевой журнал уже хранит полный baseline лишь в начале сегмента, затем небольшие события/случайные значения/хэши: `backend/roguelike_combat_journal.go:31`. Не следует предлагать «перестать сохранять полный каталог в каждом событии», поскольку в этом журнале такая оптимизация уже есть.
- Авторитетный расчёт боя выполняется до write locks, затем обе ревизии проверяются и состояние/квитанция фиксируются вместе: `backend/roguelike_worker_controller.go:56`, `:162`, `:180`, `:255`. Ускорение не должно упразднить эти проверки.

## 2. Выкатка: подтверждённые проблемы и варианты

### D1. Каждый выпуск собирает три образа на production-хосте

**Факт.** `infra/deploy-release:179–187` последовательно запускает worker, backend и frontend build; `:260` запускает весь Compose. У всех трёх образов один `${SOURCE_COMMIT}` (`infra/compose.prod.yml:8`, `:33`, `:59`). UI-правка поэтому меняет все теги и приводит к обновлению всех трёх application containers. Это лишняя работа и возможные перерывы запросов даже для неизменившегося компонента. Конкретные минуты задержки не измерены.

**Предпочтительный вариант.** Собирать проверенные immutable images в CI, публиковать в OCI registry, на TimeWeb скачивать нужные image digests и переключать только затронутые сервисы. Это переносит вычислительную работу со служащего игрокам хоста и позволяет параллельные независимые сборки. Начальный, менее сложный вариант — оставить сборку на сервере, добавить component manifest и change detection, BuildKit/cache mounts; он не устраняет конкуренцию build с игровыми запросами.

**Важно.** Простой `git diff frontend/ backend/` недостаточен: worker — часть графа `frontend`, а frontend читает JSON из backend. Раздельная выкатка означает разные версии компонентов в одном совместимом релизе, поэтому существующее требование равного `source_commit` надо заменить честной моделью, а не подставлять новый SHA в старый image.

### D2. Нет автоматического deploy после успешного commit/main

**Факт.** `.github/workflows/ci.yml:33` содержит focused gate, `:84` и далее — ручные исторические диагностические jobs. Deployment job отсутствует. Кнопка/агент сейчас должны архивировать SHA, загрузить архив и запустить runner по инструкции `docs/standalone-deploy-after-push.md:310–405`.

**Варианты.**

1. Кнопка GitHub Actions `workflow_dispatch` с exact SHA: минимальный шаг, совместимый с правилом явного запроса на выкатку.
2. Автовыкатка проверенного `main` после успешного CI: нужное пользователю поведение Railway. Включается как отдельное согласованное изменение политики проекта; текущий запрос — анализ, а не разрешение включить deploy.
3. TimeWeb App Platform: отдельно оценить поддержку текущих четырёх компонентов, приватного worker, persistent artifact volume, сохранения старых JS chunks, external Postgres и текущего rollback. Переезд ради одной кнопки может оказаться сложнее собственного небольшого pipeline; пока нет доказательства, что он сохраняет все инварианты.

При событии push использовать SHA события, а не читать постоянно движущийся `main` во время build. Ручной «последний коммит» сначала разрешить в SHA и проверить происхождение/успешный gate. Diff строить между **последним успешно развёрнутым manifest** и кандидатом: сравнение только `HEAD^` пропускает изменения при нескольких коммитах или провалившемся предыдущем deploy. Разрешить максимум один deploy; уже начатую миграцию/выкатку не обрывать механизмом `cancel-in-progress: true`, который подходит текущему тестовому CI, но не cutover.

### D3. Граф зависимости компонентов не отражён в release gate

**Факт.** `scripts/release/quick-gate.ps1:72`, `:73`, `:79` исключает удалённые файлы через `--diff-filter=ACMR`. `:88` считает worker изменённым только при `frontend/worker/*`, хотя `frontend/worker/artifact.ts:1–6` импортирует camp/combat/journey из `frontend/src/roguelike`; далее используется общий engine. `frontend/Dockerfile:17–18` копирует animation/audio catalog из backend; worker также копирует animation catalog (`infra/Dockerfile.rules-worker:9`). Такие изменения должны включать соответствующий component build/test и deploy.

**Вариант.** Один machine-readable manifest зависимостей компонентов для локального gate, CI, build и deploy. Сначала широкое безопасное правило для общего frontend engine/catalog, затем подтверждённый esbuild input graph. Учитывать удаления и переименования, lockfile, tsconfig, Dockerfile, build scripts, shared JSON, схемы и серверный транспорт. Не считать изменение `backend/animationpresentation/catalog.json` чистым backend-only. Сохранить `metafile` worker build: он уже создаётся в `frontend/worker/build.mjs:5`, но сейчас применяется лишь для запрета browser imports и не сохраняется как release input evidence.

### D4. Большие контексты/архивы и лишняя инвалидизация кеша

**Факт.** Локально tracked frontend занимает 186 726 382 bytes (178,08 MiB), из них public — 155 121 376 bytes (147,94 MiB); backend 24 935 046 (23,78 MiB), references 36 871 926 (35,16 MiB), officials 19 930 365 (19,01 MiB), scripts 9 481 220 (9,04 MiB), docs 5 585 056 (5,33 MiB), output 2 252 561 (2,15 MiB). Использован `git -c core.quotepath=false ls-files` и сумма размеров существующих файлов, без чтения содержимого артефактов.

`.dockerignore:1` подтверждает общий root context и legacy builder. Он исключает `outputs`, но не `output`, `references`, `officials`, `docs`, весь backend из frontend/worker context и весь frontend public из worker context. Runner получает только tracked-архив: локальные untracked `tmp`, `.local-postgres`, `backups` в него не входят. Однако ручной `docker build` от рабочего root может включить такие каталоги; это отдельный риск, а не размер текущего production release.

**Вариант.** Сначала production input inventory; затем минимальные контексты или BuildKit named contexts. Вынести static asset layer так, чтобы замена изображения не повторяла установку зависимостей/проверку правил. Стабилизировать Go module/npm layers, добавить cache mounts к Go compile/npm package cache, внешний cache в CI с отдельным scope на компонент. На worker не копировать весь `frontend/src` и `scripts` без необходимости; лучше явный граф source roots с проверкой импортов, чем ручной неполный список отдельных файлов. Любое урезание проверять чистой сборкой всех трёх образов, а не кешированным local build.

### D5. Release identity, health и rollback нуждаются в manifest

**Факт.** `frontend/start.sh:11–20` записывает `build-info.json` из runtime env, не из вшитой build identity. Runner проверяет только одинаковый frontend/backend SHA (`infra/deploy-release:266–276`), worker `/health` имеет artifactHash/sourceCommit (`frontend/worker/server.mjs:92`), но публичная итоговая проверка runner не сверяет его identity.

**Вариант.** `release-manifest.json` содержит release SHA и для каждого компонента: source SHA, image digest, input fingerprint; для worker также artifact hash, transport protocol version/capabilities и runtime version; для БД — ожидаемые migration versions/schema compatibility. Build identity вшивается при сборке, release identity задаётся отдельно. Backend health/readiness сообщает разные понятия явно. Неизменённый frontend остаётся с прежним component SHA и digest, новый release manifest честно на него ссылается.

Cutover symlink уже атомарен как filesystem operation, но Compose replacement нескольких сервисов не является атомарной одновременной сменой HTTP-трафика. Сначала достаточно backward-compatible rolling replacement + короткий smoke; blue/green имеет смысл только если замер покажет существенный разрыв и хватит памяти для двух наборов. Автоrollback меняет manifest/images, не откатывает данные. Если схема несовместима со старым image, выпуск должен быть заблокирован до production.

### D6. Резервное копирование и retention

**Факт.** Полный `pg_dump` выполняется на каждом релизе (`infra/deploy-release:156`), даже если меняется только frontend. В коде runner нет retention для `shared/backups`; retention 5 релизов действует на releases/builds/images, а 90 дней — на frontend assets. Rules artifacts хранятся отдельно от БД; текущий `pg_dump` сам по себе не включает CJS из `shared/rules-artifacts`.

**Вариант.** Сначала зафиксировать backup policy, размер/время dump, restore drill и зависимость «DB snapshot → referenced artifact hashes». Хранить копии артефактов отдельно от VPS, вместе с manifest, и проверять восстановление сохранённого pending decision. Для чистого frontend/worker-restart выпуска без изменения БД можно позже вынести dump из критического пути при подтверждённой независимой backup/PITR политике и новой согласованной инструкции. Backend/migration release продолжает выполнять необходимый pre-migration backup. Нельзя просто удалить backup ради скорости или оставлять только последние 5 артефактов: активный старый бой может ссылаться на более старый hash.

## 3. БД: источники роста и безопасная оптимизация

### DB1. Главный кандидат — полноразмерные квитанции забегов

**Факт.** `RoguelikeRun` хранит JSONB `combat_envelope`, `combat_catalog`, `encounter`, `shop`, `checkpoint`, journey и пр. (`backend/models_roguelike.go:21–58`). В `roguelikeRunResponse` сериализуется весь публичный run (`backend/roguelike_controller.go:170`), который включает персонажа/party и `combat_state`. На каждую принятую команду эта response сохраняется в `roguelike_command_receipts.response` (`backend/roguelike_worker_controller.go:235–256`, `backend/roguelike_controller.go:1664–1674`, `backend/roguelike_party_worker.go:270`). Это осознанная идемпотентность: retry возвращает прежний ответ, а не выполняет действие повторно.

**Гипотеза.** При длительных забегах и больших состояниях receipt response становится одним из главных потребителей TOAST/диска. Фактическая доля неизвестна. Текущий run также обновляет все крупные JSONB-поля (`backend/roguelike_controller.go:481–491`); это кандидат на избыточную сериализацию, TOAST/WAL и время transaction, но SQL-текст сам по себе не доказывает, что каждый неизменившийся TOAST value физически копируется полностью.

**Варианты после измерения.**

- Отдельный immutable content-addressed каталог для новых боёв, ссылки из нового envelope version. Дедуплицировать одинаковые каталоги между новым current state/baseline/receipts только если измерение подтверждает дубли.
- Новая версия command response с компактным immutable result/patch и ссылкой на точный snapshot; повтор старой команды должен возвращать семантически тот же ответ и не читать «текущего персонажа» вместо исторического. Старые receipts обслуживаются прежним reader.
- Разделить cold immutable metadata и hot mutable state, обновлять только изменившиеся поля. Не разбивать атомарность run/character/revision/receipt.
- Архив завершённых сегментов в проверяемом формате с хэшами и явным доступом/restore. Сначала dual-read, export/verify, затем отдельное разрешённое сокращение hot storage. «Удалить записи старше N дней» для receipt опасно: повтор command ID может вновь потратить ресурс. Нужны долговечный ledger/tombstone и доступ к точному старому результату либо явно версионированный протокол истечения, не выдающий старую команду за новую.

### DB2. Канонический транспорт хранит JSONB + точные байты

**Факт.** `backend/migrations/create_canonical_runtime.go:58–59`, `:219–226`, `:343–344`, `:396–397`, `:446–447`, `:513–514` содержит структурированный JSONB и canonical bytes. `session_snapshots` и часть журналов защищены append-only triggers (`:593–609`). `character_runtime_commands` также append-only (`backend/migrations/add_character_runtime_commands.go:16–47`).

**Ограничение вывода.** Canonical transport включается только флагом `ENABLE_UNVERIFIED_CANONICAL_TRANSPORT=1` (`backend/canonical_session_routes.go:9–15`, `backend/main.go:330`). Неизвестно, сколько строк там реально есть. Нельзя заявлять, что этот код даёт большой текущий перерасход.

**Вариант.** Только если таблицы велики: отдельный design review формата новых записей/архива. Canonical bytes нужны для доказуемого хэша и сериализации; удалять «дубликат JSON» механически нельзя. PostgreSQL уже использует TOAST; внешнее gzip-сжатие не гарантирует существенную экономию. Измерить `pg_column_size`, фактический TOAST размер и стоимость чтения до выбора формата.

### DB3. Индексы и housekeeping

**Факт.** Есть кандидаты на дубли: `image_library.cloudinary_id UNIQUE` и отдельный обычный индекс (`backend/migrations/migrations.go:3288`, `:3313`); `session_snapshots UNIQUE(session_id, seq)` и индекс `(session_id, seq DESC)` (`backend/migrations/create_canonical_runtime.go:418–422`). Их существование в текущей БД и необходимость ещё надо проверить. Индексы GIN по JSON runtime создавались отдельно (`backend/migrations/add_world_runtime_v5.go:959–971`), но некоторые таблицы могут быть пусты.

**Вариант.** Read-only inventory `pg_stat_user_tables`, `pg_stat_user_indexes`, `pg_indexes`, `pg_total_relation_size`, `pg_stat_statements` при наличии. Проверять, какой constraint обслуживает индекс, и накопленную статистику с последнего reset; нулевой `idx_scan` за короткое окно — не доказательство ненужности. EXPLAIN ANALYZE только для безопасных SELECT на локальном восстановленном снимке. После замеров точечно настраивать autovacuum для горячих JSONB-таблиц. `VACUUM FULL` не является обычной уборкой: блокирует и требует свободное место. Наличие dead tuples не равно bloat, а удаление строк не гарантирует немедленное сокращение файла на диске.

### DB4. Исторические каталоги, изображения и legacy storage

**Факт.** Изображения в моделях/`image_library` представлены URL и метаданными (`backend/models.go:1324`, `backend/migrations/migrations.go:3286`), а не доказанными большими бинарными blobs. Удаление картинок из object storage уменьшит storage/bandwidth, но не обязательно заметно уменьшит PostgreSQL. Есть архивы миграций с `before_row jsonb` (`backend/migrations/generic_spell_freeuses_297.go:173–175`, `manual_content_review_274.go:23` и др.).

**Вариант.** Составить data ownership/retention matrix: пользовательские документы, текущие персонажи/забеги, архивы боёв, idempotency receipts, неизменяемые артефакты, временные OAuth, завершённый outbox, migration evidence, legacy таблицы. У каждой категории свой срок/reader/возможность удаления. Legacy таблицы/миграции сначала считать и проверить ссылки, затем архивировать по процедуре; удаление UI-раздела не разрешает удаление пользовательской истории. Удалять из object storage только доказанно orphan assets с учётом frozen catalogs/старых документов, а не только текущих library rows.

## 4. План измерений (не выполненные SQL-команды)

Исполнитель должен работать с названной локальной БД, восстановленной из разрешённого снапшота; read-only с ограничением времени. Никакие DSN/пароли не включаются в отчёт.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';
SELECT current_database(), version(), pg_database_size(current_database());
SELECT relid::regclass AS relation,
       pg_total_relation_size(relid) AS total_bytes,
       pg_table_size(relid) AS table_including_toast_bytes,
       pg_indexes_size(relid) AS index_bytes,
       n_live_tup, n_dead_tup, n_tup_ins, n_tup_upd, n_tup_del,
       last_autovacuum, last_autoanalyze
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC LIMIT 30;
SELECT relid::regclass AS relation, indexrelid::regclass AS index_name,
       pg_relation_size(indexrelid) AS index_bytes, idx_scan
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC LIMIT 40;
COMMIT;
```

Следующий этап — ограниченные выборки самых больших таблиц: распределение `pg_column_size(response/record/combat_envelope/combat_catalog/checkpoint)` и числа команд на забег; разнести active/ended/QA. Снимок не сохраняет исторические SQL timings и метрики накопленного workload: `pg_stat_statements`/application traces на prod — отдельное read-only наблюдение только в рамках разрешённого доступа. Для оценки роста воспроизвести локально один и тот же seeded сценарий 100/1000 команд; записать logical bytes, table/TOAST/index/WAL delta и p50/p95 command time. Не добавлять GIN на каждое поле JSON и не обещать процент уменьшения до этих данных.

## 5. Задания агентам

Все задания начинаются с актуального `AGENTS.md`, `docs/data-driven-rules.md` и отдельного согласованного scope. Тесты/разработка локальные; remote/prod/commit/push не подразумеваются этим планом. Оценки — рабочие дни одного агента/разработчика, без времени ожидания доступа; предварительные, не SLA.

### DEP-01 — воспроизводимые замеры (P0, 0,5–1 день)

- Scope: новый `scripts/release/measure-local.*`, документация, JSON output вне tracked artifacts.
- Сделать локальный Linux/Docker стенд; измерить archive bytes, context bytes, install/build/backup/pull/cutover/health durations, cold/warm build каждого компонента, память/CPU, downtime.
- Брать pinned commit и версии runtime; не использовать текущие незакоммиченные изменения как production доказательство.
- Acceptance: два warm и один cold прогон с машиночитаемыми стадиями; нет сетевого обращения к prod; unknown поля явно `null`, не ноль.

### DEP-02 — единая карта зависимостей (P0, 1–2 дня)

- Depends on: ничего; можно параллельно DEP-01/DB-01.
- Scope: `scripts/release/quick-gate.ps1`, новый dependency manifest/planner, CI; worker metafile export.
- Учесть A/C/M/R/D, общий engine/data, character assembler, roguelike, schemas, backend presentation JSON, lockfile, tsconfig, Dockerfiles, frontend config/public/scripts, инфраструктуру.
- Diff для deploy — deployed manifest → candidate; для локальных checks — выбранный baseline + рабочий diff. Не использовать только `origin/main...HEAD` после push, когда он пустой.
- Acceptance: table-driven planner cases: UI-only → frontend; Go-only → backend; engine-only → frontend+worker; animation catalog → корректный набор; deletion/import change → нужный набор; docs-only → без application rebuild; unknown path → консервативный safe default.

### DEP-03 — кеш и контексты (P1, 1–2 дня)

- Depends on: DEP-01/02.
- Scope: `.dockerignore`, три Dockerfile, build definitions; исправить root-context drift в `docker-compose.yml`, `docker-compose.prod.yml`, `docker-compose.local.yml`, где frontend ещё имеет context `./frontend`, несовместимый с текущими `COPY frontend/...`.
- Сначала minimal contexts с явными shared inputs, затем cache mounts и registry/gha cache scope per component. Не менять инструкции install/build/test ради «зелёной сборки».
- Acceptance: clean isolated builds без local fixtures/secrets; warm build показывает реальные cache hits; production assets/imports целы; удалённые файлы не скрыты старым кешем.

### DEP-04 — component release manifest (P0 для selective deploy, 2–4 дня)

- Depends on: DEP-02.
- Scope: `infra/compose.prod.yml`, `infra/deploy-release`, health/build identity, новый manifest schema + validation; update runbook.
- Переход backward-compatible: старые single-SHA release описываются адаптером; новый manifest содержит release/source/digest/inputHash/API protocol/worker artifact/schema ranges. Проверять данные до mutation.
- Rollback и GC опираются на manifest references, а не общий SHA тега; не удалять image, который используется текущим/rollback manifest.
- Acceptance: локальные frontend-only/backend-only/engine-only releases; unchanged service не restart; frontend/backend/worker identity совпадают с manifest; неправильный digest/protocol/hash fail closed; искусственная health failure возвращает прежний manifest без DB restore.

### DEP-05 — CI build и запуск с кнопки (P1, 2–3 дня)

- Depends on: DEP-03/04 и новый core gate из общего тестового плана.
- Scope: отдельный release workflow, OCI registry, ограниченная deploy identity, known-host verification, component change planner, immutable image digests, manifest provenance.
- Начать с workflow_dispatch exact SHA. Проверить branch membership/green gate; запретить PR/fork публикацию в production и доступ к production secrets. Build параллельно по matrix; host только pull/verify/migrate/restart/smoke. Deploy concurrency без аварийной отмены активного cutover.
- Acceptance: complete rehearsal на локальном аналоге TimeWeb; no-op docs release, invalid manifest reject, interrupted upload recovery, failed pull и failed health rollback; отдельный явный шаг для реального включения prod pipeline.

### DEP-06 — автоматический deploy main (P1 после DEP-05, 0,5–1 день)

- Только после принятия владельцем новой политики автоматической выкатки.
- Bind CI success к точному SHA; newer commit не меняет candidate mid-flight; провалившийся commit не теряет накопленные изменения в следующем deploy.
- Acceptance: два быстрых последовательных push в тестовой ветке/стенде, ошибка первого, повтор второго; deploy history сохраняет компонентные версии. GitHub environment approvals — вариант, зависящий от тарифа/видимости репозитория, а не безусловное требование.

### DB-01 — storage inventory и baseline (P0, 0,5–1 день)

- Scope: безопасный read-only SQL/report tool; изолированный restore; никаких data migrations.
- Зафиксировать PostgreSQL version, relation/TOAST/index sizes, rows, workload counters, крупнейшие JSONB fields, активность legacy tables, рост за fixed seeded scenario. Отдельно VPS backups/artifacts/assets и Git/local experiment storage.
- Acceptance: отчёт подтверждает крупнейшие 5 consumers; size totals согласованы; не выводятся записи пользователей и секреты; ограничения restore statistics отмечены.

### DB-02 — backup/restore contract (P0, 1–2 дня)

- Depends on: DB-01; можно до оптимизации хранения.
- Scope: backup manifest, restore rehearsal, artifact-reference scanner, retention dry-run; без prod удаления.
- Связать DB backup, exact executable artifacts, release manifest и необходимые assets; внехостовая копия. Restore в новый локальный стенд и продолжение pending decision/старой команды без повторных RNG/расходов.
- Acceptance: подтверждённый RPO/RTO на тестовом стенде; current+old pinned combat opens; отсутствующий/битый artifact явно обнаружен; retention dry-run не включает referenced artifacts.

### DB-03 — индексы и hot writes (P1, 1–3 дня)

- Depends on: DB-01.
- Scope: только измеренные query/write hotspots, additive migration при необходимости, targeted persistence helpers.
- Проверить candidate duplicate indexes и реальные запросы; применить одну небольшую оптимизацию за итерацию, сохранить transaction/CAS guards. Перед любым DROP INDEX проверить constraint dependencies и план; production DDL — отдельная выкатка.
- Acceptance: одинаковый результат запросов, отсутствие auth/cross-user regressions, меньше SQL/serialized bytes или p95; нет ухудшения retry/concurrent command; статистика до/после.

### DB-04 — уменьшение новых command results (P2, 3–6 дней)

- Depends on: DB-01/02, protocol design review; выполнять, только если receipts/duplicated catalogs действительно существенны.
- Scope: новая versioned storage/response schema, dual-reader, новые записи; старые bytes/hash/history не переписывать автоматически.
- Сделать immutable catalog/result references или bounded snapshots/deltas, проверять complete restore и atomic writes; не добавлять отдельный упрощённый rules engine.
- Acceptance: baseline replay + 1000 commands идентичны по итоговым hash/RNG/resources; повтор старого и нового command ID возвращает сохранённый ответ после последующих ходов и рестарта; active и archived references доступны; измерено уменьшение диска/времени с учётом TOAST, а не только JSON length.

### DB-05 — archival/retention (P2, 2–4 дня после модели retention)

- Depends on: DB-01/02 и согласованные сроки хранения.
- Scope: plan/export/verify/apply для конкретных завершённых данных, reference graph для artifacts/assets, audit receipts.
- Не запускать общий TTL для command receipts, canonical snapshots или artifacts. Не отключать append-only triggers ради уборки. Нужен отдельный versioned archival contract с idempotent reads/проверяемыми хэшами.
- Acceptance: dry-run перечисляет точные ID/bytes/references; restore/replay архива проходит; active/pending/rollback данные исключены; apply explicit, повтор операции no-op; периодическое удаление включается отдельно.

## 6. Показатели результата

- Deploy: wall time по стадиям, число собранных/restarted компонентов, время недоступности, bytes transfer, build cache hit, CPU/RAM на serving host, rollback time.
- DB: logical/table/TOAST/index/WAL bytes, рост на 100 команд, p50/p95 чтения run и authoritative command, lock duration, dead tuples/autovacuum trend.
- Correctness guards: retry сохраняет один расход и исходные dice; saved pending decision survives reload/deploy/rollback; старые artifacts доступны; новая сущность на тех же operations не требует кода кнопки; history/hash не пересчитаны из текущего каталога.
- Численные целевые проценты ускорения/сокращения выбирать после baseline. До замеров можно принять структурные цели: UI-only deploy не рестартует backend/worker; immutable catalog не копируется в каждый новый command result; full rebuild только при реальной общей зависимости.

## 7. Официальные внешние источники, проверенные 04.10.2026

- Docker описывает порядок слоёв, малые contexts, cache mounts и external cache: [Optimize cache usage](https://docs.docker.com/build/cache/optimize/). Это подтверждает инструменты, но не обещает конкретный выигрыш для проекта.
- В multi-image CI нужен отдельный cache scope; ограничения драйвера/лимитов зависят от используемого builder: [GitHub Actions cache](https://docs.docker.com/build/cache/backends/gha/), [Cache storage backends](https://docs.docker.com/build/cache/backends/).
- GitHub поддерживает push/manual triggers, deployment environments и concurrency: [Deploying with GitHub Actions](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments). Доступность required reviewers зависит от плана и public/private: [Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
- PostgreSQL 17 описывает накопительные per-table/index counters: [Cumulative Statistics System](https://www.postgresql.org/docs/17/monitoring-stats.html). Размер локального data directory или SQL dump не заменяет `pg_database_size`/relation inventory.

