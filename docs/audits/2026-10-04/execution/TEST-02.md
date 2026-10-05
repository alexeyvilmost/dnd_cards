# TEST-02 — граница исполняемых правил

Статус: выполнено локально 04.10.2026. Коммит, push и deployment не выполнялись.
Изменения относятся к зависимостям и проверкам; игровые декларации не менялись.
`worker/build.mjs` оставлен в состоянии REL-01 без правок этой задачи.

## Исходное состояние

Исходный адресный набор воспроизведён: **26 passed / 1 failed**, упал
`rules-core/importBoundary.test.ts` на 17 модулях. Лог:
[TEST-02-before.log](TEST-02-before.log). Старый regexp смешивал runtime-импорты
с активными type-only контрактами MVP.

| Модуль в `frontend/src/rules-core` | Runtime import declarations | Type-only declarations |
| --- | ---: | ---: |
| activeSlotRecovery.ts | 0 | 1 |
| attackActionBudget.ts | 3 | 0 |
| attackRedirection.ts | 2 | 1 |
| bondLifecycle.ts | 1 | 0 |
| conditionsRuntime.ts | 1 | 0 |
| damageTransfer.ts | 0 | 1 |
| deathRecovery.ts | 6 | 0 |
| effectReceived.ts | 2 | 1 |
| equipmentChange.ts | 4 | 1 |
| generalFeatDamageRuntime.ts | 1 | 0 |
| generalFeatReactionRuntime.ts | 1 | 0 |
| handler.ts | 14 | 0 |
| itemWeaponLifecycle.ts | 3 | 0 |
| magicSuppression.ts | 3 | 0 |
| projectileReflection.ts | 3 | 1 |
| recipientBindings.ts | 3 | 1 |
| worldMigration.ts | 1 | 0 |

[TEST-02-import-map.json](TEST-02-import-map.json) содержит **56 записей**:
файл и исходную строку, specifier, импортируемые символы и локальные alias,
type-only признак, решение по переносу и фактический исполнитель. Дополнительная
запись `domain.ts` была разрешена старым тестом и явно не входит в исходные 17.
Сырой первый снимок: [TEST-02-imports-before.json](TEST-02-imports-before.json).

До правок из исходного runtime собран отдельный baseline, сохранённый в
`tmp/test-02/before-artifact.cjs`. Его metafile выявил два runtime-цикла:

1. `engine/modifiers.ts` ↔ `engine/senses.ts`.
2. `character/itemFeatProjection.ts` → `engine/actionRequirements.ts` →
   `engine/actionGrantContext.ts` → `engine/runtimeCharacterProjection.ts` →
   `character/itemFeatProjection.ts`.

Снимок: [TEST-02-cycles-before.json](TEST-02-cycles-before.json). Type-only
ссылки в эти циклы не включены: использован фактический граф esbuild.

## Изменения

Разрешённое направление зависимостей и сохранение artifact pinning описаны в
[rules-runtime-boundary.md](../../../rules-runtime-boundary.md), ссылка добавлена
в `docs/data-driven-rules.md`.

- Четыре небольшие операции перенесены в `frontend/src/rules-primitives`:
  `mechanicsView`, `effectRollFacts`, `sensePerception`, `runtimeActionGrants`.
  Реализации сохранены; старые публичные пути `engine` реэкспортируют их.
  Разделение восприятия/модификаторов и гранта/проекции устранило оба цикла.
- Stateful-операции и существующие политики доступны core через именованные
  экспорты `legacy/engineAdapter.ts`. Нет wildcard-экспортов и allowlist на
  17 модулей. Адаптер не создаёт новую реализацию механик.
- Явные `import type` из действующего `mvp/contracts` разрешены; runtime-доступ
  core/примитивов к MVP запрещён. `activeSlotRecovery.ts` и `damageTransfer.ts`
  не требовали runtime-переноса и не изменялись.
- Проверка AST распознаёт import/re-export/dynamic import/require, включая
  вычисляемые пути и wildcard-доступ адаптера. Esbuild проверяет транзитивный
  граф всех production-файлов core/примитивов, UI/HTTP/storage-зависимости,
  браузерные вызовы, файловые/сетевые Node-модули и runtime-циклы. Примитиву
  нельзя вернуться в engine/core через промежуточный общий helper.
- Отрицательные временные fixtures проверяют direct bypass, transitive API,
  `node:fs`, `localStorage`, реальный цикл и скрытую orchestration-зависимость.
  Положительный fixture подтверждает допустимость взаимных type-only ссылок.
  Production-выбор поведения по literal entity UUID остаётся запрещён.
- Новый integration-тест грантов использует две сущности с разными reference,
  порогами уровня и сохранёнными бонусами; проверяет reload, отсутствие RNG,
  отказ низкому уровню/невыданному/истёкшему гранту. Существующие тесты второй
  сущности для effect facts, предметных грантов и recipient bindings сохранены.

## Проверки и точные результаты

