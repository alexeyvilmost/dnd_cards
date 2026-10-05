# Кандидат выпуска: реальная репетиция и offline bundle

Реализован недостающий producer между `candidate.json` из CI и применяемым
`bundle.json`. Локально подтверждены machine/fault contracts и совместимость
каноничного API-сценария. **Фактический Docker rehearsal на этой машине не
выполнен:** Docker Desktop не может запустить daemon без виртуализации WSL.
Это не разрешение выкладки и не свидетельство успешного запуска OCI образов.

## Интерфейс доверенного хоста

```
node scripts/release/candidate-rehearsal.mjs run CANDIDATE_DIRECTORY CONFIG_JSON NEW_REHEARSAL_DIRECTORY
node scripts/release/assemble-bundle.mjs CANDIDATE_DIRECTORY REHEARSAL_DIRECTORY NEW_FINAL_DIRECTORY
```

Конфигурация: `schemaVersion:1`, digest-pinned `postgresImage`, абсолютный
`activeStateFile` и ровно одно из `captureDirectory`/`backupDirectory`.
`captureDirectory` — свежий результат `capture-host-backup.mjs`; уже готовый
`backupDirectory` обязан иметь полный действующий restore proof. Возраст
снимка ограничен 30 минутами, active manifest и все байты связаны hashes.
Пароли/ключи/DSN в конфигурацию и отчёты не передаются.

Collector пишет `input.json`, `rehearsal.json`, `verified-backup.json`. Последний
содержит абсолютный путь проверенного поколения backup для host orchestration.
Для capture collector получает inventory/schema/media refs из **восстановленного
самого dump**, затем пишет `backup.json`, `media-references.json` и только после
успеха всех проб и очистки — `restore-report.json`. Пара read-only live запросов
до/после не подменяет согласованный снимок.

Assembler сохраняет исходный `candidate.json` без изменений, добавляет в
`manifest.json` только validation evidence и создаёт `bundle.json`.
Provenance hash относится к исходному manifest кандидата. Нельзя подписать
новую комбинацию образов старым CI receipt или подменить control/source commit.

## Исполняемая граница

1. Разрешён только локальный Docker endpoint. Свежая internal network запрещает
   egress; порты не публикуются. PostgreSQL, приложения, probe-контейнеры и data/
   artifacts volumes имеют случайное имя и обязательную ownership label.
2. Dump восстанавливается только в созданный кластер. Disk gate проверяет минимум
   1 GiB и 4× compressed dump; это консервативный нижний предел, а не обещание,
   что любой большой restore уместится. Ошибка места блокирует выпуск.
3. Старые CJS копируются с проверкой hashes. Для пустой истории текущего старого
   артефакта или отсутствующего pending обычный previous API на копии создаёт
   нового синтетического пользователя, персонажа и сохранённый выбор броска.
   Production DB и чужие сохранённые бои не изменяются.
4. Если target отличается от наблюдаемой baseline, допускаются лишь reviewed
   additive 298–300. Реальные fault trials, exact candidate CLI и старый reader
   после расширения выполняет `migration-rehearsal.mjs`. Его seven-scenario
   receipt входит в общий receipt и сохраняется в bundle. Unknown/removal/
   checksum edit, неполная матрица и ошибка cleanup блокируют сборку bundle.
5. Стартуют три exact-digest образа кандидата. Проверяются живые HTTP endpoints,
   baked identities и inspect digest/running/no-public-ports. Обычный API создаёт
   новое столкновение и доказывает pin текущего candidate artifact.
6. Все группы сохранённых combat records проигрываются настоящим retained CJS
   через candidate worker runtime. Каждый исторический referenced hash и previous
   artifact обязан иметь непустое подтверждённое исполнение. Если старый hash
   остался лишь в ссылке без replay records, выпуск блокируется: произвольный
   внешний «passed report» или выдуманный corpus не принимается.
