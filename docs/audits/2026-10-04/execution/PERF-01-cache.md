# PERF-01 / PERF-02: immutable input cache, локальный этап

Флаг `RULES_PREPARATION_CACHE_ENABLED` по умолчанию выключен. Этот этап касается нового authoritative equipment intent и read-only initiative offers. Mutable world/HP/resources/equipment/pending, RNG, команды и подготовленные patches не кешируются. Для старых initialize/rest/camp paths остаётся ранее проверенный общий batch resolver; предварительный reference-registry traversal и повсеместное использование кеша ещё не реализованы.

## Граница кеша

- После fresh ownership check Go ищет кандидат по database pool + caller + owner + character. Это только индекс поиска. Доказательство пригодности — artifact, immutable payload identity и **свежий полный content/membership/rights fingerprint** в текущем repeatable-read snapshot.
- Один SQL statement хеширует полные selected rows через PostgreSQL SHA256, включая базовые действия, selector membership для effect types/variables/spell aliases, caller/owner rows и серверную policy. `xmin` здесь не используется. `xmin` остаётся только отдельным attempt-local prepare/commit stamp.
- Identity immutable payload переиспользует DB-03 `frozenCatalogHash`: owner + artifact + serializer `go-json-v1` + protocol + exact content. Это не разрешение брать старый battle snapshot для нового действия. Новые cache entries не записываются в историческую таблицу и не меняют старые pins.
- LRU ограничен 128 entries и 8 MiB учтённых retained bytes: payload, строковые данные, backing arrays/headers метаданных, запас на map/LRU node. Это не лимит всего RSS процесса. Возвращаются копии bytes/needs/IDs; каждая preparation декодирует отдельный JSON tree. Публикация под mutex заменяет единственный immutable entry; DB чтения разных RR snapshots не объединяются в общий in-flight запрос.
- Canonical builder заново строит текущего персонажа. Opt-in `catalogProjectionVersion=1` фиксирует потреблённые declarations/selectors, а hydration карточек использует текущий carried/bound inventory. Старый candidate superset не превращается в предметы персонажа. Cold/warm content manifest вычисляется из одинаковой consumed projection.
- Новый read selector, `needs_content`, unsupported selection или другой artifact отклоняют candidate и запускают обычное cold resolution. Особенно важно: прежний UUID read не доказывает новый alias/card_number lookup. Все новые selector memberships разрешаются настоящим resolver до принятия.
- Новая команда выбирает current artifact первым запросом. Кандидат не пинит её на старый executable. Если новый executable отклонил старый candidate до ответа с hash, выполняется один cold fallback; уже выбранный в этой preparation artifact сохраняется. RNG seed при этом тот же, результата/записи до commit нет.
- Неизменившийся entry не публикуется повторно только после fresh proof и равенства artifact, consumed manifest и обоих read sets. Commit stamp, повторная проверка прав/CAS и атомарная запись остаются обязательными.

## Доказательства и найденные при проверке дефекты

1. Targeted frontend: 5 файлов / 28 tests PASS. Полный legacy/new prepared command и RNG совпадают. Две разные resource declarations, добавление/удаление owned inventory и лишняя candidate card проверяются без изменения input. Полный TypeScript check и свежая production UI сборка прошли.
2. Actual worker/Go differential: `test_2ce8b5c6de4ec67534774eb9`, повтор после no-op publication `test_aab9126cecbff4994cf6ed74`: четыре обязательных tests PASS. Два разных preset builds, два предмета (обычный и resource grant3/5), legacy/cold/warm/evicted. Внутри нового контракта сравнивается **полный worker result**, с legacy — полный prepared command, RNG и artifact; дополнительный consumed manifest/selection имеют явный новый opt-in контракт. Warm делает один worker call.
3. UUID→новый English alias с двумя matching rows: warm и cold одинаково отклоняют ambiguous reference. UUID→новый exact card_number: exact row побеждает alias, полный warm/cold result одинаков. Независимый review обнаружил этот случай до acceptance; guard дополнен, ошибка не скрыта в normalization.
4. Native content proof проверяет изменения content, membership, variables, user/policy и изоляцию caller. Тест обнаружил PostgreSQL name collision: `to_jsonb(source)` ссылался на реальную колонку `source`; используется однозначный whole-row `to_jsonb(source.*)`. No-op UPDATE с другим xmin и тем же содержимым не инвалидирует content proof.
5. Дополнительный artifact-rollout test: `test_1dae938856f35a71347e4df8`, четыре unit tests PASS. Ни готовый ответ другого artifact, ни отказ нового executable не оставляют команду на candidate pin. LRU eviction, metadata quota, caller mutation of returned bytes и owner/artifact identity проверены.
6. Сохранены разные исторические serializer contracts. Worker `canonicalStringify` использует numeric-first enumeration integer-like keys JS objects; existing Go canonical JSON сортирует ключи иначе. Новый узкий proof adapter воспроизводит worker format, переиспользуя строгие primitive encoders. Исторические serializers не переписаны. Integer-like key/Unicode/escaping regression проходит.
7. После deduplication caller==owner read: все 7 native transaction/concurrency/rights/equipment tests PASS (`test_09fd0743bce9cf20fee29b21`). HTTP/worker I/O по-прежнему отсутствует под write locks.
8. Финальная связка `test_bc68fa1b3b2078483a114e87`: native **5/5**, actual equipment **8 commits + 8 exact retries**, initiative **3 scenarios / 6 samples**, read-only offers и exact initialize retry; настоящий browser lost-response/reload сохраняет тот же command ID, inventory и source. Page errors0, browser participant builds0 для enabled equipment/initiative. Последний frontend equipment removal assertion: 5/5 PASS. Общий полный runner выполняется отдельно; эти проверки не объявляются его заменой.

