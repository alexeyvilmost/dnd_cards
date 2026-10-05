# Сверка завершённости: релизы, БД и очистка

Проверено 05.10.2026 по исходным steps / verification / acceptance в [agent-plan.json](../agent-plan.json). Источники заморожены; изменены только этот отчёт и [машинная матрица](completion-audit-release.json). Повторных тестов, сборок, OS/CI/deploy действий нет. S/V/A — номера исходных пунктов, полный текст каждого сохранён в JSON. Один пункт может иметь отдельно доказанную часть и ещё не выполненную проверку.

Финальные **core-5 и extended-3 PASS**, 268898 / 1095961 ms, cleanup stopped. Оба проверили неизменные 4313 source files, SHA256 `9006ebdf46d135173693de59024649515d0706e4f2c2fc5eba540ef7df16aabb`. Это текущая локальная интеграция; она не выполняет OCI и не закрывает не включённые в неё требования. Пути и SHA256 обоих receipts — в JSON.

**Обновление разрешений:** во время аудита root передал явное разрешение пользователя на commit/push/deploy после проверок. Повторное подтверждение для этих действий не требуется; внешние действия выполняет только root. Условия отдельного запроса в цитируемом исходном плане отражают прежнюю границу и не отменяют полученное разрешение. Этот аудит внешних действий не выполняет.

PROVEN относится только к указанной части и её пределам. INCOMPLETE означает реальную локальную недоделку. EXTERNAL различает отсутствующую локальную Linux/Docker среду и отдельно разрешаемые remote действия — production не нужен для локального registry acceptance.

## REL-01 — Единая карта зависимостей для проверок, сборки и выкатки

Все заявленные локальные planner/wiring критерии подтверждены.

| Требование | Доказательство | Вывод |
|---|---|---|
| S1, S2, S3, S4, S6, V1, V2, V3, V4, A2, A3: Единый dependency manifest, Git change planner и проверка настоящего worker metafile; rename/delete/untracked, точный deployed baseline и консервативный fallback. | [component-dependencies.json](../../../../scripts/release/component-dependencies.json); [plan-components.mjs](../../../../scripts/release/plan-components.mjs); [plan-components.test.mjs](../../../../scripts/release/plan-components.test.mjs) (L87); [plan-components.test.mjs](../../../../scripts/release/plan-components.test.mjs) (L137); [build.mjs](../../../../frontend/worker/build.mjs); [REL-01.md](REL-01.md) | **PROVEN**. Проверен локальный контракт; manual map намеренно может выбрать лишнюю сборку. |
| S5, A1, A4: Planner используется общим local/CI runner и release plan; remote действия не выполнялись. | [run.mjs](../../../../scripts/testing/run.mjs) (L7); [ci-policy.mjs](../../../../scripts/testing/ci-policy.mjs) (L4); [quick-gate.ps1](../../../../scripts/release/quick-gate.ps1) (L26); [ci-release.mjs](../../../../scripts/release/ci-release.mjs) (L89); [ci.yml](../../../../.github/workflows/ci.yml) | **PROVEN**. Финальные core/extended проверили текущее дерево; это не запуск GitHub workflow. |

## REL-02 — Минимальные Docker-контексты и измеряемый кеш сборки

Contexts/layers/source closure готовы; actual OCI builds/cache/smoke не выполнены.

