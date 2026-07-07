# План исправлений движка (по итогам архитектурного обзора)

> Дата: 2026-07-07. Основан на [`engine-architecture-review-2026-07-07.md`](engine-architecture-review-2026-07-07.md).
> Все интеграционные точки (файлы/строки/сигнатуры) сверены с кодом отдельным
> разведывательным проходом. Язык движка — TS в `frontend/src/engine/` +
> `frontend/src/character/`. Бэкенд хранит `mechanics` как **непрозрачный jsonb**
> (`Card.Mechanics *JSONMap`, `models.go:393`) → добавление полей в payload
> **не требует миграций** (кроме сущности «Состояние», §D2).

## 0. Принципы плана

1. **Без big-bang.** Каждая фаза — самостоятельный PR, за зелёными тестами
   (`npm run test:mvp`, lint-mechanics-гейт над 244 механиками). Публичные сигнатуры
   сохраняем/оставляем deprecated-алиасы, чтобы не трогать десятки колл-сайтов разом.
2. **Данные, не код.** Каждое изменение сдвигает вещь из хардкода в данные сущности
   (парадигма №1). Где вводим слой — сразу даём ему превью (парадигма №2).
3. **Порядок — по рычагу и зависимостям:** **C → B → A → D → E → F**.
   Мягкая деградация (skip-эффекта на `FormulaError`/`MissingVariableError`) —
   инвариант: ни одно изменение не должно ронять лист/бой.

**Граф зависимостей:**
```
C (единый конвейер + when)  ─┬─────────────► A (шина событий/реакции)
                             │                     │
B (методы расчёта)  ─────────┘                     ▼
                                             D (состояния+стекинг данными)
                                                   │
                                                   ▼
                                             E (двусторонний бой) ──► (2D-бой)
F (общий describe) — можно параллельно; условия-текст зависят от C
```

**Ориентиры трудоёмкости** (S≈1–2 дня, M≈3–5, L≈1–2 нед, XL≈3+ нед):
C=M · B=M · A=XL(бьётся на A1–A4) · D=L · E=L · F=M.

---

## Фаза C — Единый formula-aware конвейер модификаторов + вычисление `when`

**Проблема (обзор §4.2, §4.4).** Два расходящихся пути: боевой
`modifiers.ts:collectRollModifiers` берёт только литералы (`Number(raw)`, роняет
`rage_bonus`), листовой `breakdown.ts:modifiersFromEffects` — formula-aware, но без
фильтров и без учёта `when`. Ни один не вычисляет `when`/`circumstances` (в
`frontend/src/engine` — 0 ссылок). А `runAbilityCheck` (`execute.ts:463`) вообще не
зовёт сбор модификаторов. Сам-throws/навыки/СЛ заклинаний в `breakdown.ts` не
применяют эффект-модификаторы совсем (Благословение/Аура защиты не видны на листе).

**Цель.** Один `collectModifiers`, formula-aware, с фильтрами, оценкой `when`, единый
для боя и листа; подключить к проверкам характеристик, спасброскам, навыкам, СЛ.

### Изменения
1. **`frontend/src/engine/conditions/evaluate.ts` (новый).**
   `evaluateCondition(cond: Dict, evalCtx: EvalContext): boolean` — диспетч по
   `cond.kind` из схемы (§5.5): `you_have_condition`, `target_has_condition`,
   `has_advantage`, `wielding`, `target_wears`, `attack_is`, `creature_within`,
   `ally_within`, `target_type`, `d20_equals`, `any_of`/`all_of` (рекурсия),
   `narrative` (всегда true — эскейп). `EvalContext = { character, state, target?,
   roll?, lastD20?, activeConditions: Set<string> }`. Неизвестный `kind` → `true`
   (мягкая деградация, не блокируем).
   `matchesWhen(when: Dict[]|undefined, ctx): boolean` — пусто ⇒ true; иначе все
   условия должны пройти.
