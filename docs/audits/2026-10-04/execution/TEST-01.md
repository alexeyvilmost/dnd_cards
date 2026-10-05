# TEST-01 — выполнение локально, 04.10.2026

Статус: реализован и проверен native supervisor; инфраструктурные контракты проходят. Исторические миграции и полный старый polish E2E остаются отдельными явно незавершёнными проверками. Коммита, push, deploy и подключения к рабочей/production БД не было.

Основная команда: `node scripts/testing/stack.mjs --profile integration -- node scripts/testing/check-api.mjs`. Документация профилей и восстановления: `scripts/testing/README.md`.

## Что реализовано

- Новый PostgreSQL 17.11 cluster в уникальном `outputs/testing/runs/test_<24hex>/postgres`, отдельная database того же имени, случайный пароль и SQL ownership marker. При отсутствии Docker используется явный native путь; подключения к произвольной localhost БД нет.
- Backend, rules-worker и production frontend с готовностью API/UI и точным SHA256 artifact worker. Корневой рабочий `.env` не читается: сервисы запускаются из run directory с allowlist окружения и без cloud credentials. Внешние HTTP(S) обращения backend блокируются локальным deny proxy; браузерные проверки отдельно блокируют внешние origins и service workers.
- Отдельные профили `fresh`, `integration`, `local-catalog-snapshot` и `db-only`, без автоматического перехода с красной migration chain на зелёный baseline. Для явного snapshot проверяется точный собственный кластер и allowlist таблиц; пользователи/персонажи/события/история не восстанавливаются.
- Переносимая schema-only база до `297_retain_generic_spell_free_uses`, SHA256 `296d25beb5723f77b91f418f96d57add118438b49ae539071354ef681dce2cc2`, файл около 231 KiB. Manifest явно содержит `historicalChainVerified:false`. Schema не содержит INSERT/COPY данных. Единственный производный материал локального snapshot — DDL и реальные имена уже применённых миграций; его каталог не экспортировался.
- Fixtures из существующих checked-in public canon JSON, только catalog.entities прежнего боевого fixture, текущих canonical character presets и двух явно synthetic monster/action rows. Личные поля отвергаются до очистки, изображения/author/owner metadata удаляются, ручной статус — `not_tested`. Магазин минимален: тестовые теги и пустой ассортимент; это не fixture проверки магазина.
- Secret-free producer/consumer: оба acceptance scripts используют общий `localAcceptanceContext`, player/admin передаются через env. Producer пишет `{runId,created}`; consumer проверяет принадлежность запуска и сам вызывает producer, если его файла ещё нет. Исправлены текущие диалоги открытия забега/группы, не восстановлен старый direct-start UI.
- Старый Python autouse `DELETE FROM cards` удалён. Историческая suite fail-closed в `pytest_configure`; текущие assertions не удалены и не объявлены перенесёнными.
- `required-go.mjs` требует реальной БД и точного непустого списка тестов. Отсутствующий/skip/fail test из required list — ошибка, PASS одного package без test events не считается успехом.
- Cleanup по точным run-owned путям, PID file PostgreSQL, порту/marker; повторный cleanup идемпотентен. Нормальное завершение, ошибка и SIGINT используют один lifecycle. Сохраняются безопасные логи. Recovery после kill без обработчиков останавливает только проверенную БД; произвольные PID из старого registry не используются.
- Compose выделен в отдельный файл с правильными build contexts, PostgreSQL/worker, loopback ports и internal network. Это пока проверенная конфигурация, не принятый container runtime.

## Фактические проверки

| Проверка | Результат / evidence |
| --- | --- |
| `node --test scripts/testing/guards.test.mjs` | 11/11 PASS. Production origin, implicit localhost port, credentials/path/query, чужая DSN/БД/роль/порт, symlink/выход из owned directory, redirect escape, required empty/skip/missing/fail, env isolation, DDL reconnect, owned/private fixture, schema hash, неверный worker artifact, разрыв API stream |
| `node scripts/testing/check-native.mjs` | Два свежих кластера, 2/2 обязательных Go tests каждый, 0 skip. `test_9153c316f93844f5800e3431`, `test_373f177614da35c84123ba0a`; второй с SIGINT. Оба `stopped`, cleanupErrors пуст, PostgreSQL data удалён |
| Required Go contracts | `TestCharacterRuntimeCommandConcurrentRetryCommitsOnce`, `TestRuntimeEquipmentCommandConservesPhysicalItems`; реальные PostgreSQL транзакции, `required-go.jsonl` в каждом run |
| `node scripts/testing/check-fullstack.mjs` | Два полных native запуска: `test_85669df7335dab7c2a1e40a9`, `test_a7c217e9b554421e5969a595`. Первый со свежей production Vite сборкой, второй прерван после принятых игровых команд. 2 пресета (`line`, `swordsman`) × copy/run/start/initialize/exact retry/reload/source-isolation; оба чисто завершены, `api-smoke.log` и `acceptance/api-smoke.json` сохранены |
| Actual binding | `Get-NetTCPConnection` для PID/порта именно `test_7546d9a570ab3fb4b0d00174`: PostgreSQL, API и worker слушают только `127.0.0.1`; `loopback-listeners.json` сохранён. Код worker реально читает LISTEN_HOST; backend support добавлен root agent |
| Standalone templates producer | PASS, `test_7546d9a570ab3fb4b0d00174/command.log`: три шаблона, создание/имя своей копии, три запуска, неизменность источника, выбор существующего забега, запрет non-admin редактора, 390px. Credentials из старых artifacts не нужны; registry stopped/cleanupErrors[] |
| Standalone polish consumer | На новом пустом run `test_afdb2c80d1cafed82d5ad90f` самостоятельно выполнил producer с PASS и прочитал свой `{runId,created}`. Затем честно остановился на устаревшем точном CSS assertion: текущая кнопка прозрачная с цветом `rgb(255,247,230)`, прежний сценарий требовал `rgb(216,185,120)`/`rgb(32,27,20)`. Gameplay-часть polish не выполнялась; lifecycle завершился `stopped`, cleanupErrors[], data removed |
| `node scripts/testing/check-compose.mjs` | PASS config resolution с пустым env-file и случайными значениями; daemon не нужен |
| Scoped `git diff --check` | PASS для изменённых existing acceptance/conftest файлов, LF сохранён |
| Credentials scanner | Последний запуск root после поправки двух чужих synthetic literals — PASS; наши новые файлы не содержат совпадений |
| Python quarantine | Bundled Python есть, pytest не установлен. Stdlib AST extraction исполнил настоящий `pytest_configure` с test double исключения и подтвердил fail-closed до fixtures. Полноценный `pytest --collect-only` dispatch не проверен; отсутствующая зависимость не считается его успешной проверкой |

