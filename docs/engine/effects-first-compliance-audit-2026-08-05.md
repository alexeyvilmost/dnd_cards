# Аудит соответствия effects-first архитектуре — 2026-08-06

**Область:** micro-MVP, production content, legacy character sheet и новый
`rules-core`.

Эталон архитектуры зафиксирован в
[`effects-first-authoring-invariants.md`](./effects-first-authoring-invariants.md).
Этот аудит не подменяет acceptance: статус становится зелёным только после
materialization в production, повторного экспорта exact snapshot и прохождения
live certification на этих байтах.

Текущий release-candidate остаётся локальным: production-код, schema, content и
certification support этим кандидатом ещё не изменялись. Все pins и counts ниже
описывают source candidate, а не production evidence.

## Итог

Проект движется в правильном направлении, но пока является переходной системой,
а не полностью effects-only runtime.

| Область | Статус | Наблюдение |
|---|---|---|
| Унифицированная mechanics-модель | соответствует | activation/targeting/resolution/result и generic payload уже являются общим языком действий, заклинаний и эффектов |
| Состояния PHB 2024 | соответствует после materialization | 15 состояний объявляются Effect-записями; source-aware ограничения, stacking, rest и thresholds читаются generic-интерпретаторами |
| Weapon Mastery PHB 2024 | соответствует после materialization | восемь свойств выбираются через `mechanics.weapon_mastery.type`; интерпретатор не ветвится по UUID, card number или названию |
| Оружейные Card micro-MVP | соответствует после materialization в заявленной границе | 12 достижимых видов имеют строгий `mechanics.weapon_profile`; engine, rules-core, Pact Blade, equipment и sheet читают один parser; Heavy threshold и ammo/range actor binding принадлежат данным |
| Пакты Колдуна L1 в canonical release/`rules-core` | соответствует после materialization | Blade, Chain и Tome выбираются через `mechanics.primitive` (`pact_blade_bond`, `pact_chain_familiar`, `pact_tome_book`) и объявленные capability/choice/resource references; UUID и card number остаются только provenance и compile-scope identity |
| Пакты и фамильяр на реальном V3-листе | частично, fail-closed | лист проецирует только скомпилированные capabilities/actions/choices: поддержаны dismiss/reappear фамильяра, Blade conjure/touch-existing, замена уже объявленного Tome-набора после отдыха и полностью разрешённая передача явно помеченного Touch-заклинания между двумя writable owner-листами одного аккаунта; Chain attack, attack/save/reaction continuations, cross-owner и online encounter не симулируются и показывают явную причину недоступности |
| Bounded action-use recovery | соответствует после materialization | `mechanics.uses.recovery` задаёт fixed Short Rest и full Long Rest; один generic interpreter обслуживает любое действие, не выбирая Second Wind по identity |
| Harmful interaction intent | соответствует после materialization | 9 наносящих урон заклинаний и 5 вариантов Дыхательного оружия явно объявляют `mechanics.interaction.intent = harmful`; Charmed не выводится из имени или формы payload |
| Исправления micro-MVP контента | соответствует после materialization | entity-specific overlay переносится в versioned JSON patch с CAS, preimage, rollback и verify-only/no-op gate |
| Outcome boundary | соответствует в поддержанном срезе | правила коммитят HP delta, Effect lifecycle или movement intent; предметные lifecycle-команды отделены |
| Детерминизм/replay | соответствует в `rules-core` | RNG, clock, IDs и pending decisions явны и сериализуемы |
| Exact sheet primitive catalog | соответствует в заявленном no-pending срезе | каталог byte-bound к compiled release и включает 12 Weapon Card, 8 Weapon Mastery Effect, closure `grant_effect` dependencies и поддержанные no-pending primitives; несовпавшая release identity или неполная closure закрывает исполнение до цены |
| Реальные character sheets | частично, граница видима | поддержанный no-pending срез и lifecycle пактов/фамильяра идут через canonical `rules-core`; остальной `executeAction` остаётся compatibility/local-legacy, а attack/save/reaction continuations fail-closed |
| Sheet persistence | соответствует в узкой границе | single-sheet и одна команда над двумя writable owner-листами одного аккаунта используют backend `runtime-command`, exact participant lifecycle, revision CAS, стабильный lock order и UUID idempotency; cross-owner не заявлен |
| Manual Effect UI | частично, не semantic authority | desktop и mobile блокируют online-sheet и пишут detached `active_effects` с revision CAS, но state и event/journal не коммитятся одной общей semantic command |
| Shared/server rules authority | не реализовано | backend авторизует и упорядочивает encounter-записи, но command worker с тем же rules artifact ещё не исполняет игровые намерения и не валидирует семантику action/spell |
| Concurrent encounter transport | соответствует в заявленной границе | каждая операция требует `expected_seq`, сериализуется под row lock, проверяет ownership/GM authority и публикуется через SSE; stale writer получает `409` |
| Универсальные system actions | частично | Attack, Weapon Attack, Unarmed Strike и grapple lifecycle пока объявлены как frozen D&D 2024 ruleset definitions в `systemActions.ts`; handlers generic, но сами параметры ещё не являются Effect-записями release/БД |
| Action/Spell физически как Effect | частично | таблицы пока раздельные; нормализатор приводит их к одной mechanics-модели во время компиляции |

