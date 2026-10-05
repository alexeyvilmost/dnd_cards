# PERF-02 — атомарная экипировка и подготовка боя

Статус: основные функциональные acceptance реализованы и локально проверены. **Новые маршруты выключены по умолчанию. API latency выросла при существенно более короткой блокировке ресурсного equip.** Общий cache/static-preparation reuse остаётся зависимостью PERF-01/DB-03; все cache-подшаги плана здесь не объявляются завершёнными. Commit/push/production не выполнялись. Исторические артефакты не переписываются.

## Исходная проверка

`frontend/src/character/sheetEquipmentResources.integration.test.ts`: 2/2 failures до исправления. Первый accepted `ChangeEquipment` для двух разных item-owned resource grants (3 и 5 зарядов, второй требует attunement) переносит предмет в слот, но `max_resources` не содержит новый ключ. Это ошибка самого канонического atomic request, независимо от последующей UI reconciliation. Проверка использует настоящий `prepareRoguelikeCombatParticipant` и `prepareSheetEquipmentCommand`, без mock формул/операций.

До правок сохранена локальная executable baseline `tmp/perf-02/before-artifact.cjs`, SHA256 `97e8d25465ba0ad7411f12fef7bab5f178bd4a123b1f26a92b257a9ea9d3b4b8`. Это собственная копия текущей сборки, не замена historical artifact.

## Реализованная граница

Общая `ChangeEquipment` согласует item resource grants **до** `equipment_changed`, поэтому declared draw restore видит новый максимум в той же atomic transition. `resourceInit.ts` переиспользует `collectItemMechanics`, grant collector, `initResources` и общий `currentResourceAfterProjection`. Нет веток по имени/UUID и отдельной формулы ресурса в UI/Go. Изменяется вклад предметов, сохраняются остальные пулы. Четыре characterization tests проверяют две сущности, attunement, истраченный dormant pool при повторном надевании, два declared draw restore, точный foldEvents и отказ дубликата после JSON reload. Полная переоценка **классовых** максимумов от изменённых предметом характеристик не входит в этот узкий фикс; существующая политика dormant item pools не перепроектировалась.

`POST /api/characters-v3/:id/equipment-commands` принимает только command ID, ожидаемые ревизии персонажа/забега и одну операцию equip/unequip. Unknown/duplicate JSON fields, отсутствующая ревизия, неоднозначная операция и browser runtime maps отклоняются. Capability GET `/api/characters-v3/equipment-authority` включает новый UI путь только при `RULES_EQUIPMENT_INTENT_ENABLED=1`. Отсутствующий capability route старого backend (404) означает compatibility; auth/network errors не маскируются.

1. Read-only repeatable-read snapshot загружает saved character, persistent caller/owner rights, run membership/phase/revision и каталог. Matching receipt возвращается до worker/revision/flag проверки. Старый public identity не получает право на запись.
2. `prepareCharacterWorker` разрешает обычный dependency closure без write/advisory/row locks; artifact фиксируется с первого ответа на все needs rounds. Worker вызывает те же `prepareRoguelikeCombatParticipant` и `prepareSheetEquipmentCommand`. RNG принадлежит серверу; браузер не присылает результат, расход или seed.
3. До write transaction рассчитываются patch и input stamp. Он включает row versions (`xmin`) персонажа/забега, caller/owner, реально затребованных сущностей, basic-action membership, complete effect types, variables и spell alias candidates. Любой столбец персонажа/забега, включая private JSON, влияет на stamp. Вставка подходящей строки каталога тоже замечается. Это **MVCC проверка одной попытки**, не durable catalog version и не shared cache key. Бюджет уникальных dependency predicates — 4096.
4. Write transaction берёт command advisory lock → run row lock → character row lock, повторяет receipt/rights/revision checks и единым SQL сверяет input/dependency stamp. CAS, события и receipt записываются атомарно. Под locks нет HTTP, worker, discovery или полной сборки. SQL сверки — точка наблюдения catalog/rights этой команды; каталог не блокируется глобально.
5. Receipt использует прежний `CharacterRuntimeCommandRecord` с domain-separated intent hash. `ruleset_ref` дополнен `artifact_hash`, `input_catalog_stamp`, `content_manifest_hash`; retention scanner поддерживает snake_case artifact field. Дубли до первого commit могут параллельно выполнить speculative preparation; сохраняется один исход. После accepted commit повтор вообще не вызывает worker.

