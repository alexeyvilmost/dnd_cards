# DB-01 — независимые повторяемые серии

05.10.2026. Две отдельные БД восстановлены из одного frozen snapshot уже инициализированного боя. Один backend binary и один pinned CJS скопированы/проверены по SHA-256. После инициализации состояние, seed, RNG и прежние receipts не изменялись. NPC получил нулевой урон в данных действий до initialization; остальные броски и команды настоящие.

Обе серии завершили1000 legal commands и1000 точных HTTP повторов. Сохранённые envelope+catalog+catalog reference полностью совпали на100 и1000 командах, включая RNG, очереди, историю и processed command IDs. Повторяемость100 проверена на независимых префиксах двух1000-command серий; дополнительный отдельный smoke2×100 также PASS. Все3 стенда завершили cleanup без ошибок.

[Машинное свидетельство](DB-01-seeded-series.json) содержит exact hashes, logical bytes, SQL/lock timing, WAL и source paths.

| Серия | Команд | Рост БД, B | Рост receipts table+index, B |
|---|---:|---:|---:|
| 1 | 100 | 36528128 | 16605184 |
| 1 | 1000 | 455532544 | 333594624 |
| 2 | 100 | 36528128 | 16605184 |
| 2 | 1000 | 471711744 | 333594624 |

На1000 командах логический JSON ответов вырос на794003252 и794003280 B; разница28 B относится к реальным operational timestamp представлениям. Journal JSON вырос одинаково на458138 B. Игровые поля для сравнения не отбрасывались и не нормализовались. DB primary keys/timestamps не входят в canonical envelope, измеряются отдельно.

Физический рост БД не обязан совпадать из-за page allocation, dead tuples и autovacuum. Результат относится к этому локальному бою, receipt compression OFF, shared catalog OFF; это не оценка production. В inventory добавлен bounded подсчёт команд по сохранённым status/phase active/ended; QA происхождение устанавливается owned registry, а не именем пользователя. Storage inventory4/4 native tests PASS, включая read-only и отказ peer/foreign DSN.
