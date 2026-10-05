# REL-05: первый переход с наблюдаемой старой выкладки

Статус на 05.10.2026: локальная реализация и адресные проверки готовы;
**actual OCI legacy → new → rollback ещё не пройден**. Production-сервисы этот
агент не менял. Первое read-only наблюдение на TimeWeb выполняет root.

Старый single-SHA release не является manifest schema1: его endpoints сообщают
runtime SOURCE_COMMIT, а historical migration ledger не содержит checksums.
`legacy-baseline.mjs` сохраняет отдельный `observed-legacy-baseline` с явными
`bakedIdentity: unavailable`, `historicalChecksums: unavailable`, `deployable:false`.
В нём actual container/image IDs, hash полной private rollback configuration,
runtime configuration fingerprints, DB identity/schema fingerprint, ledger IDs,
artifact references и observation hash. Это не аттестация сборки старых images.

`inspect-legacy.mjs CONFIG NEW_OUTPUT` сверяет текущий Compose source hash с
label каждого живого контейнера, actual env с resolved env, health/runtime claim
и bytes текущего CJS; снимает read-only DB inventory. При несовпадении источник
нужно выяснить, gate не обходится. Приватный rollback Compose document имеет
точные старые image IDs вместо mutable tags. Он содержит secrets, хранится вне
checkout с 0600/0700 и не входит в публичные CI artifacts.

Первый host capture использует этот baseline и actual backend DSN, включает
rollback configuration, dump и прежние CJS. Collector стартует old image IDs
на owned clone, исполняет прежние pending/retry сценарии, запускает настоящий
candidate migration executor и проверяет новый полный комплект. Metadata CLI
принимает schema2 `expectedCurrentIds` + `baselineObservationHash`; контрольные
суммы существуют только у candidate target. Старые миграции не исполняются и не
получают выдуманных checksums. Allowlist, один advisory-lock connection,
atomic DDL+ledger, schema proof и old-reader gate сохранены.

`deploy.mjs adopt` требует matching actual rehearsal/backup и заменяет все три
компонента. До полного health success `active.json` schema1 не создаётся.
Expanded DB journal при отказе записывается отдельно в `legacy-state.json`;
rollback использует прежние image IDs и тот же проверенный private config,
сохраняя новую additive схему. Обычный `apply` для legacy отказывается.

В deployment workflow добавлен `workflow_dispatch.adopt_legacy` (default false).
Automatic `workflow_run` никогда не выбирает adopt. После успеха используется
обычный successful deployment receipt: следующие releases сравниваются с
реально установленным manifest, а не продолжают считать сервер пустым.

Проверки:

- Native owned PostgreSQL: `test_0eca924ff7dfcd078935cc7f/legacy-additive-go.jsonl`,
  **28 passed test events, 0 fail/skip**, cleanup stopped. Включены schema2
  crash-before-ledger, repeat/inspect after acknowledgement loss, historical
  response preservation, missing/unknown/ambiguous baseline и schema tampering.
- Deployment state: **20/20 PASS**, включая all3 initial replacement,
  failed cutover → legacy rollback, separate truthful DB journal, refusal of
  substituted observation. Unit simulations не выдаются за контейнерные доказательства.
- Actual adapter boundary unit tests: **8/8 PASS**, включая pinned legacy
  image/config, changed tag/env/config и прежние recovery/DSN guards.
- Collector/assembler: **7/7 PASS**, ID-only baseline и observation binding.
- Dispatch/automatic policy: **11/11 PASS**, автоматическая adoption запрещена.

Первый remote inspector root остановился на несовпадении backend/worker
Compose source hashes. Root доказал причину read-only: Compose 2.40.3
`config --hash` отключает env-file resolution. Hash уже resolved JSON документа
через stdin **точно совпал с container labels у всех трёх сервисов**. Inspector
исправлен на этот путь, не отключая проверку и не передавая secrets через argv.
Unit дополнительно проверяет точный stdin и отказ при изменённых actual env.
До настоящего OCI rehearsal/rollback adoption не считается принятой.

## Ограниченный полный inventory (2026-10-05)

Реальный server inspection обнаружил два локально не видимых ограничения:
единый UNION по всем JSON полям превышал 60 s, а страницы с inline data URLs
превышали 16 MiB transport buffer. Лимиты не подняты. Inventory теперь обходит
все поддержанные сохранённые public relations страницами 64 строки / 4 колонки,
одним JSON traversal на колонку. CTID cursor включает tableoid для partitions.
ENOBUFS или подтверждённый statement timeout уменьшают страницу с тем же cursor
до одной строки; неизвестная ошибка или слишком большая одиночная строка
завершают проверку без утверждения полноты.

Inspector держит один экспортированный REPEATABLE READ READ ONLY snapshot
не более 600 s. Каждый короткий запрос импортирует его, сохраняет statement
timeout 60 s и lock timeout 2 s. Generated helper удаляется по owner label при
любом исходе. В callers без экспортированного snapshot изменение visibility
token между началом/концом является отказом, а не успешным частичным inventory.

Inline media и ссылки длиннее 8192 B представлены SHA256 точного UTF-8 текста
и длиной. Оригинальные байты остаются в DB dump; media-manifest не дублирует их.
Restore сравнивает старые literal manifests и новые descriptors через dual-read
нормализацию. Это изменение формата inventory, не изменение entity URL/данных.

Доказательства: `REL-05-inventory-proof.json`: native PostgreSQL проверил все
вложенные/текстовые/compact references, 20 MiB synthetic inline string,
адаптивный transport отказ, concurrency отказ и malformed reference отказ.
Максимальный ответ — 2564 B. Настоящий Docker exporter выдержал параллельный
commit: импортированный snapshot видел старую строку, свежий запрос — обе.
Оба локальных окружения полностью остановлены. Это не production acceptance.
