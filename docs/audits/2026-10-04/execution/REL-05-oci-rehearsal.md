# REL-05: реальная репетиция OCI на собственной локальной копии

2026-10-05: общий Docker collector прошёл все восемь обязательных проверок и семь сценариев additive executor. Точный машинный результат — `REL-05-oci-rehearsal.json`.

Исходный стенд использовал сохранённые реальные старые образы `4549fb3c…`, переносимый тестовый baseline схемы 297 с 302 записями ledger, ненулевые V1/V2 canaries и реальный бой с сохранённым выбором влияния на бросок. Данные синтетические; production DB не копировалась и не изменялась. Candidate собран из самостоятельного owned Git fixture `014f7208aa5ff0488ec1fe00a2aac53e7ead7f93`, а не приписан старому HEAD рабочего каталога.

Проверено настоящими контейнерами:

- восстановление свежего dump и полный inventory в одном экспортированном MVCC snapshot;
- exact-image расширение 302 → 305 ledger rows с неизменным хешем исторических полей;
- остановка candidate после DDL до ledger, откат транзакции и успешный повтор;
- повтор после потерянного acknowledgement без повторного DDL;
- общий advisory lock на той же DB connection;
- отказ при неизвестной миграции и при отключённом immutable trigger через `WHEN(false)`;
- старый backend на расширенной схеме: чтение pending и точные повторы принятых команд без изменений состояния;
- здоровье всех трёх новых OCI images, baked identity, фактическое закрепление нового artifact;
- сохранение и реальный replay старого CJS, pending choice, duplicate и continuation idempotency.

Все ресурсы collector остановлены. Финальный wrapper отдельно проверяет очистку loopback registry и результат последующей репетиции deployment adapter; этот файл не объявляет её завершённой. Receipt имеет `local-candidate-rehearsal`, `deployable:false`, `ciProvenance:null`: он не заменяет точный CI report и production authorization.

Предыдущие неуспешные попытки сохранены в owned output directories. Они выявили три ошибки проверочного контура: несвязанные MVCC snapshots, слишком раннюю Unix-socket readiness временного PostgreSQL init server и попытку читать PostgreSQL `t/f` как JSON. Исправления сохраняют исходные gates и ограничения. Последняя scalar-причина воспроизведена отдельно на настоящем owned PostgreSQL: `REL-05-pg-json-boolean.json`; targeted Node cases — 24/24 PASS, independent review PASS.