7. Held pending читается без изменения полного run/characters/receipts/events.
   Принятая команда повторяется дважды с тем же полным ответом и инвариантами;
   обычное продолжение выбора и его повтор также проверяются. Ни RNG, ни
   сохранённые исходы не подправляются тестом.
8. Ошибка любого этапа сохраняет failed receipt. Все owned контейнеры, в том
   числе короткие probes, удаляются с повторной проверкой label. Secret env files
   удаляются. Passing receipt допустим только после `cleanup.status=stopped`.
   Смена ownership запрещает удаление и делает cleanup неуспешным.

Финальный validator обязательно связывает реальный health/current artifact,
историю, pending/duplicate hashes и cleanup с image/pinned gate reports.
Симуляция с подставленным command runner имеет `execution:simulation` и не
может стать deployment bundle.

## Проверки, которые действительно выполнены

- Восемь release test files: **65/65 PASS, 0 skip**, включая stage faults,
  additive assembler, changed ownership, cleanup error, чужой кандидат, неполную
  историю и испорченные receipts. Лог: `outputs/testing/candidate-rehearsal-unit.log`.
- Native owned API helper: `test_5b778b8f3b672ecfc1f9f992`, **6/6 PASS**,
  `cleanup:stopped`. Регистрация/login, canonical archer copy, trusted initialize,
  held roll, реальный SQL receipt decoder, принятый retry×2, continuation/retry.
  Receipt: `outputs/testing/runs/test_5b778b8f3b672ecfc1f9f992/rehearsal-scenario-native.json`.
- До этого узкие попытки нашли missing register display_name и неверный preset
  selector. Исправлен только helper; не менялись production rules и assertions.
  Failed local run logs сохранены, оба кластера остановлены.
- Владелец migration executor отдельно подтвердил настоящие PG lock/connection
  termination/DDL+ledger contracts: `test_c8693b4954573d9500ff9484`, 8 top-level
  и 10 subcases PASS. Это дополняет, но не заменяет exact OCI fault rehearsal.

Новый запуск общего core выполняет root после source freeze. Source files и
hashes, локальные receipts и границы собраны в
[REL-05-candidate-rehearsal.json](REL-05-candidate-rehearsal.json).

После первого общего preflight дополнительно ужесточён shared scenario helper:
он принимает только непрозрачную process-local capability. Native factory
проверяет ready registry/DSN и DB ownership marker; Docker factory прямо читает
реальный local daemon, labels, internal network, отсутствие public ports и
effective clone DSN. Проверка повторяется перед HTTP запросами. Произвольный
HTTP callback, сериализованный proof и lookalike object отвергаются до сети.
Scanner исключение ограничено ровно этим файлом и обязательными guard fragments;
удаление любого guard снова вызывает отказ. Guards/scanner/lifecycle: 14/14 PASS.

`scripts/performance/check-rehearsal-scenario.mjs` экспортирует shared-stack
gate `checkRehearsalScenario`: обязательны ровно шесть scenario checks, четыре
hashes и тот же native run ID. Он не создаёт/не собирает второй стенд. Проверка
receipt и отрицательные helper/collector/lifecycle сценарии: 11/11 PASS.
Positive API proof после введения capability должен быть повторён этим gate
в общем extended run; прежний native receipt не выдаётся за проверку новой
authorization boundary.

## Остаточные границы

Нужна первая фактическая репетиция на доверенном Docker host с exact images и
свежим capture. Проверяется HTTP здоровье и API текущего кандидата; отдельный
браузерный запуск внутри OCI этим collector не заявляется. Media proof охватывает
ссылки из snapshot, не доступность удалённых object bytes. История передаётся
в приватный worker процесс с лимитом stdout 128 MiB; превышение блокирует пробу,
а не обрезает доказательство до «зелёного». Live refs повторно проверяет deployment
adapter перед cutover; новые неотрепетированные артефакты требуют новой попытки.

Откат producer — убрать его wiring целиком, оставив fail-closed deployment gate.
Нельзя заменить обязательный rehearsal фиктивным passed JSON или отключить
history/cleanup требования для ускорения выкатки.