| Требование | Доказательство | Вывод |
|---|---|---|
| S2, S3, S5, V2, A3, A4: Исправлены contexts/allowlists/COPY closure; media layer отделён; чистые source snapshots и native frontend/worker/Linux-target Go сборки выполнены. | [measure-local.mjs](../../../../scripts/release/measure-local.mjs); [measure-local.test.mjs](../../../../scripts/release/measure-local.test.mjs); [Dockerfile](../../../../frontend/Dockerfile); [Dockerfile.rules-worker](../../../../infra/Dockerfile.rules-worker); [Dockerfile](../../../../backend/Dockerfile); [REL-02.md](REL-02.md) | **PROVEN**. V2/A3 доказаны для source snapshots, не содержимого OCI image. Native dependency junction не является чистым npm ci. |
| S4, A4: Cache mounts/scopes и обязательные TypeScript/production build подготовлены; Compose/Bake разобраны настоящим CLI. | [docker-bake.hcl](../../../../infra/docker-bake.hcl); [docker-bake.cache-gha.hcl](../../../../infra/docker-bake.cache-gha.hcl); [Dockerfile](../../../../frontend/Dockerfile); [REL-02.md](REL-02.md) | **PROVEN**. Синтаксис и input fingerprints не доказывают cache hits. |
| S1, S6, V1, V2, V3, V4, A1, A2, A3: Cold + два warm build каждого компонента, чистый install, фактические transferred bytes/cache invalidation/image sizes и container smoke. | [measure-local.mjs](../../../../scripts/release/measure-local.mjs); [release-builds.md](../../../release-builds.md); [REL-02.md](REL-02.md); [environment-readiness-current.json](../../../../outputs/testing/environment-readiness-current.json) | **EXTERNAL / среда**. Обязательная локальная проверка ожидает Linux Docker/BuildKit; pins должны быть настоящими. Это environment gate, не требование TimeWeb. |

## REL-03 — Manifest релиза и достоверная идентификация компонентов

Identity/schema/native replay готовы; POSIX и final images/mixed rollback не исполнены.

| Требование | Доказательство | Вывод |
|---|---|---|
| S1, S2, S3, S4, S5, V1, V2, V3, V4, A1, A2, A4: Versioned mixed manifest, baked component identity отдельно от release identity, legacy fail-closed, reference-aware retention и native historical replay. | [release-manifest.schema.json](../../../../infra/release-manifest.schema.json); [validate-manifest.mjs](../../../../scripts/release/validate-manifest.mjs); [validate-manifest.test.mjs](../../../../scripts/release/validate-manifest.test.mjs); [write-build-identity.mjs](../../../../scripts/release/write-build-identity.mjs); [build_info.go](../../../../backend/build_info.go); [server.mjs](../../../../frontend/worker/server.mjs); [REL-03.md](REL-03.md) | **PROVEN**. Native/fixtures доказывают контракты, но не настоящие mixed final images. |
| S3, V3: Настоящий POSIX writer: atomic build-info, malformed metadata и runtime spoof guards. | [check-frontend-identity.mjs](../../../../scripts/release/check-frontend-identity.mjs) (L11); [write-build-info.sh](../../../../frontend/write-build-info.sh); [ci-images.mjs](../../../../scripts/release/ci-images.mjs) (L35); [REL-03.md](REL-03.md) | **EXTERNAL / среда**. Standalone проверка явно отказывает на Windows; Git Bash по стандартным путям отсутствует. Статические source assertions не заменяют исполнение shell. |
| S6, V2, V3, V4, A2, A3, A4: Actual identity/protocol сравнение всех OCI images, mixed-version cutover и rollback при старом pending бою. | [docker-rehearsal.mjs](../../../../scripts/release/docker-rehearsal.mjs); [docker-deployment.mjs](../../../../scripts/release/docker-deployment.mjs); [REL-03.md](REL-03.md) | **EXTERNAL / среда**. Подготовленные адаптеры существуют; фактический image/runtime acceptance требует Docker. |

## REL-04 — CI-сборка проверенных образов и подготовка доставки через реестр

CI path подготовлен; отдельный local registry driver отсутствует, затем нужен OCI rehearsal.

