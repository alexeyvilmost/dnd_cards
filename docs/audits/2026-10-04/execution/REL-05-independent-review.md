# REL-05 — независимая проверка executor и deployment journal

Проверено локально 04.10.2026. Производственный код в этой проверке не менялся:
исправления внёс владелец REL-05. Docker/TimeWeb/registry не запускались.

## Найденные проблемы и исправления

1. **P1: неполное доказательство неизменяемого каталога.** Изначальный
   `backend/migrations/release_schema_proof.go` сравнивал имя, enabled/type и тело
   функции триггера, но пропускал `WHEN`. Триггер с `WHEN(false)` имел ту же
   проверяемую идентичность и разрешал UPDATE. Независимое воспроизведение на
   PostgreSQL: `REL-05-schema-review.json`, run
   `test_25a5fb92363f9455820e7e0d`, cleanup `stopped`. Это воспроизведение исходной
   SQL-проекции, а не утверждение о полном CLI прогоне. Теперь capture включает
   условие, args/columns, deferred/transition-table параметры, характеристики
   функции, а для новых таблиц — RLS, persistence, partition/rules/policies и
   неожиданные триггеры (`release_schema_proof.go:75,85`). Владелец добавил
   отрицательные native PostgreSQL сценарии уже установленной схемы.

2. **P1: успешная expansion блокировала собственный cutover.**
   `ensureRelease()` сохранял весь `state.json` как immutable. После миграций
   добавление `database` меняло этот файл при том же releaseId, поэтому
   `observe(rollbackState)` и затем восстановление отклонялись. Теперь immutable
   application state исключает изменяемое наблюдение БД; оно хранится только в
   active/operation journal (`docker-deployment.mjs:15,53`).

3. **P1: отсутствие исполняемого writer-off условия rollback.** Строка
   `rollbackWriters:'off'` в rehearsal report не запрещала текущему приложению
   записать новый формат между проверкой oldReadersSafe и остановкой backend.
   Теперь reviewed Compose явно задаёт `DB_COMPACT_RECEIPTS=0`,
   `DB_FROZEN_CATALOGS=0`, `IMAGE_JOBS_ENABLED=0`; adapter проверяет также реальные
   `Config.Env` контейнера (`docker-deployment.mjs:19,97,116`). Это закрывает
   границу текущего additive rollout. Отдельное последующее включение writers
   требует новой политики совместимости, оно не входит в это доказательство.

4. **P2: восстановление старой завершённой операции переписывало новый active.**
   Воспроизведено C1 → C2 с теми же image digests и корректными per-instance
   identities: `recover(C1)` сохранял active=C1 поверх завершённого C2.
   Исходный результат — `REL-05-recovery-review.json`. Теперь completed operation
   может быть повторно проверена только если совпадает с текущим active; чужой
   последующий release отклоняется до мутаций (`deploy-state.mjs:170`).

## Повторная проверка

`REL-05-review-recheck.json` содержит независимые PASS для stale recovery,
сохранения нового active, неизменности application state при изменении DB
observation, отказа всех трёх enabled writers и принятия disabled writers.
В этом же процессе новые семь simulated migration journal tests владельца
завершились PASS, без skips. Это проверки настоящих pure production helpers и
локального журнала; они не заменяют container rehearsal.

Положительные границы по прочитанному коду:

- Advisory lock, чтение ledger, DDL и INSERT ledger используют одну выделенную
  connection/transaction (`release_additive.go:174,185`). Commit объединяет DDL
  и журнал. Потеря подтверждения выдаёт unknown, а повтор заново наблюдает схему.
- Already-applied и inspect-only также вызывают schema proof; inspect не
  применяет отсутствующие миграции. Неизвестные observed IDs и baseline removal
  отклоняются; новые разрешены только из embedded allowlist 298–300 с точным hash.
- CLI разбирает ограниченный JSON stdin до обычной инициализации приложения,
  запрещает неизвестные поля и связывает sourceCommit/inputFingerprint с baked
  executable identity. Ошибки соединения и DDL не публикуют DSN или raw SQL.
- Старый manifest сохраняется при возврате приложения, а расширенная DB identity
  и retained executor image остаются в journal. Новый формат receipts/catalogs
  или незавершённые image jobs не объявляются безопасными для старого читателя.

Нельзя считать этим review доказанными Docker networking, фактический OCI
health/replacement, контейнерный restart matrix или TimeWeb deployment. Native
PG matrix владельца и последующий общий gate имеют собственные receipts.
