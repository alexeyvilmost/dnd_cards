# REL-05 — selective deployment, локальная реализация

Статус `local_additive_executor_verified; exact_image_rehearsal_prepared`, не полный acceptance.
Production/auto-main отключены. Docker, GitHub runs/settings, registry, TimeWeb,
commit и push не выполнялись. `docs/release-deployment.md` — текущий runbook.

Реализованы persisted state machine, fsync journal/lock, honest per-instance launch
identities, selective service replacement, observed recovery, compatible image
rollback без restore DB, strict predecessor и reference-only retention. Новый
host adapter готовит immutable release directories, pulls/проверяет OCI digests,
actual image identities, сохраняет old assets/CJS, выполняет no-deps replacement.
Legacy SHA-only runner/опасный five-release prune заменены disabled manifest path.
Никакая установленная серверная копия не менялась.

CLEAN-03 follow-up: `retained-assets.mjs` ограничивает новые копии Vite hashed
assets, workbox и SHA-256 WebP. Mutable authored файлы больше не добавляются;
существующее содержимое не удаляется. Media hash/name collision, безопасные
пути и source/destination symlinks проверены отдельным `retained-assets.test.mjs`
— 4/4 PASS, 0 skip. Это локальный filesystem тест, не Docker acceptance.

Read-only `backend --migration-info` возвращает настоящий список GetAllMigrations
до env/DB startup. Checksums помечены unavailable; inspected historical baseline
не выдумывается. No-schema-change guard сравнивает baseline/manifest/live DB IDs/
embedded image IDs. Additive 298–300 теперь имеют отдельный транзакционный executor
и встроенные source checksums; неизвестные/изменённые миграции fail-closed.
Fresh backup + matching REL-06 restore proof обязательны
для любого cutover, включая frontend-only.

Disabled `.github/workflows/deploy.yml` содержит manual и separately gated auto
trigger, exact trusted release artifact и full REL-03 preflight, noncancellable
concurrency, dedicated trusted host/environment, package read only. Receipt
различает application releaseCommit и workflow controlCommit. Baseline validator
REL-04 дополнен соответствующей проверкой; moving main не заменяет candidate SHA.

Проверки 04.10.2026:

- `node --test scripts/release/deploy-state.test.mjs scripts/release/deployment-handoff.test.mjs scripts/release/ci-release.test.mjs scripts/release/validate-manifest.test.mjs scripts/content/micro-mvp-release-evidence.test.mjs`
  — **53/53 PASS, 0 skips/TODO**, включая 10 новых deployment tests. Реальные
  локальные journal/filesystem + simulated adapter; не container acceptance.
- `go test . -run '^(TestMigrationInfoCommand|TestBuildIdentityCommand|TestComponentBuildIdentity)$' -count=1`
  — **3 PASS**, current backend compile, CLI list равен реальному registry.
- `node --check scripts/release/docker-deployment.mjs` — PASS.

## Additive follow-up, 04.10.2026

`--migrate-release` / `--inspect-release-migrations` запускаются до .env/HTTP/jobs;
JSON stdin ограничен, unknown fields запрещены, baked source/input identity
обязательны, DSN/raw DB errors не выводятся. Advisory lock, DDL, ledger и schema
proof работают на одном connection/transaction. Исторический Migrator.Run не
переписан. Schema proof строит reference DDL в rollback savepoint; сравнивает
constraints/indexes/trigger WHEN/function config/table RLS/persistence. Доступ
CREATE SCHEMA необходим и подлежит host rehearsal.

Независимый review нашёл воспроизводимый обход immutable trigger через WHEN(false)
в первой версии proof (`REL-05-schema-review.json`); исправление включает этот
негативный случай, дополнительные function config/UNLOGGED/RLS/trigger/constraint
tampering tests. Old receipt bytes остаются неизменными. Новый-format receipt
блокирует old-reader rollback. Immutable app state отделён от observed database
journal; последующий app rollback сохраняет target DB set и executor digest.
Stale recovery завершённого release не может затереть более новый predecessor.
Live backend writer flags проверяются, production Compose фиксирует три флага 0.

Фактические проверки текущего executor:

