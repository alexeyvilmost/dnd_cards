# REF-01: очередь событийных реакций

Выполнен локальный первый срез, 04.10.2026. Проверенная граница TEST-02 сохранена.
Это небольшое извлечение orchestration, а не полная переработка большого handler.

## Ответственность

`frontend/src/rules-core/eventReactionQueue.ts` теперь владеет накоплением событий,
фактами наблюдателя, порядком очереди, лимитом каскада, открытием и сохранением
выбора. `EventReactionServices` имеет два явных входа: вычисление доступных
вариантов и авторитетное автоматическое исполнение. Оба предоставляет существующий
handler; binding, проверка цены/прав/целей, удержание броска и применение результата
не скопированы в новый модуль. Handler сохраняет компактный адаптер исполнения.

Разбор declared reaction triggers перенесён в `triggerOwnership.ts` без изменения
семантики. Очередь принимает только world-owned декларации; board/phase/unknown
не исполняются частично. UUID/имена не выбирают ветви правил.

## Доказательства до/после

До изменения handler явно записан versioned synthetic corpus
`rules-core/testing/fixtures/event-queue-v1`: 13 команд, 131480 bytes JSON,
5108 bytes gzip, SHA-256
`92218d18f188020300643ead41575679210e35105444daa742a9b8b4672c08a6`.
Manifest содержит hashes исходников до извлечения. Генератор write-once;
обычный test не обновляет expected результаты.

- Две различные платные реакции; сохранённый pending и продолжение после JSON
  roundtrip; повтор принятого command ID отвергается без изменения ресурса.
- Два владельца в очереди, последовательный отказ без оплаты.
- Две обязательные реакции наблюдателя с разными данными урона.
- Board-only и неизвестный predicate остаются fail-closed.
- Сравнивается весь результат: события, ID, pending, мир/ресурсы/HP и потребление
  строгой RNG tape. Каждый случай выполняется дважды, входные данные неизменны.

`ref01-before.json` и `ref01-after.json`: 13/13 до и после. Итоговый точный выбор
трёх файлов `ref01-targeted-exact.json`: **43/43**, ноль skips; включает реальные
integration reactions и AST/transitive import-boundary checks.

Свежий production worker собран. `check-rules-artifact-equivalence.mjs` сравнил
два разных executable на **18 записях**: initialize/ходы/RNG, pending journey
checks/повторы, отдых, исцеление и неизвестная операция, по две декларации.
Нормализован только физический `artifactHash`; все остальные поля идентичны:

- до: `sha256:5eedc099bbfc8e6e7641b9a07cbe9548e53b1881b6a1ae82d7c132300a4e697f`;
- после: `sha256:d08a3588f6aa3b03162b666b787d5a9ed625c4a96798203d7ff10c4b2365767f`.

`historical-replay.test.mjs` на текущем worker: **2/2**, включая retained original
executable, повтор/перезапуск, журнал, missing/corrupt fail-closed. Старые CJS,
сертификаты и сохранённые истории не переписаны. Машинный receipt:
[REF-01-evidence.json](REF-01-evidence.json).

## Граница готовности

Перед этим срезом полный extended Vitest имел 6034/6035 passed, единственный
geometry performance baseline тест исправлен его владельцем отдельно (35/35).
Финальный общий core/TypeScript/extended выполняет root после стабилизации
параллельных задач; приведённые адресные receipts не подменяют этот общий результат.

Equipment/resource seam принадлежит PERF-02. Следующий обязательный срез
[typed dispatch и attack/damage continuation](REF-01-continuations.md) выполнен
отдельно с парным immutable replay 84/84; исходный receipt этого документа
сохраняется как доказательство первого переноса. Corpus не доказывает все
возможные механики.

Откат — вернуть очередь и helper в handler с теми же fixtures и проверками.
Сохранённый artifact hash существующего боя при этом не меняется. Не удалять
архивный исполнитель и не пересчитывать старые журналы новым кодом.
