# REF-02: загрузка, команды, выбор цели и диалоги боя

Локальные последовательные срезы 04.10.2026. Дополняют извлечение загрузки библиотеки
и общего отображения действий листа. `SoloCombatPage` сокращена с 1537 до 711 строк;
страница сохраняет композицию, настройки, сцену и переход к награде. Общий объём
исходников от механического переноса не уменьшился: добавлены явные интерфейсы и тесты.

## Граница ответственности

- `frontend/src/hooks/useCombatCommandDispatch.ts` владеет одним запросом в полёте,
  блокировкой косметической презентации, передачей intent существующему transport,
  восстановлением подтверждённого забега после неопределённого ответа и снятием busy.
- `SoloCombatPage` сохраняет представление и один `acceptCombatRun`: персонаж,
  состав группы и боевой снимок публикуются одинаково при успешном ответе и GET
  после потери ответа. Две копии этой последовательности удалены.
- Существующие `commandCombatInteraction`, `roguelikeApi.command`,
  `resumePendingMovement` не скопированы и не изменены этим срезом. Генерация и
  хранение command ID, проверки revision, маршруты архивных боёв и вычисление
  правил остаются у своих прежних владельцев. Новый модуль не повторяет команду
  автоматически после ошибки и не рассчитывает серверный результат на клиенте.
- Продолжения сохранённого броска проходят тот же presentation gate, что и до
  извлечения; авторитетная проверка их допустимости остаётся в движке.
- `useSoloCombatBootstrap` владеет загрузкой одной route session, проверкой
  принадлежности персонажа забегу, восстановлением pinned combat и инициализацией
  через прежние API и canonical participant builders. Смена маршрута очищает
  прежние refs; поздние результаты загрузки/подготовки после смены или unmount
  не публикуются. Неопределённый ответ initialize по-прежнему сверяется через GET,
  новая initialize-команда автоматически не отправляется.
- `useCombatTargetSelection` владеет UI-выбором действия, цели, движения и данных
  диалога. Шесть прежних функций перенесены с **точным равенством AST-токенов**:
  manual slots, world input context, choices, choose, multi-target confirmation,
  click cell. Range/cost/target/execution продолжают вызываться из прежних
  каноничных модулей. [Машинная сверка](REF-02-combat-extraction.json).
- `CombatRollDialogs` и `CombatDecisionDialogs` выделяют представление сохранённого
  предварительного/подтверждённого броска, влияния, реакции и продолжений. Они
  используют прежние `CombatPresentationDialog`, `SheetActionLine`,
  `SheetPendingCombatPanel`, `RollInfluenceActions` и настройки icon/row. Доступные
  решения вычисляет прежний pipeline; новый host не тратит ресурсы и не решает
  исход самостоятельно.
- Trusted command publication теперь привязана к route session. Поздние success,
  error и GET reconciliation старого забега после перехода или unmount не меняют
  новый экран и не снимают его busy. Уже отправленная серверная команда не отменяется,
  дополнительная команда не создаётся.
- `useSoloCombatPersistence` теперь владеет прежними legacy single/party save,
  `apply` и reset устаревшего снимка. Это перенос прежних serializers/API/ID generation
  с guard текущей route session: поздние ответы не публикуют refs/state/error/busy
  и не выполняют навигацию в уже другом экране. Команда на сервере не отменяется,
  новый ID/retry не создаётся, accepted revision текущей страницы сохраняется.
  Ошибка сначала воспроизведена: **10 failed / 2 passed**; после guard те же
  **12/12 PASS**, затем полный набор hook **15/15 PASS**. Дополнительные проверки
  сохраняют current-route reset success/error и отвергают старый callback A→B→A.
  [Red/green evidence](REF-02-local-persistence.json).

Hooks размещены в `src/hooks`, presentation — в `src/components`: для всех семи
затронутых production UI файлов классификатор выкатки выбирает только frontend,
worker Docker context исключает этот путь, фактический esbuild graph его не
содержит. Поэтому следующий UI-only edit этой ответственности не требует
пересборки правил. Имена/UUID сущностей не выбирают новые ветви механик.

## Проверки

- Последняя проверка после всех extraction и session guards: **65/65 PASS**, 7 файлов,
  0 skips: command lifecycle — 9, bootstrap — 5, transport compatibility — 7,
  local persistence — 15, automatic continuation — 9, page 2D/3D — 14,
  общий sheet renderer — 6.
  Полный `tsc -b` после этих изменений — **PASS**.
- Новые route tests включают late accepted/lost response старого забега при активной
  команде нового; поздний reconciliation; unmount; поздний initial character и
  restored participant preparation; mismatch run/character; accepted initialize
  с потерей ответа без повторной initialize и без local persist.
- Новые проверки держат один in-flight запрос через StrictMode/rerender и
  неопределённый ответ вплоть до завершения GET; следующий клик использует
  подтверждённую revision. Отдельно проверены недоступный и неполный GET,
  сохранение последнего подтверждённого снимка, отсутствие автоматического resend
  и локального исполнения trusted intent, продолжения к20/спасброска от смерти,
  локальная ошибка превью.
- Предыдущий срез command-only имел собственную свежую сборку и real browser bridge.
  [REF-02-combat-browser.json](REF-02-combat-browser.json) сохраняет именно этот receipt:
  default UI, hash исходников и immutable UI snapshot, worker hash, runtime bridge,
  две реальные браузерные проверки боя и teardown. Финальный run
  `test_d22a019f6c48c72bdc49302d`: runtime bridge **PASS**, combat **2/2 PASS**,
  ноль skips/flaky, `sourceStable: true`, cleanup `stopped` без ошибок.
  Он предшествует остальным extraction и **не заменяет** итоговый общий прогон.
