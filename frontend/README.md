# Bag of Holding Frontend

Frontend приложение для сервиса создания карточек D&D на React + TypeScript.

## Требования

- Node.js 20+
- npm или yarn

## Установка и запуск

### 1. Установка зависимостей

```bash
npm install
# или
yarn install
```

### 2. Настройка переменных окружения

По умолчанию фронтенд использует Railway production backend: `https://backend-production-41c3.up.railway.app`

Для локальной разработки создайте файл `.env` в корне frontend папки:

```env
VITE_API_URL=http://localhost:8080
```

**Быстрое переключение:**
- **Production (Railway)**: удалите или закомментируйте `VITE_API_URL` в `.env`
- **Localhost**: установите `VITE_API_URL=http://localhost:8080` в `.env`

Также можно изменить прокси в `vite.config.ts` для dev-сервера (см. комментарии в файле).

### 3. Запуск в режиме разработки

```bash
npm run dev
# или
yarn dev
```

Приложение будет доступно по адресу `http://localhost:3000`

### 4. Сборка для продакшена

```bash
npm run build
# или
yarn build
```

## Структура проекта

```
src/
├── api/           # API клиент
├── canon/         # pinned content compiler и versioned overlay
├── components/    # React компоненты
├── rules-core/    # детерминированное ядро WorldState/Command/Event/replay
├── rules-session/ # атомарный persistence gateway (IndexedDB/local authority)
├── pages/         # Страницы приложения
├── types/         # TypeScript типы
├── App.tsx        # Основной компонент
├── main.tsx       # Точка входа
└── index.css      # Стили
```

## Функциональность

### Библиотека карточек
- Просмотр всех созданных карточек
- Поиск по названию
- Фильтрация по редкости и свойствам
- Генерация изображений через ИИ
- Редактирование и удаление карточек

### Конструктор карточек
- Создание новых карточек зелий
- Предварительный просмотр в реальном времени
- Валидация формы
- Автоматическая генерация изображений

### Экспорт карточек
- Выбор карточек для экспорта
- Экспорт в PDF для печати
- Разметка для резки (16 карт на А4)
- QR-коды для быстрого поиска

## Технологии

- **React 18** - UI библиотека
- **TypeScript** - типизация
- **Tailwind CSS** - стилизация
- **React Hook Form** - управление формами
- **React Router** - навигация
- **Axios** - HTTP клиент
- **Lucide React** - иконки
- **QRCode** - генерация QR-кодов
- **jsPDF** - создание PDF
- **Vite** - сборщик

## Размеры карточек

- **Размер**: 52.5мм x 74.25мм
- **Расположение**: 4x4 на А4 листе
- **Стиль**: Фэнтези-минималистичный
- **Цвета рамок**: по редкости (белый, зеленый, синий, фиолетовый, оранжевый)

## Разработка

### Тесты micro-MVP

Основные локальные ворота:

```bash
cd frontend
npm run test
npm run test:micro:manifest
npm run test:micro:matrix
npm run test:rules:coverage
npm run test:rules:primitives
npm run test:micro:coverage
npm run test:browser
```

Публичный `/rules-lab` исполняет checked-in compiled artifact в двух-PC
сценариях, сохраняет мир в IndexedDB и проверяется Playwright на desktop и
mobile Chromium. Записи Character Forge в E2E изолированы и не отправляются в
production DB.

Для persisted production certification отдельные команды выше недостаточны.
Команда `npm run content:evidence:micro` требует `--api`, `--frontend`,
`--artifact`, `--source-commit` и `--expected-deployed-commit`, выполняет полный 16-gate
контракт и пишет 0600 artifact. Strict micro/integration/browser-наборы не
допускают skip/todo; общий `npm test` также обязан пройти без пропусков, а
`test:mvp` запускается с live-контентом без skip и допускает только три
закреплённых по полному имени post-micro-MVP `todo`. Последним gate генератор
live-проверяет один exact 40-hex commit одновременно в backend `/api/health` и
frontend `/build-info.json`; несовпадение любого сервиса закрывает release. Затем
`content:certify:micro` требует тот же файл через `--evidence`. Полный безопасный
порядок dump/plan/apply/rollback и требования к двум disposable PostgreSQL DSN описаны в
`../docs/micro-mvp-production-content-migration.md`.

Live-matrix блокирует release по `verify-only` materialization и exact SHA-256
скомпилированной semantic projection 448 корней. Назначенные production DB
UUID канонизируются в однозначные catalog identities, поэтому surrogate ID не
подменяет семантику правила. Полный каталог
фиксируется отдельно для диагностики и evidence→apply TOCTOU; поэтому
новые неиспользуемые сущности mini-/part-MVP не ломают micro-MVP gate,
но любое изменение каталога после сбора evidence всё ещё fail-closed.

