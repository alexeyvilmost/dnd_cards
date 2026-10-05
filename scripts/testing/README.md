# Изолированный локальный тестовый стенд

Из корня репозитория, при установленных зависимостях frontend, Go и PostgreSQL 17:

```text
node scripts/testing/stack.mjs --profile integration -- node scripts/testing/check-api.mjs
```

Команда создаёт новый PostgreSQL cluster/database, собирает backend, worker и production frontend, проверяет readiness, запускает сценарий и убирает только свои процессы и БД. Логи и несекретный registry остаются в `outputs/testing/runs/test_<id>/`. Полный body API, пароли, JWT и DSN в registry не записываются. `--reuse-ui-build` явно разрешает уже собранный frontend; его hash и факт повторного использования попадают в registry. `--performance` включает opt-in метрики API/worker для OBS-01.

На Windows поддержаны установленные инструменты в `%LOCALAPPDATA%/dnd-cards-dev/tools`; на других системах — инструменты из PATH. При необходимости задайте `TEST_PG_BIN` (каталог PostgreSQL) и `TEST_GO` (полный путь к Go). Они не являются адресами подключений. Запуск `initdb` от root на Linux не поддерживается PostgreSQL: нужен обычный пользователь. Сервисы и PostgreSQL слушают `127.0.0.1` на выделенных свободных портах. Пароли генерируются на один запуск; приложение запускается из каталога запуска с очищенным окружением, поэтому рабочий `.env` не читается.

## Явные профили данных

| Профиль | Что он доказывает | Ограничения |
| --- | --- | --- |
| `--db-only` | Настоящие контракты PostgreSQL на новой пустой БД | Не запускает API/UI и исторические миграции приложения |
| `--profile integration` | API/worker/UI на переносимой схеме и fixtures из репозитория | Схема соответствует `297_retain_generic_spell_free_uses`; старые миграции этим запуском **не проверены** |
| `--profile fresh` (по умолчанию) | Запуск старой DDL и реальной последовательности миграций | Сейчас честно завершается ошибкой на 102; не заменяется другим профилем автоматически |
| `--catalog-snapshot C:/absolute/local.dump` | Локальная диагностика на явно выбранном снимке | Требует личного локального файла, не используется обязательным core/CI; не переносимый fixture |

`integration` загружает только схему из `fixtures/schema.sql`, проверяет её SHA256 и явно записывает список baseline migrations из `schema-manifest.json`. Это обычный schema baseline, а не сертификат успешной исторической chain. Последующие новые миграции выполняет настоящий backend. В baseline SQL нет COPY/INSERT, пользователей, паролей, истории или игровых снимков. Экспорт схемы для обслуживания — отдельная явная команда `export-schema-baseline.mjs absolute-local.dump`, после которой нужно проверить diff схемы, hash и границу миграций.

Каталог integration берётся из `officials/canon/prod-snapshot/*.json`; недостающие общие боевые декларации — из `frontend/src/roguelike/pinnedFighter.fixture.json` (только `catalog.entities`, не персонаж). Списки классов заклинаний превращаются в устойчивые ссылки тем же общим сопоставлением метаданных, которое описано в `normalize_live_happy_path_content.go`. Дополнительно создаются две явно тестовые сущности противников/действий, три тестовых тега и пустой магазин. Это минимальный integration fixture, не полный актуальный каталог и не проверка магазина/всех заклинаний. Шаблоны персонажей берутся из `backend/charactertemplates/presets.json`. Данные с владельцем отвергаются до удаления метаданных; авторы, оформление и ручные статусы не копируются. Все новые каталожные fixtures имеют `not_tested`.

Локальный snapshot-профиль восстанавливает schema и только allowlist каталожных таблиц, удаляет owner/author metadata до запуска API и проверяет нулевые users/characters/runs/paper_documents. Снимок остаётся локальным: каталожные таблицы могут содержать пользовательские определения, поэтому этот профиль **не экспортирует их** в переносимый fixture. Пароли/игровая история/учётные записи из снимка не восстанавливаются.

## Проверки и завершение

```text
node --test scripts/testing/guards.test.mjs
node scripts/testing/check-native.mjs
node scripts/testing/check-fullstack.mjs
node scripts/testing/check-compose.mjs
```

`check-native` создаёт два отдельных кластера, в каждом требует реального PASS точных Go tests для concurrent retry и сохранения физических предметов; затем проверяет очистку, включая SIGINT. Отсутствующая БД, пустая выборка, missing/skip/fail обязательного теста — ошибка. `check-fullstack` дважды запускает API/worker smoke и после второго запуска проверяет прерывание после принятых игровых команд. Повторный вызов cleanup идемпотентен.