- `node scripts/testing/stack.mjs --db-only -- <go> -C backend test ./migrations -run '^TestReleaseAdditive' -count=1 -v`
  — **7 top-level + 10 subcases PASS, 0 skips**, PostgreSQL 17.11;
  `outputs/testing/runs/test_e5c337b968e09b25de9304d8/command.log`, cleanup stopped.
  Это isolated schema fixture реального PG, не production baseline/checksums.
- Go `TestReleaseMigrationCLI...` + `TestMigrationInfoCommand...` — PASS (guards,
  embedded registry/source identity и current backend compile).
- Deployment/handoff Node matrix — **17 PASS, 0 skips**; additive cutover,
  lost migration acknowledgement, app rollback retaining DB, unsafe old readers,
  rejected unapproved migration/rehearsal, completed stale recovery.
- CI source/control provenance + automatic trigger + tier policy matrix —
  **22 PASS, 0 skips**. Missing baseline/worker/shared/backend/config schema requires
  extended exact-SHA proof; CI must have clean checkout and matching source snapshot.

Дополнительный follow-up: полный комбинированный Node набор до collector integration
— **78 PASS, 0 skips**; затем отдельно regression `recovery before migration intent`
подтвердил, что recovery interrupted preparation не начинает ещё не согласованный
DDL (deployment-state **17 PASS**). Fresh live history inventory обязателен до
cutover/rollback; неизвестный новый CJS fail-closed.

`capture-host-backup.mjs` / тесты (**4 PASS**, real local files + fake Docker boundary)
готовят fresh read-only pg_dump в protected root/backups/capture-run-attempt.
Actual backend image/identity/DSN проверяются до и после; DSN только private child
environment, все output files 0600, dirs0700. Captured bytes не объявляются restore
proof. Complete backup/report создаёт отдельный owned-clone collector. Actual
Docker capture не выполнен; Go/native REL06 proof не подменяет этот acceptance.

REL-06 actual native recovery уже **PASS**: `REL-06-native-media.json` содержит
pending/retry/CJS/media/schema proof на synthetic local dataset. Это не production
recovery approval. Остаётся actual OCI build/pull/health/restart matrix, Linux
Compose/network/stdin/permissions и exact-image additive 7-scenario rehearsal;
old-tab/old-pinned compatibility под реальными images; installed host inspected
baseline/config; reviewed runner/registry access. CI candidate-only artifact
первоначально нуждался в bundle collector/assembler; этот код и workflow стык
теперь добавлены, actual OCI запуск всё ещё не выполнен. Production
manifest и активный automatic deploy не создавались.

## Exact-image additive rehearsal producer

Добавлен `migration-rehearsal.mjs`: factory работает только с labelled owned
PostgreSQL clone и генерируемыми sibling trial databases. Он запускает обычный
candidate image CLI, сверяет baked source/input и embedded migration checksums,
читает migrationLockId как строку из того же executable. Production fault flags
не добавлены. Семь проверок выполняются до выдачи report/approval:

1. DDL + ledger и сохранность исторических данных после успешного применения.
2. SHARE lock на trial schema_migrations пропускает SELECT, блокирует INSERT после
   DDL; ожидающий PID обязан держать advisory и DDL locks. Candidate container
   принудительно останавливается, затем подтверждаются rollback и успешный повтор.
3. Повтор после committed result, трактуемого как потерянное подтверждение, не
   применяет миграции снова и возвращает тот же schema proof.
4. Настоящий startup advisory lock сериализует candidate process; DDL + ledger
   выполняются на проверенном соединении.
5. Неизвестная запись ledger приводит к отказу без изменения данных/схемы.
6. Подмена immutable trigger на WHEN(false) приводит к отказу inspect/repeat,
   без молчаливого восстановления неизвестной схемы.
7. Previous backend на расширенной main clone читает pending и повторяет принятую
   команду без изменения истории; storage/job writers остаются выключенными.

Snapshot proof фиксирует baseline tables. Только действительно новые storage
columns исключаются из row projection; existing old storage поля остаются в hash.
SHA-256 sorted row hashes, ledger и schema fingerprints проверяются раздельно.
Trials удаляются только внутри owned PostgreSQL; failure/cleanup error не выдаёт
approval. Collector/assembler связывают результат с actual candidate receipt.