| Требование | Доказательство | Вывод |
|---|---|---|
| S1, S2, S3, V1, V3, V4, A1, A4: Exact candidate/control identities, проверенный source-stable CI report, shared planner, parallel matrix/reuse и guarded publication/ready bundle path. | [release.yml](../../../../.github/workflows/release.yml); [ci-release.mjs](../../../../scripts/release/ci-release.mjs); [ci-images.mjs](../../../../scripts/release/ci-images.mjs); [deployed-baseline.mjs](../../../../scripts/release/deployed-baseline.mjs); [automatic-release.mjs](../../../../scripts/release/automatic-release.mjs); [candidate-rehearsal.mjs](../../../../scripts/release/candidate-rehearsal.mjs); [assemble-bundle.mjs](../../../../scripts/release/assemble-bundle.mjs); [REL-04.md](REL-04.md) | **PROVEN**. Доказаны code/contracts; actual images/publication не выполнялись. Старые абзацы REL04.md «manual only» и REL05 bundle missing исторические: текущий workflow_run и collector уже есть. |
| S4, V2, A1, A2: Owned loopback registry build/publish/pull, reuse, missing layer/image/manifest и повтор выпуска. | [ci-release.mjs](../../../../scripts/release/ci-release.mjs) (L104); [ci-release.mjs](../../../../scripts/release/ci-release.mjs) (L151); [ci-images.mjs](../../../../scripts/release/ci-images.mjs) (L84); [release-ci.md](../../../release-ci.md) (L114); [release.yml](../../../../.github/workflows/release.yml) (L140) | **INCOMPLETE — локально**. Не только Docker block: отсутствует локальный registry producer/caller. prepareBuildPlan/validateBuildPlan жёстко связывают imageRepository с GHCR; publish требует GitHub control/run. docker-rehearsal лишь потребляет опубликованные digests. Нужен отдельный owned local adapter/driver без ослабления production provenance, затем actual OCI запуск. |
| S5, S6, A3: Registry/TimeWeb pull access, credentials, GitHub environment/policy и настоящий exact committed CI run. | [release-ci.md](../../../release-ci.md); [release-build-config.json](../../../../infra/release-build-config.json); [release.yml](../../../../.github/workflows/release.yml) | **EXTERNAL / среда**. Runbook/disabled config подготовлены. Commit/push/deploy уже разрешены пользователем после проверок; root владеет external execution. Это не оправдывает отсутствие локального registry driver. |

## REL-05 — Раздельная выкатка и отдельно разрешаемый автодеплой main

Journal/adapters/capture/collector/additive producer готовы; actual selective OCI matrix не исполнена, зависит от REL04 local seam.

| Требование | Доказательство | Вывод |
|---|---|---|
| S1, S2, S3, S4, V2, V4, A2, A3: Persisted deploy journal, selective plan, recovery/rollback, retained assets/CJS, fresh capture, source DB binding и additive executor 298–300. | [deploy-state.mjs](../../../../scripts/release/deploy-state.mjs); [docker-deployment.mjs](../../../../scripts/release/docker-deployment.mjs); [capture-host-backup.mjs](../../../../scripts/release/capture-host-backup.mjs); [prepare-host-release.mjs](../../../../scripts/release/prepare-host-release.mjs); [migration-rehearsal.mjs](../../../../scripts/release/migration-rehearsal.mjs); [release_additive.go](../../../../backend/migrations/release_additive.go); [release_schema_proof.go](../../../../backend/migrations/release_schema_proof.go); [REL-05.md](REL-05.md) | **PROVEN**. Native PG executor + simulated Docker boundary + real config-only Compose proof. Новая DB schema сохраняется при app rollback; old readers разрешены только при доказанной совместимости и writer-off. |
| S5, V1, V2, V3, V4, A1, A2, A3: Настоящая frontend/backend/engine selective matrix, restart counts, failed health/pull, interrupted delivery/recovery, old tab/pending/rollback, exact-image семь migration scenarios. | [deploy.mjs](../../../../scripts/release/deploy.mjs); [docker-deployment.mjs](../../../../scripts/release/docker-deployment.mjs); [docker-rehearsal.mjs](../../../../scripts/release/docker-rehearsal.mjs); [migration-rehearsal.mjs](../../../../scripts/release/migration-rehearsal.mjs); [deploy-state.test.mjs](../../../../scripts/release/deploy-state.test.mjs); [REL-05.md](REL-05.md) | **EXTERNAL / среда**. Адаптеры/collector/assembler существуют; реальные containers не запускались. Сначала закрыть локальный registry seam REL04 и Docker среду. Current native candidate-rehearsal-api не OCI rehearsal. |
| S6, S7, A4: Manual exact-SHA и gated automatic CI→build→capture→rehearsal→deploy wiring; активный cutover не отменяется новым push. | [release.yml](../../../../.github/workflows/release.yml); [deploy.yml](../../../../.github/workflows/deploy.yml); [automatic-release.mjs](../../../../scripts/release/automatic-release.mjs); [deployment-handoff.mjs](../../../../scripts/release/deployment-handoff.mjs); [release-deployment.md](../../../release-deployment.md) | **PROVEN**. Подготовленное wiring доказано; реальная установка/включение и TimeWeb deployment ещё не выполнены. Пользователь уже разрешил root commit/push/deploy после локальных проверок. |

