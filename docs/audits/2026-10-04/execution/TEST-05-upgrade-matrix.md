# TEST-05: проверка обновления поддерживаемых схем

Объём: три перехода **297→300, 298→300 и 299→300** на изолированных локальных
PostgreSQL. Это дополнение к проверкам additive release executor, а не доказательство
полной исторической установки 001→300. Проверка не создаёт production bootstrap и
не изменяет исторические миграции или сертификаты.

## Источник и граница доказательства

- Полный checked-in DDL: `scripts/testing/fixtures/schema.sql`, SHA-256
  `296d25beb5723f77b91f418f96d57add118438b49ae539071354ef681dce2cc2`.
  Его manifest явно содержит `historicalChainVerified:false` и baseline297.
- Журнал импортируется из 302 ID manifest с явным описанием: исторические `Up`
  здесь не запускались. Четыре уже присутствующих retired ID сохраняются:
  `011_add_detailed_description_formatting`, `096_register_micro_mvp_rules_release`,
  `097_repair_micro_mvp_rules_release_identity`, `098_repair_magic_initiate_2024`.
  Их удаление или появление других неизвестных ID делает проверку неуспешной.
- Непустые связанные данные — synthetic storage canaries: пользователь, персонаж,
  забег, два вида command receipts, журналы боя/персонажа, непроверенное действие
  и архив его непроверенного support. У канареек нет действующего сертификата.
- Старые envelope, расходованный RNG cursor и сохранённый выбор берутся из
  неизменяемого `frontend/worker/fixtures/replay-v1/corpus.json.gz`; его manifest,
  сжатые и распакованные байты проверяются. Original CJS
  `sha256:d65f8e2e1bd73976acbc2d6d7f2d18b2b104b2c8a34463bafddbaf7d07770645`
  сохраняется побайтово. Эта проверка доказывает хранение; семантический replay
  выполняет отдельный обязательный historical worker gate.

## Реализация

`scripts/testing/check-upgrade-baselines.mjs` создаёт три новых owned `dbOnly`
стенда, используя `upgrade-baseline-fixture.mjs`. UI, API и worker не собираются
и не запускаются. `backend/migrations/baseline_upgrade_matrix_test.go` требует
явных маркеров отдельного стенда, loopback DSN и совпадения DB ownership marker.
Обычный общий пакетный запуск Go не может случайно использовать этот сценарий.

Промежуточные схемы 298/299 получаются применением настоящих зарегистрированных
`Up`, затем вызывается **обычный startup `Migrator.Run()`**. Проверяются точные
3/2/1 новые строки журнала и нулевое изменение при повторном `Run()`. Хэши всех
старых колонок каждой исходной таблицы, включая support, request/response, историю,
envelope/catalog и timestamps, сохраняются. Новые default/null колонки не меняют
проекцию исторических значений. Полные FK и triggers остаются включёнными.

Дополнительно проверяются receipt storage version1, пустые новые catalog refs/jobs,
полный поиск ссылок на CJS, сохранность файла CJS и одинаковый итоговый fingerprint
колонок, ограничений, индексов, функций и triggers во всех трёх исходных схемах.
Входные Go/JSON/source fixtures и исполняемый тестовый файл имеют хэши до/после.

Go-тест компилируется один раз в новый каталог отчёта, затем выполняется через
`go tool test2json`. Это сохраняет точный бинарник и обходит Windows-ошибку удаления
только что исполнявшегося временного `.exe`, не игнорируя ненулевые exit codes.
Проверки отклоняют пустое выполнение, skips, failures и отсутствующий exact subcase.
Linux-профиль может включить `--race` при компиляции; Windows race здесь не заявлен.

## Локальный статус

**Native matrix: 3/3 PASS, 0 skip/fail, 41,7 с**, PostgreSQL 17.11 и Go 1.25.12
Windows/amd64. По каждому исходному состоянию сохранены проекции 93 таблиц,
9 связанных канареек, 62 FK и 49 пользовательских triggers. Startup применил
ровно 3/2/1 новых миграций; повторный запуск — ноль. Все три owned PostgreSQL
остановлены, итоговая схема совпала. Дополнительно сохранены точные определения
всех 1960 исходных schema objects. Linux race этим запуском не проверен.

Команда: `node scripts/testing/check-upgrade-baselines.mjs outputs/testing/upgrade-baselines-native-7`.
Полный отчёт: `outputs/testing/upgrade-baselines-native-7/report.json`; переносимая
выжимка: [TEST-05-upgrade-matrix.json](TEST-05-upgrade-matrix.json). В mandatory
extended это отдельный driver; exact Go test не запускается на общей batch DB.

Промежуточные failed receipts сохранены в
`outputs/testing/upgrade-baselines-native-{1,2,3,4,5}`. Первые два выявили явные
retired ledger ID; следующие два завершились Windows unlink error после Go PASS;
пятый прошёл Go297 с exit0 и выявил несовместимость stdout общего sensitive psql
query с JSON parser. Эти отчёты не объявляются успешной матрицей. Отдельный
`native-6` — успешные 3/3 до усиления проверки schema objects; итоговый `native-7`
подтвердил её. Проверки known credentials, database dump artifacts и `git diff
--check` прошли. Независимый read-only review первоначальной matrix не выявил
блокирующих замечаний.

## Оставшийся исторический долг

`seedPre083Catalog` исключает private support, но простое возвращение поля
не восстановит отсутствующее происхождение. SPELL-0253 и SPELL-0173 имеют
`support:null` во всех трёх отслеживаемых Git-версиях исходного snapshot.
Миграция102 требует точную историческую комбинацию mechanics/support/hash/evidence,
которую checked-in snapshot не содержит. Её isolated exact-preimage test проверяет
сам guarded transition, а не полную установку.

Поэтому historical fresh install остаётся `awaiting_trusted_historical_preimage`.
Нельзя брать stale certificate из констант миграции и выдавать его за восстановленный
production preimage, ослаблять guard102/103 или использовать урезанный integration
каталог как новый production seed. Тридцать historical migration snapshot cases
этим дополнением не превращаются в PASS.
