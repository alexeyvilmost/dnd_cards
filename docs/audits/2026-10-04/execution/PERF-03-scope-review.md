# PERF-03 — сверка исходного плана и решение по остаточному scope

Read-only review после финального core-3. Production source не изменён.
Решение root: не добавлять межзапросные delta или CPU pool ради перечня исходного
плана; сначала закрыть честное измерение cold/load/memory/admission. Это явное
уточнение способа реализации, а не заявление, что эти механизмы уже существуют.

Позднее разрешённый source срез выполнен: [PERF-03-capacity.md](PERF-03-capacity.md).
Он закрывает fresh cold/current+historical, явные full/mirrors1/4/16, numeric
RSS/heap/lag, общую Go admission4 и LRU4 с reload parity. Ниже сохранено
обоснование исходного решения. Длинная последовательность позднее измерена:
[PERF-03-long-combat.md](PERF-03-long-combat.md),160 раундов и отдельный разбор
роста `processedCommandIds`195B/ход. Остатки — retention внутренней дедупликации,
более сложные/длительные сценарии и production budget. Фазовый process-kill проверен:
[PERF-03-crash-recovery.md](PERF-03-crash-recovery.md).
Общий heap bound остаётся недоказанным.

## Что закрыто и чем

| Исходный шаг / критерий | Фактическое подтверждение | Статус |
|---|---|---|
| Размеры world/catalog/presentation/history/mirrors, JSON/clone/hash/engine | Два 30× actual-worker отчёта, composition и micro probes; поздние160 legal turns +100 diagnostic turns | Измерено локально; выявлен linear dedup ID ledger growth, общий memory bound не заявлен |
| Новый компактный protocol + совместимость | Самодостаточный mirrors-v2 с точными same-frame hashes, Go expansion до старых validators/commit, legacy fallback | Локальная correctness закрыта; флаг OFF |
| Immutable blob отдельно от runtime | DB-03 frozen **input** owner/artifact/hash; PERF-01 immutable declarations с fresh proof | Закрыт в этих границах; dynamic state.catalogActions не объявляется immutable |
| Base-revision delta / full resync | Межзапросной delta нет; каждый mirrors-v2 response содержит собственные основания восстановления | Вариант заменён более узким протоколом; base mismatch неприменим, malformed mirror fail-closed проверен |
| Readers old/new, pinned replay, missing/corrupt inputs | Node/Go mirror negative tests, archived CJS replay, DB-03 immutable reader/restore | Закрыт для реализованного варианта; старые bytes не переписываются |
| CPU по профилю, не убирать stall guard | Один light collector на immutable aura projection; same seeded result/RNG; old/new alternating30 | Локальный win подтверждён; stall hash сохранён |
| CPU pool/replicas только при bottleneck | Pool не создан; измеренная saturation ограничена Go admission4 | Условно, не обязательная архитектура; host SLO не заявлен |
| 1/4/16, cold, память, saturation | Поздние9 fresh profiles, raw RSS/heap/lag, historical eviction parity; admission4/4 native tests | Выполнено локально; live-module bound не равен общему heap bound |
| Crash before/after commit | Настоящий kill собственного backend после worker compute до commit и после durable receipt до доставки ответа; тот же command ID/revision, полный worker input/result и DB/RNG equality | Локально выполнено; PostgreSQL/WAL crash не имитируется |
| Rollback без восстановления БД | Выключение mirrors flag, full reader; DB02/03 writer-disable сохраняет dual readers | Реализовано; старый binary без новых DB readers не является разрешённым rollback |

## Почему сейчас не нужен межзапросной patch/blob transport

В paired profile партия 6 отправляет 1,194,736 B, тогда как сам envelope — 376,215 B.
`catalogActions` = 23,960 B, `actionPresentation` = 19,477 B: вместе около 3.6%
полного request. Даже идеальное удаление только этих полей не решает основную
избыточность; `world` = 296,283 B, а character/characters несут зеркала состояния.
Это обоснование исследовать точные **same-frame входные зеркала** до сложного
межзапросного протокола. Это предложение следующего эксперимента, не реализованная
или доказанная оптимизация.

