# OBS-01 — локальный baseline и наблюдаемость

Дата: 2026-10-04. Только локальные изменения; commit/push/production не выполнялись. Игровые механики, порядок lock/commit и байты pinned artifact не менялись.

## Реализовано

`scripts/performance/run.mjs` поднимает изолированный integration stand TEST-01 и выполняет реальные HTTP команды: initialize/continue для party 1/2/6, camp_turn, ordinary/resource-changing equip/unequip. Общие `createRunFixture`, `attachRunFixture`, `runCommandSeries` экспортированы из `scenarios.mjs`; DB-01 использует их для 100/1000 команд. Повторные HTTP запросы считаются отдельно от committed commands. Bridge экипировки вызывает канонические `prepareRoguelikeCombatParticipant` и `prepareSheetEquipmentCommand`.

Добавлена выключенная по умолчанию корреляция frontend→backend→worker и числовые фазы. Двойной opt-in: конфигурация серверов `RULES_PERFORMANCE_ENABLED=1` и header запроса `X-Performance-Trace: 1`; frontend дополнительно `window.__DND_PERFORMANCE__=true`. Тела, SQL, токены, prompts, base64, полные листы и entropy не записываются. Private RNG seed сравнивается только через fingerprint, полный saved response сравнивается в памяти без вывода при ошибке. Существующие AI error interceptors сохранены.

Файлы реализации: `backend/performance_observability.go`, контекстные hooks controller/catalog/client, `frontend/worker/server.mjs`, `frontend/src/api/performanceTelemetry.ts`, `client.ts`, browser adapter `sheetCombatTargetRuntime.ts`, `useSheetEquipmentSave.ts`, `SoloCombatPage.tsx`. Общий runtime factory/pinned artifact не инструментирован изнутри. Worker hash остался `sha256:97e8d25465ba0ad7411f12fef7bab5f178bd4a123b1f26a92b257a9ea9d3b4b8`.

Подробные команды и точные границы метрик: [README runner](../../../../scripts/performance/README.md).

## Финальный воспроизводимый серверный baseline

[OBS-01-final-server-baseline.json](OBS-01-final-server-baseline.json): run `test_e9d2121d66f85d5f091d1e58`, 330 samples (30 каждого из 11 сценариев), все exact retry/reload/source isolation/RNG/pin assertions PASS; outcome hashes сохранены до browser этапа. Fixture фиксирован после card declarations и явного ANALYZE; `statistics=analyzed-after-seed`. Это актуальная контрольная серия для PERF-01, полное сравнение приведено в [PERF-01.md](PERF-01.md). Ниже оставлена ранняя диагностическая серия с другими fixture/statistics для объяснения найденных проблем; её latency нельзя смешивать с финальной.

## Ранняя диагностическая серверная серия

Сырые 330 samples: [OBS-01-server-baseline.json](OBS-01-server-baseline.json), исходный `outputs/testing/runs/test_33c617f90da8c05645c45cd0/performance/samples.jsonl`. По 30 наблюдений каждой строки, p95 nearest-rank **предварительный**. Windows x64, Node 24.19.0, Go 1.25.12, PostgreSQL 17.11, Ryzen 7 7800X3D, 16 logical CPUs, ~33.38 GB RAM, loopback без throttle. Параллельные локальные проверки/сборки создавали CPU contention; это не production SLA и не результат на выделенном idle host.

| Сценарий | p50, ms | p95, ms | SQL count | Needs | Rounds | От первого lock до возврата tx, среднее ms |
|---|---:|---:|---:|---:|---:|---:|
| initialize, 1 |117.52|177.87|40|25|5|36.46|
| initialize, 2 |184.86|265.48|68|50|5|70.74|
| initialize, 6 |602.24|982.55|172|150|5|192.41|
| continue, 1 |99.34|149.53|14|—|—|36.70|
| continue, 2 |169.75|213.79|17|—|—|68.73|
| continue, 6 |538.50|1045.20|21|—|—|173.68|
| camp_turn, 1 |54.59|67.24|40|25|5|8.87|
| ordinary equip |17.78|22.24|8|—|—|7.76|
| ordinary unequip |17.31|18.96|9|—|—|7.78|
| resource equip |62.83|78.83|36|27|5|53.96|
| resource unequip |63.28|77.97|37|27|5|53.47|

Initialize использует шесть worker calls (пять needs + ready). Party увеличивает число повторно разрешаемых needs с 25 до 150 при неизменном числе rounds. Это подтверждает приоритет batch/dedup resolver PERF-01. Продолжение не вызывает needs resolver, и его стоимость требует отдельного исследования сериализации/worker projection. Разница resource equip связана с фактически измеренным дополнительным worker пересчётом под транзакцией; обычная ветка его не вызывает.

