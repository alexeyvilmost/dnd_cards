# Выкатка по manifest и сохранение истории

Статус на 2026-10-06T20:18:01.730Z: f383c905 выкачена и независимо проверена; БД и предыдущий коммит fed0195f сохранены. CI31 frontend-only прошёл, но публикация отказала при запуске отдельного стенда; selective delivery не принята. Политика автоматического main подготовлена после успешного полного внедрения; внешнее включение и actual acceptance ещё впереди. [Доказательства и границы](audits/2026-10-04/execution/CI-31-selective-publication-refusal.md).

## Состав и состояние

`scripts/release/deploy-state.mjs` хранит `active.json` с общим immutable manifest
и `instances` — последним releaseId/releaseCommit запуска каждого сервиса.
При UI-only изменении backend/worker сохраняют прежние launch identities.
Их baked sourceCommit/inputFingerprint/imageDigest остаются истинными. Общую
активную композицию определяет manifest, не одинаковый SHA трёх health endpoints.
Compose использует отдельные `BACKEND_`, `FRONTEND_`, `RULES_WORKER_RELEASE_*`.

Runner проверяет exact predecessor и всю REL-03 evidence bundle; определяет
изменившиеся digests/fingerprints; проверяет live images, их IDs и endpoint
identities. Замена вызывает `compose up --no-deps --no-build --pull never` только
для затронутого сервиса. Caddy, неизменённые backend/worker не перезапускаются.
Это последовательная замена контейнеров, а не атомарная смена всего HTTP-трафика.

Каталог операции и journal сохраняют предыдущий/целевой состав, touched services
и этап до действия. Запись использует temporary file, fsync и rename; host lock
не снимается автоматически после неизвестного исхода. Повтор успешного запроса
сначала проверяет live composition, не выполняет cutover повторно. Другой кандидат
не допускается, пока осталась операция с неизвестным исходом. `recover` сначала
наблюдает старый/новый состав; смешанное состояние требует явного `rollback`.
Откат возвращает только затронутые совместимые images и проверяет здоровье. БД
не восстанавливается; при сомнительной схеме автоматический откат блокируется.

## Миграции, backup и сохранение истории

Поддерживаются **no-schema-change** и явная expansion allowlist 298–300. Host
adapter читает реальные IDs из schema_migrations и сравнивает их со встроенным
`backend --migration-info`. CLI выполняется до env/DB startup: исторические
checksums=unavailable, а additiveMigrations содержит SHA-256 встроенных исходников
только 298–300. Историческая таблица не хранит исходные checksums; их нельзя
вывести из номера миграции.
Нужен отдельный inspected transition baseline с исходными доказательствами.
Legacy adapter выдаёт non-deployable inspection, не разрешение на замену.

Любая другая новая миграция или изменение уже принятого checksum блокирует rollout.
Для 298–300 требуется exact-candidate additive rehearsal report с семью сценариями
из `migrationScenarios`, прежним/целевым migrationSet и backward compatibility.
One-off `--migrate-release` получает JSON через stdin, DATABASE_URL только через
окружение; candidate sourceCommit/inputFingerprint должны совпасть с baked binary.
Он берёт тот же advisory lock, что старый startup, и на **одном соединении**
атомарно выполняет DDL + ledger в одной транзакции. Повтор сверяет фактическую
схему, не считает наличие IF NOT EXISTS доказательством. Неизвестный commit outcome
сначала требует reconciliation; schema/ledger не откатываются при app rollback.

`--inspect-release-migrations` не применяет отсутствующие migrations. Сравнение
схемы использует временную reference schema внутри откатываемого savepoint:
нужна CREATE SCHEMA permission в этой БД, сохранённых объектов не остаётся.
Проверяются типы/defaults/constraints/indexes, trigger WHEN/args/function settings,
RLS и persistence новых таблиц. Изменённый immutable trigger блокирует rollout.

`active.json.database` и operation journal сохраняют фактически принятую схему
отдельно от app manifest; immutable release directories содержат только состав
приложения. После app rollback новая схема и executor image остаются учтены.
Recovery завершённой старой операции не может перезаписать более новый release.
Compose expansion profile явно выключает DB_COMPACT_RECEIPTS, DB_FROZEN_CATALOGS
и IMAGE_JOBS_ENABLED, actual backend environment проверяется; дополнительно перед
rollback проверяется отсутствие новых receipt/catalog/job состояний. Включение
writers требует отдельно проверенной политики совместимости отката.

