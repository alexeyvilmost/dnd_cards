# Измерение хранения PostgreSQL

Нагрузка: `node scripts/database/storage-growth.mjs` запускает 100 и 1000 реальных команд на двух отдельных стендах; `--count 100` или `--count 1000` выбирает один объём. Каждый запрос повторяется с тем же ID, квитанции и сохранённые ответы проверяются. Данные лежат в `outputs/testing/storage-growth/<run-id>-<count>/`. Полные JSON состояния и credentials туда не записываются. Независимые прогоны пока не фиксируют entropy backend и wall-clock: для проверки идентичности seeded state этот инструмент нужно дополнить отдельным test-only источником времени/entropy, не менять производственный RNG глобальной переменной окружения.

`scripts/database/storage-report.mjs` собирает read-only инвентарь в явно созданном локальном стенде. Он не читает `.env`, не подключается к production и не очищает БД. Для локального восстановленного снимка используется тот же одноразовый кластер, созданный `scripts/testing/stack.mjs`.

Нужны `TEST_DATABASE_URL`, выданный runner, и путь `--run-directory` к его реестру. Пароль передаётся PostgreSQL через окружение, не через аргументы процесса или JSON-отчёт. Перед чтением проверяются loopback, порт, имя базы, роль, путь реестра, состояние стенда и маркер владения в самой базе. Чужой адрес или отсутствие маркера — ошибка.

Пример внутри команды, которую запускает тестовый стенд:

```text
node scripts/database/storage-report.mjs --run-directory <TEST_RUN_DIRECTORY> --output <local-report.json> --sample-limit 1000
```

Аргументы с путями задаются вызывающим runner. Выражение `<TEST_RUN_DIRECTORY>` в примере надо заменить настоящим путём, оно не раскрывается самим скриптом. Для программного использования экспортирован `collectStorageReport({dsn, registry, sampleLimit})`.

Отчёт содержит размеры БД, relation/heap/TOAST/index, пять крупнейших таблиц, оценки live/dead rows, counters и даты обслуживания, начало окна статистики, определения индексов и виды ограничений. Наличие `pg_stat_statements` проверяется без его установки. Размеры JSON измеряются только для заранее разрешённых колонок, не более 1000 строк на колонку; сами значения в вывод не попадают.

`table_bytes` уже включает TOAST и его индекс; их нельзя прибавлять повторно. `index_bytes` — индексы основной таблицы. Для каждой relation проверяется `total_bytes = table_bytes + index_bytes`. Сумма relation не равна размеру всей БД: остаются системные каталоги, другие схемы и прочие объекты. Размеры колонок — выборочная оценка, не ещё одна аддитивная категория дискового места.

Выборка берёт первые физически доступные строки и не объявляется репрезентативной. Каждая выборка работает в read-only транзакции с лимитом запроса 5 секунд и ожидания блокировки 250 мс. При параллельной записи значения разных запросов могут немного расходиться. Нулевой `idx_scan` без достаточной длительности наблюдения не является основанием удалить индекс. WAL counters относятся ко всему одноразовому кластеру; размер каталога PostgreSQL, WAL-файлов, дампа, Docker-образов и исходного репозитория — разные показатели.

Проверки инструмента:

```text
node --test scripts/database/storage-report.test.mjs scripts/database/storage-report.integration.test.mjs
```

Integration создаёт и удаляет собственный кластер. Проверяет реальные размеры, ограничение выборки, отсутствие приватного fixture-значения/пароля в отчёте, неизменность строк и отказ при удалённом маркере владения. Нужны локальные PostgreSQL tools, как и для тестового стенда; отсутствие среды не маскируется skip.

На 04.10.2026 измерены 100/1000 реальных команд с exact retries; independent seeded-state equality остаётся открытой частью DB-01. Фактические размеры и экономия production БД не измерены. Основной inventory ничего не меняет и не выполняет `VACUUM FULL`.

## Новые форматы хранения

