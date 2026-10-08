# Удаление поддержки и таблиц персонажей V1/V2

Актуальные персонажи V3, личные инвентари, листы и история боёв сохраняются.
SQL `302_retire_legacy_characters` отсутствует в обычном startup registry.
Данные старых поколений сначала сохраняются в проверяемый архив строк;
обычная выкатка и запуск приложения не выполняют их удаление.

## Подготовка

1. Завершить текущую выкатку и независимо проверить её manifest, образы,
   работающие сервисы и зарегистрированную схему. Пока имеется незавершённая
   операция, удаление не запускается.
2. Создать свежий защищённый capture текущего установленного состава.
   Сохранить весь `capture.json`, исходный `active.json`, dump, CJS и сертификаты.
   Восстановить копию только на отдельном локальном стенде. Продовую БД
   не восстанавливать.
3. Сохранить архив `characters`, `characters_v2`, старых инвентарей и их
   предметов; проверить восстановление всех архивных строк и отпечатки
   остальных таблиц. Выполнить SQL и повтор той же команды на копии.
4. Проверить на этой схеме реальные опубликованные образы прежней и
   установленной версии, затем возврат прежней версии. Обязательны 11
   каноничных reader checks, браузерные сценарии всех трёх запусков и
   воспроизведение полной истории обоими readers. Исходные журналы миграций,
   pending/reload/retry и очищенный стенд входят в доказательства.
5. Собрать `local-retirement-artifact-bundle` версии **4** с `capturedActive`
   и `capture`. Снимок установленной версии отличается от её прежнего
   rollback manifest. Старые bundles 1–3 остаются локальными доказательствами
   и не подходят для выполнения на сервере. `productionReady:false` у
   локального профиля не меняется.
   Для проверки опубликованных readers использовать `retirementRehearsalInput`:
   он сохраняет исходные capture/backup текущего installed candidate и отдельно
   настоящий rollback state. Обычный `rehearsalInput` остаётся контрактом снимка
   до выкатки и не принимает такой диагностический пакет. Новый input проверяет
   одинаковые migration identities/schema proof и не является разрешением SQL.
6. Передать защищённый пакет в отдельный каталог
   `DEPLOY_ROOT/retirements/retirement302-...` с правами 0700, файлы — 0600.
   В пакет включить `request.json` и `approval.json`; полный capture оставить
   в `DEPLOY_ROOT/backups/capture-...`. Не создавать дополнительные независимые
   копии dump без необходимости; проверяемый hard link допустим.

Запрос имеет существующий контракт `execute-character-retirement-302`:
точный `releaseId`, прежний `migrationSet`, SQL hash, прежний schema proof,
backup/archive/reader hashes, отпечатки старых строк и baked source/fingerprint
установленного backend. `approval.json` содержит только:

```json
{
  "schemaVersion": 1,
  "kind": "character-retirement-302-approval",
  "activeHash": "sha256:<hash current active>",
  "bundleHash": "sha256:<hash original bundle bytes>",
  "captureHash": "sha256:<hash original capture bytes>",
  "executorManifestHash": "sha256:<canonical manifest hash>",
  "requestHash": "sha256:<canonical request hash>",
  "automaticMigration": false
}
```

Хеши JSON состояния, запроса и manifest вычисляются каноничным `evidenceHash`;
хеши файлов bundle/capture/dump — по исходным байтам. Пересериализация исходного
capture или замена неизвестного артефакта текущим недопустима. У snapshot,
archive и reader reports должны совпасть actual source bindings. Время capture
на момент проверки ограничено 30 минутами; его дата не обновляется.

## Явный запуск

После разрешения владельца на удаление старых поколений отдельная политика
должна содержать `characterRetirementEnabled:true` и
`automaticCharacterRetirement:false`, сохраняя обычные host deployment guards.
Команда требует Linux и `DEPLOY_PRODUCTION_ENABLED=true`:

```text
node scripts/release/retirement-host.mjs apply --production HOST_CONFIG POLICY PRIVATE_RETIREMENT_DIRECTORY CAPTURE_DIRECTORY
```

Точка запуска использует каноничные `createDockerDeploymentAdapter`,
`verifyLocalRetirementArtifacts`, `verifyBackup` и `executeRetirement`.
Отдельный verifier связывает их результаты с текущим installed state и
approval; изменённый baseline, неподходящие права, ссылки, неизвестные поля,
другой dump/образ или устаревший capture останавливают выполнение до SQL.

Контроллер сохраняет исходный intent и неопределённость **до** dispatch.
Потеря ответа требует read-only reconciliation той же команды; другой запрос
не заменяет intent. Успешный повтор проверяет журнал и текущие приложения,
не выполняет SQL снова. БД, приложение и схема не откатываются по тайм-ауту.

## После выполнения

- Независимо проверить журнал, ledger/schema proof, отсутствие старых таблиц,
  здоровье и прежние identities приложений. Состав приложений не меняется.
- Сохранить архив старых строк и оригинальные hashes запросов/доказательств.
  Применить согласованное хранение двух полных резервных копий отдельно от
  очистки промежуточных копий; сначала проверить сохранённые копии на ПК.
- Через `retirement-projection.mjs` опубликовать реальный recorded-only
  artifact с фактическим GitHub context. Не дописывать его в старый immutable
  artifact и не придумывать workflow/run ID.
- Подготовить следующий build baseline через `retirement-build-baseline.mjs`:
  учитываются все прежние migrations и отдельно установленная 302. Изменение
  конфигурации проходит обычный commit/CI. До получения нового full anchor
  не объявлять прежний anchor доказательством неизменённой БД.

## Проверки

`retirement-production-artifacts.test.mjs` включён в обычный suite manifest.
Он проверяет binding запросов, источников, давности, архивных отпечатков и
browser/history evidence; смежные controller/command tests проверяют crash,
конкурентный dispatch и reconciliation. Unit fixtures не являются реальным
SQL, backup либо production acceptance. Нужен также свежий owned snapshot
с настоящими опубликованными приложениями и запуск полного host controller.
