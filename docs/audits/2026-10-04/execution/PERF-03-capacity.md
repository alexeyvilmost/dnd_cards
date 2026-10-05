# PERF-03 — истинный cold, нагрузка, admission и residency

Локальное выполнение 04.10.2026, Node24.19.0/Windows. Production не запускался.
Текущий CJS `80ef5c7149be4545130d8165a34c904bab90c6d7529408f852a15ee7bce8da64`
не изменён этим срезом. Исторические файлы и pins не переписывались.

## Измерение

`fresh-worker.mjs` запускает отдельный процесс на каждую комбинацию партии,
артефакта и wire protocol. Фикстуры сначала создаются обычным API исходного
стенда; измеряемый процесс до первого transition их артефакт не загружал.
Во всех9 профилях первый запрос показал `worker_artifact_cache_hit=0`, все
последующие тёплые запросы —1. Для партий1/2/6 проверены current/full,
current/mirrors-v2 и historical/mirrors-v2. В каждом процессе10 окон каждой
параллельности1/4/16, то есть10/40/160 числовых отсчётов. Полные ответы, RNG,
events и pending сравниваются с точным ожидаемым ответом; ничего игрового не
нормализуется. Private inputs/results остаются только в памяти.

Baseline: `test_1bafdff9a841c098f13798a6`, [все raw samples](PERF-03-capacity-before.json).
В нём партия6/current/mirrors имеет следующие значения:

| Одновременных запросов | n | p95 HTTP, мс | p95 event-loop delay, мс | Process maxRSS, MiB |
|---:|---:|---:|---:|---:|
| 1 | 10 | 148.6 | 85.6 | 204.7 |
| 4 | 40 | 315.9 | 213.0 | 275.9 |
| 16 | 160 | 1092.8 | 1005.1 | 311.0 |

Cold artifact-load этой комбинации48.9мс, весь cold HTTP207.1мс.
Handler callback-active peak даже при16 равен1: значительная задержка возникает
раньше observable callback. Поэтому счётчик активных Node handlers не использован
как фиктивный ограничитель внешней очереди.

Повтор с eviction/reload: `test_f1e2ca13ce2036bfda9ce5d9`,
[полные данные](PERF-03-capacity-eviction.json). Во всех9 процессах загружался
другой настоящий historical/current CJS при cache limit1, затем исходный pin
загружался заново (`cache_hit=0`) и возвращал **полностью тот же результат**.
После этого выполнены такие же1/4/16 окна. Для партии6/current/mirrors p95
266.5/874.7/3211.8мс, lag p95≈230.3/630.7/3158.3мс. Это другая созданная API
партия/энтропия, поэтому два запуска **не являются парным замером ускорения**.
Исходное поле `sourceUnchanged` подтверждает неизменность исходных персонажей
fixture, а не Git snapshot. Закрывающий shutdown guard добавлен после этого
численного запуска и отдельно проверен детерминированным regression test.

Метод сохраняет whole-process CPU/ELU, RSS/heap before/after, boundary/timer
peaks, lifetime maxRSS и event-loop histogram с60мс drain. Timer может пропустить
пик внутри синхронного executor; maxRSS — lifetime high-water, не per-window
heap. Callback entered/closed — наблюдаемые границы, не remote queue time.
Прямой диагностический worker load обходит Go admission намеренно; эти графики
не описывают отказы нового публичного API. Local CPU contention и состав AI
ходов исключают обещание production p95. Pool/delta не добавлены.

## Ограничение обращений

`backend/roguelike_worker_admission.go` содержит один process-wide budget,
используемый **всеми** `roguelikeWorkerClient.call`, включая подготовку каталога,
equipment, initiative, camp/rest, party, journey и recovery. Default4 выбран
как консервативная граница ниже измеренного16-request насыщения; env допускает
1–64. Получение разрешения идёт до marshal; очередь не создаётся. Busy имеет
фиксированные code/message, существующий HTTP409; команда не дошла до worker.
Context cancellation проверяется до admission и после marshal; defer release
покрывает decode/HTTP/validation/marshal errors и успех.