`DB_COMPACT_RECEIPTS=1` включает только новые квитанции v2: точный gzip JSON,
SHA-256/длина, прежние identity/request fingerprint, прежняя atomic transaction.
Маленькие и невыгодные для сжатия ответы остаются JSONB v1. На одинаковых 1000
сохранённых ответов owned стенда relation уменьшилась 44,507,136→26,492,928 B
(40.47%); это synthetic result, не оценка production. `receipt_storage` отдельно
показывает версии/logical/encoded bytes: пустой JSONB у v2 не означает пустой
ответ. Backup tooling декодирует v2 для полного artifact/media inventory.

`DB_FROZEN_CATALOGS=1` закрепляет только новые initialization catalogs в
owner-scoped immutable table. Hash покрывает весь frozen input, owner, protocol,
serializer и artifact. Динамические действия/состояние и исторический журнал
остаются прежними. Неизменные холодные поля забега исключаются из UPDATE.
Missing/corrupt/private-owner mismatch блокируют чтение, текущая библиотека не
подставляется вместо сохранённой. На 30 одинаковых frozen inputs получена одна
запись; init p95 в диагностическом прогоне не улучшился, поэтому performance
acceptance ещё не закрыт. Обе функции **выключены по умолчанию**.

Перед будущим включением: additive migrations 298/299, полный recovery gate,
общий core/extended и измерения на сопоставимой нагрузке. Rollback выключает
writers, но сохраняет dual readers/schema/blobs. Возвращать прежний бинарник,
который не читает v2/reference, после новых записей нельзя. История не backfill,
TTL квитанций и GC каталогов отсутствуют. Подробные результаты:
`docs/audits/2026-10-04/execution/DB-02.md`, `DB-03.md`.

## Retention, индексы и data URLs

`retention-plan.mjs --run-directory <owned> --output <new-plan.json>` создаёт
план без изменений. Принимает только явный `TEST_DATABASE_URL` нового owned
loopback стенда с registry/marker. План по умолчанию сохраняет персонажей, забеги,
документы, media, receipts, историю, frozen catalogs и rules artifacts. Владелец,
назначение и время использования важнее «редко открываемой вкладки».

Автоматически проверяемый кандидат — только точный duplicate обычного valid/ready
nonunique btree без predicate/expression/include/replica/dependencies. Сравниваются
ключи, collations, opclasses/options, uniqueness, tablespace/storage attributes,
а не только имя/`idx_scan`. Доступно восстановление конкретного DDL; более сложные
индексы остаются manual review. Окно статистики присутствует в плане, нулевые
сканирования сами по себе не позволяют удалить индекс.

Для **одного выбранного** кандидата в этом же owned стенде:

```text
node scripts/database/retention-plan.mjs --run-directory <owned> --plan <plan.json> --candidate <id>
node scripts/database/retention-plan.mjs --run-directory <owned> --restore <export.json>
```

Перед изменением инструмент перечитывает semantic preimages, сохраняет recovery
export, блокирует соответствующую таблицу и повторно сверяет определения в
транзакции. Чужой стенд, stale plan, потеря маркера, неизвестный формат — отказ.
При ошибке нет автоматического retry/широкой очистки. Это local-only инструмент;
production применение, scheduler/GC и удаление пользовательских строк отсутствуют.

Data URL inventory возвращает только MIME/count/logical bytes/distinct-content
count в первых ≤1000 строках известных media columns и paper documents. URL,
base64, IDs и owner IDs не выводятся. Значения >2 MiB и JSON matches свыше 128 на
документ пропускаются с явными границами; это не полный аудит всех вложений.
Перенос data URLs во внешнее storage требует отдельного плана, проверки объектов
и сохранения старых references; он не выполняется автоматически.

Обычный `VACUUM` освобождает место для повторного использования внутри PostgreSQL,
но не обещает уменьшение файлов/OS disk. Политик TTL для idempotency receipts нет;
append-only triggers не отключаются. Для CJS/backup/catalog cleanup обязательно
объединение active/history/pending/backups/rollback references и подтверждённый
restore; текущий план сохраняет всё.