2. **`frontend/src/engine/modifiers.ts` — переписать `collectFromPayload`/
   `collectRollModifiers` → `collectModifiers`:**
   ```ts
   export function collectModifiers(
     state: RuntimeState,
     passives: Dict[],
     opts: { roll: string; filter?: Dict; formulaCtx: FormulaContext; evalCtx?: EvalContext },
   ): { modifiers: RollModifier[]; advantage: AdvantageState }
   ```
   - значение `op:'add'`: `try { evaluate(raw, opts.formulaCtx) } catch (FormulaError|MissingVariableError) { skip+log }` — **убрать** ветку `Number(raw)`-only.
   - перед применением: `if (!matchesWhen(payload.when, opts.evalCtx)) continue;`
   - `combineAdvantage` (adv+adv=adv, adv+dis=none) — **сохранить как есть** (корректно по 2024).
   - оставить `collectRollModifiers(state, passives, appliesTo)` как **deprecated-обёртку** над `collectModifiers` (без `evalCtx` ⇒ `when` трактуется «всегда», безопасный дефолт), чтобы не трогать сразу все колл-сайты.
3. **`breakdown.ts:modifiersFromEffects` → делегировать в `collectModifiers`** (formula-ctx обогатить: сейчас `formulaCtxOf` не даёт `spellcastingMod`/`variables` — добавить). Подключить эффект-модификаторы к **саврскам/навыкам/СЛ заклинаний** (сейчас их нет): `breakdownSave`/`breakdownSkill` + новые ключи `save:<ab>`, `skill:<id>`, `spell:save_dc`.
4. **`execute.ts`:** `runAttackRoll:409`, `runSave:442` → передавать `formulaCtx` (уже строится в `formulaCtx(ctx)`) и `evalCtx`. **`runAbilityCheck:463` — добавить недостающий вызов** `collectModifiers({roll:'ability_check', filter:{ability|skill}})`.
5. Колл-сайты ручных бросков `CharacterSheetMVP.tsx:323`, `CharacterSheetV2.tsx:79` — перевести на новую сигнатуру (или оставить на обёртке).

### Схема / бэкенд
`when` и `condition` уже в `mechanics.schema.json` (строки 356–370, 90–101) —
**правок схемы нет**. Бэкенд не трогаем.

### Тесты
- `conditions/evaluate.test.ts`: каждый `kind`, `any_of/all_of`, неизвестный kind ⇒ true.
- расширить `engine.coverage.mvp.test.ts`: модификатор с формулой `rage_bonus` теперь виден в атаке; модификатор с `when:[target_has_condition prone]` применяется только когда цель prone.
- `breakdown`: Аура защиты (+CHA к спасброскам) и Благословение видны в `breakdownValue('save:wis')`.

### Критерии готовности
Формульные модификаторы применяются в бою; условные пассивки срабатывают по `when`;
проверки хар-к получают модификаторы; 0 регрессий в `test:mvp`. **Оценка: M.**
**Риски:** «двойной учёт» если и `when`, и старый фильтр матчат — покрыть тестом;
следить, что `evalCtx.target` для соло-листа = undefined (тогда `target_*` → false).

---

## Фаза B — Настоящие «методы расчёта» (парадигма №3 как механизм)

**Проблема (§4.3).** `computeAC` (`ac.ts:97`) — жёсткий каскад, `findAcBaseOverride`
берёт **первый** `set_value ac_base`, не максимум. Нет обобщения: саврски/навыки —
`base+prof`, скорость/инициатива — `base+effects`, СЛ заклинаний — хардкод
`8+pb+mod` (`derive.ts:60`). Всё это — частные случаи одного примитива.

**Цель.** `computeValue(target, ctx, {methods, additive})`: среди методов-кандидатов,
чьи `requirements` выполнены сейчас, взять **максимум**, затем прибавить аддитивные
модификаторы (дедуп по имени источника — задел под §D). Реестр расширяется данными.

