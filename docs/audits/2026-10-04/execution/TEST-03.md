# TEST-03 — единый runner

Статус: fresh core-5 и extended-3 приняты локально на одном полном source snapshot. CI подготовлен, удалённо не запускался. Более ранние результаты ниже сохранены как история проверки.

## Последний основной набор

`outputs/testing/final-core-5/report.json`: **504/504 PASS**, 268898 мс, без пропусков. Слои: 162 Node, 227 Vitest, 12 worker/DB Node, 81 backend Go, 10 migration Go и 12 реальных браузерных сценариев. Отдельно прошли настоящая API-цепочка, свежие сборки, проверка исходников и завершение стенда без ошибок очистки.

4313 входных файлов оставались неизменными; SHA-256 `9006ebdf46d135173693de59024649515d0706e4f2c2fc5eba540ef7df16aabb`. Worker artifact `baecf7238e60633604dc8028ca89d33a1f96383c1db92326c86680e696aae528`. Это native Windows/PostgreSQL проверка; Linux race и OCI этим результатом не подтверждаются. В инвентарь включены все 26 настоящих исходников rules-core/coverage; исключаются только верхнеуровневые каталоги generated coverage. Старые hashes не пересчитаны задним числом.

S05 теперь раздельно проверяет попадание и промах при движении. Они воспроизводятся декларациями синтетических сущностей до инициализации, через настоящий executor/RNG/UI, а не подменой сохранённого боя. Усиление теста обнаружило и закрыло потерю объявленного исхода после реакции; источник сохраняется в самом броске. [Адресная проверка и границы](TEST-04-movement.md).

Реализованы `tests/suites.json`, `scripts/testing/suites.mjs`, `run.mjs`, точный Vitest selection config, npm scripts и общие wrappers. Новый CI больше не использует отдельный фиксированный список тестов и внешние production browser probes. Наборы не обходят required DB/skip checks. Документация: `docs/testing-suites.md`.

## Итоговый расширенный набор

Свежий extended-3: **7586 численно учтённых проверок PASS**, 1095961 мс (18,27 мин). Слои: 559 Node, 6196 Vitest, 17 worker/DB Node, 737 Go, 12 real E2E. Production UI fixtures и 3D, фазовое завершение процесса, upgrade matrix, candidate rehearsal, каталоги/кеш/экипировка/инициатива, mirrors, PWA и Urvin также прошли как обязательные gates. Полный список и отдельные counts находятся в переносимом receipt; суммировать их с core как уникальные тесты нельзя.

[Core receipt](TEST-03-final-core.json), [extended receipt](TEST-03-final-extended.json), [одинаковые hashes и границы приёмки](final-verification.json). Оба запуска использовали новые UI сборки; no fail/skip/retry в обязательных группах, source stability и cleanup приняты. Native результат не заменяет OCI, Linux race или historical fresh install.

## История промежуточных проверок

- 20/20 unit contracts выбора/изоляции PASS: отсутствующий файл, пустой selector, docs-only, unknown/shared input, явный legacy ID, skipped Vitest/Node, skipped child Go при parent PASS.
- Первый полный core остановился на старом ожидании 503 в `TestCharacterTemplateRoutesAuthorizationAndCopies`. Проверено текущее production поведение: пустой legacy allowlist при настроенной БД оставляет authority у account grants. Тест исправлен на 403 для обычного аккаунта и дополнен 201 после настоящего DB admin grant; production authorization не менялась. Отдельный обязательный PG test PASS.
- Второй полный core: PASS за 178503 ms, свежая UI/worker/backend сборка. 64 Node + 125 Vitest + 5 worker + 53 backend Go + 2 migration Go = 249 тестов, 0 skipped; отдельно реальный API smoke двух пресетов с initialize/retry/reload. `outputs/testing/suites/1791127350346-67f3822d-0c7e-4fca-b6c2-86fa8296dc5e/report.json`, owned run `test_4b89297d0c87f7bdf466a44f`. Teardown stopped, cleanupErrors пуст.
- CI YAML parsed; diff whitespace check PASS до последних документационных изменений. Не утверждается работа GitHub/TimeWeb.

На этом промежуточном этапе оставалось завершить extended, интегрировать browser слой TEST-04 без второй сборки и проверить полный aggregate после параллельных изменений. Эти пункты теперь закрыты итоговым прогоном выше. Для 35 snapshot-specific Go cases сохранены точные имена/причины и статические sibling tests; исторический fresh-install долг описан в TEST-05.

Первый expanded Node запуск обнаружил два старых Urvin harness: угадывают localhost:3001 и сохраняют/читают access.json. Подключение закончилось ECONNREFUSED, успешных API writes не было. Оба теперь fail-closed до чтения credentials/network, assertions сохранены; точный карантин в manifest и отдельный тест раннего отказа. Перенос owned fixtures — TEST-05. Второй expanded Node: 396/397 PASS, одна устаревшая проверка frontend SOURCE_COMMIT одновременно с REL-03; исправляется владельцем REL-03 без возврата подменяемой build identity. Расширенный Vitest запущен отдельно для выявления остальных регрессий.

## История: продолжение проверки

- Expanded Vitest: 6004 assertions, 5850 passed, 114 failed, 40 skipped. Полный список в `TEST-03-extended-vitest.json`. 40 пропущенных являются точными env-gated/live источниками и вынесены в явный недоступный ordinary tiers профиль; локальные compiler tests со словом live в имени остаются обязательными.
- Исходный commit проверен в отдельном tracked-source snapshot с тем же локальным исходником PHB. В семи выбранных suites 44 failed case names полностью совпали с текущими: `TEST-03-baseline-comparison.json`. Это доказательство для этих 44, не всех отказов. Поздняя проверка установила: оба исходника PHB уже tracked в baseline; первоначальная ошибка локального snapshot была вызвана извлечением Unicode-пути. TEST-05 нормализует только CRLF/LF при вычислении fixture, не меняя исторические сертификаты.
- 24 теста окна бросков/настроек звука прошли после явной фиксации режима броска в fixture и проверки текущего переключателя звука. Исправлена реальная ошибка режима отображения эффектов: `ActiveEffectCard` использует настройку effects, вложенные лист/бой больше не навязывают icon. 18 связанных проверок прошли, полный TypeScript check PASS. Новые контракты каноничного отображения и ручной авторизации эффектов добавлены в core.
- Полный DB-only Go extended после исправления самостоятельных fixtures: **686/686 PASS, 0 skips**, owned `test_2869395c337b56c6b3d189c7`, cleanup stopped. `TEST-03-extended-go-final.json`. Оставшиеся historical cases перечислены точно. Новый PERF-01 differential case отдельно маршрутизируется manifest в обязательный gate полного стека; не относится к legacy.
- Общий runner подключает все текущие `e2e-local` файлы к `local-browser-flows` на уже построенном стеке. JSON verifier отвергает skipped, retried, expected-failure, отсутствующий файл и пустой набор. Слой прежних UI fixtures получает отдельный static host без API upstream и сетевой allowlist proxy; production и dev-only 3D профили обязательны в extended. На этом этапе они ещё проверялись; итоговые 48/48 и 8/8 PASS включены в extended-3.
