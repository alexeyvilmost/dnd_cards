# Движок BG3: как устроен, стоит ли переходить, что забрать в разрешении событий

> Дата: 2026-07-07. Спутник к [`engine-architecture-review-2026-07-07.md`](engine-architecture-review-2026-07-07.md)
> и [`engine-remediation-plan-2026-07-07.md`](engine-remediation-plan-2026-07-07.md).
> Источники: реверс-инжиниринг Norbyte/bg3se (заголовки C++ структур — реальные имена
> рантайма), LSLib, доки Larian, bg3.wiki / wiki.bg3.community, форумы. Пометки:
> **[FACT]** — подтверждено первоисточником; **[STRONG]** — устойчиво по многим модерским
> источникам; **[COMMUNITY]** — домысел сообщества.

---

## 1. Как реально устроен движок BG3

Официального исходника нет. Но BG3 Script Extender (bg3se) — это реверс C++-структур
живого рантайма, поэтому имена компонентов/систем ниже — **настоящие имена движка**.

**Базовый движок — Divinity 4.0, свой C++ ECS** [FACT]. Не Unity/Unreal, не EnTT
(«BG3 на EnTT» — [COMMUNITY], не подтверждается). Игровые объекты — сущности из
компонентов; рантайм опрашивается через `Ext.Entity`. Компоненты несут реальные
namespace-префиксы: `eoc::` (общая игровая логика), `esv::` (сервер), `ecl::` (клиент) —
явный **server/client split с репликацией** (`Replicate`, `SetReplicationFlags`,
`GetNetId`), это фундамент дроп-ин кооп-режима: боевая/статовая логика авторитетна на
сервере, клиент зеркалит реплицируемые компоненты. Есть покадровый трекинг мутаций
(`WasAdded/WasRemoved/GetChangedComponents`) — data-oriented модель «изменения батчатся
по тику».

**Три слоя правил** [FACT] — чистое разделение, которое стоит копировать:

| Слой | Форма | Ответственность |
|---|---|---|
| **Osiris** | Prolog-подобный VM, компилируется в `.osi` | Квесты, триггеры, флаги диалогов, реакции мира (факты/правила/цели, событийно) |
| **Anubis** | скрипт Larian | Поведение/ИИ NPC |
| **Stats** | декларативные `.txt` данные | Боевые правила: заклинания, статусы, пассивки, бусты, функторы |
| **C++ ECS-ядро** | скомпилировано | Исполняет резолвер, держит состояние сущностей, реплицирует |

Ключевое: **Osiris НЕ считает боевую математику** — он реагирует на боевые события и
крутит глобальную логику. Дайс/урон/DC делает Stats-система + C++-резолвер. Это ровно
наш паттерн «конструктор (данные) + интерпретатор (ядро)», но провалидированный на
AAA-масштабе.

### Резолвер заклинания/действия — конвейер [FACT/STRONG]
Заклинание — запись `.txt` типа `SpellData`. Поля — контракт резолвера:
- `SpellType` — категория диспетчеризации (`Projectile/Target/Zone/Shout/…`) → выбирает
  C++-обработчик и режим таргетинга.
- `SpellRoll` — **гейт броска**: `Attack(AttackType.RangedSpellAttack)` |
  `SavingThrow(Ability.Dexterity, SourceSpellDC())` | `SkillCheck(...)`.
- `SpellSuccess` — функторы при успехе броска (атака попала / **цель провалила спас**).
- `SpellFail` — функторы при провале (промах / цель спаслась); для «спас вдвое» — половина.
- `SpellProperties` — функторы, что выполняются **всегда при касте**, независимо от броска
  (поверхности, самобаффы, концентрация).
- `TargetConditions` — булев фильтр целей (`Character() and not Dead()`).
- `UseCosts` — ресурсы (`ActionPoint:1`, слот).

**Последовательность:** таргетинг+`TargetConditions` → оплата `UseCosts` → `SpellRoll` по
каждой цели → ветка `SpellSuccess`/`SpellFail` → всегда `SpellProperties` → исполнение
функторов (каждый гейтится `IF(cond)`). Инверсия имён: `SpellSuccess` = **успех кастера**
= цель ПРОВАЛила спас.

**Урон-подпайплайн** [FACT]: `DealDamage()` создаёт **отдельный инстанс урона**, который
можно независимо бустить; `WeaponDamage()` — «воспитанный» бонус только к триггерной атаке;
`DamageBonus()` — к каждому инстансу. Сопротивление+уязвимость одного типа гасятся;
иммунитет — отдельно.