### Изменения
1. **`frontend/src/engine/derivedValue.ts` (новый):**
   ```ts
   type ValueMethod = { name: string; requires?: (c: EvalContext)=>boolean;
                        compute: (c)=>{ value:number; parts:RollModifier[] } };
   export function computeValue(methods: ValueMethod[], additive: RollModifier[],
                               ctx): ValueBreakdown  // value = max(applicable) + Σ additive
   ```
   `ValueBreakdown` расширить полем `rejected?: {name:string; value:number}[]` —
   отвергнутые кандидаты для превью (парадигма №2: «почему такой КЗ»).
2. **`ac.ts:computeAC` → выразить через методы:** кандидаты `base_10_dex`,
   `armor:<id>` (по надетой броне, с dex-cap), `unarmored:<slug>` (из каждого
   `set_value ac_base` пассивок — теперь **все**, берётся max), + аддитив «щит».
   Это чинит «Варвар 10+ЛВК+ТЕЛ vs Доспех мага 13+ЛВК → больший». Сигнатуру
   `computeAC(...)` сохранить (тесты `equipment.mvp.test.ts`).
3. **`breakdown.ts:breakdownValue` — общий диспетч через `computeValue`:** AC, max_hp,
   initiative, speed, `save:*`, `skill:*`, `spell:save_dc`, `spell:attack`. Спелл-СЛ и
   характеристики становятся методами (СЛ = метод `8+prof+spellcasting`; **Пояс силы
   огра** = метод-кандидат СИЛ `AbilityOverrideMinimum`-стиля — данными).
4. Эффект-модификаторы (`applies_to.roll ∈ {ac,max_hp,speed,initiative,save:*,skill:*,
   spell_save_dc}`) прибавляются как `additive` (из фазы C).

### Тесты
`derivedValue.test.ts`: два безбронных метода → берётся max; метод с невыполненным
`requires` игнорируется; аддитивы поверх. Регрессия `equipment.mvp.test.ts`,
`breakdown.mvp.test.ts`.

### Критерии готовности
КЗ берёт максимум применимого; спелл-СЛ и характеристики — данные-методы; `rejected`
показывается в тултипе. **Оценка: M.** **Риски:** «RAW игрок выбирает метод, а не
max» — по умолчанию max (оптимизатор), но заложить `preferredMethod` в данные на
будущее; следить за dex-cap средней брони (`12+min(dex,2)` — грамматике формул нужен
`min`, проверить `formula.ts`).

---

## Фаза A — Шина событий + диспетчер триггеров/реакций

**Проблема (§4.1) — центральный пробел.** `activation.mode:"triggered"` исполняется
только для `long_rest` (`turn.ts:104`). `events.ts` — журнал, не pub/sub. Не работают
реакции, он-хит-райдеры, авто-концентрация, ОА.

**Цель.** Явная событийная модель (BG3 Interrupt как данные): движок эмитит события в
фазах `before→during→after→replaces`, для каждого собирает подходящие
`triggered`/`reaction` механики (по `event`+`subject`+вычисленным `circumstances` из
фазы C) и исполняет/предлагает игроку. Дробим на 4 под-фазы.

### A1. Ядро диспетчера (без UI)
- **`frontend/src/engine/dispatch.ts` (новый):**
  ```ts
  type DomainEvent = { kind: string; timing: 'before'|'during'|'after'|'replaces';
                       source: 'self'; subject?: 'self'|'target'|...; ctx: {...} };
  export function dispatch(ev: DomainEvent, state, execCtx, passives): ExecuteResult
  ```
  Строит таблицу слушателей из `passives`+`state.activeEffects`, у которых
  `activation.mode ∈ {triggered, reaction}` и `activation.trigger.event === ev.kind`
  и `matchesWhen(trigger.circumstances)` (фаза C). Исполняет их через существующий
  `applyPayloads`/`executeAction`-путь (списание `cost` для reaction). Возвращает
  доп. события в общий `events[]`.
- **`events.ts`:** формально ввести словарь доменных событий (отдельно от лог-событий
  UI): `attack_roll_made, hit, crit, miss, damage_dealt, damage_taken,
  reduced_to_0_hp, saving_throw_made, spell_cast, condition_applied, turn_start,
  turn_end`. (Лог-`EngineEvent` не ломаем — доменные события внутренние.)

