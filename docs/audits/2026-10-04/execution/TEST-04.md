# TEST-04 — реальные локальные пользовательские сценарии

Реализован отдельный `frontend/e2e-local` профиль на настоящих Go API, worker и PostgreSQL. **Два независимых новых кластера: по 9/9 PASS**, retries=0, skipped=0. Production, рабочая БД, commit/push/deploy не использовались.

## Команда и граница

```text
node scripts/testing/stack.mjs --profile integration -- node frontend/node_modules/@playwright/test/cli.js test --config=frontend/playwright.local.config.ts
```

Обязательный общий runner TEST-03 включает все четыре spec-файла. Старые `frontend/e2e` API-fixture tests остаются отдельным слоем, не доказательством серверной атомарности. `integration` — переносимая текущая schema + проверенные публичные/synthetic fixtures; **historicalChainVerified:false**. Историческая migration chain по-прежнему отдельно fail-closed на 102.

## Покрытие

| Сценарий | Проверенный контракт |
| --- | --- |
| S01 | Настоящий UI login; библиотека заклинаний, поиск и фильтр уровня, список/сетка, каноничное SpellPreview; отсутствие concurrent duplicate GET в одном документе и uncaught JS errors. |
| S02 | Копия шаблона из UI, выбранное имя/владелец, reload; исходный каталог шаблонов не изменяется. |
| S03 | Создание бумажного листа, имя/многострочная заметка, скрытие/возврат блока после reload; JSON равен сохранённому документу; печатный PDF; stale revision 409 не затирает данные. |
| S04 | Снятие и надевание настоящего доспеха через каноничный inventory UI; КД уменьшается и восстанавливается; reload; количество инвентаря и ресурсы не изменены. |
| S05 | Настоящий archer run → initialize worker → UI движение → авторитетный возврат/подход к цели → атака → сохранённое влияние; до выбора HP цели не меняются; forged influence отвергнут; reload сохраняет выбор, каноничную строку/preview и расчёт КД; потерянный ответ после commit и повтор исходного command ID дают тот же результат, один расход/receipt, неизменный приватный RNG cursor/catalog/envelope/journal. После разрешения — UI конец хода либо награда и лагерь при победе. Исходный лист не изменён. |
| S06 | Пустой мастер: вид, предыстория, класс, реальные декларативные skill/mastery/feat choices, характеристики/бонусы, стартовый инвентарь; настоящее создание, ожидаемый первый resource reconciliation PATCH листа, затем стабильный reload. Ни offline authority, ни фиктивный verified status не используются. |
| S07 | Два разных обычных пользователя: чужой лист/бой/создание забега недоступны; неадминистратор не редактирует шаблон; недействительный JWT 401; concurrent одинаковые commands имеют идентичный ответ/один receipt; stale revision отвергнута без изменения. |
| S08 | Корзина с валидной и несуществующей позицией полностью откатывается; настоящая покупка припасов, продажа своего предмета, короткий/долгий отдых; forged цена/ресурсы клиента не принимаются; повтор команд не удваивает расход, receipt один; source sheet не меняется. |
| S09 | Холодное открытие naming modal забега, видимая доступная кнопка с контрастом >=4.5; nonadmin/admin UI редактора шаблона соответствует реальным серверным правам. |

`acceptance-observer.mjs` выполняет только SELECT в READ ONLY transaction на проверенном owned DSN/marker. Он возвращает hashes, ревизию, позицию RNG и counts; seed и полный приватный envelope не извлекаются. Продуктовые успешные `/api/**` ответы не подменяются. Единственный fault injection сначала действительно отправляет paid command backend, получает настоящий ответ и лишь затем обрывает ответ браузеру.

## Исправления, необходимые для воспроизводимости

- Каноничные dependencies archer/Forge восстановлены из уже существующих `catalog-audit-20260929/spells.json` (preimage+patch+effect guards), `micro-mvp-l1-content-patch.v1.json` (условия и weapon profiles) и `generic_spell_freeuses_297_manifest.json` (mechanics только effects, уже присутствующих в минимальном каталоге). Registry содержит hashes/проекции/явные excluded IDs. Rules production не изменены ради fixture. Все support statuses остаются `not_tested`.
- После bulk seed выполняется `ANALYZE`: без статистики одинаковые свежие кластеры иногда выбирали дорогие планы `entity_reference_resolved_edges`, отдельные GET занимали ~2.3s, лист не успевал загрузиться. Это подготовка test DB, не утверждение об оптимизации production SQL.
- Каждый stack копирует production frontend в свой `ui-dist`. Полное дерево до/после копирования и копия должны иметь одинаковый manifest; racing shared build отклоняется. Следующий build не меняет уже работающий стенд. Unit проверяет неизменность копии после изменения исходных файлов, запрет перезаписи/чужой ownership.
- Единственная product UI правка — доступное имя equipped item в `SheetEquipmentPanel.tsx`: `aria-label` сообщает слот и имя предмета. Механики, настройки и представление карточки не изменены.
- Forge driver ждёт реальные class-choice counters после асинхронной загрузки; baseline persisted sheet берётся после настоящего первого PATCH синхронизации ресурсов. GET snapshot сравнивается с GET snapshot; порядок ключей JSONB канонизируется только в hash test helper.
- Бой использует авторитетный `approach_action`, учитывающий геометрию и препятствия текущей процедурной карты. Ветвление после броска различает продолжающийся бой и уже наступившую победу; успешный результат не задаётся тестом.