`useSheetEquipmentSave`, `sheetEquipmentCommit` и общий `sheetRuntimeCommand` поддерживают старую prepared request и новый intent. LocalStorage сохраняет исходный command ID/context. Replayed receipt проверяется, затем загружается актуальная ревизия вместо старого postimage. Unknown outcome/503 не очищает pending. OFF flag продолжает разрешать accepted receipt replay; новая execution возвращает503. Старый endpoint сохранён для открытых клиентов.

## Начало боя

`GET /api/roguelike/runs/:id/initiative-options?expected_revision=...` при `RULES_INITIATIVE_OPTIONS_ENABLED=1` получает owned run и лидера в read-only snapshot. Worker использует тот же participant builder и `availableCheckManeuvers` по owned grants, возвращая обычные Action entities для каноничного choice/preview. Список не бросает кубики, не создаёт встречу, не списывает ресурс и не резервирует выбор.

Trusted branch `SoloCombatPage` больше не делает обязательный `loadSheetCombatParticipant` ради options. Проверяются character/run revisions ответа; initialize получает выбранный action ID и повторно проверяет его стоимость/допустимость. OFF capability использует прежний builder. Сохранённые бои не меняют свои pins. Серверные options и initialize пока отдельно вызывают общий builder: **между запросами готовая сборка не кешируется**. Выбор для лидера соответствует прежнему UI; новый выбор для всех членов группы не добавлен.

## Локальные проверки

- 9 targeted Vitest files /52 tests PASS: resource atomicity, intent/shared-sheet full outcome equality для двух сущностей, incomplete catalog, pending/reload/receipt, прежний initializer/camp inventory/import boundary.
- Ещё4 files /45 tests PASS: equipment lifecycle, API capability/identity-only transport, trusted initialization и initiative offers. Для двух resource/die declarations preview не вызывает Math.random и не меняет input; полный seeded initialize после preview равен initialize без него. Exhausted/unowned selection отклоняются; accepted paid pool тратится один раз.
- Equipment typecheck PASS. После initiative additions найден только test-fixture Monster cast, исправлен до успешной общей UI сборки root. Fresh UI manifest `0b1bb20ad122b4f4b7dc38b5615728b86617433a4466e806df004c53e5f48b04` включает изменения.
- Native PG **7 required tests PASS**, `test_eaa62d47e0380789ea2198e3`, затем полный `test_65568879948349ae4a951141`: strict schema; catalog aliases/membership/rights; независимый UPDATE NOWAIT во время worker HTTP; same-ID/different-ID concurrency; один effect/receipt; build/owner/rights/catalog/run phase/private JSON drift; rollback receipt; owned readonly options/revision.
- Общий core обнаружил нестабильный test preimage: объект после GORM Create содержал наносекундные timestamps, PostgreSQL — микросекундные. Диагностика подтвердила только `[created_at updated_at]`. Исправление сравнивает **полную persisted row до GET** с persisted row после; поля не исключены и не нормализованы ради прохождения. Production handler не менялся.
- Actual worker/API equipment `test_29776b7d3e23c12e6f40cd80`:124 accepted +124 exact retries/reloads, немедленное согласование pool/placement, source isolation;30 samples на каждую из4 операций плюс warmup.
- Actual worker/API initiative `test_4339a64c1b5041face6d1c66`:30 offers +warmup для party1/2/6, затем real initialize+exact retry+reload. DB row_to_json fingerprints run/character и private entropy/artifact не меняются при просмотре.93 samples=90 offers+3 initialize. У baseline fighter нет optional initiative action; две платные декларации проверены настоящим TS executor выше.
- Browser `test_7978e064ea4840f119c5ac71`: fresh owned UI, real API/PG/worker. Accepted unequip response намеренно потерян; reload послал тот же ID, revision не увеличилась повторно. Equip обратно сохранил inventory/source.3 equipment POST=2 команды+1 replay. **0** sheet_combat_participant при enabled equip и trusted initialize; options GET1, initialize POST1, page errors0. Один intercepted POST пересылается через guarded local API helper, после чего теряется ответ; egress proxy/CONNECT deny не ослаблен. Начальный route.fetch403 был отказом локального proxy CONNECT до backend, не отказом игры.
- Worker wrapper4/4 PASS: pinned artifact/restart/identity/observability. Scope git diff --check PASS. Baseline artifact97e8...b4b8 повторно проверен; исторические файлы не изменены.