`test_c62e2a90c27d02a21f49bd3d`: owned PostgreSQL + реальный HTTP,4 обязательных
Go cases PASS,0skip. Четыре отдельно созданных клиента достигают HTTP одновременно,
12 лишних не вызывают даже MarshalJSON. Отмена до входа/после marshal/во время
HTTP, неверная конфигурация и6 видов отказа освобождают budget. Настоящие API,
PG transaction и receipts с контролируемым executor проверяют: busy/HTTP failure
не меняют полный run/runtime/resources/seed/clock и не пишут receipt; тот же ID
после восстановления выполняется один раз; exact receipt replay проходит при
снова заполненном budget без вызова executor. Это не имитация новых записей в БД.

Ограничение **локальное для одного backend**, не TCP/kernel queue и не сумма
нескольких backend replicas. Отмена HTTP не прерывает уже начатое sync JS:
локальное разрешение освобождается, удалённая работа может ещё закончиться.
Хранимый RNG при отказе не меняется; transient seed allocation при подготовке
новой команды не выдаётся за отсутствие любых вычислений до admission.

## Загруженные исторические модули

`retained-artifacts.mjs --compare`, run `test_f7fea8fce715036beee5f9ad`:
11 **разных существовавших** исторических CJS, два fresh process, одинаковый
порядок загрузок и повтор первого. Лимит64 удерживает все11 для контрольного
сравнения, default4 вытесняет LRU. Запрос намеренно неполный: проверяется загрузка
модуля, затем422. Нельзя считать это игровым replay; он проверен выше отдельно.
GC вызывается только в диагностическом child. [Полные данные](PERF-03-retained-artifacts.json).

| Измерение | Все11 загружены | LRU4 |
|---|---:|---:|
| require.cache entries / живые exports по WeakRef | 11 /11 | 4 /4 |
| Heap до загрузок, bytes | 8027936 | 8027896 |
| Heap после загрузок и GC, bytes | 79415200 | 77139496 |
| RSS после, bytes | 143818752 | 140673024 |
| Process maxRSS, bytes | 149491712 | 151535616 |
| Повтор первого: cache hit / load ms | 1 /0.039 | 0 /9.762 |

**Значимого общего memory win нет**: heap уменьшился примерно на2.9%, peakRSS
даже вырос. Освобождение Node exports доказано, но оно не равно освобождению всей
памяти V8. Сохранён узкий LRU как ограничение явных live-module references;
общий heap/RSS bound и отсутствие долгосрочного роста не заявляются. Более
сложный VM/process pool или принудительный restart в этот срез не включены.

Повторная загрузка всегда проверяет SHA-256 исходного файла; active executor
держит свою ссылку до завершения. Cache close удаляет свои references и запрещает
pending read публиковать модуль после остановки. Independent review обнаружил
и закрыл этот race. Отдельный delayed-read test реально закрывает cache до
завершения чтения, затем проверяет отказ и отсутствие нового require entry.

## Проверки и эксплуатация

- Fresh worker build PASS, CJS80ef неизменён. Node runtime/protocol/history/replay,
  packaging import closure и profiler tests —18/18 PASS,0skip.
- Native admission —4/4 PASS,0skip; общий final suite принадлежит TEST-03.
- Compose config без запуска контейнеров: defaults4/4 и explicit2/8 PASS;
  docker-deployment/measure-local tests16/16 PASS. Настройки добавлены в Compose,
  прочие rollout flags не включались.
- Три основных owned run registry выше имеют status `stopped`; cleanup выполнен.
- [Настройки и границы](../../../worker-capacity.md). Нового runtime module
  нет: cache helper внутри `frontend/worker/server.mjs`, clean distribution
  собрана и проверена; исторические CJS не редактируются.

Фазовый backend process-kill до/после commit выполнен отдельным настоящим
[drill](PERF-03-crash-recovery.md). Длинная **боевая** последовательность160 ходов
проверена [отдельно](PERF-03-long-combat.md): log cap80 подтверждён, устойчивый
рост world — `processedCommandIds`195B/ход, сохранённый для дедупликации.
Остаются retention этого списка, более сложные/длительные сценарии и production host budget.
Это не основание вводить межзапросную delta или pool без следующего
подтверждённого bottleneck.