### Boost vs Functor — главный архитектурный урок [FACT — из C++-заголовков]
Два ортогональных механизма, подтверждённых именами структур в `Boosts.h`/`Stats.h`:
- **Functor = императив, событийный, fire-and-forget.** «Немедленное изменение состояния»
  на конкретном контексте (`OnCast/OnHit/OnEquip/OnStatusApplied/OnTurn…`). Рантайм-хук
  `ExecuteFunctor` «срабатывает перед исполнением функтора».
- **Boost = декларативный, непрерывно суммируемый модификатор.** `AC(1)`, `Ability(Cha,+1)`,
  `Advantage(...)`, `Resistance(Fire,Resistant)`, `SpellSaveDC`… Хранятся в
  `BoostsContainerComponent`; отдельный `BoostInfoComponent` на каждый инстанс (**причина/
  owner/тип** — это гранулярность, наша парадигма №4). `esv::boost::BoostSystem` —
  «центральная система обработки». Изменение бустов штампует
  `ChangedEventOneFrameComponent` → **dirty-флаг** → `StatsSystem` пересчитывает производные
  (КЗ, характеристики, DC, резисты) **декларативно из текущего набора бустов**. Есть
  `Ext.Stats.GetCachedBoost` — бусты **кэшируются/агрегируются**, не пересчитываются на лету.

Итог: функтор — «что произошло в момент»; буст — «каким мир должен быть, суммируется
всегда». Это ПРЯМО наша парадигма №3 (значение = набор кандидатов → максимум/агрегат) и
лекарство от «двух расходящихся путей модификаторов».

### Script Extender подтверждает архитектуру [FACT]
`Ext.Entity` (компоненты, подписки OnCreate/OnChange, трейсинг) — настоящий компонентный
стор; именованные системы (`ServerSpell/ServerCombat/ServerStats/BoostSystem/
ecl::TimelineSystem`) — классическая ECS; `Ext.Events` (`Tick` ~30 Гц, `StatsLoaded`,
`ExecuteFunctor`) — движок гоняет всё от lifecycle+tick событий; `Ext.Osiris.RegisterListener
("TurnEnded", 1, "after", fn)` (before/after/beforeDelete/afterDelete) — Osiris живой,
хукается серверно.

---

## 2. Шансы перехода на готовый движок — трезвая оценка

Вывод в одну фразу: **исполняемого ядра для React/TS + Go, которое можно «взять и
встроить», не существует.** Реалистичен только путь C.

### A. Взять движок BG3 напрямую — **шанс НУЛЕВОЙ**
- **Юридически:** Divinity 4.0 не лицензируется никому (нет SDK, нет исходника); EULA
  запрещает reverse engineering. Данные BG3 — двойной копирайт Larian + WotC; импорт в
  сторонний продукт нарушает EULA/Fan Content/копирайт.
- **Технически:** нативный C++ desktop-движок, сросшийся с тулчейном (GR2/.pak/LSF/Osiris);
  «вырвать ядро» невозможно и бессмысленно.
- **Контекст:** наш продукт — веб. C++ desktop-движок архитектурно нерелевантен.

### B. Взять другой готовый движок (Foundry dnd5e / Midi-QOL / pf2e) как ядро — **шанс НИЗКИЙ**
- **Барьер НЕ лицензионный** (dnd5e MIT, Midi-QOL MIT, DAE MIT, pf2e Apache 2.0 —
  GPL-заражения в ядре нет; форкать можно).
- **Барьер интеграционный (главный):** движок правил там **не отделён от рантайма
  Foundry**. Логика attack/save/damage зашита в Foundry-классы (`Actor`/`Item` Document,
  `ChatMessage`, `D20Roll`, `Hooks`, `ApplicationV2`); разрешение спелла создаёт
  интерактивные `ChatMessage` с кнопками и апдейтит документы. **Вне Foundry не стартует.**
  Наш критерий «отделяется ли движок от UI/рантайма» стек не проходит — извлечь резолвер =
  переписать его.
- **Единственный headless-кандидат** — `ttrpg-engine-dnd` (event-sourced TS, plan/commit,
  ~25 primitives) — **alpha, один мейнтейнер**, слабее нашего прода (244 механики / 70
  тестов / lint-гейт). В прод-зависимость нельзя.

