# TEST-05 — расширенная регрессия и историческая совместимость

Статус: выполнены исправления локальной регрессии и переносимый исторический replay corpus;
общие fresh core-5 и extended-3 прошли на одних исходниках. Полная acceptance TEST-05 **не объявлена**:
Linux race и fresh historical DB migrations имеют отдельные открытые ограничения;
поддерживаемая upgrade matrix 297/298/299→300 уже прошла.
Production, commit и push не выполнялись.

Последующие проверки закрыли два отдельных пробела: [все 15 типов PendingResolution](TEST-05-pending-matrix.md) — 73/73; [upgrade297/298/299→300](TEST-05-upgrade-matrix.md) — 3/3. Первый общий extended прошёл 6117 Vitest, 731 Go и 11 браузерных сценариев, затем остановился на HTTP429 из-за избыточных авторизаций harness. Лимиты сервиса не ослаблены: добавлен process-local cache настоящего owned login; последующий адресный прогон всех девяти дополнительных gates прошёл. Окончательная общая проверка после переноса Urvin, ограничения нагрузки worker, исправления S05 и сохранения объявленного исхода прошла: [итоговый extended](TEST-03-final-extended.json), 6196 Vitest и 737 Go; весь native набор 18,27 мин. Source snapshot совпал с core; старые failed reports сохранены.

## Доказанные исправления

После baseline core-5/extended-3 добавлена [полная матрица 17 сохранённых продолжений SoloCombatState](TEST-05-solo-durable.md): immutable corpus 222 случая, Vitest224/224, реальный worker/PG220 принятых команд и440 повторов квитанций, два отдельно классифицированных boundary rejection. Это новый адресный receipt; последующий общий прогон обязан включить gate `solo-durable-continuations`.

1. Исправлены неполные текущие fixtures: `world.objects`, состояние актёров/условий, источник
   ability-check, материализованные targeting/metadata. Exact state/replay assertions сохранены.
   В Mending убран второй `startEncounter` из теста, потому что общий protocol уже содержит первый.
   False Life сравнивает наблюдателя после действительного запуска столкновения, включая turn ledger.
2. `engine/execute.ts` регистрирует уже существующие `attack_dice_followup` и `effect_received`
   в словаре событий. Иначе общий preflight ошибочно отвергал доступное продолжение.
3. `resolveFailedCheckBoost` сохраняет получателя результата при преобразовании проверки в
   подтверждённый auto outcome (`who ?? target`). Fixed DC и contest проходят reload и расход один раз.
4. `triggerOwnership.ts` явно разделяет универсальную очередь мира, досочную реакцию с сохранённым
   контекстом атаки и фазовое вмешательство. Неизвестные декларации не исполняются как безусловные.
   Это исправило двойное/преждевременное предложение манёвра без проверки predicates.
   Две разные hit-action декларации, разные resource/price, weapon/unarmed/spell, один offer/расход,
   duplicate rejection и unsupported gate проверяются в существующих общих integration suites.
5. Familiar guard проверяет статическую форму точно, а текущие board observations и движение —
   валидной динамической схемой. Owl/cat проходят общий контракт; malformed distance/revision/sea,
   движение и подмена proficiency остаются отказами. Проекции пространственных фактов обновляются
   в тестах после ручного изменения исходной геометрии, до snapshot для сравнения.
6. RulesLab проверяет каноническую запись атаки в сохранённом журнале, а не присутствие раннего
   события в UI-окне последних десяти записей. Asset test больше не зависит от cwd запуска.

## Сертификаты и версии fixtures

- `sheetCombatCertification.generated.json` не изменён. Тест фиксирует его прежний SHA-256,
  проверяет все старые действия и отказ исторического сертификатора принимать изменённые текущие
  executable projections. Текущий compiler отдельно строится дважды и проверяет все roots/actions.
- RulesLab получил отдельный `rulesLabFixture.v6.generated.json` и namespace
  `dnd-cards-rules-lab-v6` / `rules-lab:dnd-2024:compiled-l1-v6`.
  Прежний `rulesLabFixture.generated.json` v5 и прежнее IndexedDB не изменяются/не удаляются.
  Схема JSON остаётся 5; версия набора данных стала 6.0.0.