Команды запускались из `frontend` локальным Node:
`C:/Users/alexe/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`.
Ниже `node` обозначает этот исполняемый файл; это те же команды из npm-скриптов,
без зависимости от наличия npm в PATH.

| Проверка | Результат | Свидетельство |
| --- | --- | --- |
| Исходные 5 адресных файлов после расширения boundary-теста | 29/29, 2.97 s | [TEST-02-after.log](TEST-02-after.log) |
| Фокус на вынесенных операциях, двух сущностях и reload | 17/17, 2.88 s | [TEST-02-primitives.log](TEST-02-primitives.log) |
| Финальный объединённый прогон после всех test-правок | 10 файлов, 46/46, 5.38 s | [TEST-02-final.log](TEST-02-final.log) |
| Production TS `tsc --noEmit` | exit 0, ошибок нет | [TEST-02-typecheck.log](TEST-02-typecheck.log), пустой успешный вывод |
| Свежая сборка worker + server/replay | 5/5, 2.445 s | [TEST-02-worker.log](TEST-02-worker.log) |
| Baseline ↔ candidate executable differential | 18/18 equivalent | [TEST-02-differential.json](TEST-02-differential.json) |
| Worker metafile | 267 inputs, 0 циклов, 0 запрещённых путей, все 4 общих примитива, 0 test helpers | [TEST-02-graph-after.json](TEST-02-graph-after.json) |
| `git diff --check` по scope | exit 0 | Изменённые короткие CRLF-файлы нормализованы в LF |

Финальные команды:

```text
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run src/rules-core/importBoundary.test.ts src/engine/rollInfluence.test.ts src/engine/conditionActions.test.ts src/character/sheetEquipmentCommit.test.ts src/character/useSheetEquipmentSave.test.tsx src/engine/senses.test.ts src/engine/effectRollFacts.test.ts src/character/itemFeatProjection.test.ts src/rules-core/recipientBindings.integration.test.ts src/rules-primitives/runtimeActionGrants.integration.test.ts --reporter=dot
node worker/build.mjs
node --test worker/server.test.mjs worker/replay.test.mjs
node scripts/check-rules-artifact-equivalence.mjs ../tmp/test-02/before-artifact.cjs worker/dist/artifact.cjs
```

Исходный SHA256:
`284c13adbbbeee740805f495ec1be6e82f33dbea092bbdf04abc098bce25a636`.
Новый SHA256:
`97e8d25465ba0ad7411f12fef7bab5f178bd4a123b1f26a92b257a9ea9d3b4b8`.

Differential использует два отдельных настоящих executable и существующий
`pinnedFighter.fixture.json`. Для двух seeded вариантов сравниваются init,
три хода с ответными действиями врага, сохранённая/перезагруженная проверка до
влияния и её подтверждение, короткий отдых, healing hazard с разными костями и
отказ неизвестной операции. Проверяется реальное восстановление HP от отдыха
и hazard. Точная повторная отправка сохранённого входа не меняет результат;
у journey сохраняется command ID и исходная кость. Полные ответы сравниваются
deep equality, включая state/events/порядок/RNG/pending/resources/breakdowns.
Нормализуется **только поле физической идентичности `artifactHash`**.

Worker replay отдельно проходит настоящие HTTP-переходы, RNG/revisions,
restart сохранённого journey-решения и игнорирование поддельного runtime в rest.
Два server contract теста используют намеренно минимальные временные artifacts
для авторизации/ошибок; они не выдаются за проверку всех механик. Ни один тест
не переписывает production-историю; архивирование worker проверяется во временном
каталоге. Baseline-файл сохранил исходный hash.

## Ограничения и продолжение

Полный исторический suite, browser E2E, production и реальная БД в этой задаче
не запускались. 18 differential-записей — ограниченный corpus, а не перебор
каталога, всей группы или всех механик перенесённых примитивов. Проверка
детерминированного retry worker не заменяет проверку атомарной DB receipt и
транзакций; это отдельные задачи реального стенда. Проверка AST/графа — защита
архитектуры для статически анализируемых путей, не security sandbox произвольного
JavaScript. Действующий engine и MVP types не объявлены удалёнными.

Новый bundle с другим hash собран только локально. Исторические artifacts,
записи боёв и pinning не изменялись; автоматического repin нет. Откат состоит
в возврате соответствующей группы импортов вместе с её shared-примитивом и
совместимыми реэкспортами; данные боёв откатывать не требуется.

Для OBS-01/DB-01 разумно переиспользовать локальный target/auth-контекст из
`scripts/testing/acceptance-context.mjs`, создание личного персонажа/забега из
`scripts/roguelike/templates-local-acceptance.mjs` и настоящие API-команды из
`frontend/e2e-live/real-backend-canary.spec.ts`. `pinnedFighter` полезен для
seeded worker differential, но сам по себе не создаёт реальные DB receipts и
не является драйвером замеров 100/1000 серверных команд. Новая задача не начата.
