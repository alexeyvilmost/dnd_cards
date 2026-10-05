# REL-05: короткая проверка схемы при legacy adoption

В `observe`, `prepare` и сверке исходной схемы перед миграцией больше не выполняется повторный полный обход JSON ответов и истории. Эти границы проверяют фактическую привязку к БД, журнал миграций и исходный отпечаток структуры через общий `databaseSchemaLedgerProof`. Проекция структуры, порядок и исключения полностью совпадают с прежним полным inventory; historical baseline не переписан.

Helper возвращает только `scope: schema-and-ledger`, migration IDs и schema fingerprint. Он не подтверждает полноту артефактов или медиа. Полный typed inventory, сохранение source certification и CJS по-прежнему обязательны при capture/restore и в `assertHistoricalInventory` непосредственно перед cutover. Expanded-schema inspection по-прежнему выполняет exact candidate CLI. Срок backup 30 минут и требования к реальному restore proof не изменены.

Проверки:

- 57 адресных Node cases: metadata scope, невалидный ответ, смена схемы/ledger, imported read-only snapshot, очистка при ошибке, прежние binding/recovery/migration gates.
- Два реальных native PostgreSQL теста: полный bounded scanner и typed source references; metadata fingerprint совпал с полным inventory, reference-only изменение не было ошибочно объявлено проверенным, DDL и неизвестная строка ledger изменили соответствующее доказательство. Оба стенда остановлены.
- На owned Docker PostgreSQL прежняя observation `541911e0…` и все 302 IDs совпали с одним новым SQL запросом.
- Root отдельно выполнил строго read-only запрос на production: 505.462269 мс, прежний отпечаток `6d00949d…` и все 302 IDs совпали. Это измерение metadata query, не времени полной выкатки. Предыдущий полный inventory занимал около 490 секунд; его необходимые границы сохранены.

Независимый review узкого разделения PASS. Последующая Linux OCI репетиция проверяет интеграцию с реальными контейнерами; её результат хранится отдельно.