## Evidence

| Запуск | Результат |
| --- | --- |
| `test_a7bf7e6091ddd6ec8a73562d` | Свежие tsc/Vite/backend/worker build PASS. Первый расширенный боевой driver обнаружил неправильное предположение о свободной линии видимости; полный UI тогда 8/9. Это не green receipt. |
| `test_574da1970b12fe7468ff3172` | Новый owned UI snapshot; все механические/атомарные assertions прошли, последний UI assert ошибочно ждал end-turn после настоящей победы; 8/9. Failure screenshot показывает награду. |
| `test_809ef5ef5d33939c59a4dbc8` | **9/9 real E2E PASS, 47.9s**, плюс producer 3 presets/mobile/rights/source isolation PASS; отдельный generic mastery unit **10/10 PASS**. `acceptance/playwright.json`, `acceptance/polish.json`, `acceptance/polish-mastery-unit.json`. Cleanup `stopped`, `cleanupErrors:[]`. |
| `test_24b0f6561ffb18d506368dd4` | Второй независимый новый cluster/accounts: **9/9 real E2E PASS**, retries/skips=0. Тот же owned UI manifest; `acceptance/playwright.json`, `command.log`; cleanup `stopped`, `cleanupErrors:[]`. |

UI index SHA256 контрольной сборки: `a02028ac8abca310f29dc4d1f7cab75efb42406bb1e185fd30c4f496804f23e9`; owned full manifest SHA256 `b7f153c0cbe1af6d281f3b86a10cc26caa85822dd8573ed77cbc8fa6774d4a99`, 589 файлов. В ходе совместной работы это evidence конкретной локальной dirty tree; exact-source общий release gate принадлежит TEST-03, не подменяется этим текстом.

Старый `polish-local-acceptance.mjs` сохранён как совместимый entry point: проверяет producer runId, при отсутствии создаёт его, вызывает общий E2E и отдельно generic mastery suite. Устаревший exact-color assert заменён реальным контрастом. Dev-only imports `/src` удалены. Прежняя read-only проверка Slow заменена явно отдельным общим compiler-контрактом (damage prerequisite, authored penalty, choice, иные декларации), **не объявлена дополнительным full-stack боем**.

Trace/HAR/video выключены, чтобы не записывать auth headers. Failure screenshots относятся только к synthetic accounts. Безопасная сетевая диагностика содержит method/path/status/request-id, без query/body/auth. Логи не удалялись.

## Практические границы

Это обязательный основной набор, а не все комбинации правил/магазина/отдыха. Ресурсные предметы, альтернативная подготовка заклинаний после отдыха, группы 2/6, восстановление после прерывания процесса и старые pinned artifacts дополнительно покрываются адресными Go/engine/performance/extended задачами; обычный доспех S04 сам по себе их не доказывает. Магазин минимального fixture использует реальные staples и продажу имущества, без полного случайного ассортимента. Контейнерный runtime этой машины недоступен из-за виртуализации; Linux/Docker E2E ещё не выполнен локально. Historical certificates не пересоздавались, полный текст PHB в репозиторий не добавлялся.


## Коррекция после общего core и обязательные две ветви боя

Общий core обнаружил ошибочный assertion победной ветви: приложение правильно возвращает в конкретный лагерь `/roguelike/<run.id>`, а driver ожидал список `/roguelike`. Ранее два зелёных 9-case запуска случайно покрыли продолжающийся бой. Их receipts сохранены; они не доказывали победную ветвь.

Теперь S05 задаёт исходным синтетическим монстрам HP=1000 до замораживания встречи и обязательно проверяет продолжающийся бой. Отдельный S10 задаёт HP=1/КД=1 и тренировочные атаки с damage=0 через настоящий admin API, затем исполняет настоящие атаки/продолжения до победы. Декларации восстанавливаются сразу после initialize; snapshot конкретного боя остаётся закреплённым. Seed, броски, HP сохранённого мира, ответы worker и receipts не редактируются. Превышение 80 шагов — failure, а не retry/skip.

S10 обязательно проверяет настоящий reward dialog, возврат в тот же camp, одну победу/опыт, reload без повторного начисления и неизменные envelope/RNG/receipt/journal hashes/counts. S05 и S10 независимы; ни один больше не получает зелёный результат обходом своей ветви.

- `test_281e79631d3fca7e24b9a9ca`: обе боевые ветви **2/2 PASS**, 18.4s.
- `test_e696d1f97db7e7d9b914bdbd`: полный текущий набор **10/10 PASS**, 58.5s; skips/retries/flaky=0; owned cluster cleanup завершён.

Промежуточный `test_83659e64f284822f2eecda05` (1/2) честно сохраняет отказ start_encounter для существа без действий. Действующий fixture использует валидные обычные атаки с нулевым damage, не пустой action catalog.

## Свежий повтор после REF-02 и server review pagination

`test_86e66f54dedf2c9f418f9227`: fresh UI build (`reused=false`), все четыре real E2E файла **11/11**, 30.5 s, 0 retries/skips/flaky, строгий receipt verifier PASS. Добавлена реальная настройка статусов библиотеки, одна page-загрузка и полный серверный summary; обновлён точный checkbox selector с учётом описания label. Команда: `node scripts/testing/stack.mjs --profile integration -- node frontend/node_modules/@playwright/test/cli.js test --config frontend/playwright.local.config.ts`. Registry после finally — `stopped`. Подробные hashes сборки: [REF-02-library](REF-02-library.md).