## Что считается допустимым кодом движка

В runtime допустима ветка по типу повторно используемого примитива, например
`damage`, `condition`, `modifier`, `summon_actor`, `weapon_mastery.type` или типу
сериализуемого continuation. Все числа, формулы, источники, ограничения,
длительности, цели и цены должны приходить из `mechanics` и ruleset release.

UUID, `card_number`, локализованное имя и текст описания допустимы в:

- versioned content patch и миграционном CAS;
- immutable release manifest и certification evidence;
- UI-ссылках и provenance;
- тесте, который выбирает конкретную production entity для проверки её правила.

Они не должны выбирать поведение внутри generic handler/interpreter.

## Аудит identity-dispatch в production-путях

Проверены `frontend/src/engine`, non-test пути `rules-core` и оркестрация
реального character sheet. Manifest/compiler mappings, CAS-патчи и тестовый
выбор production entity не считаются runtime-dispatch: там identity является
provenance или compile scope, а не условием поведения.

| Приоритет | Граница | Результат |
|---|---|---|
| P1, micro-MVP | Fighter fallback в `engine/breakdown.ts` выводил владение спасбросками и d10 из ключа класса | исправлено: breakdown читает только явные `saveProficiencies` и `hitDie`; отсутствие фактов даёт generic d8 и не дарит владение; regression покрывает старую ошибку |
| P1, micro-MVP | Публичный read-only V3-лист можно было выбрать целью action/spell вне encounter, а отказ target PATCH проглатывался | исправлено: read-only цель недоступна в picker, write failure останавливает действие и показывается пользователю |
| P1, micro-MVP | Ручное наложение/снятие Effect могло уйти через generic persistence в encounter authority после устаревшего detached-снимка | исправлено fail-closed: desktop/mobile UI и handler блокируют известный online-sheet, detached mutation пишет только `active_effects` с `runtime_revision` CAS и повторно проверяет server response; join-race не перенаправляется в encounter Apply. Это не общий атомарный semantic authority: desktop journal идёт отдельным шагом, mobile не создаёт сертифицированный command journal |
| P1, micro-MVP | Оружейный runtime читал `weapon_type`, damage/range/properties, `enchant_bonus`, attunement и локализованные tags/name из разных legacy-полей | исправлено для 12 достижимых оружий: единый строгий `mechanics.weapon_profile`, actor-bound targeting/ammo, fail-closed parser и schema; legacy divergence покрыта тестами |
| P1, до mini-MVP | Pact Chain familiar statblocks находятся в TypeScript-каталоге | известный долг: templates должны приехать из versioned MM release; `summon_actor` остаётся generic primitive |
| P1, вне atomic-authority claim | generic legacy-действие между двумя V3-листами сохраняет сначала цель, затем источник двумя HTTP-запросами | fully-resolved same-account familiar Touch использует один `runtime-command` с exact participant set, UUID idempotency key и CAS двух writable owner-листов; для остальных legacy action/spell target failure останавливает списание источника, но потеря ответа/ошибка второго запроса всё ещё может оставить односторонний результат |
| P1, вне доказанной shared-authority границы | `encounter.apply` принимает уже рассчитанные client patches; transport проверяет `expected_seq`, ownership/GM authority и сериализует запись под row lock, но не проверяет action/spell provenance, цену, DC или release hash | не расширять production claim: CAS доказывает порядок transport-записей, а не корректность игровой семантики; для shared rules authority нужен server-side command validation/replay тем же rules artifact |
| P2, micro-MVP | Pact Blade adapters нормализовали legacy category/tags и дублировали Card adapter | исправлено: оба пути используют общий `pactBladeWeaponCardSnapshot`, построенный тем же `weapon_profile` parser; legacy Card tags не авторизуют магическое оружие |
| Явная граница | Брошенное оружие на дистанции ≤ reach сейчас выбирает melee mode; сам предмет не перемещается и не расходуется | не заявлять полной поддержкой thrown: нужен UI mode selector и отдельный item-lifecycle/transfer primitive |
| P3, UI compatibility | `character/abilityDisplay.ts` использует legacy prefix/заголовок как presentation fallback | не влияет на mechanics execution; удалить после полной materialization display metadata |