## REL-06 — Проверяемый backup/restore для БД, правил и релизов

Native complete restore/negative drill + policy plan; production-sized/OCI/off-host этап отдельный.

| Требование | Доказательство | Вывод |
|---|---|---|
| S1, S2, S3, S4, V1, V2, V3, A1: Checksummed dump+CJS+media-reference manifest, настоящий native restore, pending/RNG/paid resource и exact duplicate; negative corruption/schema tests. | [backup-manifest.mjs](../../../../scripts/release/backup-manifest.mjs); [native-backup.mjs](../../../../scripts/release/native-backup.mjs); [restore-drill.mjs](../../../../scripts/release/restore-drill.mjs); [restore-negative-drill.mjs](../../../../scripts/release/restore-negative-drill.mjs); [REL-06-native-media.json](REL-06-native-media.json); [REL-06-negative.json](REL-06-negative.json); [REL-06.md](REL-06.md) | **PROVEN**. Synthetic owned schema/catalog; media refs не media object bytes. Схема baseline297 не доказывает historical fresh install. |
| S5, S6, V4, A2, A3, A4: Restore time измерено, RPO/RTO/off-host schedule/retention предложены; reference protections вместо удаления по числу releases. | [backup-restore.md](../../../backup-restore.md); [backup-manifest.mjs](../../../../scripts/release/backup-manifest.mjs); [artifact-references.mjs](../../../../scripts/release/artifact-references.mjs); [deploy-state.test.mjs](../../../../scripts/release/deploy-state.test.mjs); [REL-06.md](REL-06.md) | **PROVEN**. 1.94s capture / 2.27s restore относятся малой fixture. Политики/расписания — reviewable план, не действующая гарантия; keep-all безопасен. |
| S6: Production-sized restore, external storage/config durability и фактический OCI capture/restore. | [backup-restore.md](../../../backup-restore.md); [capture-host-backup.mjs](../../../../scripts/release/capture-host-backup.mjs); [docker-rehearsal.mjs](../../../../scripts/release/docker-rehearsal.mjs); [REL-06.md](REL-06.md) | **EXTERNAL / среда**. Это явно отдельный внешний/OCI этап; не препятствует local restore acceptance, но native proof не открывает production gate. |

## DB-01 — Измерение размера БД и роста хранения по игровым сценариям

Inventory/growth измерены, независимая seeded equality и per-run-class counts отсутствуют.