## Измеренный tradeoff

`test_65568879948349ae4a951141`: sequential compatibility/intent на **одном** stand, artifact `sha256:5eedc099bbfc8e6e7641b9a07cbe9548e53b1881b6a1ae82d7c132300a4e697f`, одинаковые fixture/statistics и `catalogBatch=false`. Каждый путь124 commands+124 retries,120 samples. Resources/maxima сравниваются с общей canonical projection, полные retry responses — без нормализации. Разные fixture UUID/entropy не объявлены одинаковыми cross-run исходами.

| Операция | API median old→intent,мс | API p95 old→intent,мс | Lock-to-return mean old→intent,мс | SQL old→intent |
|---|---:|---:|---:|---:|
| Ordinary equip |19.24→91.10|34.05→109.67|9.61→10.93|8→45|
| Ordinary unequip |18.31→90.20|33.95→104.13|9.64→10.74|9→45|
| Resource equip |74.60→93.28|85.60→104.74|63.48→11.05|36→45|
| Resource unequip |72.84→91.84|91.81→101.81|62.98→11.38|37→45|

Intent делает6 worker calls/5 needs rounds **до** lock для любого предмета. Старый ordinary equip имел0 calls; resource equip —6 под lock. Подтверждены authority и короткая блокировка ресурсного перехода; **API latency хуже**, особенно ordinary. Старые API числа не включают клиентскую сборку. Test bridge измеряет её отдельно в Node, а не browser click-to-render; из таблицы нельзя вывести общий UI speedup. p9530 предварительный, локальные задачи конкурируют за CPU. Lock-to-return включает commit acknowledgement и не является точным PostgreSQL hold statistic.

Initiative offer API median70.20/77.41/74.02мс для party1/2/6; собирается лидер, не вся группа. На этом этапе browser доказал устранение full UI preparation; позднее выполнено отдельное сравнительное30× измерение настоящего клика: [PERF-02-initiative-browser.md](PERF-02-initiative-browser.md).

## Артефакты и продолжение

- `PERF-02-equipment-intent-baseline.json` — первая30× intent серия, artifact b59a1f...59955 до initiative export.
- `PERF-02-paired-compatibility.json`, `PERF-02-paired-intent.json` — полные числовые samples/hashes одной paired series.
- `PERF-02-initiative-options-baseline.json` — offers/init samples и private fingerprints.
- `PERF-02-browser-proof.json` — UI manifest и browser counters; без токенов/полных состояний.

Команды: `node scripts/performance/check-equipment.mjs`; `... --full --compare --measure`; `node scripts/performance/check-initiative.mjs --measure`; `node scripts/performance/check-runtime-browser.mjs --reuse-ui-build`. Shared-stack exports: checkEquipmentTransactions(stack), checkEquipmentFlow(stack,{repetitions:1}), checkInitiativeOptions(stack,{repetitions:1}), checkRuntimeBrowserFlow(stack). Full gates требуют equipmentIntent:true, initiativeOptions:true; browser — fresh owned UI snapshot.

До включения default: сократить repeated catalog transport/build через validated immutable cache(PERF-01/DB-03), затем повторить полный browser end-to-end и отдельно принять latency tradeoff. Rollback выключает соответствующие flags, сохраняя additive endpoints и чтение accepted receipts. Нельзя удалять pending IDs, переписывать committed outcomes или artifact pins.

## Дополнение: настоящий click-to-ready, 30 отсчётов