### C. Остаться на самописном, перенять архитектуру/формат BG3 — **шанс ВЫСОКИЙ (единственный жизнеспособный)**
- **Юридически чисто:** форматы/идеи/системы/методы не копирайтятся (idea/expression;
  дух *Google v. Oracle*). Перенять дизайн boost/functor/status/interrupt и синтаксис DSL —
  легально. Данные берём из **SRD 5.2.1 (CC-BY-4.0, можно коммерчески, нужна атрибуция)**,
  не из распакованных .pak. Прецеденты: LSLib (MIT), GemRB (чистая реимплементация).
- **Технически по адресу:** у нас уже TS-движок (`frontend/src/engine/*`), единый
  `execute.ts`, mechanics(jsonb), payload-роутер, переменные. Архитектура BG3
  (декларативные данные + компилируемый интерпретатор) — это наш паттерн, только зрелее.
  **Переносим дизайн, а не код.**
- **Совпадает с парадигмами:** буст-агрегация = №3; one-boost-per-source = №4; реакции-как-
  данные = №1; чистые предикаты условий = основа №2 (превью «сработает/нет»).
- **Мешает только объём работы** — шину/boost-слой/interrupt-конвейер надо написать самим.
  Но эту работу всё равно придётся делать: вариантов A/B как ядра нет.

### Что реально взять из внешнего мира (не движок, а куски)
- **Данные:** 5e-bits / dnd5eapi (SRD, OGL) — для сидинга. Только данные, не логика.
- **Dice-роллер:** `@dice-roller/rpg-dice-roller` (npm, **MIT**) или `@3d-dice/dice-roller-
  parser` — не изобретать парсер бросков заново.
- **Референсы дизайна:** pf2e **Rule Elements** (фазы `applyAEs → beforeDerived →
  afterDerived → beforeRoll` + предикаты/селекторы — эталон «правила как данные»), Midi-QOL
  reaction-hooks (`isAttacked/isHit`, `thirdPartyReactionTrigger`), event-sourcing
  `ttrpg-engine-dnd` (plan/commit-split).

| Кандидат | Лиц. | Ядро? | Ценность |
|---|---|---|---|
| Движок BG3 (Divinity 4.0) | закрыт | ❌ | недостижим |
| Foundry dnd5e (Activity System) | MIT | ❌ Foundry-lock | референс data-driven activities |
| Midi-QOL | MIT | ❌ Foundry hooks | референс реакций/концентрации |
| pf2e (Rule Elements) | Apache 2.0 | ❌ Foundry pipeline | **лучший референс «правила как данные»** |
| 5e-bits API/DB | MIT/OGL | ✅ (данные) | сидинг SRD |
| rpg-dice-roller | MIT | ✅ (npm) | готовый dice-движок |
| ttrpg-engine-dnd | MIT | ⚠️ alpha | референс event-sourced headless |

---

## 3. Best practices разрешения событий из BG3 → как ложится на наш движок

Ни один пункт не требует ни строки кода Larian, ни байта данных BG3 — только их публично
задокументированный дизайн.

1. **Шина событий = OR-набор битфлагов контекста.** Один enum триггеров
   (`OnCast|OnAttack|OnAttacked|OnDamaged|OnStatusApplied|OnTurn…`), подписка = битовая
   маска, матчинг = одно `AND`. → Закрывает пробел №1 (сейчас `triggered` только для
   `long_rest`). Маска — новое поле mechanics(jsonb), матчинг — в `execute.ts`.
2. **Пары active/passive как отдельные флаги** (`OnAttack`/`OnAttacked`,
   `OnDamage`/`OnDamaged`). Одно действие эмитит два ребра. → Лечит односторонность: точки
   входа второй стороны боя. Проектировать пары сразу.
3. **Интроспекция флага `context.HasContextFlag(current)`** — обработчик знает, чем разбужен,
   и ветвится. → Добавить `context` с текущим флагом в сигнатуру интерпретатора.
4. **Boosts (декларативные, длящиеся, dirty-recompute) vs Functors (императивные,
   одноразовые).** → Самое ценное. Boost-слой = единый агрегатор значений (КЗ, модификаторы,
   DC, резисты), пересчёт по dirty. Наш if/else-каскад КЗ → набор boost-кандидатов =
   парадигма №3, и это же убивает «два пути модификаторов».
5. **Реакции = данные с контрактом**, не код: `{контекст-хук, scope Self/Nearby, условие,
   стоимость, свойства, default Ask/Auto/Disabled, UI-контейнер}`. Shield/Counterspell/OA
   различаются только полями. → Парадигма №1; `default:Ask` даёт «превью решения» (№2).