Полный путь требует свежего backup активного manifest и matching restore report:
checksum/размер snapshot и CJS, schema, pending decision, duplicate command и media
references. Backup gate принимает только доказанный REL-06 bundle. Это сохраняет
обязательность pre-release backup до принятия иной политики. Подготовленный
capture должен быть не старше 30 минут при начале прогона. Полное восстановление,
история, writers и cutover имеют общий предел 60 минут от первоначальной даты:
подлинный production-sized прогон CI24 занял 30 минут 58 секунд. Дата снимка
не обновляется; будущий или просроченный снимок блокируется после проверки байтов
и снова перед заменой. Более строгий явно заданный предел допустим; бесконечный
или превышающий час предел запрещён. Оригинальный отчёт стадий сохраняется до
поздней freshness-проверки, а при отказе verified-backup/ready не создаются.
Остановленная попытка требует нового capture, не продления старого сертификата.

Отдельный типизированный frontend-only путь (`ui-host-release.mjs`) применим
только при точном совпадении неизменённых backend/worker, их конфигурации,
схемы, протоколов и защищённых каталогов с исходным полным proof anchor.
Он проверяет свежий frontend CI и 12 фактически выполненных mixed OCI сценариев,
включая откат и старые файлы интерфейса. Перед и после замены проверяются текущие
контейнеры и неизменяемые файлы. В этом пути нет нового дампа, восстановления,
миграции или сканирования ссылок рабочей БД; текущая полнота её ссылок не
утверждается. Неизвестное изменение возвращает выпуск в полный путь.

Подготовленный
`capture-host-backup.mjs HOSTCONFIG POLICY NEWOUTPUTDIR` создаёт новый pg_dump
custom snapshot и копирует все hash-checked CJS, release.json и active.json.
Его source DSN берётся из реально работающего backend после проверки image/health/
baked identity; значение передаётся только private child environment. Перед и
после capture проверяется тот же container/database binding и active hash.
Mutable app.env не определяет источник снимка отдельно от работающего backend.

Capture root — существующий protected `config.root/backups`, новый каталог только
`capture-<run>-<attempt>` внутри него; workflow checkout для private snapshots
не используется. Каталоги 0700, файлы 0600. Повтор не перезаписывает прошлый snapshot,
не удаляет partial output и не загружает private данные в GitHub artifacts.
`capture.json` подтверждает только сохранённые bytes и active identity. До реального
owned-clone restore/inventory в collector нет backup.json, complete/schema/PASS
claims. Collector завершает backup/media/restore reports, а private runtime config
указывает deployment gate на этот же каталог. Первый внешний capture и restore
выполнены. Для f383c905 полный candidate rehearsal принят: девять проверок прошли,
временные ресурсы убраны без ошибок. Исходная дата снимка сохранена; остановленная
попытка никогда не считается успешным backup/restore/release bundle.

Перед заменой pull/inspection всех digests, проверка каждого referenced CJS,
сохранение предыдущих и новых immutable assets/workbox/WebP. Новые копии
ограничены `assets/<name>-<hash8>.<ext>`, `workbox-<hex>.js` и
`media/variants/<sha64>.webp`; authored/unhashed assets и HTML не архивируются.
Для WebP SHA-256 содержимого обязан совпадать с именем. Уже сохранённые файлы,
включая прежние unhashed assets, не удаляются. Коллизия immutable имени с другими
байтами блокирует выкатку. Старые файлы не удаляются по TTL, числу релизов или месту
на диске. `deploymentRetention()` возвращает union защищённых references и
`authorizesDeletion:false`. Политика удаления — отдельное решение после inventory.
Прямо перед cutover/rollback выполняется новый read-only live inventory, включая
compressed receipts. Появившийся unrehearsed artifact или отсутствующий/повреждённый
CJS блокирует замену, а не исчезает из retention по устаревшему snapshot.

## Ручной внешний этап и автоматика

`.github/workflows/deploy.yml` подготовлен для manual exact-main release run и
отдельно включаемого workflow_run после release pipeline. Проверяются origin/run
metadata, exact SHA, полная readiness bundle. Неполный REL-04 candidate-only artifact
блокируется. `cancel-in-progress:false`; host lock сериализует реальную замену.
Новые быстрые push не отменяют активную выкатку; stale predecessor требует нового
плана от фактически успешно действующего manifest и не теряет предыдущие changes.