- Runtime bridge проверяет оборудование после потерянного ответа/перезагрузки,
  тот же сохранённый command ID и точный replay без нового расхода, сохранение
  инвентаря, серверную инициализацию боя без повторной browser preparation.
- Combat S05 проверяет реальное перемещение, сохранённый предварительный бросок,
  отказ поддельному действию, каноничные строку/превью влияния, сохранённый расчёт КД,
  потерю ответа после оплаты влияния, точный повтор без нового расхода ресурса и
  боеприпаса, перезагрузку и завершение хода. S10 проверяет победу, однократную
  награду и возвращение в тот же лагерь.

Общий fresh core-2 (`outputs/testing/final-core-2/report.json`, owned run
`test_8e76e7ae94242b5a582eca49`) прошёл до последнего local-persist среза: 462 checks,
real API, 11/11 browser, 4250 source files unchanged, cleanup stopped. Это подтверждает
предыдущие Solo/Sheet extraction, но не подменяет свежую проверку guard.
После окончательного source freeze общий core-3 **PASS**:
`outputs/testing/final-core-3/report.json`, owned run `test_cd204c423ae3c24b17436501`.
В нём 477 численно учтённых проверок, включая 221 Vitest и **11/11 real browser**,
а также реальный API spine; 4252 source files unchanged, 246.1 s,
cleanup `stopped`, errors `[]`. [Сводный receipt](REF-02-final-acceptance.json).
Общий extended ведёт root; его успех до получения результата не утверждается.

Свежая default сборка core-3 готова и обслуживается из immutable UI snapshot.
Manifest identity: `b83e6ff1d4dcca7e5fae08479aa3d9139a304fad136dd2f0bcc8457bc5c33566`.
Worker artifact по-прежнему `sha256:80ef5c7149be4545130d8165a34c904bab90c6d7529408f852a15ee7bce8da64`.
[Фактический route graph](REF-02-route-graph.json): initial static JS
468694→468845 bytes raw, gzip 133492→133557 (+65 bytes), CSS неизменен 131575 bytes.
SoloCombatPage, CardLibrary, CharacterSheetMVP остаются lazy entries; именованный
handler chunk не входит в initial static closure. Между snapshot присутствуют
смежные image/Sheet изменения, поэтому +151 bytes не приписываются одному hook.
Статическая closure маршрута учитывает общие зависимости, dynamic imports перечислены
отдельно; gzip — сумма отдельных файлов, а не измеренный сетевой трафик.

React profile выполнен до/после в тех же 14 page scenarios:
[числовая сводка](REF-02-react-summary.json), [before](REF-02-react-before.json),
[after](REF-02-react-after.json). React development/jsdom, графика заменена тестовым
представлением, canonical UI и движок реальны. Before: 178 commits, total actual
619.50 ms, commit p50/p95 2.61/10.06 ms. After: 179 commits, 826.51 ms,
3.27/13.83 ms. Это наблюдение одного прогона при JIT, параллельном typecheck,
изменении смежного Sheet renderer и разном расписании асинхронных ответов,
**не доказательство ускорения или SLA**. Рост наблюдаемых чисел не скрывается.
GPU/FPS/мобильная производительность этим профилем не измерялись.

Правила и байты исторических артефактов этим срезом не менялись. Рефакторинг проверяет
поведение и явную ответственность; широкого переписывания страницы нет.

UI manifest identity предыдущего command-only receipt:
`a1b6b680b23ddf44890a024252a17a7669f49412e77319a530567dad3309cb38`.
Worker artifact остался
`sha256:80ef5c7149be4545130d8165a34c904bab90c6d7529408f852a15ee7bce8da64`.
Переезд command hook между каталогами в том срезе сохранил итоговые байты Vite bundle.

Адресная повторяемая проверка: из `frontend` выполнить `node
node_modules/vitest/vitest.mjs run src/hooks/useCombatCommandDispatch.test.tsx
src/hooks/useSoloCombatBootstrap.test.tsx src/components/sheet-actions/SheetActionList.test.tsx
src/hooks/useSoloCombatPersistence.test.tsx
src/roguelike/combatInteraction.test.ts src/solo-combat/useAutomaticCombatDecision.test.tsx
src/pages/SoloCombatPage.3d-parity.test.tsx`. Для браузерной проверки поднять один
`startTestStack({profile:'integration',equipmentIntent:true,initiativeOptions:true,
performance:true})`, вызвать `checkRuntimeBrowserFlow(stack)`, затем выполнить
Playwright с `frontend/playwright.local.config.ts` и `combat.spec.ts`, передав
тот же `stack.env`; cleanup обязателен в `finally`. Stand собирает свежий UI и
всегда обслуживает собственную immutable копию dist.

## Сопутствующая проверка упаковки worker

Найден второй слой ранее исправленного missing `mirrors.mjs`: `build.mjs` уже
копировал wrapper, но `infra/Dockerfile.rules-worker.dockerignore` не пропускал его
в чистый build context. Добавлено точное исключение для этого файла.

Регрессионная проверка в `frontend/worker/server.test.mjs` сначала упала на
`Clean Docker context omits runtime import: frontend/worker/mirrors.mjs`.
После исправления **49/49** server/replay + Docker inventory + component planner
прошли. Новый тест разбирает AST реального `build.mjs`, получает все runtime
`copyFile` inputs, проверяет их и closure относительных импортов на фактическом
ignore-filtered inventory, затем требует отказа при удалении каждого входа.
Существующая проверка отдельно запускает server/replay из одной `worker/dist`
вне исходного дерева, включая настоящий health/artifact hash.

Локальное выполнение Linux OCI здесь не объявляется проверенным: закрыты
воспроизведённый пропуск build input, состав dist и native запуск wrapper.
