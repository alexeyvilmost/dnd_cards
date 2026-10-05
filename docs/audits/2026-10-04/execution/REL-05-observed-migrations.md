# Переход с наблюдённого legacy ledger

Действующий baseline `outputs/operations/legacy-inspection-20261005/baseline.json`
снят root только чтением. Его observation hash:
`sha256:ec0f3c91221acf1c53fab653017db491cc8733c5b4810d55a99ca905bd1e2a3d`.
Все 302 ID совпадают с ledger переносимой проверенной схемы297. Это совпадение
ID, а не доказательство исходных SQL или выполнения исторической цепочки.

Исторические строки manifest имеют `kind: observed-id-only` и этот observation
hash. Для новых298–300 используются точные SHA256 встроенных исходников.
Четыре исторических ID, отсутствующие в исполняемом реестре, разрешены только
как ранее наблюдённые записи; исполнитель их не запускает и не удаляет:

- `011_add_detailed_description_formatting`
- `096_register_micro_mvp_rules_release`
- `097_repair_micro_mvp_rules_release_identity`
- `098_repair_magic_initiate_2024`

Целевой ledger содержит305ID. Следующий обычный релиз сохраняет ту же
наблюдённую идентичность. Изменение observation hash, неизвестный ID, добавление
ранее не наблюдавшегося retired ID и выдуманный historical checksum отклоняются.
Метаданные `--migration-info` разделяют исполняемые `versions` и поддерживаемые
`retiredObservedMigrationIds`; оба Docker caller используют общий валидатор.

## Локальное доказательство

- Полная импортированная схема297 с ненулевыми канарейками:
  `test_de4a2eb8973ce3031bdb8406/observed-baseline-go.jsonl`, PASS,
  cleanup stopped. Проверены first apply, rollback транзакции до ledger,
  повтор после потерянного ответа, обычный следующий release, точные старые
  column/ledger bytes и прежние schema objects.
- Адресные additive tests:
  `test_934d128e16312c2a366cdca3/observed-migrations-go.jsonl`,
  33 события PASS включая итог пакета, без FAIL/SKIP, cleanup stopped.
- Эти запуски предшествуют расширению read-only metadata
  `retiredObservedMigrationIds`. Последующий `TestMigrationInfoCommand` прошёл;
  общий JS helper и оба OCI caller различают executable registry и только
  наблюдённые до обновления retired IDs. Независимый review подтвердил контракт.

Повторяемый entrypoint: `node scripts/testing/check-observed-baseline.mjs`.
Он создаёт отдельную принадлежащую runner БД и никогда не использует production
DSN. `TestSupportedObservedLegacyBaseline` требует dedicated route, не общий
пакетный запуск на произвольном test database.

Полный OCI legacy→candidate rehearsal и production adoption здесь не заявлены.
Ранее отсутствовавший `04678a04…` оказался семантическим hash исторического
source release, а не CJS. Exact certification/source bytes восстановлены из Git
и проверены отдельно. Typed inventory сохраняет этот provenance, не подменяет им
исполняемый файл и не переписывает исходное наблюдение с 19 hashes. См.
`REL-05-typed-reference-inventory.json`. Полная репетиция OCI проходит отдельно.
