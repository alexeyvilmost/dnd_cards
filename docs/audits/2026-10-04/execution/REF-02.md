# REF-02 — границы выполненного рефакторинга

Все предусмотренные границы исходного REF-02 теперь реализованы локальными
срезами. Адресные проверки, общий fresh core и extended прошли на одних замороженных исходниках. API, авторитетное исполнение правил
и исторические боевые артефакты этим рефакторингом не заменяются.

## Подтверждённые срезы

- **Библиотека:** один `useLibraryCatalogPage` и 11 типизированных адаптеров
  вместо повторяющихся loaders. Права, типы, каноничные карточки/превью,
  редактирование и tag flows остаются явными. Фоновый server summary сохраняет
  DOM, накопленные страницы, scroll и detail; stale responses отбрасываются.
  Проверка: 75/75 адресных assertions и fresh real E2E 11/11.
  Подробности: [REF-02-library.md](REF-02-library.md),
  [сравнение сборок](REF-02-library-build.json).
- **ChoiceResolver и диалоги:** resolver выделен из общего character components,
  Choice/Dice presentation загружается через lazy hosts; контексты сохраняют
  время жизни запросов, отмену и совместимые exports. Проверки nested canonical
  entity presentation и ранней отмены описаны в [PERF-04.md](PERF-04.md).
- **Загрузка и command lifecycle SoloCombatPage:** `useSoloCombatBootstrap` владеет
  загрузкой/восстановлением одной route session; `src/hooks/useCombatCommandDispatch`
  отвечает за один запрос в полёте и восстановление подтверждённого состояния;
  transport, command ID, revision и исполнение правил переиспользуются.
  Late route/unmount results не подменяют новый trusted бой. Command IDs,
  accepted revisions, pending и RNG остаются у прежних transport/engine владельцев.
  Новая проверка охватывает 14 lifecycle/bootstrap cases. Legacy single/party save
  и reset также выделены в `useSoloCombatPersistence`: 10 воспроизведённых failures
  поздней публикации закрыты session guard; полный набор hook 15/15 PASS.
  [Red/green receipt](REF-02-local-persistence.json). До расширения этого среза
  свежая сборка, runtime browser bridge и combat S05/S10 2/2 прошли; после расширения
  общие fresh core и extended также прошли.
  Подробности: [REF-02-combat-command.md](REF-02-combat-command.md),
  [предыдущий browser receipt](REF-02-combat-browser.json). Hooks классифицируются как frontend-only.
- **Выбор цели и presentation SoloCombatPage:** `useCombatTargetSelection`,
  `CombatRollDialogs`, `CombatDecisionDialogs` разделяют UI orchestration и
  каноничные dialog hosts. Шесть перенесённых функций имеют точное равенство
  AST-токенов, а page tests проверяют реальные target/move/action/held/reaction
  через один engine в 2D/3D. Страница 1537→711 строки; общего метаконструктора и
  нового источника механик нет. [Сверка и классификация](REF-02-combat-extraction.json).
- **SheetActionsPanel:** `sheet-actions/actionModel`, `actionAvailability` и
  `SheetActionList` выделяют общий selector и renderer; прежняя панель остаётся
  владельцем загрузки/команд и обеспечивает reuse в листе, бою и мобильном режиме.
  Все 30 statements availability после destructuring равны прежнему телу;
  `SheetActionLine`, filter/preparation/reaction, inspect/command callbacks сохранены.
  46/46 адресных тестов, две декларации с различной стоимостью, icon/row,
  keyboard focus/preview, недоступная активация, mobile inspect. Подробности:
  [REF-02-sheet-actions.md](REF-02-sheet-actions.md).

## Общая проверка и пределы измерений

После всех Solo/Sheet changes адресные65/65 и полный TypeScript прошли. Итоговые fresh core-5 и extended-3 приняты на 4313 неизменённых исходниках; core 504 проверок, extended 7586 численно учтённых. Оба включают настоящий API,12 real browser scenarios и cleanup без ошибок. [Общее свидетельство](final-verification.json). Старый [receipt core-3](REF-02-final-acceptance.json) сохранён как исторический, не является последним общим результатом.

Свежая default UI core-3 уже проверена по immutable manifest:
[route graph](REF-02-route-graph.json). Initial JS 468694→468845 bytes raw,
133492→133557 gzip; CSS неизменен. Бой, библиотека и лист остаются ленивыми
маршрутами; handler chunk вне initial closure. В этом парном сравнении worker artifact остался 80ef5c71…; позднее отдельное исправление сохранённого исхода атаки создало baecf723… — [S05 evidence](TEST-04-movement.md).

React CPU profile до/после снят на 14 одинаковых page scenarios:
[сырые samples и сводка](REF-02-react-summary.json). 178→179 commits,
actual total 619.50→826.51 ms, commit p95 10.06→13.83 ms. Это development/jsdom
с заглушённой графикой, параллельным typecheck и изменившимся смежным Sheet renderer; численное ускорение
этого переноса не заявляется. Наблюдаемый route graph/library bundle comparison
также учитывает параллельные изменения. Рефакторинг не уменьшает сам по себе
общий объём кода: он отделяет ответственность и убирает дублированную публикацию.

Откат выполняется по срезам; нельзя возвращать обход всех страниц ради counts,
подменять каноничные сущности списками имён или менять старые artifact pins.