### A2. Точки эмиссии в `execute.ts`
- `runAttackRoll:420` после исхода → `emit(hit|crit|miss, after)`; **до** броска →
  `emit(attack_roll_made, before)` (для Щита/помех).
- `runSave` → `emit(saving_throw_made)`.
- `applyPayloads:'damage'` → `emit(damage_dealt / damage_taken, after)`.
- `applyCondition` → `emit(condition_applied)`.
- HP до 0 (когда появится урон по себе, §E) → `emit(reduced_to_0_hp, replaces)`.
- `turn.ts:startTurn` → `emit(turn_start)`; обобщить `applyLongRestPassives` в
  общий диспетчер (частный случай `long_rest`).

### A3. Реакции + подсказка игроку (UI, парадигма №2)
- **`frontend/src/contexts/ReactionPromptContext.tsx` (новый)** — по образцу
  `DiceDialogContext` (промис + модалка). Политика на реакцию
  `Automatic|Ask|Disabled` (в localStorage на персонажа), `InterruptDefaultValue`-семантика BG3;
  правило «не больше одной подтверждаемой реакции на событие».
- `SheetActionsPanel.tsx:runAction (147–188)`: когда диспетчер находит доступную
  реакцию у листа — `await reactionPrompt.request(describeMechanics(...))` (текст из
  фазы F), затем исполнить/пропустить. Списывать ресурс `reaction`; сбрасывать в
  `startTurn` (уже есть `TURN_KEYS`).

### A4. Первые данные-контент (проверка выразительности)
Смоделировать **данными** (без кода): Скрытая атака, Божественная кара, Внезапный удар
(`triggered` on `hit`), Адское возмездие / Щит (`reaction`), **авто-проверка
концентрации** on `damage_taken` (`DC=clamp(max(10,⌊dmg/2⌋),10,30)`, помеха при крите —
данные + `concentration.ts`). Атака при возможности — пометить зависимой от §E (нужны
дальность/позиция).

### Тесты
`dispatch.test.ts`: on-hit-райдер срабатывает раз/ход (`uses.per:turn`); реакция
тратит `reaction` и недоступна повторно до `startTurn`; `circumstances` гейтит
срабатывание; авто-концентрация кидает спасбросок на `damage_taken`.

### Критерии готовности
≥6 способностей из A4 работают данными; реакции спрашивают игрока; 0 регрессий.
**Оценка: XL (A1=M, A2=M, A3=M, A4=S).** **Риски:** порядок/цепочки реакций
(реакция, порождающая событие) — ограничить глубину; таргетинг реакций на соло-листе
(без второй стороны часть реакций — «напоминание», полноценно — после §E);
идемпотентность `uses.per:turn` (нужен счётчик срабатываний на ход).

---

## Фаза D — Состояния и стекинг как данные

### D1. Стекинг (без миграций — payload-поля в jsonb)
- **Схема** `mechanics.schema.json` (в `modifier` и `condition`): добавить
  `stack_id: string`, `stack_type: enum[overwrite,ignore,additive,stack]`,
  `stack_priority: integer` (модель BG3, обзор §5.1).
- **`execute.ts:applyModifierPayload/applyCondition`:** при наличии `stack_id` —
  политика коллизии: `overwrite` (снять прочие с тем же `stack_id`, оставить
  наибольший `stack_priority`/потенцию), `ignore` (не добавлять дубль), `additive`
  (сложить длительности), `stack` (независимо).
- **`collectModifiers` (фаза C):** дедуп «одноимённое не складывается» — при равном
  `stack_id`/`source` брать максимум потенции (RAW 2024 «Combining Game Effects»).
- **Авто-концентрация** довести через §A2 (`damage_taken`).