| Требование | Доказательство | Вывод |
|---|---|---|
| S1, S2, S3, S4, S6, V1, V2, V4, A1, A3, A4: Owned/read-only bounded inventory: relation/TOAST/index/WAL, top5, stats window, canonical/legacy presence, no credentials/production claims. | [storage-report.mjs](../../../../scripts/database/storage-report.mjs) (L45); [storage-inventory.sql](../../../../scripts/database/storage-inventory.sql); [storage-report.integration.test.mjs](../../../../scripts/database/storage-report.integration.test.mjs); [summary.json](storage/summary.json); [DB-01.md](DB-01.md) | **PROVEN**. S3 частично: JSON size distributions есть, но отдельного распределения command counts по active/ended/QA runs в current report нет. |
| S5, A2: 100 и 1000 actual camp commands + exact retries, before/after sizes, timings и одинаковые response bytes в DB02 shadow comparison. | [storage-growth.mjs](../../../../scripts/database/storage-growth.mjs); [growth-100.json](storage/growth-100.json); [growth-1000.json](storage/growth-1000.json); [DB-02-storage.json](DB-02-storage.json); [DB-01.md](DB-01.md) | **PROVEN**. Свежие UUID/entropy/time между независимыми сериями различаются. |
| S3, S5, V3: Две независимые одинаково seeded series с одинаковым final state/RNG/receipts и сопоставимым logical ростом; run-class command counts. | [storage-growth.mjs](../../../../scripts/database/storage-growth.mjs) (L18); [storage-growth.mjs](../../../../scripts/database/storage-growth.mjs) (L47); [storage-report.mjs](../../../../scripts/database/storage-report.mjs) (L77); [database-storage.md](../../../database-storage.md); [DB-01.md](DB-01.md) | **INCOMPLETE — локально**. Нет seeded repeat driver и отчёта equality. Retry одной команды и same-answer shadow DB02 не заменяют два воспроизведения. Это локальная работа, не Docker/production blocker. |

## DB-02 — Компактные новые квитанции команд без потери идемпотентности

Local exact format/atomicity/recovery и physical saving подтверждены; performance/prod не обобщаются.

| Требование | Доказательство | Вывод |
|---|---|---|
| S2, S3, S4, S6, V1, V2, V3, A2, A3, A4: Additive v2 exact gzip bytes+hash, dual readers, atomic receipts/state, mismatch/concurrency/SQL-failure rollback и restore с выключенным writer. | [storage_receipt.go](../../../../backend/storage_receipt.go); [storage_receipt_test.go](../../../../backend/storage_receipt_test.go); [compact_receipts_298.go](../../../../backend/migrations/compact_receipts_298.go); [receipt-codec.mjs](../../../../scripts/database/receipt-codec.mjs); [DB-02-recovery.json](DB-02-recovery.json); [DB-02.md](DB-02.md) | **PROVEN**. Writer OFF. Rollback сохраняет reader/schema; старый бинарник без v2 reader после новых записей запрещён. Фазовый process-kill общего gate работает с writer OFF, отдельно ON это не доказано; ON проверены SQL failure+restart/restore. |
| S1, S5, V4, A1: 1000 exact responses: physical relation 44,507,136→26,492,928 bytes (−40.47%), включая TOAST; старые строки не переписаны. | [compact-receipts-drill.mjs](../../../../scripts/database/compact-receipts-drill.mjs); [DB-02-storage.json](DB-02-storage.json); [DB-02.md](DB-02.md) | **PROVEN**. Локальный выигрыш хранения; ускорение API/production disk saving не заявляются. |

## DB-03 — Неизменяемые каталоги по хэшу и разделение горячего состояния

Correctness и storage win доказаны; latency acceptance остаётся локально открытым.

| Требование | Доказательство | Вывод |
|---|---|---|
| S1, S2, S3, S4, S5, S6, V1, V2, V3, V4, A1, A2, A3: Owner/artifact/full-input hash, immutable rows+FK/dual read, frozen initialization reuse, cold update omission, corruption/rights/atomic/restore safeguards. | [storage_catalog.go](../../../../backend/storage_catalog.go); [storage_catalog_test.go](../../../../backend/storage_catalog_test.go); [frozen_catalogs_299.go](../../../../backend/migrations/frozen_catalogs_299.go); [frozen-catalog-drill.mjs](../../../../scripts/database/frozen-catalog-drill.mjs); [DB-03-recovery.json](DB-03-recovery.json); [DB-03.md](DB-03.md) | **PROVEN**. Новый dynamic envelope/CharacterV3 transport не выделен; реализован узкий frozen input и пропуск неизменных cold полей. Dynamic catalogActions не объявлен immutable. Checkpoints без измеренной потребности не добавлены. |
| S1, S4, V4, A4: 30 catalog copies→1 immutable blob, run+catalog relation 4,784,128→2,834,432 bytes; SQL payload/WAL/serialization/timing измерены. | [DB-03-storage.json](DB-03-storage.json); [DB-03.md](DB-03.md) | **PROVEN**. Два fresh synthetic прогона с разными UUID/RNG/time; это не exact-state A/B. |
| V4, A4: Принятие latency нового writer и полное обоснование включения. | [DB-03-storage.json](DB-03-storage.json); [DB-03.md](DB-03.md) | **INCOMPLETE — локально**. Init p95 182.7→194.0ms на30 samples; общего performance acceptance нет. Storage win доказан, writer остаётся OFF; повтор сравнения в контролируемой среде локален, не требует Docker. |