`check-api` требует два различных подтверждённых пресета (`line`, `swordsman`), их настоящие копии, забеги, инициализацию через worker, одинаковый ответ повторной команды, перезагрузку боя и неизменность исходного листа. Расширение `--all-presets` включает `archer`. Его зависимости для integration восстановлены из существующих декларативных spell audit, condition/weapon patch и migration 297: точные источники, hashes, проекции и исключённые высокоуровневые эффекты записываются в registry. Ручные статусы и сертификаты не импортируются. `diagnose-fixture.mjs` проверяет тот же artifact без сохранения результата: пишет статус/ошибку, необходимые references и краткий контракт действия, не входной снимок.

При обычной ошибке и SIGINT/SIGTERM supervisor останавливает собственные дочерние процессы и PostgreSQL, проверяет точный data path/порт/ownership, удаляет cluster data и сохраняет логи. После принудительного завершения процесса без обработчика:

```text
node scripts/testing/stack.mjs recover-db C:/Projects/dnd_cards/outputs/testing/runs/test_<id>
```

Восстановление проверяет runner-owned каталог и postmaster.pid; чужие PID из старого registry намеренно не завершаются (PID мог использоваться повторно). Реестр не является системой управления рабочими БД. Автоматизация не подключается к рабочей БД даже для контрольного чтения.

## Браузерные сценарии и контейнеры

`templates-local-acceptance.mjs` и `polish-local-acceptance.mjs` запускаются только после `stack.mjs -- ...`. Общий `localAcceptanceContext` проверяет DSN/origins/run marker и передаёт случайные player/peer/admin credentials через env. Producer пишет только `{runId,created}`, consumer проверяет runId и при отсутствии файла вызывает producer. Оба блокируют браузерные обращения вне текущих UI/API origins и service workers. `polish` теперь вызывает общий настоящий E2E профиль и отдельно generic weapon mastery unit suite; подробная карта прежних контрактов сохраняется в `acceptance/polish.json`. Exact-color сравнение заменено проверкой контраста, браузерные imports `/src` удалены. Unit-проверка Slow не объявляется вторым полноценным серверным боем.

```text
node scripts/testing/stack.mjs --profile integration -- node frontend/node_modules/@playwright/test/cli.js test --config=frontend/playwright.local.config.ts
```

`frontend/e2e-local` использует настоящие API/worker/PostgreSQL и production UI: вход/библиотека, шаблон и пустой мастер, бумажный лист/JSON/PDF, экипировка/КД, бой/движение/сохранённое влияние/retry/завершение хода, права/конкуренция, магазин/отдых, редактор шаблона. Продуктовый успешный ответ не подменяется. В fault injection реальный ответ теряется только после backend commit, затем повторяется исходный command ID. Read-only наблюдатель проверяет hashes приватного envelope/catalog, позицию RNG и число receipt/journal, не извлекая seed или полный снимок. Отчёт `acceptance/playwright.json`, retries=0; trace/HAR/video отключены из-за credentials, при ошибке сохраняются локальный screenshot и безопасные method/path/status/request-id.

После bulk seed выполняется `ANALYZE`. UI раздаётся из `run/ui-dist`: перед/после копирования сравниваются полный manifest исходной сборки и копии. Параллельная смена shared `frontend/dist` завершает snapshot ошибкой, а следующая сборка не меняет уже работающий стенд. `registry.uiBuild` содержит directory, indexHash, manifestHash, число файлов и байтов. Локальные копии сборки сохраняются с evidence и учитываются отдельно при последующей очистке outputs.

Опасная историческая Python HTTP suite помещена в fail-closed карантин в `backend/tests/conftest.py`, autouse `DELETE FROM cards` удалён. Её assertions сохранены для TEST-04/05; это не означает их перенос или успешное прохождение.

`infra/compose.test.yml` использует правильный корневой frontend context, отдельный PostgreSQL/worker, случайные значения, loopback publishing и внутреннюю сеть. `check-compose` подтверждает только разрешение конфигурации без рабочего `.env`. На этой машине Docker runtime заблокирован выключенной виртуализацией; сборка образов, readiness и lifecycle контейнеров **не подтверждены**. Container bootstrap/fixtures также требуют интеграции; исполняемый путь сейчас native supervisor.