### D2. Состояния как сущность (единственная миграция плана)
- **Бэкенд:** сущность `Condition` по образцу `Variable` — миграция `064_create_conditions`
  (клон `createVariablesTable`, `migrations.go`), `condition_controller.go` (клон
  `variable_controller.go`, CRUD по uuid-или-slug), роуты `/api/conditions`. Сид 13
  состояний (`INSERT ... ON CONFLICT`) из текущего `CONDITION_RULES`.
  Поля: `condition_id, name, self_modifiers(jsonb), projected_modifiers(jsonb),
  notes, image_url`.
- **`projected_modifiers`** — то, что состояние даёт **атакующему/окружающим** (задел
  §E: «по распластанному — с преимуществом»); `self_modifiers` — как сейчас.
- **Фронтенд:** `conditions.ts` — заменить хардкод-карту загрузкой дефиниций
  (`/api/conditions`) в реестр; `conditionModifierPayloads` читает из данных.
  Конструктор: блок-редактор состояния (по образцу переменных, коммит «Библиотека и
  конструктор переменных»).

### Тесты
Стекинг: `overwrite` оставляет наибольший; `additive` складывает длительность; дедуп
одноимённых. Состояние из API даёт те же модификаторы, что хардкод (golden-диф).

### Критерии готовности
Владелец добавляет состояние без перевыкатки (парадигма №1); стекинг по RAW; авто-
концентрация. **Оценка: L.** **Риски:** сид-диф со старым `CONDITION_RULES` (покрыть
golden-тестом); порядок применения при `additive` длительностях.

---

## Фаза E — Двусторонний контекст боя

**Проблема (§4.5).** Урон не применяется к HP, `resistance` → `NOT_IMPLEMENTED`;
`TargetContext.saveMods` захардкожены нулями (`SheetActionsPanel:154`). Нет проекции
состояний цели на бросок атакующего.

### Изменения
1. **`contracts.ts:TargetContext`** расширить: `characterContext?: CharacterContext;
   runtimeState?: RuntimeState;` (богатая цель). `ExecuteResult` → опционально
   `targetState?: RuntimeState` (двусторонняя мутация).
2. **Динамические спасброски цели:** если есть `target.characterContext` — считать
   `saveMods[ab]=abilityMod+prof*(proficient)`; убрать нули из UI.