Серия выполнила все server assertions (exact retry, reload, source isolation, private RNG/pinning fingerprint), затем упала в browser equipment selector. Эта версия runner сохраняла сырые samples, но ещё не сохраняла outcome hashes до браузера: полный итоговый JSON отсутствует, и это явно отмечено в baseline. Исправленный runner сохраняет `server-baseline.json` до browser этапа. Более ранний успешный smoke с persisted outcomes и browser navigation: `outputs/testing/runs/test_eb65cf88ce538b76c90de6c9/performance/baseline.json`.

При первой попытке 30× driver логинился заново на каждый encounter и получил HTTP429 на 19-м. Исправлен driver: одна реальная authenticated session на всю серию; rate limiting приложения сохранён. Ни failed attempt, ни повтор не выданы за успешную полную серию.

## Браузер и сборка

Первый smoke library/forge/sheet/paper: восемь cold/primed навигаций, 0 page errors. Исходный stand отдавал `no-store`, и primed samples **не доказывали warm HTTP cache**: transfer bytes оставались теми же. TEST-01 добавил opt-in immutable caching hashed assets; runner явно считает реальные ResourceTiming cache hits и переименовывает warm sample, если cache hit не наблюдался.

Выяснилось дополнительное ограничение: Playwright routing тоже отключает HTTP cache, даже после попытки включить его через отдельную CDP session. Поэтому performance browser использует отдельный loopback allowlist HTTP proxy, пропускающий только два owned origins, с запретом CONNECT/удалённых адресов и сохранением cache headers. Его regression test PASS проверяет разрешённый запрос, запрещённый внешний адрес, чужой локальный порт, URL credentials и CONNECT. Первый пробный proxy запуск выявил unhandled reset закрытого CONNECT socket; error handling исправлен, оставшаяся owned БД остановлена guarded recover-db, чужие процессы не затрагивались.

Финальный browser smoke PASS: [OBS-01-browser-cache-baseline.json](OBS-01-browser-cache-baseline.json), исходный run `test_402f155344242cd8128ff3c7`. По одному cold/warm sample на экран; 0 page errors. Реальные cache hits JS/CSS: library53, forge34, sheet74, paper21. LCP cold/warm: 524/96ms,4140/164ms,500/244ms,180/68ms. Equip/unequip через UI подтверждены сохранением на сервере; наблюдённые click→commit 53.26/155.29ms. 30 hover карты: saved state и RNG/pins не изменились, Chrome CPU sample1138 за1.496s; это не чистая стоимость React render. Library/forge network-quiet доходил до13–19s при параллельных проверках и блокировании внешних медиа; считать его TTI или production latency нельзя. Stand fixture был дополнен TEST-04 между ранним server baseline и этим browser smoke; hashes каждого запуска сохранены, их нельзя выдавать за одну неизменную выборку.

Профиль собирает navigation/resources, LCP, long tasks, Event Timing entries, Chrome task/layout/script deltas. Для hover карты — 30 настоящих перемещений мыши и Chrome CPU sampling, с проверкой неизменности saved state/RNG. Для экипировки — настоящий canonical UI и отдельные prepare/commit phases. UI не заменяется API-ответами. Браузерный selector поддерживает названия canonical icon/row; специальная механика для benchmark отсутствует.

[OBS-01-build.json](OBS-01-build.json) анализирует фактический dist: entry JS 801206 raw /233195 gzip bytes; entry CSS178920/33500. Статический JS closure c entry: library296023gzip, forge457463, sheet760670, paper329086, combat781250. Полный JS13,052,859raw bytes и весь dist168,981,003bytes не являются initial load. PWA manifest содержит21 URL; сумма реальных файлов2,489,421bytes учитывается отдельно от первого открытия. Названный route CSS указан отдельно; shared/preloaded CSS приписывается только через browser resources, а не выдуманной статической атрибуцией.

## Проверки и точные ограничения

