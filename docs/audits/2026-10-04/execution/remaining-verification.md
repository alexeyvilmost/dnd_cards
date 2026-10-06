# Оставшаяся проверка после локальных наборов

Историческая передача до успешных CI26 и выкатки. Актуальные закрытые и открытые границы перечислены в [отчёте выкатки](CI-26-production-delivery.md); требования ниже сохранены для истории и не означают, что выпуск всё ещё ожидает первого запуска.

Передача агентам, 05.10.2026, в каталоге аудита 04.10.2026. Это перечень **неподтверждённых окружений и внешних действий**, а не новый план разработки или разрешение выкатки. Машинный эквивалент: [remaining-verification.json](remaining-verification.json). Этот документ ничего не запускает и не меняет конфигурацию.

Для предыдущего снимка исходников локальные наборы прошли: свежие **core и extended целиком** на одинаковых замороженных исходниках, точный выбор тестов, ненулевые обязательные группы, отсутствие fail/skip, завершённый cleanup и совпадающие source hashes. Адресные результаты не подменяют общий receipt. Внешние критерии ниже остаются самостоятельными условиями выпуска.

Итоговые fresh core-5 и extended-3 **PASS**: [общий receipt](final-verification.json), [core](TEST-03-final-core.json), [extended](TEST-03-final-extended.json). 4313 исходных файлов, одинаковый SHA-256 9006ebdf46d135173693de59024649515d0706e4f2c2fc5eba540ef7df16aabb; новые UI сборки и cleanup без ошибок. Инвентарь включает26 реальных файлов rules-core/coverage. Старые core-4/extended-2 и другие failed receipts сохранены без переаттестации; они не заменены выборочными положительными результатами.

Docker повторно проверен 2026-10-04T22:40:44.985Z: Linux 29.8.1, x86_64, context desktop-linux доступен после запуска пользователем. Новый [receipt](environment-docker-ready.json). Прежняя недоступность daemon больше не блокирует работу; OCI build/rehearsal и Linux race ещё должны быть выполнены. Агент настройки ОС не менял.

Фазовый process-kill **локально PASS в обеих фазах**: [PERF-03-crash-recovery.md](PERF-03-crash-recovery.md), [машинное свидетельство](PERF-03-crash-recovery.json), actual run `test_b74426d134f97d09e055f94a`. До commit настоящий worker уже вычислил результат, но proxy ещё не передал его Go; после commit настоящий ответ API удержан до передачи клиенту. Повтор полностью сохраняет worker input/result либо возвращает durable receipt без нового worker вызова; ресурс списан один раз, дополнительный повтор после успеха не меняет RNG/БД. Исходные/скопированные binary/artifact hashes совпали, все собственные процессы и БД остановлены. Это backend-process crash на native PostgreSQL с работающим worker: не power-loss/PostgreSQL crash, не exact-container migration fault и не длинная memory-сессия. Интегрированный process-crash-recovery gate также прошёл в итоговом extended-3 на текущих исходниках; подробности в общем receipt.

Пользователь 05.10.2026 явно разрешил коммит и выкатку после локальной проверки; необходимый push входит в release workflow. Повторного подтверждения не требуется. Production пока не изменён. Секреты и платная генерация не входят в диагностические отчёты.

После этих наборов сверка каждого требования выявила оставшиеся локальные шаги. Они выполняются по [completion-followup.json](completion-followup.json); прежний PASS не считается проверкой новых изменений.

## ENV-LINUX-RACE — полный набор с Go race

Владелец: тестовая инфраструктура. Требуются Linux, Node24 с lockfile dependencies, Go1.25 с C toolchain, PostgreSQL17 binaries, установленный браузер и чистый exact-source checkout для режима CI. BIOS/WSL менять для этого не требуется: подходит отдельный разрешённый Linux host.

Существующий entrypoint из `.github/workflows/ci.yml` и `scripts/testing/run.mjs`:

```text
node scripts/testing/run.mjs --mode ci --candidate HEAD --suite extended --race --output outputs/testing/linux-extended-race-UNIQUE
```

`UNIQUE` заменить новым каталогом; PostgreSQL передаётся через существующий `--pg-bin`/`TEST_PG_BIN`, если binaries отсутствуют в PATH. Проверить финальные `report.json`, `source-snapshot.json`, `test-catalog.json`: `go_race=true`, требуемые Go root/subtests реально выполнены, весь extended зелёный, cleanup завершён. Включённая отдельная matrix297/298/299 должна также получить race-флаг. Не заменять race обычным Windows прогоном и не выбирать урезанный набор. Commit/push для release workflow уже разрешены пользователем после локальных проверок.

