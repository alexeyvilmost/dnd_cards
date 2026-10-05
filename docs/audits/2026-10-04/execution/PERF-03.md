# PERF-03 — точные зеркала транспорта и повторные расчёты света

Локальная реализация 04.10.2026. Завершены точные зеркала ответа, устранение повторного сбора освещения, fresh-process профиль и ограничение активных Go-вызовов/загруженных модулей. Межзапросные delta-патчи и worker pool не добавляются ради архитектурного перечня: пока не показан их выигрыш. `RULES_WORKER_MIRRORS_ENABLED` по умолчанию выключен. Начатые бои не получают новый pin. Подробности позднего среза, включая отсутствие значимого общего memory win: [PERF-03-capacity.md](PERF-03-capacity.md).

## Что измерено

`scripts/performance/profile-worker.mjs` создаёт через реальный API отдельные партии 1/2/6, начинает бой и читает только собственный приватный envelope в память. Каждые 30 повторов посылают один и тот же полный вход/seed/cursor/intent; весь ответ сравнивается без удаления RNG, ID, времени, событий или pending-решений. В первоначальных сохранённых отчётах короткие bursts 1/4/16 проверяли только **старый полный ответ**: прежняя ветка вызывала default `transition` даже при `mirrorComparison:true`. Поздний срез исправляет вызов и добавляет отдельные fresh-process full/mirrors окна; старые JSON не переименованы в доказательство нового поведения. Один настоящий API commit на партию, его точный retry, сохранённый приватный envelope, все зеркала персонажей и неизменность исходного листа проверяются отдельно. Подготовительные команды тоже проходят exact retry.

Поле `cold` в сохранённых JSON означает **первый transition данного fixture**,
а не загрузку артефакта в свежем процессе: preceding initialize уже загрузил CJS,
во всех paired rows `worker_artifact_cache_hit=1`. Исторические числовые результаты
не переписываются; новый runner называет это `firstTransition`, а настоящий
fresh-process `cold` подтверждён отдельно во всех9 комбинациях.

В JSON-отчётах только размеры, фиксированные названия полей, числовые отсчёты, hashes и идентификаторы собственных тестовых запусков. Полные состояния, seed и авторизационные данные не сохраняются. ASCII/base64 framing чтения PostgreSQL исключает повреждение UTF-8 границами терминальных chunks. Исправление общего streaming decoder принадлежит TEST-01/root. Более ранние неуспешные диагностические прогоны с повреждённым stdout не являются baseline.

Вход воспроизводит сортировку ключей Go `encoding/json`; порядок массивов и любые значения сохраняются. У старого движка порядок обхода `actors` влияет на порядок `spatialObservations.nearby`; сравнение PostgreSQL jsonb order с Go wire order не было бы сравнением одинаковых входов. Direct JS результат сравнивается после обычной JSON-сериализации, как в реальном HTTP. Другой нормализации нет.

Первый завершённый wire baseline: `test_a832e7fa62d08e0eec894cbf`, artifact `d08a3588f6aa3b03162b666b787d5a9ed625c4a96798203d7ff10c4b2365767f`, 30 legacy + 30 negotiated запросов на каждую партию. Полные данные: [PERF-03-wire-baseline.json](PERF-03-wire-baseline.json).

| Партия | Ответ legacy, байт | Mirrors v2, байт | Уменьшение | Дополнительная компактация, среднее мс |
|---|---:|---:|---:|---:|
| 1 | 196059 | 103390 | 47.3% | 0.75 |
| 2 | 417396 | 147246 | 64.7% | 1.80 |
| 6 | 1149669 | 404167 | 64.8% | 4.86 |

Входной payload этим шагом не уменьшен: около 178/438/1203 KB. Сериализация ответа уменьшилась с 0.64/1.36/3.68 до 0.30/0.44/1.07 мс, но сама компактация и Go-восстановление тоже требуют CPU. Нельзя приписать всю разницу latency/CPU последовательного HTTP baseline только протоколу: JIT, GC, состав ходов и параллельная локальная работа влияют на результаты. Поэтому флаг OFF, production SLA/снижение общей задержки не заявлены.

## Протокол

`frontend/worker/mirrors.mjs` обслуживается внешним wrapper; байты существующих CJS-артефактов не меняются. Только запрос с `X-Rules-Wire: mirrors-v2` получает `{wireSchema:2,value,mirrors}` и только при фактических точных совпадениях. Whitelist полей снимка включает world/catalogActions/log/board/tokens и несколько других крупных проекций. Разные actionPresentation сохраняются полностью. Дублирующий leader patch заменяется ссылкой только при полном равенстве. Каждая ссылка имеет SHA-256 точных JSON-байтов источника из **того же ответа**.