`profile-equipment-browser.mjs --compare` выполнил два fresh owned stack, одинаковые artifact/UI manifest/fixture/statistics проверены автоматически. Compatibility: `test_baaaef755487e7a76ba693ae`; intent: `test_0db9d8ad08eb449aae757edd`. Каждый — 120 измеренных команд + 4 warmup. Clock начинается capture-событием настоящей кнопки «Надеть»/«Снять в сумку» и заканчивается после принятого результата, обновлённого DOM экипировки, отсутствия pending receipt и двух animation frames. Открытие превью предмета не входит; подготовка каноничного participant, реальный API и отрисовка входят. Все ресурсы/ревизии и исходный лист проверены, pageErrors=0. Backend catalogBatch OFF в обоих вариантах.

| Сценарий | p50 compatibility → intent, ms | p95 compatibility → intent, ms |
|---|---:|---:|
| Обычный предмет, надеть |44.1 → 112.5|50.4 → 123.0|
| Обычный предмет, снять |41.8 → 114.0|51.1 → 122.8|
| Ресурсный предмет, надеть |90.9 → 113.2|108.0 → 123.2|
| Ресурсный предмет, снять |91.7 → 111.8|108.5 → 119.6|

Тёплая browser preparation уже занимает около11.6мс в compatibility против8.8–9.1мс в intent; API requests5→3. Скрытого ускорения за счёт устранения browser builder в этом сценарии нет. Это подтверждённая регрессия; PERF-02 latency acceptance остаётся открытым и флаг OFF. Следующий отдельный эксперимент — совместное включение уже проверенного catalog batch и CPU fix. Кроссзапросное повторное использование каталога допустимо только с проверяемой версией dependency membership/content/прав, а attempt-local xmin stamp не является таким ключом.

Полные числовые данные: [PERF-02-browser-compatibility.json](PERF-02-browser-compatibility.json), [PERF-02-browser-intent.json](PERF-02-browser-intent.json).

## Финальный локальный этап: batch + immutable input cache

После CPU fix и batch выполнена новая серия с текущими одинаковыми UI/artifact/backend/fixture hashes: legacy / authoritative cache OFF / authoritative cache ON,30 отсчётов на каждую из4 операций. Все372 accepted commands согласовали equipment/resources/revision; source isolation и отсутствие browser errors подтверждены. Полный отчёт и точные pins: [PERF-01-cache.md](PERF-01-cache.md), [numeric comparison](PERF-01-cache-comparison.json).

Ресурсный предмет: median78.8→56.0ms надеть и78.8→55.7ms снять; p9590.6→65.6 и86.1→59.2ms. Это измеренное ускорение полного UI пути относительно legacy. Ordinary:37.3→56.4ms и38.0→56.6ms — остаётся стоимость нового авторитетного worker check. Относительно такого же authoritative path cache OFF все четыре операции ускорились примерно на35–37%; worker calls6→1, SQL27→16. Прежние таблицы сохранены как этапы и не смешиваются с новыми pins.

Fresh selected content/membership/rights proof обязателен на каждом cache hit; текущий персонаж строится заново. Новый selector/artifact возвращает cold resolution. Write transaction не содержит worker I/O, commit stamp и повторная авторизация сохранены. Combined gate `test_bc68fa1b3b2078483a114e87`: native5, equipment8commits+8retries, readonly initiative3scenarios, browser accepted-response-loss/reload/exactretry PASS.

Флаги остаются OFF. Latency acceptance ресурсной экипировки подтверждён локально; ordinary tradeoff требует отдельного решения. Общий prepared runtime между options/initialize не кешируется: повторно используется только immutable declaration input после fresh proof.

Финальное30× initiative/battle browser измерение на одинаковых baec artifact/UI/fixture завершено: [отчёт](PERF-02-initiative-browser.md), [сырые числовые samples](PERF-02-initiative-browser.json). OFF→ON initiative median340.4→366.7мс, p953949.3→437.9мс; battle-ready median726.3→921.2мс, p954745.0→1194.1мс. Builder30→0, все exact retries/source isolation PASS. Arms последовательные при concurrent extended suite; медианы хуже, причинный общий speedup не подтверждён. Measurement gap закрыт, но эти числа не являются основанием включить флаг по умолчанию.