## OCI-BUILD — реальные pins, cold/warm и содержимое образов

Владелец: release/build. Требуется доступный **локальный Linux/amd64 Docker daemon и BuildKit**; remote SSH/TCP/Kubernetes builder измеритель отвергает. Подготовить реальные digest refs GO/ALPINE/NODE/NGINX и отдельно BuildKit, подтвердить platform, Node24 и input closure. Tag по умолчанию не считается pin. `infra/release-build-config.json` сейчас `enabled:false`, четыре baseImages и buildkitImage пусты, contentManifestHash пуст, migrationSet пуст; не придумывать значения и не включать этот файл ради локальной проверки.

Поддерживаемый измеритель:

```text
node scripts/release/measure-local.mjs --prepare --build --builder rel02-local --images path/to/image-pins.json
```

Builder `rel02-local` должен быть заранее создан на разрешённом локальном daemon с проверенным BuildKit. `image-pins.json` содержит именно четыре допустимых ключа base images с реальными `@sha256`. Один cold и два warm каждого компонента должны дать настоящие build logs, elapsed/cache markers/image IDs/sizes. Cold здесь означает изолированный application/dependency cache, не обязательный повтор скачивания base image. Отдельно проверить изменения UI, shared rules, media и lockfile на реальном BuildKit; текущий измеритель не выполняет всю mutation matrix автоматически. Не применять prune к чужому cache.

Запустить actual image contracts и изолированный container smoke: frontend HTML/lazy chunks/preview/DiceBox/PWA/media, backend HTTP+БД, worker health+current CJS и retained CJS. `infra/compose.test.yml` и `check-compose.mjs` пока доказаны только как конфигурация; готового автоматического Docker lifecycle, эквивалентного native `startTestStack`, нет. Нельзя считать `compose up` на старом bootstrap готовым integration-профилем или импорт schema297 доказательством fresh chain. Exact candidate collector ниже даёт подготовленный путь HTTP smoke; браузер внутри OCI требует отдельного owned adapter.

## OCI-SELECTIVE — registry, frontend-only замена и откат

Владелец: release orchestration. После OCI-BUILD подготовить отдельный loopback registry со случайным портом/owned volume и pinned registry image; чужие registry/образы/сети не менять. Готовой единой CLI-команды для всей этой матрицы в репозитории нет: добавить локальный driver поверх `ci-images.mjs`, `deploy-state.mjs` и `createDockerDeploymentAdapter`, сохранив проверку владения всеми Docker-ресурсами. Production CLI не использовать как обход отсутствующего local adapter.

Обязательные actual сценарии: save/load/push/pull тех же проверенных bytes; UI-only source change сохраняет backend/worker digests и container IDs/launch identities, заменяется только frontend; worker/shared-rule change выбирает всех реальных потребителей; одинаковый повтор не делает новый cutover. Проверить отсутствующий image/layer/manifest, повреждённый archive, stale predecessor, нездоровый candidate, сбой после замены одного компонента и restart/recover/rollback. Неизменённые backend/worker/Caddy не перезапускаются; старые HTML/chunks/WebP и CJS остаются доступны. Неверные DSN/env override, checksum и ownership должны блокировать действие. Unit simulations и Compose config-only roundtrip этого доказательства не заменяют.

После additive298–300 app rollback сохраняет наблюдаемую новую DB schema и executor identity в journal. Writers `DB_COMPACT_RECEIPTS`, `DB_FROZEN_CATALOGS`, `IMAGE_JOBS_ENABLED` остаются0; schema rollback и удаление history не разрешены. Отдельно проверить recovery со stopped/missing candidate backend и проверенным приватным runtime snapshot. Любой unknown outcome/cleanup error оставляет failed/unknown receipt и блокирует следующий кандидат.

## OCI-CANDIDATE — capture → clone → exact images → bundle

Владелец: release/database. Требуются настоящий candidate record с подтверждёнными source/control SHA и exact-image provenance, inspected active manifest/DB baseline, сохранённые CJS, свежий согласованный capture или уже принятый backup. Локальные source builds без настоящего CI receipt можно проверять как local OCI evidence, но нельзя выдавать их за deployable CI candidate. Получение настоящего опубликованного кандидата зависит от отдельно разрешённой build/publication фазы REL-ENABLE.