`SYSTEM_ACTION_IDS` являются идентификаторами стабильных engine-примитивов, а
не entity-specific dispatch. Это не снимает долг frozen definitions из пункта
4 ниже. Аналогично, display labels для объявленного resource key и reference
resolution по `card_number` не считаются авторизацией игрового поведения.

## Оставшийся архитектурный долг

1. `microMvpL1Overlay.ts` должен остаться только совместимым миграционным
   adapter и стать no-op для materialized release; тесты приёмки обязаны читать
   raw production snapshot без подмены mechanics.
2. Armor of Agathys, Protection, Alert, Stonecunning, fighting styles,
   Two-Weapon Fighting, bounded recovery Второго дыхания и три пакта Колдуна
   уже авторизуются по mechanics/capability без выбора поведения по имени или
   pinned UUID. В частности, `microMvpL1Overlay.ts` связывает Blade, Chain и
   Tome через data-owned primitive declaration; отдельный тест заменяет UUID
   созданного эффекта Воровского жаргона и доказывает, что relation класса
   материализуется из каталога, а не из UUID-ветки компилятора.
3. Стат-блоки форм Pact Chain сейчас находятся в TypeScript-каталоге. До
   mini-MVP их нужно перенести в versioned MM content release/БД; код должен
   только валидировать и материализовывать `summon_actor` template.
4. `rules-core/systemActions.ts` остаётся явным архитектурным долгом: числа,
   формулы и ограничения Attack/Weapon Attack/Unarmed Strike/grapple lifecycle
   записаны в TypeScript. Сейчас это frozen built-in ruleset declaration, а не
   entity-specific dispatch, поэтому generic handlers и replay детерминированы.
   Целевое состояние — перенести эти definitions в immutable rules release/БД
   как Effect с activation/cost/mechanics; код оставляет только primitive и
   continuation interpreters. До этого нельзя заявлять полную effects-only
   архитектуру, даже если сценарии system actions зелёные.
5. Встроенный offline-реестр состояний является recovery fallback и дублирует
   production данные. Целевое состояние — генерировать fallback из того же
   immutable release, а не редактировать два независимых источника.
6. Реальный sheet и Rules Lab используют разные authority adapters. Лист теперь
   явно показывает compatibility/local-legacy notice и не называется
   canonical/shared; Rules Lab прямо сообщает об isolated IndexedDB authority.
   Поддержанные single-sheet операции и полностью разрешённый familiar Touch
   сохраняются через backend `runtime-command`: для двух writable owner-листов
   одного аккаунта команда фиксирует exact participant set, ожидаемые revisions,
   стабильный lock order и UUID idempotency key. Это не является общим
   server-side rules worker: cross-owner, attack/save/reaction continuations и
   online encounter остаются закрытыми. Сам notice устраняет ложный claim, но не
   устраняет техническое расхождение остальных исполнителей.
7. Полная геометрия отложена. Любое правило расстояния сейчас обязано получать
   явные `SpatialFacts`; линия обзора и направленная видимость являются разными
   фактами. Movement сохраняется как intent/event и не должно притворяться
   выполненным без board authority.
8. Shared encounter transport теперь имеет обязательный revision-CAS:
   `expected_seq` проверяется под row lock, stale writer получает `409`, а
   ownership/GM authorization и SSE закрывают заявленную границу доставки.
   Это не делает backend rules authority: клиент по-прежнему присылает готовые
   patches. Реакция на уже рассчитанное попадание и сохранение source/target
   через разные endpoint не образуют одной игровой транзакции. Например, смена
   temp HP между вычислением реакции и коммитом остаётся семантическим конфликтом,
   который должен разрешать будущий server-side command/event replay с единым
   rules artifact.

## Состояние текущего release-candidate на 2026-08-06

- Production-контент ещё не изменён. Свежий pre-A dump/restore proof и
  двухклоновый локальный drill текущего кандидата готовы; production plan,
  deployment attestation, release evidence и production postimage появятся
  только после commit A/B в порядке runbook.