## DB-04 — Адресная уборка хранения: retention, индексы и встроенные изображения

Safe metadata/index path доказан; repeat no-op, EXPLAIN/latency и inline export verification не выполнены.

| Требование | Доказательство | Вывод |
|---|---|---|
| S1, S2, S3, S4, S5, V1, V2, A1, A2, A3: Conservative keep policy, bounded dataURL metadata, exact simple duplicate-index plan/export/drop/restore с preimage/ownership guards; old data/history сохранены. | [retention-plan.mjs](../../../../scripts/database/retention-plan.mjs); [retention-plan.test.mjs](../../../../scripts/database/retention-plan.test.mjs) (L20); [data-url-inventory.mjs](../../../../scripts/database/data-url-inventory.mjs); [DB-04-plan.json](DB-04-plan.json); [DB-04.md](DB-04.md) | **PROVEN**. Полный fixture не дал duplicate candidates/inline URLs. Positive fixtures подтверждают scanner и index export/restore; row archive/delete protocol не реализован и не разрешает удаления. |
| S6, V3, V5: Повтор exact apply — no-op; после duplicate-index изменения EXPLAIN/latency не ухудшены. | [retention-plan.mjs](../../../../scripts/database/retention-plan.mjs) (L58); [retention-plan.mjs](../../../../scripts/database/retention-plan.mjs) (L62); [retention-plan.mjs](../../../../scripts/database/retention-plan.mjs) (L68); [retention-plan.test.mjs](../../../../scripts/database/retention-plan.test.mjs) (L20) | **INCOMPLETE — локально**. Повтор после drop бросает preimage changed, recovery export пишется flag wx; нет durable applied/no-op reconciliation. До/после EXPLAIN/latency в positive fixture не проверяется; доказана идентичность index semantics и сохранность row hash. |
| S3, S4, S6, V4: Byte/hash verified inline image export с сохранением references и восстановлением на disposable fixture. | [data-url-inventory.mjs](../../../../scripts/database/data-url-inventory.mjs) (L2); [retention-plan.mjs](../../../../scripts/database/retention-plan.mjs) (L41); [DB-04.md](DB-04.md) | **INCOMPLETE — локально**. Реализованы только MIME/count/size агрегаты. Local export/verify/restore helper и positive byte equality test отсутствуют; реальный внешний storage migration отдельно не разрешён. Отсутствие inline URLs в stripped fixture не доказывает отсутствие их в production. |
| S7, A4: Production index/data retention/storage migration и scheduler. | [database-storage.md](../../../database-storage.md); [DB-04.md](DB-04.md) | **EXTERNAL / среда**. Конкретное удаление/подключение требует отдельного плана и запроса; текущий apply строго owned-local-only. |

## CLEAN-01 — Упорядочить локальные артефакты и действующую документацию

Обратимый согласованный cleanup scope и сохранность originals доказаны.