Существующие интерфейсы:

```text
node scripts/release/candidate-rehearsal.mjs run CANDIDATE_DIRECTORY CONFIG_JSON NEW_REHEARSAL_DIRECTORY
node scripts/release/assemble-bundle.mjs CANDIDATE_DIRECTORY REHEARSAL_DIRECTORY NEW_FINAL_DIRECTORY
node scripts/release/deployment-handoff.mjs verify NEW_FINAL_DIRECTORY VERIFIED_RELEASE_RUN_JSON -
```

Имена в верхнем регистре — обязательные реальные входы, не готовые файлы. CONFIG_JSON: `schemaVersion:1`, pinned `postgresImage`, абсолютный `activeStateFile`, ровно одно из `captureDirectory`/`backupDirectory`. Capture привязан к actual active/backend/database identity, его возраст при приёме не более30мин; готовый backup требует принятого restore proof. Простое наличие dump не разрешает сборку bundle.

Collector должен реально восстановить dump в owned internal-network cluster, получить inventory **из восстановленного снимка**, проверить exact image HTTP health/identities, новый canonical battle на candidate CJS, весь referenced historical CJS/replay, held decision, duplicate и continuation без RNG/resource drift. Если меняется schema — обязательны все семь `migrationScenarios`: atomic-ddl-ledger, crash-before-ledger, repeat-after-commit, same-connection-lock, unknown-migration-rejected, schema-proof, old-readers-after-expansion. Native lock tests не заменяют exact-container CLI/fault checks. Ни одной новой миграции вне298–300, удаления или изменения уже принятого checksum.

Accept: real `execution:docker` receipt, complete inventory, current health, source/image/nonce binding, additive receipt при необходимости, `cleanup.status=stopped` без errors; только затем assembler создаёт manifest/bundle. Исходный candidate.json и его provenance hash неизменны; final manifest добавляет только evidence. Capture/privacy files не загружаются в GitHub artifacts. Неизвестный historical hash без достаточного replay evidence блокирует выпуск; не генерировать фиктивный «старый» корпус. Media reference restore не доказывает наличие remote object bytes: отдельно измерить production-sized restore/RTO, off-host backup durability и доступность сохранённых объектов. Retention/GC не включать.

## REL-ENABLE — включение реально проверенного release-контура

Владелец: release operator совместно с владельцем TimeWeb/GitHub. Раздельные этапы исполнения: сначала exact-source CI/build-only и разрешённая публикация; затем явно порученные production capture/cutover. Не требовать повторного разрешения на шаг, уже охваченный поручением. Не называть всю автоматическую цепочку проверенной до прохождения OCI-SELECTIVE и OCI-CANDIDATE. Текущие `productionEnabled:false`, `autoDeployMain:false`, `deleteBackupsImagesAssets:false` сохраняются до этого этапа.

После явного поручения commit/push и успешного exact-SHA CI заполнить реальные reviewed pins/contentManifest/migrationSet; настроить registry pull/publication policies и доступные environment protections. GitHub build/publish jobs не получают production DB/SSH secrets. Для production нужен отдельный trusted runner с Node24.19.0/Docker, labels, которые недоступны обычным PR jobs, и проверенные абсолютные пути/checksums host config. Legacy migration checksums и старые image digests требуют inspected baseline; их нельзя восстановить предположением из ID.

Проверить независимые switches из актуальных workflows: `RELEASE_BUILD_ENABLED`, `AUTO_RELEASE_MAIN_ENABLED`, `RELEASE_PUBLICATION_ENABLED`, `PRODUCTION_DEPLOY_ENABLED`, `AUTO_DEPLOY_MAIN_ENABLED`; host path variables `DEPLOY_HOST_CONFIG_FILE`, `REHEARSAL_CONFIG_FILE`. В дочерних процессах production gate использует **`DEPLOY_PRODUCTION_ENABLED`**. Repository variable не обходит tracked policy. Поддерживаются ручные dispatch и отдельно включаемый `main → CI extended → release → deploy`; старое описание «только workflow_dispatch» не определяет поведение актуального `release.yml`.

Host config всегда хранит `backupDirectory=<root>/backups` вне checkout. Для каждой попытки:

```text
node scripts/release/prepare-host-release.mjs HOSTCONFIG POLICY REHEARSAL_TEMPLATE capture-RUN_ID-ATTEMPT
```

