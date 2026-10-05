# TEST-05 — перенос Urvin на принадлежащий runner стенд

Статус: **27/27 actual native API checks PASS**, `test_ae06e8058e978db6fbb0ea4f`. Required PostgreSQL: 5 top-level +4 subcases PASS, Node: 6/6 PASS, 0 skip. Shared settings/catalog возвращены, stack остановлен без ошибок. Машинный receipt: [TEST-05-urvin.json](TEST-05-urvin.json). UI-сборка переиспользована; этот gate проверяет настоящий backend/worker/PostgreSQL, не браузер.

## Граница fixture

`checkUrvinAcceptance(stack)` принимает только готовый integration stack с registry, loopback origin, точным DSN и PostgreSQL marker `test_run_ownership`. Пользователи уже созданы runner. Старые `access.json`, guessed localhost:3001 и самостоятельная регистрация удалены из двух `.test.mjs`; эти пути теперь проверяют отказ неподтверждённому adapter до любого сетевого вызова. Полный API сценарий вынесен в `scripts/testing/urvin-acceptance.mjs`, обязательный gate — `scripts/performance/check-urvin.mjs`.

`export-urvin-fixture.go` создаёт случайный namespace в этой же одноразовой БД, копирует только структуру пяти таблиц и исполняет настоящие seed `199_materialize_roguelike_monsters` и `273_urvin_run` только там. Экспортируется mode v1, пять аур, шесть достижимых monsters и замыкание их действий/эффектов. Namespace удаляется; migration ledger не меняется. Это переиспользование деклараций, **не проверка исторических Up 001–297**. Fixture отмечен `historicalChainVerified:false`.

Перед вставкой исключаются private rows; служебные изображения/авторы/даты/certificates очищаются общей `publicFixtureRow`, support становится `not_tested`. Вставка возможна только для отсутствующих identity/slug/card_number. Существующие bandit/guard и остальной каталог не заменяются. Магазин получает три новых карточки и отдельные tag IDs. Прежняя конфигурация возвращается только при совпадении ожидаемых временных config/version; полный hash исходной строки и actions/effects/monsters проверяется после finally. Карточки наград остаются зависимостями созданных этим gate персонажей до удаления всей одноразовой БД; shared settings/каталог правил восстанавливаются. Отдельный `acceptance/urvin-fixture-cleanup.json` сохраняется и при отказе сценария.

## Сохранённые и усиленные сценарии

Строгий receipt требует все 27 именованных checks без duplicate/skip: пять аур, ограничение solitude, wealth +200, отдельные копии одного source для classic/Urvin, peer ownership, отсутствие private полей, маршрут и запрещённые команды, инициализация/retry/reload; treasure; покупка/закрытие shop; short/long rest; два настоящих elite/boss исхода; все семь вариантов проверок пяти событий; ambush/поражение/checkpoint/retry; неизменность исходных листов.

Все успешные команды повторяются с теми же ID/revision/payload: ответ, полный private run hash, receipts, events и принадлежащие пользователю листы должны остаться одинаковыми. Отклонённая команда не меняет те же хэши. Pending проверка сохраняется и перечитывается до продолжения, отказ от влияния не меняет итог кости.

Elite/boss сначала инициализируются с оригинальными guardian declarations. Отдельные завершения используют только объявленные synthetic HP/КД/damage до initialize; затем каталог возвращается, а исход получается реальными командами закреплённого worker. RNG seed не задаётся, outcome/envelope после initialize SQL не изменяются. Это доказательство исполнения и выдачи наград, не баланс игры. Для поражения driver подтверждает обычные `death_save` фазы; unknown pending/phase отвергается. Настоящий acknowledgement атомарно завершает defeat, лишний `complete_encounter` получает409, после чего проверяется исходный checkpoint/composition.

## Найденная и исправленная регрессия отдыха

На первом actual run старый сохранённый шаблон line не содержал pool предмета, который каноническая подготовка закономерно материализовала (`uses_CARD-0839`, максимум2). Worker вернул корректные resources/max_resources, но одиночный trusted rest сравнивал resources с прежними maxima и отвечал400 `invalid_runtime`. Это подтверждено отдельным вызовом настоящего Go resolver/worker, не копией расчёта в fixture.

В `roguelike_worker_controller.go` проверка использует maxima уже принятого `applyTrustedRoguelikePatch` из того же worker результата. Прежние currents сохраняются для проверки расхода костей хитов; клиентские runtime/max_resources по-прежнему не попадают в доверенный запрос. Замороженные receipts не меняются. Новые PG tests покрывают два разных пула, overflow и отрицательное значение, forged browser payload, точный retry и persisted reload; прежняя проверка запрета maxima у legacy patch сохранена.

## Evidence

- `outputs/testing/test05-next/urvin-unit-final.log`: 6/6 Node PASS, 0 skip.
- `test_5010b7eb112cd29e6feb1f34/required-go.jsonl`: 5/5 required top-level +4 subcases PASS; полный Urvin run failed на ещё не поддержанном driver death-save.
- `test_5010b7eb112cd29e6feb1f34/urvin-acceptance.json`: 25 завершённых checks, статус failed; оба canonical rest прошли.
- `test_783ce106481b38f5eb660709`: failed на лишнем `complete_encounter` после настоящего завершения defeat; исправлен driver, продуктовый отказ сохранён.
- `test_ae06e8058e978db6fbb0ea4f/urvin-acceptance.json`: итоговые 27/27 checks PASS, 23 созданных забега, 26 исходных листов неизменны. Короткий и долгий отдых материализовали отсутствовавший declared pool и сохранили его после повторов/перезагрузки. Строгий verifier проверил exact список и уникальность checks, artifact hash и fixture restoration.
- `outputs/testing/test05-next/urvin-sixth.log`: полный итоговый запуск, включая5 required PG tests и sensitive JSON SELECT; `urvin-final.json` подтверждает lifecycle stopped/errors[].
- Во всех завершённых попытках stack cleanup `stopped`, errors пусты. Логи сохранены в `outputs/testing/runs/` и `outputs/testing/test05-next/`.
- `postgres.mjs -qAt` проверен настоящим sensitive JSON SELECT: служебный SET tag не попадает в результат, PostgreSQL statement-log suppression сохранён.

Shared manifest принадлежит root; снятие двух quarantine согласовано одновременно с включением обязательного gate. Никакие прежние уникальные assertions не удалены: terminal-state SQL setup заменён полноценными авторитетными командами, а сравнение публичного mode отделяет объявленную механику от очищенных fixture image metadata. Проверка актуальной исторической установки с нуля остаётся отдельной незавершённой границей.