- Patch `1.5.0` объявляет 108 целевых сущностей: cards 12, effects 52,
  actions 9, spells 26, races 2 и classes 7. На свежем production snapshot три
  декларации уже exact (`EFF-divine-order`, `RACE-0002`, `RACE-0008`), поэтому
  фактический plan содержит 105 writes: 100 update и 5 create, включая две
  отсутствующие condition rows.
- Current source pins:
  - patch — `sha256:7a07f8b1ed3483370093c67277363d0b1a95852126db1ab124eabc813b6c5bc7`;
  - overlay — `sha256:980678c4ab6c2d696b150142ce3ab2e3fa52bbc49cee5c9844b2535542aed108`;
  - compiled content — `sha256:6b04b93ad93476c2e57224f902d1a0739e1ff3fa4994e9d36f6e77d7b927ff48`;
  - compiled release — `sha256:8568dc40ae99dd4ea3d981799941e510445a682a107aece7c62a752593a8689c`.
- Exact sheet primitive catalog привязан к этой release identity. Его closure
  включает 12 Weapon Card, все 8 Weapon Mastery Effect, транзитивные
  `grant_effect` dependencies и поддержанные no-pending primitives. Missing,
  extra, changed или pending-only declaration отвергается fail-closed.
- Поддержанная persistence-граница — single-sheet и одна atomic
  `runtime-command` над двумя writable owner-листами одного аккаунта. Exact
  participant lifecycle, revision CAS, lock order и idempotency проверяются;
  cross-owner и online encounter в micro-MVP claim не входят.
- Manual effects на desktop и mobile имеют detached revision-CAS, но не одну
  атомарную semantic authority для state + journal. Desktop journal отделён от
  state write, mobile не создаёт certified command journal; online-sheet
  mutation запрещена.
- Declarative companion bridge является implementation evidence. Touch
  определяется `mechanics.targeting.requires_touch`, а не локализованным
  названием или описанием; это не переносит coverage canonical `rules-core` на
  весь legacy UI.
- Thrown остаётся ограниченным: при дистанции не больше reach выбирается melee
  mode, explicit mode selector отсутствует, брошенный предмет не
  перемещается/расходуется/передаётся.

### Актуальная restored-production evidence

Fresh archive
`prod-before-micro-mvp-20260806T055629Z.dump` имеет SHA-256
`c4550c89d4404482756ed06ae393a5f18c7825e11343644f0bedccf3a7105768`,
TOC 608 и успешный PostgreSQL 17.10 restore proof. На двух заново
восстановленных клонах patch 1.5.0 прошёл plan 105 → apply 105 → no-op 0 →
rollback 105 → replan 105; все пять create receipts остались audit-записями со
статусом `rolled_back`, а созданные Effect физически отсутствуют.

Drill также нашёл и закрыл precision-баг create receipt: GORM nanoseconds не
совпадали с PostgreSQL microseconds. Сервер теперь выпускает receipt только из
повторно загруженного persisted postimage; отдельная PostgreSQL regression и
сравнение пяти receipt/current hashes подтверждают исправление.

### Историческая superseded evidence

Предыдущий schema-v4 drill на двух PostgreSQL 17 клонах старого dump дал 90
операций и проверил crash-safe apply/no-op/rollback старого bundle. Он относится
к superseded patch `1.2.0`–`1.4.0`, не заменяет актуальный 105-write drill, не
является production evidence и не может использоваться для apply. Его точные
исторические параметры сохранены только в migration runbook для аудита
протокола.

## Обязательные gates перед production

1. Проверенно восстанавливаемый полный `pg_dump` и его SHA-256.
2. Exact API preimage всех затрагиваемых строк и rollback bundle.
3. Dry-run с совпавшими expected-before hashes; любой drift останавливает apply.
4. Mechanics schema + interpreter allowlist validation до первой записи.
5. Idempotent apply и exact postimage verification.
6. Повторный production snapshot, новый reviewed content hash и live compile.
7. Unit evidence и последовательный two-PC scenario для каждой заявленной
   condition/mastery/entity obligation.
8. Browser smoke на реальном временном V3-персонаже, затем его удаление, плюс
   read-only smoke существующих листов.
9. Последний release gate `deployment_health`: один exact 40-hex commit должен
   одновременно совпасть с backend `/api/health.source_commit` и frontend
   `/build-info.json.source_commit`; mismatch/missing/malformed закрывает release.