6. **Ретроактивная правка «брошенного в полёте».** Фазы-паузы `OnPostRoll` (до применения
   броска) / `OnPreDamage` (до применения урона), где значение ещё мутабельно
   (`AdjustRoll(-5)`, `SetReroll`). → Самое инвазивное: наши 4 категории сейчас атомарны;
   нужны окна между «выпало» и «применилось». Без этого Щит/Меткий залп невыразимы.
7. **Малый DSL условий БЕЗ сайд-эффектов** (`HasStatus/IsAbleToReact/Self/Enemy/and/or/not`
   над `context.Source/Target/Observer`). Гейт и исполнение раздельны. → Закрывает
   «when не вычисляется». Расширяем formula-движок булевыми предикатами. Чистота критична
   для превью «сработает/нет» (№2).
8. **Предикат «интересности»** отсекает бессмысленные приостановки (не спрашивать, если
   реакция ничего не меняет). → UX-правило поверх конвейера; заложить в контракт реакции
   сразу. Смыкается с превью (№2).
9. **Экономика реакции = first-class ресурс + «одна подтверждаемая реакция на событие».**
   `ReactionActionPoint:1` тратится атомарно; часть «реакций» (Кара, Скрытая атака) ресурс
   НЕ тратит — решают данные. → У нас уже «ресурсы как пулы»; новый пул + правило в
   конвейере. Почти без нового кода.
10. **Каскад через ту же шину; границы хода/раунда — тоже события.** Снятие статуса эмитит
    `OnStatusRemoved`; урон → проверка концентрации → возможное `OnStatusRemoved`. Начало/
    конец хода эмитит `OnTurn`, что тикает статусы (TickType), будит пассивки, перезаряжает
    ресурсы. → Наш `ход/отдых` становится эмиттером шины; `long_rest`-triggered (единственный
    рабочий сейчас) — частный случай подписчика.
11. **Роли в контексте `Source`/`Target`/`Observer`.** Одно условие адресует всех участников;
    `Observer` — кто реагирует. → Три указателя в объект контекста; обязательно вместе с
    п.2/п.3 — без ролей нельзя «реагирую на чужой бросок».
12. **Жизненный цикл статуса как функторы-хуки + семантика стека.**
    `OnApply/OnTick/OnRemoveFunctors`, `TickType`, `RemoveEvents`, `StackId` +
    `Stack/Ignore/Overwrite/Additive`. → Лечит «состояния захардкожены»: статус = данные с
    хуками (payload-роутер `condition` уже почти умеет) + tick/stack-поля. Парадигма №1.

**Вектор внедрения:** 1–3, 7, 10–11 — фундамент (шина + контекст + роли), дёшево на
`execute.ts`; 4 (boost-слой) — самое ценное, наша №3; 5–6, 8–9 (реакции) — следующий слой,
инвазивен из-за ретроактивных окон (п.6); 12 — параллельная чистка состояний. Совпадает с
порядком C→B→A→D→E→F из плана исправлений.

---

## Источники
- bg3se (API/ECS/события/Osiris-мост): https://github.com/Norbyte/bg3se/blob/main/Docs/API.md
- bg3se Boosts.h (BoostSystem, dirty-recompute, cached boost): https://github.com/Norbyte/bg3se/blob/main/BG3Extender/GameDefinitions/Components/Boosts.h · Stats.h: https://github.com/Norbyte/bg3se/blob/main/BG3Extender/GameDefinitions/Components/Stats.h
- Osiris: https://wiki.bg3.community/Information/Osiris · https://docs.larian.game/Osiris_Overview
- SpellData/резолвер: https://wiki.bg3.community/en/Information/Spells/Spell-Data · /Spell-Rolls · https://bg3.wiki/wiki/Damage_mechanics
- Foundry dnd5e (MIT): https://github.com/foundryvtt/dnd5e · Activity System: https://deepwiki.com/foundryvtt/dnd5e/4.1-activity-system
- Midi-QOL (MIT): https://gitlab.com/tposney/midi-qol · DAE: https://gitlab.com/tposney/dae
- pf2e Rule Elements (Apache 2.0): https://github.com/foundryvtt/pf2e/wiki/Quickstart-guide-for-rule-elements
- 5e-bits (MIT/OGL): https://github.com/5e-bits/5e-database · dice-роллер (MIT): https://www.npmjs.com/package/@dice-roller/rpg-dice-roller
- ttrpg-engine-dnd (MIT, alpha): https://libraries.io/npm/ttrpg-engine-dnd
- LSLib (MIT, реверс форматов): https://github.com/Norbyte/lslib · SRD 5.2.1 (CC-BY): https://www.dndbeyond.com/srd
