# CI9, первая публикация и остановленная репетиция

Полный CI на `cfe9e54d6645c684c0e97e5c6570ea1244c78278` прошёл: 689 Node, 6462 Vitest, 753 Go/race, 20 DB/worker, 12 основных браузерных сценариев, 48 UI и 8 battle3D. Все четыре части и cleanup успешны. Интервал агрегированного набора — 14,29 минуты; полный GitHub workflow от запуска до завершения занял 15 минут 40 секунд. Это разные измерения; ни одно не является временем всей выкатки. [CI](https://github.com/alexeyvilmost/dnd_cards/actions/runs/37271099509).

Три immutable образа реально опубликованы в GHCR. Их source/fingerprint/digest и Node 24.21.0 проверены; release artifact остаётся candidate-only до полного host acceptance. [Публикация](https://github.com/alexeyvilmost/dnd_cards/actions/runs/37272499962).

Первая серверная репетиция была остановлена единственным подтверждённым SIGTERM после истечения 30-минутной свежести capture. До сигнала отдельно проверены точный validator, phase05 и неизменный active state. Автоматическое отклонение по TTL не заявляется: это решение оператора до cutover. Завершены пять из семи migration scenarios; schema-proof был прерван, полный rehearsal не прошёл. [Неуспешный deploy](https://github.com/alexeyvilmost/dnd_cards/actions/runs/37273035754).

У внутреннего migration cleanup записан incomplete, поскольку после сигнала команды trial DROP запрещены. Родительский cleanup завершил все 17 owned resources; независимый осмотр доказал ноль оставшихся containers/networks/volumes, отсутствие validator, Docker auth, deployment journal и lock. Рабочие backend/frontend/worker сохранили прежние container/image IDs и healthy; главная страница и API отвечали HTTP200. Приложение осталось на `4549fb3c903659d3fe2beb272f7f903a731f7388`.

Capture от 2026-10-05T06:35:01.822Z сохранён на сервере без изменения даты. Custom dump — 958580611 B; защищённая локальная копия имеет тот же SHA256 c6024ff9d7c5fa64f96111a3f01b22b89566ae3c4e15b8a57b73981a38630c60. Данные не публиковались. Полные повторные fingerprints больших квитанций и reference inventory требуют ускорения; срок freshness не расширен. После проверки нового алгоритма нужна новая попытка с новым снимком и обязательными gates.

Manual build/publication/deploy variables включены, auto-main выключен. Новые writers остаются OFF в первом кандидате. Healthy adoption, distinct-pair writer proof, UI-only и auto acceptance пока отсутствуют. [Машинная запись](CI-09-first-publication.json).