`backend/roguelike_worker_mirrors.go` ограничивает версии, поля, число ссылок, hash, владельца leader-зеркала и отсутствие перезаписываемого target. Expanded response ограничен прежними 16 MiB. Полный результат восстанавливается **до прежних валидаторов и до транзакции**. Mutable aliases после декодирования отсутствуют. Протокол не использует состояние прежнего запроса, отдельный blob storage, произвольные JSON paths, межпользовательский cache или клиентский baseRevision. Поэтому потерянная база не нужна: каждый ответ самодостаточен. Старый wrapper продолжает возвращать full response новому клиенту, старый клиент получает прежний формат от нового wrapper. Откат — выключение флага; преобразования сохранённых данных нет.

## Worker CPU

V8 sampled profile указал на `projectCombatAuras`, повторные `boardLightSources`, `spatialFacts` и клонирование. В `combatAuras.ts` теперь один **ленивый** сбор света на неизменяемый вход конкретной проекции; существующий `spatialFacts` принимает этот collector. Финальный `projectCombatIllumination` по-прежнему считает свет на обновлённом мире после аур. Global cache, упрощённых предикатов, смены правил, удаления AI stall hash или нового RNG нет.

Парное исполнение с чередованием old/new на одинаковых входах: `test_7070781790b7836455fb06ad`, old `d08a3588…`, new `a6f82c7a74a9ec4caa2c3e3cddf230da27a2723cb70cc2cf0400fbae65dd54ef`. [Полные 30× данные и sampled profile](PERF-03-worker-paired.json).

| Партия | Executor mean old → new, мс | p50 old → new, мс |
|---|---:|---:|
| 1 | 22.88 → 18.48 | 20.19 → 18.14 |
| 2 | 7.04 → 6.26 | 6.32 → 5.83 |
| 6 | 46.50 → 37.65 | 46.21 → 37.06 |

Это локальные wall-time пробы executor, не exclusive CPU API и не production latency. Разное число фактически прошедших AI-ходов объясняет отсутствие монотонности между партиями. Для сравнения модулей один и тот же pin передан обоим pure вызовам; целиком совпали результат/entropy/randomValues. Отдельный HTTP replay использует настоящий прежний pin и сохранённый CJS; в ожидаемом результате изменены только идентичность артефакта и её два hash-derived trace, все игровые данные сравниваются полностью. Исторический файл не переписывается.

## Проверки и ограничения

- Node wrapper/protocol: 7/7 PASS, включая старый artifact после restart, повтор, неизвестную версию/hash/target, разные представления и независимые копии.
- Go: `TestWorkerMirrorsExactRestorationAndFailClosed`, `TestWorkerMirrorsClientNegotiationAndLegacyFallback` — 2/2 PASS; лимит expanded payload, client OFF/ON/старый wrapper.
- Aura/spatial/engine targeted: 4 файла, 340/340 PASS, две независимые декларации света, перемещение/удаление/ambient light, read-only parity.
- Адресные UI geometry/parity/cover/hazards/projection: 7 файлов, 65/65 PASS. TypeScript отдельно проверен после переноса UI и aura/cache правок; финальная свежая default production UI сборка (tsc-b + Vite, manifest46f754d2…) также прошла. Общий suite runner фиксируется отдельно.
- Два завершённых actual-worker профиля выше: полные equality/replay/private-envelope/source-isolation проверки PASS. Задержки legacy bursts при concurrency 1/4/16 растут, но RSS/heap/event-loop lag и настоящее admission в этих отчётах не измерены. Это не стресс-проверка OOM/отмены/ограниченной очереди. Pool не добавлялся.

Общий gate: `checkWorkerMirrors(stack)` из `scripts/performance/profile-worker.mjs`, требует один готовый owned stack с `{performance:true,workerMirrors:true}`. Он запускает обе Go-проверки и actual API/worker сценарии; не собирает второй стенд. CLI `--mirrors --smoke` — короткий отдельный запуск; без `--smoke` 30 отсчётов. Для CPU differential передать `--baseline-artifact=<absolute owned runs path>/<hash>.cjs`.

DB-02 уже реализует exact compact receipts, DB-03 — owner/artifact-bound frozen
initialization inputs, PERF-01 — cache с fresh content/rights/read-set proof;
это отдельные проверенные области, не новая mutable transport authority.
Входной payload пока не уменьшен. Fresh cold/memory/admission срез выполнен,
но общий heap/RSS bound не доказан. Длинная легальная последовательность
160 раундов измерена: [PERF-03-long-combat.md](PERF-03-long-combat.md).
Остаточный рост — внутренний `processedCommandIds` (195B/ход в этом сценарии),
не накопление модификаторов; retention нельзя менять без сохранения повторов.
Фазовые backend process-kill проверки выполнены отдельно:
[PERF-03-crash-recovery.md](PERF-03-crash-recovery.md). Inter-request patch и CPU pool
условны: сначала нужен подтверждённый bottleneck и budget. Разбор исходного scope
и решение: [PERF-03-scope-review.md](PERF-03-scope-review.md).