- Из mixed `microMvpL1Overlay.test.ts` вынесен ровно один исходный old-pin assertion в
  `microMvpL1Overlay.historical.test.ts`. Остальные текущие compiler invariants остаются extended.
  Полный `liveMicroMvpCompiledCertification.test.ts` сохраняет старые assertions протокола
  исторической сертификации (нет application runtime caller; используются audit/certification tools).
  Только эти два точных файла добавлены в manual manifest; папка canon не исключена.
- Новый `catalogFingerprint.test.ts` сохраняет текущие normalized/raw fingerprint, HTTP metadata,
  nested mechanical keys, отсутствие мутации review statuses, exact compiler attestation и
  fail-closed изменения scope/preimage/оборудования. Старые pins не повышают ручной статус сущности.

## Настоящий старый executable на новом сервере

`frontend/worker/fixtures/replay-v1/` переносим и не зависит от private dump, Git checkout или
установленного PostgreSQL во время теста. Архив построен из Git tree
`4549fb3c903659d3fe2beb272f7f903a731f7388`, 263 исходника с индивидуальными hashes:

- original executable: `sha256:d65f8e2e1bd73976acbc2d6d7f2d18b2b104b2c8a34463bafddbaf7d07770645`;
- распакованный размер 2 696 248 байт, gzip 550 860 байт;
- synthetic corpus: `sha256:754a72a1daf8bd15f1de630bf4b43020ad07e1f015a6e87343ac9fc2b93c88cf`;
- corpus gzip 482 641 байт; девять сохранённых ответов (две held проверки успех/провал,
  их продолжения, отдых, initialize и три настоящих боевых хода с RNG).

`historical-replay.test.mjs` запускает текущий HTTP worker с **другим** default executable,
затем исполняет каждый сохранённый запрос старым hash: два повтора × два независимых запуска
сервера. Сравнивается полный canonical outcome hash, включая RNG/ресурсы/revision/pending.
Дополнительно replay трёх команд журнала даёт тот же конечный envelope; повреждённый outcome
отвергается. Missing executable →409, corrupt executable →422, fallback на текущие правила отсутствует.
Генераторы — явные write-once инструменты; обычный тест не пересоздаёт expected результаты.

`worldMigration.historicalCorpus.test.ts` читает 12 сохранённых миров оригинального executable
текущим migration reader: исходник неизменен, ruleset/revision/pending/HP/resources/inventory/
equipment/effects сохраняются, повтор миграции идентичен. Неизвестная схема отвергается.
Существующие schema migration suites остаются обязательными; это не замена PostgreSQL DDL matrix.

Paid roll influence / один расход стрелы / БД receipts и journal / dump→restore проверяет
настоящий API drill [REL-06](REL-06.md), результат `REL-06-native-media.json` (7 checks).
Он дополняет переносимый original-executable corpus, а не заменяется unit stub.

## Локальные результаты

| Проверка | Результат | Сохранённый отчёт |
|---|---:|---|
| Fixtures / existing event dictionary | 64/64 | `outputs/testing/test05-fixtures-first.json` |
| Failed-check recipient / primitive contracts | 52/52 | `outputs/testing/test05-primitives-second.json` |
| Trigger ownership, second entity, Familiar, solo combat | 355/355 | `outputs/testing/test05-ownership-contract.json` |
| Current world/area/save fixture contracts | 80/80 | `outputs/testing/test05-remaining-fixed.json` |
| RulesLab journal / assets | 5/5 | `outputs/testing/test05-lab-current.json` |
| Versioned RulesLab / current + historical certificates | 23/23 | `outputs/testing/test05-versioned-fixtures.json` |
| Current canon/materialization/fingerprints | 39/39 | `outputs/testing/test05-canon-current.json` |
| Original worker + repeat/restart/missing/corrupt | 2/2 | `outputs/testing/test05-historical-replay.log` |
| Historical world reader + existing schema suites | 51/51 | `outputs/testing/test05-historical-migrations.json` |

Эти counts пересекаются, суммировать их как уникальное покрытие нельзя. Zero skips во всех
указанных адресных прогонах. Credential scan changed-files и `git diff --check` прошли.