Полный input пока остаётся ограничением: worker JSON parse mean для партии6
4.62 ms при execute 40.22 ms и callback-to-send 59.04 ms. Hash phase 6.96 ms,
stringify 3.36 ms. Отдельные micro probes нельзя складывать с этими фазами.
CPU-аура дала mean46.50→37.65 ms при чередовании old/new. Response mirrors сократил
байты примерно на65%, но добавил собственную компактацию/Go expansion; общей
latency acceptance нет. Новый remote blob cache добавил бы lifecycle, owner/rights,
GC и missing-base риски до доказательства необходимости. `catalogActions` меняется
от summons/grants, поэтому переносить его целиком как immutable некорректно.

## Исходное обоснование профиля и ограничения насыщения

Следующий абзац описывает состояние до позднего capacity-среза. Сейчас добавлены
process-wide Go admission4 и live-module LRU4; исторические измерения сохранены.

Короткий legacy burst партии6: один request86.55 ms; при16 p95≈1021.49 ms,
весь burst≈1067.04 ms. Это показывает сериализацию нагрузки, но не устойчивую
arrival rate, queue time, overload threshold или production SLO. CJS cache в
`frontend/worker/server.mjs:108` и Node require cache не имеют eviction budget.
Handler исполняет rules синхронно (`:210`); callback timing не видит время ожидания
перед вызовом Node handler. Лимит16MiB относится к **одному** body (`:166`), а не
к сумме запросов; Go timeout20s (`backend/roguelike_worker_client.go:282`) сам по себе
не ограничивает накопленную работу и не прерывает уже начатый synchronous compute.

Это существенный локальный **неизмеренный** memory/admission риск, а не доказанный
OOM. Минимальное возможное исправление после профиля — лимит активных обращений/
queued bytes на входе, явный overload и проверка отмены до compute; оно не требует
threads/pool и не отменяет уже закоммиченные команды. Лимиты должны следовать из
resource budget, а не из произвольной константы. Pool умножает память каждого
loaded artifact; без archive/heap профиля вводить его преждевременно.

## Исходный список локальных проверок

Пункты1–3 и решение об admission из пункта5 выполнены в capacity-срезе.
Фазовый process-kill из пункта5 выполнен отдельным drill. Пункт4 позднее выполнен
для одной партии и160 ходов; сложные summon/attack-ledger сценарии остаются
границами имеющегося профиля.

1. Новый процесс wrapper для настоящего cold current/archived artifact; первый
   transition обязан показать cache_hit=0, последующие=1. Init fixture выполняется
   в исходном стенде, но не прогревает измеряемый отдельный wrapper.
2. 1/4/16 с явным `mirrors-v2`, повторные окна и old/full контроль; те же raw input,
   command/seed/cursor, полное равенство результата, events/pending/RNG. Никаких
   полнотекстовых states/credentials в логах.
3. Child-process RSS/heap before/after/observed peaks, process maxRSS, event-loop
   delay/utilization и whole-window CPU; отдельно requests started/completed и
   callback-active peak. Это наблюдение handler boundaries, не выдуманный remote
   queue/admission clock. Timer sampling во время sync block может пропустить пик,
   поэтому maxRSS/ограничение метода сохраняются в отчёте.
4. Журнал ограничен80 записями (`engine.ts:456`), но это не bound числа records или
   actor/declaration payload. Длинный legal scenario должен измерить рост state,
   history, request и памяти до/после нескольких окон, а не использовать fake writes.
5. Принять решение о bounded admission по измерениям; process-kill before/after
   transaction оформить отдельной фазовой проверкой с exact retry. Failure до
   commit не расходует ресурс; failure после commit возвращает прежний receipt.

Прежний ignored draft интегрирован в `scripts/performance/fresh-worker.mjs` и
проверен2 profiler Node tests вместе с новым retained-artifacts helper. Export
`profileFreshProtocol` использует отдельный child wrapper на loopback, token
только в памяти/IPC, собственный archive directory в owned run и cleanup.
Выполнены два полных actual profiles, а также controlled11-artifact retention
comparison. Полные receipts, числовые данные и проверенные границы вынесены
в [PERF-03-capacity.md](PERF-03-capacity.md); это заменяет статус прежнего draft.