Deployment receipt различает releaseCommit приложения и controlCommit workflow:
workflow_run может выполняться на более новом default branch SHA. Baseline consumer
проверяет оба значения и hash manifest, а не подменяет один другим.

Разрешение пользователя уже получено. Полный путь перед заменой требует Linux/OCI
проверки, restore актуального backup, exact-candidate rehearsal и registry pull access.
Типизированный frontend-only путь проверяется по отдельному контракту выше.
Репозиторий публичный: используется hosted runner, отдельный SSH-ключ environment
`production`, закреплённые known_hosts и Node 24.19.0 на сервере. Production
self-hosted Actions runner не устанавливается. Environment допускает только `main`.
Production включается только tracked policy + repository variable + CLI flag;
auto-main требует ещё отдельные policy/variable. SSH-протокол повторно проверяет
GitHub provenance на сервере, передаёт краткоживущий token через stdin и удаляет
временный Docker auth после завершения дочернего процесса. Неизвестный исход
требует осмотра journal, а не слепого повтора.

Host config содержит абсолютные пути root/compose/Caddy/deploy env/app env/worker
env/artifacts/assets/backup/migration baseline, reviewed compose/Caddy checksums,
project name и pinned PostgreSQL client image. Значения секретов остаются в
защищённых env files; runner не печатает их, DSN не интерполируется в host argv.
Новый manifest сначала проверяется локально:

```text
node scripts/release/deploy.mjs plan candidate.json bundle.json active.json
node scripts/release/deploy.mjs legacy-inspect previous-legacy.json
```

`apply/recover/rollback --production` требуют всех независимых переключателей
и проверенных входных данных. Само изменение tracked policy не запускает выпуск. При stale lock
нельзя удалять его автоматически: сначала подтвердить завершение владельца и
сохранить journal/наблюдения. Отдельного unsafe force режима нет.

## Первые проверки и исторические отказы

Ниже сохранена история первоначального внедрения. Текущее состояние и отдельно
незавершённая выборочная приёмка приведены в датированной записи в начале файла.

Native PostgreSQL 17 acceptance проверяет 298–300, атомарность/повтор/lock, crash
до ledger, старые bytes и отказ при schema tampering. REL-06 synthetic native
backup/restore PASS, но это не production snapshot proof. Unit fault matrix
проверяет реальный persisted state/journal и injected adapter:
frontend/backend/worker-only, no-restart unchanged, corrupt manifest, failed backup,
pull/health failure, unknown outcome, повтор, rollback, lock и stale predecessor.
Это **не** доказательство production traffic. Actual local Docker/OCI matrix,
переключение/откат, old chunks и pending battle проверены отдельными датированными
receipts; CI9 и GHCR publication прошли на точном текущем коммите. Полная первая
host rehearsal осталась незавершённой, production cutover не состоялся.
Candidate bundle producer и CI→build→rehearsal→deploy
стык подготовлены и проверены локальными contract/fault tests; candidate-only
artifact становится release bundle только после actual clone/health/history/
additive rehearsal. Семь migration scenarios исполняют тот же candidate image,
включая kill до ledger и old-backend reads. Автоматический cutover до фактического
OCI acceptance и отдельного enablement запрещён policy.

После первого отказа подготовлен явный manual first_adoption_recovery для точной попытки 37273035754-1. Он требует trusted control proof, полного CI, всех трёх новых images и свежей проверки main/истории/защищённого host до capture и под lock. Успешного predecessor ещё нет; старый capture и failed rehearsal не заменяют новый bundle. Обычный deployed discovery не изменён. [Локальная интеграция](audits/2026-10-04/execution/REL-06-thin-recovery.md).

CI10 и публикация bf79 успешны; второй actual deploy37287164307 отказал до capture из-за root0755. Точный существующий root исправлен на0700, read-only original-host guard и healthPASS. История обоихfailedactual attempts сохраняется, следующий manual recovery должен явно связать обе проверенные попытки. AUTO/selective/writersOFF; новый source требует нового exactCI и свежего полного bundle. [Точная запись](audits/2026-10-04/execution/CI-10-second-publication.md).

Исправление Go JSONMap boundary прошло полный replay оригинального локального снимка136/136 и локальные33+27проверки. Trusted proof связывает все три failed attempts; следующий выпуск требует нового exactCI/images/fresh30minute capture и всех обычных gates. Первого healthy adoption ещё нет. [Подробности](audits/2026-10-04/execution/REL-06-go-wire-recovery.md).