- `node --test scripts/release/migration-rehearsal.test.mjs` — **13 PASS**,
  fault-machine и prepared Docker boundary; не actual image execution.
- Combined deployment-state/migration/collector local contracts — **35 PASS**
  перед последним расширением collector tests; definitive общий gate ведёт root.
- Native PostgreSQL `TestReleaseAdditive...` — **8 top-level + 10 subcases PASS**,
  `outputs/testing/runs/test_c8693b4954573d9500ff9484/command.log`, cleanup stopped.
  Новый физический fault: настоящий SHARE lock, same PID advisory + ALTER lock,
  pg_terminate_backend до ledger, rollback DDL/ledger, restart — PASS.

Prepared Docker producer теперь имеет исполнимый путь для 298–300; фактические
image pull/kill/clone/runtime/permissions и полный end-to-end rehearsal остаются
**unverified** без Docker daemon. Это не production migration approval.

Финальная локальная интеграция release tooling: `node --test scripts/release/*.test.mjs scripts/testing/ci-policy.test.mjs`
— **145/145 PASS, 0 skipped/TODO, exit 0**, 9.56 s. Набор включает collector и
assembler (включая additive), host capture/orchestration, deployment journal,
source/control provenance, latest deployed baseline, contexts и retained assets.
Main Go CLI/info проверки — exit 0; первый запуск завершил сами тесты успешно,
но Windows отказал удалить test.exe, повтор завершился полностью успешно.

Последние review fixes capture: запрет private root внутри/поверх Git checkout и
GITHUB_WORKSPACE; fail-closed URI query overrides/dot-path/encoded-host формы,
которые Go и libpq разбирают по-разному; explicit sslmode и отсутствие inherited
PG* overrides. Capture timeout удаляет только свой generated labelled контейнер.
Migration metadata/CLI probes также зарегистрированы для owned cleanup.

## Финальный review: привязка выкатки к БД резервной копии

Исправлен конкретный межмодульный дефект: capture использовал фактический
DATABASE_URL работающего backend, но migration/inventory читали изменяемый
app.env. При одинаковой схеме они могли проверить или изменить другую БД.
Теперь capture создаёт `source-binding.json`, включённый в hash-bound backup
inventory. Он содержит ID исходного контейнера и SHA-256 от endpoint/user/database/
sslmode без пароля. Adapter проверяет эту идентичность по actual container image,
launch environment и разрешённому active/candidate state. Полный DSN остаётся
в памяти и передаётся DB-командам через child environment, без app.env или argv.

Перед prepare/migrate/cutover проверяется настоящий merged Compose environment,
включая worker env override. `up` получает именно проверенный resolved документ
`compose.runtime.json` с mode 0600; повторное чтение изменённых env-файлов
не может переключить БД. Этот **приватный** файл содержит effective secrets и
не должен публиковаться. Active/operation/capture JSON не содержат пароль/DSN.
Literal `$` сравнивается после одного decode Compose presentation, сам resolved
JSON сохраняется без повторного экранирования.

Остановившийся candidate остаётся проверяемым по immutable image и launch env.
При полностью отсутствующем контейнере fallback разрешён только после начатой
backend replacement либо для записанной незавершённой операции с touched backend:
проверяются сохранённый private runtime, candidate image/launch, captured DB identity
и выключенные writers. Неизвестный/лишний контейнер и произвольный app.env не являются
основанием восстановления; initial deployment без backend отказывается.

- Общий локальный release + CI policy набор: **154/154 PASS, 0 skips, exit 0**,
  11.18 s; `outputs/testing/release-final-binding-tests.log`.
- Независимый review adapter + deployment state: **24/24 PASS, 0 skips**;
  `outputs/testing/release-binding-independent-review-final.log`.
- Настоящий Docker Compose **config-only**, без daemon/containers: literal single
  и double `$`, decoded DSN, повторный parse и отсутствие env_file в resolved
  document — PASS; `outputs/testing/release-compose-binding-proof-1791143423491.json`.
  Receipt содержит Compose version и SHA-256 проверенных source files.
- Source credentials scanner и scoped `git diff --check` — PASS.

Actual OCI deployment/rollback, production secrets и TimeWeb не запускались.
Старый backup без source-binding не открывает новый deployment path: требуется
свежий capture и настоящий accepted rehearsal.