Полный промежуточный default Vitest: 5733 total / 5709 passed / 23 failed / 1 skipped.
Он стартовал до последних fixture/UI исправлений и не выбирал canon/mvp из-за старого default
config; сохранён как диагностика `test05-full-current.json`, не является итоговым receipt.
Финальный прогон использует exact selection общего manifest (708 файлов на момент выбора),
`test05-extended-selection.json` → `test05-extended-final.json`: 5976 assertions, 5973 passed, 3 failed, 0 skipped. Дополнительно четыре suite-load ошибки из-за cwd-relative файлов; это failed receipt, несмотря на нулевые assertion failures этих четырёх файлов.

Все семь обнаруженных причин исправлены адресно: три library expectations перенесены на серверный page/summary контракт с сохранением DOM; три engine fixture paths и UtilityPages source/CSS paths сделаны независимыми от cwd. `test05-library-second.json`: 74/74, 0 skips (7 файлов, включая дополнительный общий loader race contract и текущие certified fixture проверки). Повтор с актуальным manifest: `test05-extended-complete-selection.json` (712 файлов) → `test05-extended-complete.json`: **6035 total, 6034 passed, 1 failed, 0 skipped**, 299 s. Единственное падение — промежуточный красный baseline `TacticalBattleMap.performance.test.tsx` во время работы владельца PERF-05; после production memoization тот же assert прошёл в его адресном наборе 35/35. Это всё ещё failed общий receipt, не зелёный. Финальный общий прогон выполняет root после стабилизации параллельных исходников.

REF-01 добавляет отдельный immutable command replay (13 cases), targeted43/43 и actual two-artifact differential18 records; см. [REF-01](REF-01.md). Эти новые тесты включены в следующий manifest inventory автоматически.

### Исторический полный Vitest после первой стабилизации исходников

`test05-extended-freeze-selection.json` → `test05-extended-freeze.json`: **6073/6073 PASS, 717 файлов, 0 failed/skip/todo, 297.2 секунды**. Это все текущие Vitest-файлы общего manifest (core + extended), с прежними явно документированными historical/manual исключениями. Никакие дополнительные файлы ради зелёного результата не исключались. Общий `verifyVitestResult` подтвердил непустое выполнение и успешность каждого из 717 выбранных файлов. Hashes 1680 файлов frontend/worker/engine/data до и после совпали; manifest также не изменился.

Краткий переносимый receipt: [TEST-05-vitest-final.json](TEST-05-vitest-final.json). Полный отчёт, exact selection и hashes сохранены в `outputs/testing/test05-extended-freeze{,-selection,-source}.json`. Это зелёный результат именно слоя Vitest; общий core/extended также требует отдельных Node, PostgreSQL/Go, worker и browser receipts, которые собирает root. Предыдущие failed отчёты сохранены как диагностика и не заменяются этим файлом.

## Незавершённые границы

- Fresh DB historical chain останавливается на migration102 без нужного исторического preimage.
  Integration schema297 не считается доказательством fresh install. Нужны versioned public
  pre-102 catalog или отдельно проверенная clean-install стратегия. Поддерживаемая full-schema
  upgrade matrix297/298/299→300 выполнена отдельно: [TEST-05-upgrade-matrix](TEST-05-upgrade-matrix.md);
  она явно импортирует schema297 и не подменяет historical fresh install.
- Linux Go race не выполнен на этой Windows-машине: Docker/WSL требует включённой виртуализации.
  Настройки ОС/BIOS не менялись. Native PostgreSQL concurrency проверки имеют отдельные receipts.
- Original-executable corpus покрывает перечисленные исторические фазы и не переписывается.
  Дополнительный current-handler слой всех15 pending variants описан отдельно:
  [TEST-05-pending-matrix](TEST-05-pending-matrix.md); это не сертификат всех прежних executable.
- Два Urvin live harness перенесены на owned context и временные seed/catalog fixtures;
  real API gate27/27 PASS с exact retries, pending/reload, victory/defeat/checkpoint и restore:
  [TEST-05-urvin](TEST-05-urvin.md). Обе quarantine сняты; gate обязателен в extended.
- Фактический native extended выполнен за 18,27 мин. Целевой бюджет20–40 минут и длительность удалённого CI не объявляются измерением этой среды.

Rollback: отменять отдельный кодовый срез с его регрессионным тестом; не возвращать безусловную
trigger dispatch или ослабленный guard. При откате dev RulesLab namespace не удалять новое/старое
локальное хранилище. Замороженные сертификаты и executable corpus не переписывать.
