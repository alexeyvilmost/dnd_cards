# Расширенный Go gate — восстановление актуальных тестовых контрактов

04.10.2026. Исправлены пять отказов из `TEST-03-extended-go.json`. Production
механики не ослаблены: изменения касаются fixtures/assertions и одного устаревшего
комментария runtime-команды. Чужие параллельные OBS изменения сохранены.

| Отказ | Причина | Изменение |
| --- | --- | --- |
| Unknown patch field | `equipment` уже явный канал `CharacterRuntimeCommandPatch`, проверяемый авторитетной валидацией | Негативный тест передаёт действительно неизвестный `forged_equipment`; duplicate/immutable/inventory rejection сохранены |
| Exact update support | С migration 274 механика сбрасывает support в `not_verified`, не NULL | Ожидается точный статус; усилена проверка неизменности identity/created_at/updated_at; metadata-only support и CAS retry продолжают проверяться |
| Content receipt integration | Fixture копировала старый NULL trigger и статусы до manual review, схема отсутствовала | Явный disposable bootstrap использует настоящую функцию migration 277, актуальные статусы и триггеры INSERT/UPDATE; вложенный произвольный JSON сохраняется; транзакционный rollback/receipt/CAS/retry проверки сохранены |
| OAuth integration | Изолированная таблица users не содержала is_admin, который уже использует модель/авторизация | После реальной OAuth263 применяется только реальная account268; глобальные catalog migrations не запускаются. Helpers получают текущий subtest `t`, устраняя FailNow на родителе |
| Registry sequence | Тест требовал, чтобы 280–285 всегда оставались последними миграциями, хотя уже добавлены 286–297 | Проверяются уникальность версий, наличие/непрерывность/порядок исходной dependency sequence и handlers; новые append-only миграции допустимы |

Изменённые файлы: `backend/character_runtime_command_test.go`, комментарий
`backend/character_runtime_command.go`, `backend/content_migration_controller_test.go`,
`backend/content_migration_controller_integration_test.go`,
`backend/oauth_integration_test.go`, `backend/migrations/entity_reference_registry_test.go`.

## Проверка

Через `startTestStack({dbOnly:true})` создана отдельная локальная PostgreSQL с
ownership marker. `runRequiredGo()` повторно проверяет marker/DSN перед запуском.
Только для этой БД заданы `OAUTH_TEST_DSN` и
`CONTENT_MIGRATION_TEST_BOOTSTRAP=1`. Bootstrap не разрешает частично заполненную
схему. Существующие локальные/production базы не читались и не изменялись.

Финальный run `test_9984d93efd920a9e1f3a9e8b`:

- package `.`: точные четыре названных top-level теста — **4/4 PASS**, включая все
  OAuth subtests с локальным fake provider, без настоящих OAuth/network calls;
- package `./migrations`: `TestEntityReferenceMigrationsFollowProductionCatalogMigrations`
  — **1/1 PASS**;
- skipped/failed selected tests: **0**. Owned PostgreSQL остановлена `cleanup()`.

Команды Go внутри runner: `go test . -json -count=1 -run ^(TestDecodeCharacterRuntimeCommandRejectsAmbiguousAndUnknownJSON|TestExactUpdateValidationPreservesIdentityAndServerFields|TestContentMigrationCreateReceiptRoundTripOnIsolatedPostgres|TestOAuthIntegration)$`
и `go test ./migrations -json -count=1 -run ^(TestEntityReferenceMigrationsFollowProductionCatalogMigrations)$`.

Первый run `test_8474eb2f38e28848a1d25f63` завершил assertions успешно, но Go
получил Windows `unlinkat …test.exe: Access is denied` при удалении временного
исполняемого файла. Он не считается успешным gate; финальный повтор выше вернул 0.

## DSN aliases для общего runner

Runner owner уведомлён о дополнительном списке **только per-test isolated-schema**
aliases: `ACCOUNT_ADMIN_268_TEST_DSN`, `ANIMATION_TEST_DATABASE_URL`,
`AUDIO_TEST_DATABASE_URL`, `EFFECT_CLASSIFICATION_TEST_DATABASE_URL`,
`ENTITY_REFERENCE_TEST_DATABASE_URL`, `ITEM_SOURCE_262_TEST_DSN`,
`OWNED_ITEM_265_TEST_DSN`, `PAPER_DOCUMENT_266_TEST_DSN`,
`ROGUELIKE_MIGRATION_TEST_DSN`, плюс текущие CANONICAL/CONTENT/OAUTH.
Все они должны указывать только на собственную БД текущего запуска. Старые
clone-specific переменные snapshot-drill тестов этим DSN подменять нельзя.
Runner/env/manifest в этой подзадаче не менялись. Полный повтор всех расширенных
Go tests с дополнительными aliases остаётся за общим runner; 5/5 не означает
прохождение всей расширенной матрицы.

## Полный повтор слоя Go после дополнительных исправлений

Выполнен полный проход всех Go packages с exact историческими исключениями
из `tests/suites.json`. Дополнительно явно маршрутизирован только
`TestCatalogBatchActualWorkerEquivalentForOwnedFixtures` в обязательный отдельный
`scripts/performance/check-catalog.mjs`: ему нужны API-seeded party1/2/6 и настоящий
worker. Это действующий performance gate, не исторический/отключённый тест.
Root owner оформил `dedicated_go_routes` общего manifest.

Первый полный run `test_83d301d29c49f944b20ee06b` выявил ещё неполные fixtures:

- Item source 262 вызывал настоящую установку certificate guard, не создав
  остальные таблицы каталога. Fixture теперь создаёт пустые зависимости в своей
  private schema, сохраняя все отрицательные проверки rollback/tag conflicts.
- Recommended spell choices копировал `public.spells`/`public.effects` и потому
  зависел от произвольного состояния общей БД. Теперь он читает только нужные
  колонки checked-in публичных snapshots effects/spells в private schema.
  Это реальные декларации контента, не синтез вариантов из проверяемой функции;
  повторный seed и неизменность **полных** исходных строк effects проверяются.

Точечный run `test_df47de5b0940f8a1fa60ba5d`: четыре новых отказа — 4/4 PASS.
Финальный полный run `test_2869395c337b56c6b3d189c7`: **686/686 выбранных top-level
Go tests PASS**, package backend 351, migrations 321, остальные packages 14;
0 anonymous skips/failures, все команды вернули 0, owned PostgreSQL остановлена.
Evidence: `TEST-03-extended-go-final.json` и private run log в outputs/testing.
Все aliases указывали на собственную БД, bootstrap=1 только в этом запуске.

Результат завершает DB-only Go layer. Он не заменяет отдельный performance gate,
browser/E2E, исторические snapshot drills или Docker validation.