Этот **production интерфейс сейчас не запускать**. Он требует enabled env/policy и создаёт fresh capture плюс private deployment/rehearsal config. Передать collector именно `rehearsal_config`, а apply — именно `host_config` этой попытки: в первом `captureDirectory`, во втором `backupDirectory` указывают на один новый `capture-<run>-<attempt>`. Статический прежний backup не подставляется. Проверить эту связь настоящим запуском, source/container/DB binding и права0700/0600.

После всех gate и отдельного поручения на TimeWeb точный интерфейс: `node scripts/release/deploy.mjs apply --production HOSTCONFIG POLICY FINAL_DIRECTORY`; recovery — `recover` либо `rollback` с теми же config/policy и **release ID** вместо каталога. Сначала read-only `plan`/`status`. Перед cutover повторно проверяются current main, active predecessor, live artifact refs и фактическая DB identity; появившийся unrehearsed CJS требует новой репетиции. Отказ/unknown не обходить ручной записью active.json. Только успешный observed cutover создаёт deployed receipt с различными application releaseCommit и controlCommit.

## DATA-FRESH — исторический pre102 и полная fresh-цепочка

Владелец: migrations/data provenance. Нужен доверенный и разрешённый для локального использования исторический preimage с происхождением, hash, mechanics/support/evidence перед102 и следующими guarded transitions. Checked-in SPELL-0253 и SPELL-0173 имеют support:null; isolated exact-preimage unit fixtures и константы ожидаемых hashes не являются архивом исходного production состояния. Native matrix297/298/299→300 уже проверена отдельно и не закрывает этот пункт.

Получив данные, подготовить versioned минимальный public fixture или отдельный приватный локальный loader с redaction и hashes; документация должна ясно отличать воспроизводимый clean-install input от restored upgrade snapshot. Такое wiring полного доверенного preimage пока отсутствует. Затем на новом owned native PostgreSQL выполнить все реальные startup migrations001→current и повтор с нулём новых migrations, проверить exact ledger, schema, необходимые catalog/character/combat сценарии, source/support/history preservation; отдельно upgrade с доверенного pre102 состояния. Существующий `node scripts/testing/stack.mjs --profile fresh` — вход проверки, сейчас ожидаемо останавливающийся на102. `--catalog-snapshot` и imported schema297 пропускают историческую цепочку и не подходят как доказательство.

Если происхождение не восстановлено, оставить `awaiting_trusted_historical_preimage` и failure102, не менять guard/сертификаты/старые bytes ради зелёного результата. Это недостающий вход и оставшаяся локальная работа, а не отказ Docker. Доступ к TimeWeb для получения нового snapshot требует явного поручения; уже предоставленный разрешённый локальный snapshot можно исследовать локально.

## PERF-HOST — длинный бой и бюджет окружения

Владелец: runtime/performance. Локальная длинная последовательность выполнена: 160 команд и ещё 100 диагностических, каждая с точным receipt retry и полным worker replay; оба стенда остановлены. [Числа и пределы проверки](PERF-03-long-combat.md). Журнал ограничен 80 записями, но processedCommandIds растёт на 195 B/ход: это список для дедупликации внутренних команд. Автоматически обрезать его нельзя без отдельного версионного контракта. Forced GC в конце вернул heap близко к начальному уровню; это не доказательство общего memory bound. Замер фактического TimeWeb host budget остаётся отдельным внешним действием после явного поручения. Короткие fresh-process профили партий 1/2/6, нагрузки 1/4/16, admission и reload historical CJS описаны в `PERF-03-capacity.md`. LRU ограничивает число записей кеша; выполняющийся вызов может дольше удерживать вытесненный модуль. Ни одна из этих серий не доказывает production p95; измеренное уменьшение heap около 2.9% в отдельном cache-профиле не является значимым общим выигрышем памяти.

Существующий `node scripts/performance/profile-worker.mjs --mirrors --capacity` повторяет короткий профиль, но не заменяет отсутствующий long-combat driver. Следующий driver должен делать обычные авторитетные команды, без SQL-подделки состояния: несколько последовательных окон, рост/выход на плато state/history/request bytes, RSS/heap/maxRSS/event-loop lag, cancel/busy outcomes и exact retry/reload с неизменными RNG/resources. Сохранить исходные source/artifact/fixture hashes, числовые samples и полное сравнение результатов в памяти. Наблюдаемые пики и lifetime maxRSS нельзя называть точной exclusive памятью запроса.

