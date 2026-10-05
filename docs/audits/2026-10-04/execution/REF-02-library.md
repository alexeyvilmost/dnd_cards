# REF-02: библиотечный срез

Выполнен локально, 04.10.2026. Это проверенный срез CardLibrary, не объявление
всех экранов из REF-02 переписанными. Другие срезы согласуются с PERF-02/PERF-04.

## Изменение ответственности

`frontend/src/components/library/useLibraryCatalogPage.ts` владеет состоянием
страницы: loading/error, курсор, total/hasMore, server review summary, слияние
страниц по устойчивому ID и поколение запросов. Один механизм используется
одиннадцатью типизированными адаптерами в `pages/CardLibrary.tsx`.

Адаптеры сохраняют отдельные endpoints, filters, права, сортировку и тип ответа.
Каноничные renderer/preview/detail components, редактирование и bulk tags остаются
явными. Hook не импортирует вычислительный движок, не исполняет команды и не
вычисляет ручной статус проверки.

Устранён регресс обновления статуса: теперь успешное сохранение патчит открытые
строки, hover и detail и отдельно запрашивает серверную статистику (`page=1`,
`limit=1`, тот же search/tag/status query). Запрос не заменяет накопленные страницы,
не включает основной loading и не размонтирует DOM. Ошибка статистики видима
отдельно; отсутствующая/невалидная обязательная summary не заменяется подсчётом
текущей страницы. Полная загрузка каталога ради статистики отсутствует.

Поколения запросов отвергают устаревшие результаты при смене фильтра/авторизации;
более свежая post-save summary не перезаписывается старым page response. Общая
пагинация дедуплицирует входящие IDs и не изменяет исходные массивы. Если сохранение
может изменить состав активного status-фильтра, следующий scroll один раз
перечитывает граничную страницу с dedup: сдвиг offset не пропускает новую строку.

## Проверка

- `outputs/testing/ref02-final.json`: 75/75 assertions, семь файлов,
  ноль skip. Это адресный набор с пересекающимися TEST-05 fixture исправлениями.
- Новый `useLibraryCatalogPage.test.tsx`: две разновидности данных, переход page1→2,
  старый успешный/неуспешный запрос, сохранение DOM/scroll/cursor, гонка summary/page,
  отсутствие обязательной summary, отдельная ошибка статистики, смена фильтра
  и изменение offset после выхода строки из фильтра.
- `CardLibrary.test.tsx`: серверные полные counts при одной странице, OR-фильтр,
  сохранение detail/row/scroll/URL при двух разных новых статусах; существующие
  admin/logout, search debounce/back/forward, mobile и entity group contracts.
- Fresh stack `test_86e66f54dedf2c9f418f9227`: `tsc -b`, Vite build и все реальные
  E2E **11/11**, 30.5 s, 0 retries/skips/flaky, строгий receipt verifier прошёл.
  В том числе новый server-summary browser test с настоящим settings checkbox.
- `uiBuild.reused=false`; `indexHash`:
  `1d11c73fe23354cbb82ab9ee67a471fb2e8a251cd6730e2f7c0fc8be33d1ca1d`;
  pinned build manifest:
  `f10510b92869b9b3adaae46cb342248e3f2fb08c1a001f03d28065d7730857b1`.
  Registry status после проверки `stopped`. Последующий небольшой boundary-page
  guard проверен адресно в 75/75; новый общий core/tsc/браузерный receipt root
  запишет после стабилизации всех параллельных изменений.
- [REF-02-library-build.json](REF-02-library-build.json): наблюдаемое сравнение
  retained builds. Дополнительный JS CardLibrary: 355882→351742 bytes;
  entry JS: 460484→464634. Параллельно менялись другие UI modules, поэтому это
  не причинная оценка ускорения от данного refactor. В entry closure не появились
  именованные engine/handler/materialization chunks. Полный route graph сохранён.

Исходные engine cwd-dependent fixtures и UtilityPages CSS/source paths исправлены
без ослабления assertions; подробности и итог полного expanded набора — TEST-05.

## Границы и откат

API/схема БД/механики/прошлые artifacts этим срезом не меняются. Фоновая metadata
выборка содержит одну строку для совместимости с существующим list endpoint;
отдельный summary endpoint для этого среза не требуется. Производительность
подтверждена количеством запросов, но отдельный React CPU profile не снимался.

Откат — вернуть page orchestration вместе с hook/tests одним срезом, сохранив
server-side review contract. Не возвращать all-pages traversal ради counts или
автоматический сброс открытого detail при сохранении статуса.
