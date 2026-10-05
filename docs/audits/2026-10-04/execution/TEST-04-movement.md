# S05: сохранённое движение и исход атаки

Общий `final-extended-2` обнаружил в S05 не ошибку координат клика: настоящий opportunity hit остановил движение на сохранённой реакции «По вам попали». HTTP 200 подтверждал принятие команды, а не завершение шага. Старый driver немедленно сравнивал конечную клетку и ошибочно ожидал уже завершённое движение.

Теперь две независимые версии S05 требуют обе ветви: прямое движение после объявленного промаха и сохранённую реакцию после объявленного попадания. Вторая ветвь перезагружает страницу, сравнивает полный hash сохранённого состояния, отклоняет реакцию через настоящий каноничный UI и только затем проверяет точную клетку и расход движения. Повтор первоначального command ID должен вернуть точно тот же сохранённый ответ, не менять RNG/envelope/receipt/journal. Проверяются новые авторитетные записи opportunity attack с настоящей к20, атакующим соседним противником, целью-персонажем и точным исходом; отсутствие атаки больше не может выдать зелёную direct-ветвь.

## Контролируемые входные данные

Это отдельный synthetic training fixture, а не проверка обычной случайной вероятности попадания. Через настоящий admin API до `initialize_combat` создаётся modifier `op:outcome`: первая сущность объявляет `miss`, вторая — `hit` для натуральных 1–20. Оба сохраняют реальные броски, фазы, стоимость, pending resolution и авторитетный исполнитель. Монстры получают HP=1000, нулевой объявленный damage тренировочной атаки, скорость/инициативу для выхода в ближнюю дистанцию. В canonical actor проверяется точная исходная декларация. У victory S10, Urvin и случайных engine-сценариев эти modifiers отсутствуют.

Сцена S05 задаётся до инициализации существующим `clearing-v1`. SQL seam допускает только runner-owned PostgreSQL, marker текущего запуска, своего владельца, revision=1, незаполненные envelope/catalog, ровно один start receipt, отсутствие combat events и точный preimage encounter. В сохранённом бою seam запрещён даже при поддельной устаревшей модели caller. Меняются только входные `map_id`/`map_seed`; combat RNG, исходы, world, принятые receipts и журнал не редактируются. Для последующей атаки выбирается цель с доступным каноничным `combatApproachRoute`, а не первая случайная цель за стеной.

Каталог восстанавливается после инициализации: restore регистрируется до PUT, чтобы потерянный ответ не оставил изменённую сущность; каждый PUT/GET выполняется независимо, ошибки агрегируются, временный effect удаляется и его отсутствие проверяется. `name_en` действий сохраняется явно, поскольку controller присваивает его и при механической правке. Проверяются восстановленные изменяемые декларации; обычное серверное снятие ручного review status не обходится. Любая неподтверждённая очистка делает сценарий неуспешным. Четыре Node fault/guard tests проходят, включая committed write с потерянным ответом, отдельный отказ restore и ложный успешный PUT.

## Реальный дефект продолжения, обнаруженный строгим тестом

В `test_b45ddba4cdc5300589c14b4a` получены 8/9 PASS и один обязательный FAIL: сохранённый `attack_reaction.attackRoll.outcome=hit` после «Пропустить» стал `miss` в окончательном журнале. `retargetAttackRoll` заново сравнивал total с КД и терял data-owned outcome override. Увеличение attack bonus скрыло бы дефект, поэтому assertion сохранён.

Минимальное исправление общего движка: новый необязательный `RollLog.outcomeOverride` хранит фактически принятый исход и detached snapshot первого совпавшего правила. `retargetAttackRoll` и `addBonusDieToD20Roll` используют сохранённое правило; текущий изменившийся каталог не читается. Более позднее явное перенаправление `automaticHit` сохраняет свой приоритет. Обычные броски сравниваются с новой КД как прежде; старые записи без поля читаются прежним путём. Архивные executable artifacts, старые snapshots и certificates не изменены.

Новый `savedOutcomeOverride.test.ts`: 5 FAIL/1 PASS до исправления → 6/6 PASS после; вместе с соседними четырьмя suites — 58/58 PASS. Проверены natural-1 forced hit, высокая сумма forced miss, unchanged/raised/lowered КД, reload, изменение исходной декларации без aliasing, bonus die, две разные сущности, настоящий executor continuation без нового RNG, ordinary/snapshotless/crit/crit_miss и automatic redirection.

## Evidence

- Красный адресный baseline: `outputs/testing/saved-outcome-before.log`.
- Исправление и смежные контракты: `outputs/testing/saved-outcome-after.log`, 58/58.
- Guards и восстановление fixture: `outputs/testing/movement-fixture-unit.log`, 4/4.
- Все промежуточные browser failures и screenshots оставлены в своих owned run directories; они не считаются положительными receipts.
- Финальная серия `test_e7c31469fcd9235675a784dc`: fresh tsc/Vite/backend/worker, **9/9 PASS, 78.0 s**, S05 miss + S05 hit + S10, каждый три раза, retries/skips/flaky=0. Все три direct-ветви записали `miss`; все три held-ветви сохранили `hit` в pending и окончательных records, прошли одну UI reaction, точное движение 30→25. Cleanup: `stopped`, `cleanupErrors:[]`.
- Новый artifact: `sha256:baecf7238e60633604dc8028ca89d33a1f96383c1db92326c86680e696aae528`; owned UI manifest `2a562f13aab53051d724f6c8b5aaf88dc2136f816a10795dd202a98ba392fe83` (`reused:false`). Подробные receipts, source file hashes и безопасные outcome attachments — [TEST-04-movement.json](TEST-04-movement.json). Это адресная native-проверка; итоговый общий core/extended подтверждается отдельными receipts.