| Требование | Доказательство | Вывод |
|---|---|---|
| S1, S2, S4, S5, V2, V3, A2: Tracked/original/evidence inventory, outputs convention, root ignore, safe resolved-path dry-run и разделение Git/local/context sizes. | [inventory-artifacts.mjs](../../../../scripts/maintenance/inventory-artifacts.mjs); [artifact-inventory-summary.json](artifact-inventory-summary.json); [cleanup-ignore-inventory.json](cleanup-ignore-inventory.json); [README.md](../../../README.md); [.gitignore](../../../../.gitignore); [CLEAN-01.md](CLEAN-01.md) | **PROVEN**. Неизвестные originals сохранены; history/temporary Git objects не удалялись. |
| S3, S6, V1, A1, A2: Current docs index + 3 reversible archives с SHA256 original bytes, forwarding links; link check и build после переноса. | [archive-documents.mjs](../../../../scripts/maintenance/archive-documents.mjs); [document-archive-manifest.json](document-archive-manifest.json); [check-document-links.mjs](../../../../scripts/maintenance/check-document-links.mjs); [README.md](../../../README.md); [CLEAN-01.md](CLEAN-01.md) | **PROVEN**. Link checker ограничен inline local file links: remote/anchors/reference-style не заявлены проверенными. |

## Обязательные локальные остатки

- **REL04-LOCAL-REGISTRY**: Добавить отдельный owned loopback registry producer и caller build/save/publish/pull/reuse/fault matrix. Изолировать его plan/receipt от production-ready identity; не подставлять фиктивные GitHub runs. Закрепить реальный registry/base image digest, зарегистрировать owned resources/cleanup; actual build/run после появления локального daemon.
- **DB01-REPEATABLE-SERIES**: Создать один реальный owned бой с закреплённым artifact/seed, снять frozen snapshot ДО workload и восстановить его в две отдельные owned DB. Выполнить один и тот же список legal command IDs/revisions/inputs через реальный API/worker; сравнить authoritative game state, RNG, journal и exact receipts плюс logical growth. Не использовать camp_turn с новой entropy на каждом запросе и не подменять RNG после init. Если server-generated semantic time всё ещё меняет результат — сначала явная test-only clock/entropy dependency injection до старта source, без production env fault knob; operational timestamp whitelist документировать отдельно, semantic fields не отбрасывать. Добавить bounded per-run-class command counts, неизвестный QA scope явно отмечать.
- **DB03-LATENCY-ACCEPTANCE**: Повторить OFF/ON comparison на одинаковой восстановленной базе/inputs с численной дисперсией и idle CPU либо явно оставить storage-only эксперимент OFF. Не называть текущие30samples отсутствием регрессии; оптимизацию повторных catalog lookups делать только при сохранении integrity/privacy.
- **DB04-IDEMPOTENT-APPLY**: Добавить hash-bound owned operation receipt/reconciliation: absent drop-index плюс неизменный keep-index и совпадающий exact export дают already-applied/no-op; чужое изменение/несовпадение fail-closed. Проверить повтор, потерянный ack, restart, changed preimage; добавить EXPLAIN и bounded before/after query timing на clone.
- **DB04-INLINE-EXPORT**: Подготовить owned local-only export/verify/restore fixture для найденного synthetic inline image: exact decoded bytes/hash, MIME/access/reference preimages, отсутствие удаления исходного значения и воспроизводимый rollback. Внешний object storage/production apply не включать; если scope сознательно оставляется scan-only, зафиксировать явно неисполненный V4, а не done полного исходного плана.

## Что не следует заявлять

- Docker недоступен, однако это не объясняет отсутствующий loopback registry driver, seeded equality runner или idempotent cleanup verification.
- DB02 shadow сравнивает ровно те же сохранённые ответы и доказывает экономию representation; оно не доказывает два одинаковых seeded gameplay run.
- DB03 сокращает frozen inputs/cold UPDATE, но не вынес весь динамический world/CharacterV3. Writer OFF и сохранённый dual reader обязательны для честного rollback.
- DB04 keep-all и отсутствие кандидатов не дают права говорить, что выполнены inline export или очистка production. Index retry сейчас безопасно отказывает, но не выполняет исходное требование no-op.
- REL06 local recovery подтверждён; внешние media object bytes, production RTO/RPO, полная historical install цепочка и OCI recovery остаются отдельными доказательствами.
- REL04/05 collector, assembler, fresh capture и additive executor уже существуют: старые заметки о полном отсутствии этих частей больше не описывают текущий код.