- Worker server/replay/performance:6/6 PASS, включая body equivalence при включённом tracing, opt-in, correlation, numeric allowlist, historical artifact replay/restart.
- Frontend targeted:29/29 PASS в5files (telemetry, image errors, boundary, equipment-save, equipment-commit). Полный TypeScript check PASS; свежая production UI сборка PASS.
- Go middleware/worker telemetry:2/2 PASS. Native PostgreSQL `TestPerformanceSQLCountsPreloadOnceAndRecordsActualLockScope` PASS в disposable stand: preload считается дважды за две SQL, не дважды за lifecycle; locking/persist phases присутствуют. Начальный Windows test executable cleanup дал exit1 после PASS, повтор/stand checks завершились нормально; этот exit1 не считается зелёной проверкой.
- SQL counts охватывают controller/catalog DB с request context, **не** все auth/library queries. Lock statement включает сетевой round trip/scan, а acquired→tx-return включает commit acknowledgement; точное PG lock wait/hold не измерено.
- Worker timing начинается с HTTP callback; remote accept→schedule queue неизвестна. Process CPU не является exclusive request CPU. Clone внутри pinned artifact отдельно не измерен.
- Стандартная production React сборка не выдаёт component commit profiles. Chrome CPU profile не называется React profile. Event Timing не реализует полный web-vitals INP. Здесь остаётся диагностическое расширение OBS, а не ложное значение0.
- 30 server repeats выполнены при fresh catalog/existing worker process; OS/PG cache не сбрасывались. Artifact cache hit измеряется для каждого worker call. Нельзя называть все30 повторов cold worker.
- Seed/UUID каждой новой битвы независимы. Exact receipt replay сравнивает полный outcome и RNG fingerprint того же fixture. Повтор разных новых encounters не объявляется одинаковым seeded replay; differential pinned artifact отдельно покрыт TEST-02.

Resource-changing fixture выявил отдельный correctness gap: канонический ChangeEquipment request может нести resource capacity предыдущего placement, backend принимает before OR after projection. В evidence equipment записан `resourcePlacementProjectionAligned:false`; совпадение persisted state с каноническим request **не доказывает корректность grant**. OBS ничего не исправляет и не утверждает воспроизведение полного UI self-reconciliation: дальнейший correctness owner PERF-02/03.

Предварительные диагностические бюджеты: не повышать scoped SQL/needs относительно этой таблицы без объяснения изменения fixture; entry/route bytes фиксировать отдельно; сравнивать минимум30server repeats. Latency regression >20% отправлять на повторный idle-host замер, не блокировать правила по одной шумной серии. Блокирующие performance SLA пока не устанавливаются.

Изоляция UI: после этого аудита TEST-01 переводит stand на owned snapshot dist. Серверная финальная пара не использовала browser и не зависит от конкурентной UI сборки. Исторические browser числа — диагностический smoke, а не acceptance перед/после; при обнаружении пересечения со сборкой их следует исключить. Новые browser/build reports используют `registry.uiBuild.directory`.

## Принятый browser baseline на изолированных snapshots

[OBS-01-browser-baseline.json](OBS-01-browser-baseline.json): run test_3b1cd5fa4ff4d787e84e184e, по3 cold/warm навигации4экранов. Snapshotmanifest c1fa3b42968918e8d649b2f4b9d8616f849507325759dc8f21e617a05824ea47 (точное значение в JSON),0pageerrors. After snapshot test_3dfa2e937b243c65adf1f67d сохранён в [PERF-04-lazy-comparison.json](PERF-04-lazy-comparison.json). Полная tree-копия со сверкой hash устранила гонку общей dist. Метрики остаются диагностическими, ограничения ОС/нагрузки выше сохраняются.

Локальный baseline принят: сервер330observations с outcome proofs и browser24navigation с реальным cache. Эта исходная серия не измеряла React profiler и web-vitals INP. Production SLA не заявляется. Найденное расхождение resource grant исправляется и проверяется отдельным PERF-02.

## Дополнительный профиль браузера, 05.10.2026

Настоящий Chrome выполнил 120 измеряемых надеваний/снятий двух предметов и 4 разогрева на изолированном стенде. Включены intent, batch и preparation cache. Сборка использует `react-dom/profiling`: это диагностический вариант с дополнительной стоимостью профилирования. Ошибок страницы нет; исходный персонаж не менялся.

| Сценарий, 30 повторов | Нажатие → готовый лист p50 / p95, мс | Рендер компонента p50 / p95, мс |
|---|---:|---:|
| Надеть обычный предмет | 66.5 / 85.8 | 1.0 / 1.6 |
| Снять обычный предмет | 69.1 / 97.8 | 0.9 / 1.7 |
| Надеть предмет с ресурсом | 66.7 / 77.8 | 1.0 / 1.4 |
| Снять предмет с ресурсом | 65.4 / 81.2 | 0.9 / 1.6 |

`web-vitals@6.2.2` наблюдал взаимодействия с начала посещения: итоговый INP — 152 мс. Это значение одного локального сценария, не статистика реальных пользователей. Записаны 1074 события профиля `SheetEquipmentPanel`; измерения рендеринга отделены от ожидания API. [Точный состав сборки, границы и результат](OBS-01-equipment-browser-profile.json). Серия отражает текущую реализацию после ускорений; сопоставимого профиля прежней версии здесь нет, поэтому процент ускорения по ней не вычисляется.
