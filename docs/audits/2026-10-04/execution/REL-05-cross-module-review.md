# Финальный review цепочки CI → выпуск → применение

Review выполняется чтением исходников, без внешних запросов, Docker, сборки или
дополнительного стенда. Последующие исправления владельцев отмечаются отдельными
receipts; статический review не заменяет фактический OCI rehearsal.

## Блокирующие находки

1. Первоначальный `docker-deployment.mjs`, функции `migrationCommand`,
   `assertDatabase`, `assertHistoricalInventory`: executor/psql использовали
   `config.appEnvFile`, тогда как capture был привязан к effective DATABASE_URL
   действующего backend. Воспроизводимая конфигурация: backend подключён к A;
   app.env заранее изменён на B с одинаковыми ledger/schema или worker.env
   переопределяет DATABASE_URL. Capture/rehearsal относятся к A, migration — к B.
   Владелец ввёл общий `database-binding.mjs`, hash-bound `source-binding.json`,
   inspect effective DSN, child environment вместо повторного чтения app.env и
   приватный checked Compose snapshot. Первичная binding matrix: 9 PASS по отчёту
   владельца. Основная обнаруженная рассинхронизация закрыта в исходниках.
2. Повторный review этой правки обнаружил новый rollback blocker:
   `assertLiveDatabase` требует работающий backend перед DB probe и replacement.
   Если candidate backend после `up --wait` остановился или отсутствует, old
   container уже заменён. Rollback не может проверить БД и восстановить old
   backend, поскольку не получает running DSN. Передан владельцу сценарий
   mock: после первого binding `ps status=running` возвращает пусто; вызов
   `assertDatabase`/`replace('backend', previous)` отвергается до восстановления.
   Нужен fallback только к проверенной private runtime configuration и captured
   DB identity с сохранением schema/writer-off guards. Владелец расширил inspect
   на stopped контейнеры и реализовал bounded `allowRecovery(operation)` для
   missing backend после зафиксированного touched backend. State machine
   вызывает его после проверки принадлежности незавершённой операции active
   release. Fallback получает DSN из сохранённого private checked runtime JSON,
   проверяет image, launch identity, captured DB identity и выключенные writers.
   Чужой или неоднозначный контейнер не открывает fallback.
3. Настоящий `docker compose config --format json` уже экранирует literal `$`
   для повторного чтения Compose. Повторное экранирование checked snapshot
   изменяло пароль. Это обнаружил владелец отдельной CLI-проверкой без daemon:
   сравнение декодирует `$$` один раз, а сохраняемый JSON остаётся исходным
   resolved document. Проверка повторного разбора CLI показала сохранение
   исходного значения, в том числе сочетания одиночных и двойных `$`.

Независимый адресный повтор после последней правки: **24/24 PASS, 0 skip**
(`docker-deployment.test.mjs` и `deploy-state.test.mjs`). Лог:
`outputs/testing/release-binding-independent-review-final.log`. Он включает
отказ при изменении app/worker environment, привязку DB probes к effective DSN,
сохранение literal `$`, stopped candidate и missing candidate после начатой
замены. Эти unit-проверки моделируют Docker boundary; CLI config-only проверка
не запускала контейнеры. Реальный OCI rehearsal остаётся невыполненным из-за
недоступного Docker daemon и не заменяется этим результатом.

## Проверенные связи без новой находки

- CI source report содержит exact candidate SHA, clean checkout и неизменившийся
  source snapshot. Release plan проверяет ancestor main и source/control SHA
  различаются явно.
- Publish привязан к release run ID/control commit; provenance исходного
  candidate manifest сохраняется при добавлении итогового validation evidence.
- Handoff сверяет verified release run и неизменность application composition;
  assembler не меняет образы и source identities.
- Prepared host config заменяет backupDirectory на новое capture-поколение;
  deploy workflow передаёт именно generated config после rehearsal.
- Additive 298–300 report привязан к candidate source/input fingerprint,
  фактической baseline/target, семи fault scenarios и общему rehearsal receipt.
- Registry pull access указан как обязательная настройка доверенного хоста;
  наличие packages:read само по себе не считается настройкой Docker.

Отдельные source-hygiene и typed image error проблемы исправлены локально и
покрыты адресными тестами. Они не являются положительным OCI proof.