Общий gate: `checkPreparationCache(stack)` в `scripts/performance/check-preparation-cache.mjs`; fresh owned API fixtures, без второго стенда. Native actual-worker test сам сравнивает флаги в одном процессе/снимке. Actual API/browser callers используют `{performance:true,catalogBatch:true,equipmentIntent:true,preparationCache:true}`; initiative flow дополнительно `initiativeOptions:true`. `--unit-only` запускает только DB/unit tests.

## Измерение

Диагностический browser smoke `test_629a935cec41d2e4d3250c51` подтвердил 6→1 worker calls; восемь реальных equipment commands прошли. Он также показал 10–12 ms лишней повторной публикации entry; она затем устранена с описанными проверками. Этот smoke не является финальным сравнением p95.

Итоговая серия — `profile-equipment-browser.mjs --cache-compare --batch --fresh-ui`: legacy / authoritative cache OFF / authoritative cache ON, по 30 отсчётов для четырёх операций. Каждый owned stack выполнил124 commands:120 измеренных и4 warmup, итого372. Открытие item preview исключено; click capture → committed DOM + отсутствие pending command + два animation frames включает реальные API, browser preparation и render. Page errors0, resource capacities/revisions/source isolation проверены во всех сериях.

| Операция | Legacy p50 / p95, ms | Intent cache OFF p50 / p95, ms | Intent cache ON p50 / p95, ms |
|---|---:|---:|---:|
| Обычный предмет, надеть |37.3 /46.1|90.1 /93.5|56.4 /80.2|
| Обычный предмет, снять |38.0 /42.8|89.9 /99.3|56.6 /64.2|
| Ресурсный предмет, надеть |78.8 /90.6|85.7 /92.2|56.0 /65.6|
| Ресурсный предмет, снять |78.8 /86.1|86.5 /92.7|55.7 /59.2|

Cache ON сокращает median нового authoritative path примерно на35–37%. Для resource equip/unequip полный UI путь быстрее legacy примерно на29%, одновременно worker I/O вынесен из write transaction. Ordinary legacy по-прежнему быстрее примерно на19ms: он не вызывает authoritative worker. Поэтому ускорение всех видов экипировки не объявляется достигнутым и default остаётся OFF.

SQL27→16 и worker calls6→1 для нового пути. Все120 тёплых запросов ON прошли fresh validation и retained-entry check; повторной публикации0. Mean content validation5.4–6.2ms. Lock-acquired→return mean: legacy resource48.3/48.5ms → ON8.9/8.4ms, ordinary8.2/8.0→9.2/10.1ms. Это включает commit acknowledgement и не является точным PostgreSQL lock-hold statistic.

Последовательные runs: legacy `test_2b3cf98e88f74abb4e1e0a15`, OFF `test_5185e53f94567fa0345f6895`, ON `test_185e3c601a8036a0d499bad1`. Все три имеют одинаковые artifact `sha256:80ef5c7149be4545130d8165a34c904bab90c6d7529408f852a15ee7bce8da64`, UI manifest `46f754d2b030e56730115796bc6e70501691bdc9cbdf8b180f7d6bacc7b804f3`, backend bytes `sha256:91f95d4fe40f8b792ffcc9918f38cdb53cfa2eff70d7c14a645f8a43c5cfd7f2` и полный fixture descriptor/statistics. UI/artifact/fixture проверялись runner; backend hash дополнительно проверен после серии и теперь также проверяется автоматически перед каждой следующей серией. Frontend media variants OFF. Между разными runs UUID/entropy различаются; их outcome hashes не нормализуются ради заявления равенства. Доказательство полных seeded outcomes — отдельный native differential выше.

Raw numeric samples: [legacy](PERF-01-cache-browser-legacy.json), [OFF](PERF-01-cache-browser-off.json), [ON](PERF-01-cache-browser-on.json). Сводка с проверенными hashes и всеми числовыми фазами: [PERF-01-cache-comparison.json](PERF-01-cache-comparison.json). Browser replay: [PERF-01-cache-browser-proof.json](PERF-01-cache-browser-proof.json). Локальные30 samples не дают production p95 guarantee; отдельная saturation/load проверка ещё нужна.

## Проверка состава поставки

Независимый review обнаружил, что source `server.mjs` импортировал `mirrors.mjs`, отсутствующий в `worker/dist`, который копируется в OCI. Native stack запускает source wrapper и раньше не обнаруживал это. Добавлены copy и regression: тест копирует только готовый dist во временный каталог вне репозитория, импортирует server/replay и запускает настоящий artifact health. До повторной сборки он упал с ENOENT mirrors; после свежей сборки worker server/replay **7/7 PASS**, artifact hash80ef не изменился. Эта проверка подтверждает closure runtime modules; запуск полного Linux OCI остаётся release gate.

## Оставшиеся ограничения и rollback

Кеш не заменяет отдельную полную multi-class corpus, 30× initiative click-to-ready, concurrent saturation и долгие сессии. Два preset builds не объявлены покрытием всех классов. Новая entity ACL/tenant policy потребует расширить proof contract; текущий resolver работает с общим content catalog и отдельно авторизованным owned character. Shared prepared/runtime state не добавлялся.

Откат: выключить cache flag. Базовый resolver остаётся доступен, кеш воспроизводим и может быть удалён; command receipts, RNG, исторические artifacts и pending IDs сохраняются. Authoritative intent и initiative flags также остаются OFF до отдельного решения. Ускорение нового authoritative path измеряется отдельно от старого ordinary endpoint, который вообще не выполнял worker validation.