3. **Урон по цели:** ветку `applyPayloads:'damage'` довести до применения к
   `target.runtimeState.hp` через `hp.ts:applyDamage` **с проходом сопротивлений/
   иммунитета/уязвимости** (из `target` активных `resistance`-payload'ов). Реализует
   `resistance` из §4.5.
4. **Проекция состояний (из §D2 `projected_modifiers`):** в `collectModifiers` для
   броска атакующего подмешать модификаторы от состояний **цели** (преимущество по
   prone/restrained/blinded; авто-крит вблизи paralyzed/unconscious).
5. Атака при возможности / дальность — требуют позиционной модели (граница с 2D-боем);
   пометить как вход в модуль боя.

### Тесты
Урон применяется к HP цели с учётом сопротивления (полурон по fire-resist); атака по
prone-цели вблизи — с преимуществом; спасброски цели считаются из её характеристик.

### Критерии готовности
Полный двусторонний расчёт одной пары; сопротивления работают. **Оценка: L.**
**Риски:** где хранить состояние «врага» (сущность боя vs эфемерная цель) — решить в
модуле боя; сериализация двусторонней мутации в UI.

---

## Фаза F — Общий `describe(mechanics) → текст` (парадигма №2 везде)

**Проблема (§4.7).** Ховер = свободный текст `description`; `summarizeMechanics`
работает из состояния редактора, не из сохранённого `mechanics`; общего гуманизатора
нет.

### Изменения
1. **`frontend/src/engine/describeMechanics.ts` (новый):**
   `describeMechanics(mechanics, ctx?): { summary: string; details: string[] }` —
   обходит `activation.cost` (→ «Требует :reaction:, слот 2 круга»), `effects[]`
   (attack/save/auto → payload'ы), `duration`/`uses`, `when` (через фазу C).
   Вывод в разметке **`FormattedText`** (`[fire]…[/fire]`, `:reaction:`, `**bold**`)
   — уже поддерживается (`formattedText.tsx:264`).
   `describeCondition(id)` / `describeConcentration(name)` — из данных §D2.
2. **Заменить `ActionPreview.parseMechanics (23–68)`** на `describeMechanics`.
3. **Слой-причина поверх превью:** паттерн **уже есть** в `SheetActionLine.tsx`
   (превью показывается на ховере даже у disabled, причина `disabledTitle` — оверлеем,
   строки 84–107). Задействовать `describeMechanics` в этом превью — тогда парадигма
   №2 выполняется буквально (превью из механики + причина слоем поверх).
4. Единый гуманизатор — в конструкторе (`summarizeMechanics`), листе, реакции (§A3),
   боевом логе.

### Тесты
`describeMechanics.test.ts`: Ярость → корректная строка с ресурсом/длительностью/
условиями; AI-сгенерированная механика (не из блоков) получает превью.

### Критерии готовности
Один `describe` на все поверхности; превью не расходится с исполнением. **Оценка: M.**

---

## Кардинальные направления (заделы, не блокируют MVP)

- **Event-sourced `RuleState` (обзор §8.1).** Фаза A уже вводит доменные события; при
  наличии `CharacterEvent` (персистентные) — следующий шаг сделать лист/бой/кампанию
  проекциями редьюсера над потоком событий. Начинать после стабилизации A+E.
- **Общий TS-пакет движка (§8.2).** Вынести `frontend/src/engine/*` в пакет без React
  (границы уже чистые: инъекция RNG, сериализуемые снапшоты) → переиспользовать в
  серверном бою (`n8n_battle_automation_plan.md`) и кампании. Делать после F.
- **Разделение Boost/Functor (§8.3).** По ходу C/D явно отделить декларативные
  бусты (влияют на значения) от императивных функторов (меняют состояние по событию).

---

## Дорожная карта / вехи

| Фаза | Зависит от | Оценка | Пользовательский выигрыш |
|---|---|---|---|
| **C** | — | M | формульные модификаторы в бою; условные пассивки; баффы саврсков видны |
| **B** | C | M | КЗ берёт лучший метод; спелл-СЛ/характеристики — данные; «почему такое значение» |
| **A** | C | XL | реакции, он-хит-райдеры, авто-концентрация — данными; фундамент боя |
| **D** | A, C | L | состояния добавляются данными; корректный стекинг 2024 |
| **E** | A, D | L | полноценный двусторонний расчёт; сопротивления; вход в 2D-бой |
| **F** | C | M | единое превью механик везде (парадигма №2) |

**Быстрые победы (первая неделя):** фаза C целиком чинит тихие баги (формульные
модификаторы, условные пассивки, баффы спасбросков) — минимальный риск, максимум
«починилось само». Затем F (параллельно) даёт видимый эффект в UI. A — главный
многонедельный трек, начинать сразу после C.

## Сводный реестр рисков

1. **Скрытые двойные учёты** при вводе `when`/стекинга — покрывать golden-тестами до
   и после (свип прод-контента уже есть).
2. **Соло-лист без второй стороны** (§A/§E): часть реакций до §E — «напоминания».
   Явно помечать в `describeMechanics`, чтобы игрок понимал.
3. **Сид-диф состояний** (§D2) со старым хардкодом — golden-диф обязателен.
4. **Грамматика формул** (`min` для средней брони, §B) — проверить `formula.ts`,
   при отсутствии — добавить как отдельный S-таск перед B.
5. **Порядок/глубина цепочек реакций** (§A) — ограничить, чтобы избежать циклов.

## Определение готовности (для каждой фазы)
`npm run test:mvp` зелёный · lint-mechanics-гейт зелёный (0 ошибок схемы над контентом) ·
новый функционал покрыт тестом · публичные сигнатуры сохранены или помечены deprecated ·
0 крашей на свип-тесте прод-контента (инвариант мягкой деградации).