Production browser gate проверяет уже развёрнутые frontend, backend и реальные
CharacterV3-записи. Малый обязательный spine использует один canary-аккаунт,
стартует с пустой Кузни и кликает реальные контролы вида, наследия, предыстории,
класса, заклинаний и обязательных выборов. Он запрещает незавершённую сборку,
проверяет изображения, UX-бюджеты и дублирующиеся GET, создаёт лист и открывает
отдельный бой с реально спроецированным оружейным действием:

```bash
LIVE_BROWSER_CANARY=1 \
LIVE_BROWSER_BASE_URL=https://bagofholding.ru \
LIVE_BROWSER_API_URL=https://bagofholding.ru \
EXPECTED_DEPLOYED_COMMIT=<exact-40-hex-commit> \
LIVE_BROWSER_USER_A=<configured-user-a> \
LIVE_BROWSER_PASSWORD_A=<from-secret-store> \
npm run test:browser:live:nightly
```

Этот набор запускает три независимых production-пути: lineage/ranged/reaction,
martial/spell и full-caster/world spell. Он выполняется ночью и вручную job-ом
`live-browser-spine` из CI. После каждой production-выкладки он является
обязательной release-проверкой с `expected_deployed_commit`, равным выложенному
SHA. Push в `main` автоматически ждёт этот exact SHA в production до 45 минут и
затем запускает тот же набор, поэтому проверка не зависит от ручного dispatch.
Пароль хранится только в
GitHub Actions secrets; отсутствие canary credentials делает job красным, а не
превращает проверку в skip.

Расширенный transport canary требует два разных заранее созданных аккаунта и
явное разрешение на временные записи:

```bash
LIVE_BROWSER_CANARY=1 \
LIVE_BROWSER_BASE_URL=https://bagofholding.ru \
LIVE_BROWSER_API_URL=https://bagofholding.ru \
EXPECTED_DEPLOYED_COMMIT=<exact-40-hex-commit> \
LIVE_BROWSER_USER_A=<configured-user-a> \
LIVE_BROWSER_PASSWORD_A=<from-secret-store> \
LIVE_BROWSER_USER_B=<configured-user-b> \
LIVE_BROWSER_PASSWORD_B=<from-secret-store> \
npm run test:browser:live
```

Критический сертификат одного реального листа (Кузня → Воин с «Посвящённым
в магию» → Длинный лук → Пугало → новый ход → «Волна грома») требует только
аккаунт A и запускается отдельно через `npm run test:browser:live:sheet`.
Перед действиями он сравнивает exact commit из `/api/health` и
`/build-info.json` с `EXPECTED_DEPLOYED_COMMIT`, поэтому старый публичный релиз
не может выдать новый сертификат.

Production-target жёстко закреплён за этими двумя origin; альтернативой может
быть только явный `localhost`/`127.0.0.1` origin без path/query/fragment/userinfo.
Перед запуском сам spec отдельно типизируется через
`npm run test:browser:live:typecheck`.

Canary создаёт по одному временному персонажу у каждого аккаунта, объединяет
их в encounter, проверяет последовательный `expected_seq`, входящий спасбросок
и его разрешение вторым игроком через UI/SSE, изменение HP, канонический
condition, журнал, переход хода из UI мастера и reload реального листа. В
`finally` он закрывает браузерные контексты, удаляет encounter атомарным API и
сметает оба листа по уникальному cleanup-marker (включая случай потерянного
create-response); ошибка cleanup делает gate красным и требует ручной проверки.
Запускать его следует после materialization и certification контента, когда UI
уже видит новый verified release.

Граница этого canary намеренно транспортная. Pending save создаётся
синтетическим payload (`DC 99`, `hpDelta 3`), после чего spec проверяет реальный
JWT/ownership, CAS под row lock, SSE, UI-разрешение, CharacterV3/encounter DB и
канонический lifecycle состояния Prone. Backend всё ещё принимает уже
рассчитанные клиентом patches, а source/target не коммитятся одной транзакцией.
Поэтому зелёный canary доказывает работоспособность реального transport/UI/DB,
но не исполнение production action/spell mechanics и не server command
authority; эти правила принимаются matrix/primitive/two-PC semantic gates на
точном materialized release.

### Добавление новых компонентов

1. Создайте файл в папке `components/`
2. Используйте TypeScript для типизации
3. Следуйте соглашениям по именованию
4. Добавьте JSDoc комментарии для сложной логики

### Стилизация

- Используйте Tailwind CSS классы
- Создавайте кастомные классы в `index.css` при необходимости
- Следуйте дизайн-системе проекта

### API интеграция

- Все API вызовы через `api/client.ts`
- Обработка ошибок в компонентах
- Типизация запросов и ответов