Перед повышением лимитов на реальном хосте измерить бюджет backend + worker + PostgreSQL + прочие процессы, число backend replicas и отменённые удалённые запросы. `RULES_WORKER_MAX_INFLIGHT=4` действует на один backend; отмена HTTP не прерывает уже начатый synchronous JS. `RULES_WORKER_MAX_CACHED_ARTIFACTS=4` не задаёт общий heap limit. Зафиксировать допустимый отказ и запас памяти по измерениям, не увеличивать limits и не добавлять pool/delta ради перечня плана.

Это измерение и решение о параметрах, **не требование включить opt-in flags на production**. Catalog/cache/equipment/initiative/mirrors остаются OFF до отдельной приёмки и разрешённого выпуска. Ресурсная экипировка ускорилась в локальном сравнении, обычная остаётся медленнее legacy. [30+30 браузерных замеров инициативы](PERF-02-initiative-browser.md) уже выполнены: builder calls30→0, медианы хуже; последовательные серии при конкурирующей нагрузке не доказывают общее ускорение. Этот локальный measurement gap закрыт без включения флага. Фазовый process-kill и длинная последовательность имеют отдельные принятые receipts; production host budget и OCI acceptance ими не заменяются.

## AI-DIAG — классифицировать настоящий403

Владелец: backend/image operations. До установки сети получить отдельно разрешённую диагностику работающего TimeWeb backend: существующий request_id, source/provider_status, безопасные provider_code/type/request_id и content type; реальное наличие конфигурации и DNS/TLS/egress в том же namespace. Полные URL с userinfo/query, ключи, prompt, body/base64 не записывать. Не вызывать платный Images POST ради сетевой диагностики без бюджета.

Сверить текущие официальные требования к странам/аккаунту/организации/модели во время исполнения. HTML403, app content-admin403, permission403 и точный unsupported-region code — разные причины. GET models или доступ к сайту ChatGPT не доказывают Images API. Acceptance — доказанная категория отказа и безопасный correlation receipt; неизвестная причина остаётся unknown, не объявляется «VPN исправит». Существующей автоматической production diagnostic CLI нет: использовать процедуру `docs/image-generation-operations.md`, без выдуманных shell-команд и утечки конфигурации.

## AI-EGRESS — выделенный gateway и реальный платный/storage путь

Владелец: network operator + image backend. Только после AI-DIAG и отдельного поручения на целевой gateway/TimeWeb; при региональном/аккаунтном ограничении выбрать допустимое размещение/доступ или другого доступного провайдера, не обещать обход сетевой маскировкой. VPN-сервер на самом TimeWeb без внешнего gateway не меняет исходящий адрес.

Реализованный client contract — `OPENAI_CONNECT_PROXY_URL`: HTTP(S) CONNECT только для OpenAI HTTPS client, TLS verification сохранён, invalid config не вызывает direct fallback, глобальные proxy/NO_PROXY его не подменяют. Настройка самого gateway/WireGuard здесь не установлена и готового deployment CLI нет. На разрешённом стенде проверить authenticated/private gateway с ограниченными destinations, provider credential не попадает в CONNECT headers, DB/worker/storage route не меняется, отключение gateway даёт безопасный отказ без direct/paid retry, откат возвращает проверенную конфигурацию.

Одна реальная генерация — в пределах поручения и известного денежного лимита/проекта/модели/storage target; если необходимый расход не определён, сначала уточнить его. Проверить provider request ID, сохранённый URL и объект, entity+job transaction, reload/history, повтор того же job UUID без новой оплаты. Unknown после потери ответа не повторять автоматически; legacy acknowledgement сам не вызывает POST. `IMAGE_JOBS_MAX_DAILY_ATTEMPTS` ограничивает число заданий, не деньги. Expansion rollout оставляет `IMAGE_JOBS_ENABLED=0`; включение writer требует отдельной проверки совместимости rollback после появления job rows. Для отката выключить admission, сохранить history/readers и существующие UUID, не удалять image_jobs или старые blobs.

## Закрытие передачи

По каждому пункту сохранить новый receipt с exact source/control/image/config hashes, фактической средой, полным selected набором, outcome и cleanup; не редактировать старые failed/historical receipts. Unit/native PASS, Docker simulation, config-only и actual OCI/provider execution различаются явно. Если внешний вход недоступен — зафиксировать точную недостающую величину, оставив gate закрытым. Разрешения этим документом не выдаются.