## Обнаруженные и не скрытые границы

1. **Fresh historical migration chain красная.** Legacy DDL → 001…082 проходят; 083 требует `CLASS-warrior`. Явный seed checked-in public catalogue на точной границе 082 позволяет пройти до101, но102 требует исторический preimage Feather Fall, которого в этом snapshot нет. Не подделывались certificates/applied flags. Evidence `test_524c6af69ba3a4ee5931d4a1/backend.log`. Это отдельная задача восстановления historical catalog baseline, не результат integration profile.
2. **Локальные snapshots имеют разную пригодность.** Snapshot до273 фактически содержал max269; 278 отверг неверный preimage `ACT-feat-musician-song.name_en` (`test_26362ea3104429920e50548f`). Более новый до293 (max292) прошёл актуальные миграции до297/API/UI/worker (`test_529a799e714030bf5ab53397`). Ни один из файлов не нужен переносимому integration profile.
3. **Archer расширенный scenario ещё красный.** В старом публичном каталоге отсутствовали mastery operations; подключён существующий canonical combat fixture. Затем обнаружены старые spell class refs и нормализованы по существующим metadata joins. Следующая подтверждённая граница — `SPELL-0317: active/reaction entity requires explicit mechanics.targeting`. Evidence `test_b654280fbe02f30d0628ff6e/fixture-diagnostic.json`. `check-api --all-presets` включает эту проверку и завершается ошибкой. Она передаётся в TEST-04, а не silently skipped в required core.
4. **Старый polish E2E ещё не принят.** Standalone producer/consumer lifecycle доказан, но полный сценарий остановился на старом exact-color assertion (см. таблицу). Далее он содержит dev-only browser imports `/src/...` и опирается на archer catalog. Полный сценарий надо переработать в TEST-04 на настоящий текущий UI и декларации. Его green не заявлен.
5. **Docker runtime недоступен.** CLI найден в `%LOCALAPPDATA%/Programs/DockerDesktop/resources/bin/docker.exe`. Root запустил Desktop; WSL сообщает выключенную виртуализацию. Настройки Windows/BIOS не менялись. Container build/health/cleanup и интеграция переносимых fixtures в container init не проверены. Рабочий путь — native supervisor.
6. **Проверка proxy cleanup нашла и исправила race.** При закрытии страницы/сервиса старый proxy мог повторно отправить HTTP headers и прервать teardown. Добавлены корректное закрытие потоков и guard ответа, отдельный регрессионный тест. Run `test_027940193e8022dba38b8962` восстановлен точным `recover-db`; его безопасные логи сохранены.

## Передача следующему агенту

- TEST-03 может требовать green guards + native required PG + integration API smoke, не включая свежую историческую цепь под видом зелёной.
- TEST-04: восстановить декларацию archer spells из актуальных checked-in migration manifests/каноничных данных, без changes production rules ради теста; обновить browser producer/polish на production preview, перезагрузку held decision и один расход; сохранить все незавершённые проверки явными.
- Полная история миграций: получить/построить versioned public pre-083/pre-102 catalogue с проверяемыми hashes, либо восстановить clean-install migration strategy отдельным ревью. Baseline297 не заменяет эту работу.
- OBS-01 использует `startTestStack({profile:'integration',reuseBuild:true,performance:true})`; `RULES_PERFORMANCE_ENABLED=1` передаётся API и worker только явно. Несколько независимых copies line/swordsman подходят для party scenarios; пригодность конкретного extended flow проверять отдельно.

Rollback: удалить новую тестовую точку входа/fixtures только после замены; не возвращать опасный Python autouse cleanup. Старые рабочие Compose/Dockerfiles/production env не изменены. Для незавершённого native запуска использовать проверенный `recover-db`, не blanket kill/delete.
