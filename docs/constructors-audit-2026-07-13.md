# Аудит конструкторов сущностей — 2026-07-13

Ревью всех конструкторов сущностей фронтенда. Фокус по запросу:
1. Неиспользуемое / бесполезное для конкретной сущности / устаревшее.
2. Компоненты, которые делают одно и то же, но объявлены дважды.
3. Длинные сложные UI, которые можно упростить.

Эталоны — `SpellCreator` и `CardCreator` (но и у них есть недочёты; см. ниже).

Метод: полное чтение 4 карточных конструкторов + под-секций вручную, трассировка через
CodeGraph/grep (движок `engine/`, сборка листа `character/`, превью, бэкенд `models.go`/`controller.go`),
3 параллельных под-агента на вспомогательные конструкторы, редакторы механики и трассировку мёртвых полей.

Объём: 11 конструкторов + общий стек `components/mechanics/*` ≈ 6 100 строк.

---

## 0. TL;DR — что делать в первую очередь

| # | Находка | Тип | Приоритет |
|---|---------|-----|-----------|
| 1 | Легаси-вкладка «Эффекты» предмета (`effects: Effect[]` + `EffectsSection`, 301 стр.) — мёртвые данные, заменены движком | Мёртвое | **Высокий** |
| 2 | `PropertiesSection` эффекта (493 стр.) пишет сопротивления/владения в поле `script`, которое движок **никогда не читает** → в игре не работают | Мёртвое + сложное | **Высокий** |
| 3 | Поле `script` write-only на 7 типах; в `ActionCreator` вообще нет UI для него — чистый round-trip | Мёртвое | **Высокий** |
| 4 | `battle_profile` (JSON-редактор в `EquipmentSection`) — читается только мёртвым эндпоинтом `/battle-stats` | Мёртвое | Средний |
| 5 | `class.starting_equipment` (JSON-textarea) — сохраняется, никогда не читается; дублирует `equipment_options` | Мёртвое | Средний |
| 6 | Нет общего каркаса конструктора: шапка/спиннер/ошибка/сетка+превью/кнопки скопированы в 7 файлов | Дублирование | **Высокий** |
| 7 | `CardCreator` строит объект запроса (~40 полей) **дважды** (`onSubmit` + `handleCreateCardForGeneration`), копии уже разошлись | Дублирование | **Высокий** |
| 8 | 3 разные реализации навигации по секциям в 4 конструкторах (NavRail / инлайн-кнопки / никак) | Дублирование | Средний |
| 9 | `FeatCreator`: `EntityRefSelector` без `resolveItems` → показывает голые UUID (баг, в `RaceCreator` уже исправлено) | Баг | Средний |
| 10 | Отладочные `console.log` в `ActionCreator`, `EffectCreator`, `PropertiesSection` | Мусор | Низкий |

---

## 1. Эталоны и их недочёты

**`SpellCreator` (648 стр.)** — самый аккуратный: типизированная форма `ScalarForm`, секции через
константу `SECTIONS`, валидация механики (`validateMechanics`). Недочёты:
- Дублирует систему урона: структурные `damage[]` / `heal_dice` / `save_outcome` (вкладка «Механика»,
  рендерятся в `SpellPreview`) **и** исполняемый `mechanics` (вкладка «Движок»). Два источника правды об уроне
  заклинания — та же двойственность «структура vs движок», что и у предмета.
- Навигация по секциям — своя инлайн-реализация (строки 301–319), а не общий `NavRail`, который используют
  `CardCreator`/`EffectCreator`.

**`CardCreator` (749 стр.)** — эталон предмета, но несёт больше всего легаси:
- Вкладка «Эффекты» (мёртвая, см. §2.1).
- `handleCreateCardForGeneration` — вторая копия сборки payload (см. §3.2).
- `memoizedWatchedValues` — ручной список ~35 полей в зависимостях `useMemo` (строки 249–285), хрупкий:
  не включает `enchant_bonus`, `weapon_type`, `container_mode`, `contents` → превью не обновляется при их правке.
- **Не вызывает `validateMechanics`** перед сохранением, в отличие от Spell/Action/Effect — несогласованность.

Вывод: за «правильную форму» стоит брать **структуру** `SpellCreator` (типы, секции, валидация), а за
целевой **UI-каркас** — вынести общий shell, которого сейчас нет ни у одного.

---

## 2. Неиспользуемое / устаревшее (по сущностям)

### 2.1. Предмет — легаси-система «Эффекты» (мёртвая)
Точная связка в `CardCreator.tsx`: state `:42`, вкладка `:53`, загрузка `:125-128`, сохранение `:349-354`,
рендер `:620-629` → компонент `components/cardCreator/EffectsSection.tsx` (весь файл, 301 стр.) +
`utils/descriptionAnalyzer.ts` (кнопка «Найти в описании»).

Трассировка `Card.effects: Effect[]` (`types/index.ts:34-39,95`):
- Единственные чтения на фронте — **некеанические**: `CardCreator` (загрузка в редактор) и `CardLibrary.tsx:184`
  (`getCardNumberColor` — просто красит номер карты, если `effects.length>0`).
- Бэкенд: `AnalyzeCardEffects`/`GetEffectsSummary` (`effects_utils.go`) — **0 вызовов** (подтверждено и в
  `docs/project-review-2026-07-12.md:916`); `buildBattleStats` кладёт в ответ мёртвого эндпоинта.
- Механика надетого предмета идёт **только** через `card.mechanics → runtimeSources → resolveCharacterRules`
  (тест `character/rules/itemRuntimeSources.test.ts`).

**Вердикт: мёртвые данные.** Вкладка «Эффекты» редактирует поле, которое ничто не интерпретирует;
её живая замена — вкладка «Движок» (`MechanicsBuilder` над `mechanics`). Именно тот случай, что был в запросе.

### 2.2. Эффект — `PropertiesSection` пишет в мёртвый `script`
`components/effectCreator/PropertiesSection.tsx` (493 стр.) собирает сопротивления/иммунитеты/уязвимости и
владения оружием/доспехами/языками и сохраняет их в поле `script` (`resistance`, `weapon_proficiencies`, …).

Поле `script` (`Record<string,any>` на 7 типах, `types/index.ts:49,771,806,839,913,946,976`) во всём фронте
**только пишется** — чистая проверка по границе слова показала запись в `ActionCreator`, `EffectCreator`,
`PropertiesSection` и **ни одного чтения** в `engine/`, `character/`, превью или detail-модалках. Сопротивления
в игре реально выдаёт движок через `mechanics` (`engine/execute.ts`, `engine/mechanicsView.ts`), а не `script`.

**Вердикт:** `PropertiesSection` — легаси-двойник движка; введённые в нём сопротивления/владения **не действуют**.
Это аналог предметных «Эффектов» для сущности «Эффект».

### 2.3. Действие — `script` без UI и лишние поля
- `script` в `ActionCreator` (`:77,122,223`) — загружается и сохраняется, но **редактора нет вообще**: поле
  просто гоняется туда-обратно. Мёртвый round-trip.
- `formData.resource` (единственное число, `:117`) — не регистрируется в форме; легаси-остаток (живое — `resources`).
- Карточно-текстовые поля отображения — `text_alignment`, `text_font_size`, `description_font_size`,
  `detailed_description_alignment`, `detailed_description_font_size`, `show_detailed_description`, а также
  `price`, `weight`, `properties`, `tags`, `is_extended` — присутствуют в `reset`/`preview`/`submit`, но **ни
  одного поля ввода** для них в UI (JSX `:275-523`). Пассивный passthrough, замусоривающий тип и payload.
- `rarity` показан обязательным `<select>` (`:316-330`), хотя для действий не имеет игрового смысла и нигде,
  кроме round-trip, не читается. Ср. `EffectCreator`, который жёстко ставит `rarity:'common'` и прячет выбор —
  несогласованность.

### 2.4. Класс — `starting_equipment` (мёртвое)
`ClassCreator.tsx`: JSON-textarea `:375-378`, парсинг `:187`, загрузка `:114`. Свойство `class.starting_equipment`
**нигде на фронте не читается** — стартовое снаряжение `CharacterForge` строит исключительно из
`equipment_options` (`CharacterForge.tsx:419,1100`). Дублирует структурный A/B/C-редактор в той же форме.
(`skill_choices` и `resources` рядом — **живые**: `character/forgeHelpers.ts`, `character/resourceInit.ts`.)

### 2.5. Мёртвые поля Card, всплывающие в конструкторе
- `battle_profile` — JSON-редактор `EquipmentSection.tsx:404-425` + дамп в `CardDetailModal`. Читается лишь
  `buildBattleStats` для маршрутов `main.go:161-162`, которые фронт не дёргает. Фактически write-only.
- Card-уровневые `related_cards` / `related_actions` / `related_effects` — пишутся `CardCreator`, но у предмета
  потребителя нет (`CardDetailModal` берёт связанное из `contents`). *Важно:* одноимённые поля на
  расе/подрасе/подклассе/черте — **живые** (`character/assemble.ts`). Мертвы только на Card.

**Живые (не трогать):** `bonus_type`/`bonus_value` (`engine/weapon.ts`, `engine/ac.ts`), `defense_type`
(`engine/equipment.ts`, `engine/ac.ts`), `elemental_damage_*`, `enchant_bonus` (`engine/weapon.ts`),
`is_template`/шаблоны.

### 2.6. Мёртвые пропсы в общих редакторах
- `WhenEditor` — пропс `label` объявлен (`:162`, рендер `:170`), но ни один вызывающий его не передаёт.
- `LevelProgressionEditor` — пропс `maxLevel` (`:16,106`) не передаётся ниоткуда, всегда дефолт 20.
- Внутри `MechanicsBuilder` — author-only поля без исполнения движком: `recharge` (`:494-502`, помечено в коде),
  `requirements` (RequirementsEditor), `targeting` (TargetingEditor, баннер «движок пока не использует наведение»),
  `duration.ends_when`/`requires_each_turn`. Не мусор, но кандидаты на сворачивание, если author-only не нужен.

### 2.7. Отладочный мусор
`console.log` в проде: `ActionCreator` (`:57,96,211,242,247`), `EffectCreator` (`:68-69,94,190-191,219-220,227`),
`PropertiesSection` (`:127,145,153,161,169,178,243-246`).

---

## 3. Дублирование (объявлено дважды одно и то же)

### 3.1. Нет общего каркаса конструктора
`CreatorShell`/`CreatorLayout` отсутствует. Каждый из 4 карточных конструкторов вручную повторяет шапку
(назад + переключатель превью), баннер ошибки, спиннер загрузки, сетку «форма + липкое превью», строку
кнопок «Отмена/Сохранить»: `Background 136-315`, `Feat 134-277`, `Class 211-419`, `Race 197-400`, а также
`CardCreator`/`SpellCreator`/`EffectCreator`. Строковые константы `inputCls`/`labelCls` скопированы буквально
во все 4 «библиотечных карточных» конструктора. Три «библиотечных» (`Concept`/`Variable`/`Resource`) так же
дублируют каркас «форма сверху + список снизу» (delete/submit/список/поля).

### 3.2. `CardCreator` собирает payload дважды
`onSubmit` (`:307-356`) и `handleCreateCardForGeneration` (`:407-441`) строят почти одинаковый объект
`CreateCardRequest` из ~40 полей. Копии **уже разошлись**: второй не кладёт `elemental_damage_*`,
`enchant_bonus`, `container_mode`, `contents`, `price_currency`, `price_abbreviated`, `weapon_type`, `effects`,
`mechanics`. Классический источник багов «сохранилось не то, что при генерации».

### 3.3. Проверка ID продублирована 3×
`checkIdUniqueness` + `idRegex` практически идентичны в `SpellCreator` (`:193-213`), `ActionCreator`
(`:152-193`), `EffectCreator` (`:138-172`). Просится общий `useEntityId()` / `validateEntityId()`.

### 3.4. Загрузчики связей продублированы
`loadEffects`/`loadActions` побайтово одинаковы в `FeatCreator` (`:95-103`), `ClassCreator` (`:88-96`),
`RaceCreator` (`:87-95`). В `RaceCreator` рядом есть хороший `resolveEffects`/`resolveActions`, который стоит
поднять в общий `useEffectActionLoaders()`.

### 3.5. Редактор снаряжения A/B(/C) переизобретён
`BackgroundCreator` (`:232-271`) — copy-paste A/B из `ClassCreator` (`:316-341`, A/B/C). Один и тот же
«золото + `ItemRefSelector`», реализован дважды; в `Class` — уже через `.map`, в `Background` — руками.

### 3.6. Чип-тогглы переизобретены
Паттерн «чип-переключатель списка» реализован отдельно в `BackgroundCreator` (`toggle` `:101-102`, `:186-218`)
и `FeatCreator` (`toggleAbility` `:92-93`, `:198-209`). Есть и третья вариация — `SpellCreator.toggleInList`.

### 3.7. Мультиселект решён двумя противоположными способами
`MechanicsBuilder` (`:235-264`) намеренно заменил нативный `<select multiple>` чип-тогглами (с комментарием,
что нативный теряет выбор). А `ChoiceEditor` (`:99-111`) воскрешает именно нативный `<select multiple>`.

### 3.8. Бойлерплейт внутри `components/mechanics/*`
- Строка класса инпута `'w-full px-2 py-1 border rounded text-sm'` объявлена ~6× (`CostEditor:14`,
  `RequirementsEditor:9`, `FilterEditor:8`, `TargetingEditor:6`, `DurationEditor:8`, `WhenEditor:17`).
- Хелпер строки-списка `patch = (i,p) => onChange(rows.map(...))` + гард `Array.isArray` + кнопка «+ добавить»
  повторён 3× (`CostEditor`, `RequirementsEditor`, `FilterEditor`) — просится `<RowList>`/`useRowList`.

### 3.9. Три разные навигации по секциям
`NavRail` (`CardCreator`, `EffectCreator`) vs инлайн-кнопки по `SECTIONS` (`SpellCreator:301-319`) vs
без навигации, одна длинная колонка (`ActionCreator`). Стоит унифицировать на `NavRail`.

---

## 4. Длинный / сложный UI — кандидаты на упрощение

- **`PropertiesSection` (493 стр.)** — самый сложный и при этом пишет в мёртвый `script` (§2.2). Двусторонняя
  синхронизация `script ↔ 4 локальных стейта` через `useRef` + сравнение `JSON.stringify` (`:121-252`), плюс
  4 почти одинаковых блока «список + select + добавить». Лучший исход — **удалить** и заменить примитивами
  движка; если оставлять — свести 4 блока к одному переиспользуемому `<ProficiencyList>`.
- **`ClassCreator` (`:316-385`)** — два способа задать стартовое снаряжение (структурный A/B/C **и** мёртвый
  JSON) + три JSON-textarea (`skill_choices`, `starting_equipment`, `resources`) подряд. Самая недружелюбная
  поверхность ввода; один путь мёртв. Плюс `!isSubclass` рвёт форму на 3 фрагмента — тяжело читать.
- **`EquipmentSection` (438 стр.)** — сырой JSON-редактор `battle_profile` (`:404-435`) в пользовательском
  конструкторе; поле мёртвое (§2.5). Убрать.
- **`EffectsSection` (301 стр.)** — удаляется целиком вместе с легаси-эффектами (§2.1).
- **`RaceCreator`** — `darkvision` рендерится дважды в взаимоисключающих ветках (`:295-308` и `:312-319`);
  `previewRace` (`:146-159`) повторяет логику зануления по подрасе, уже вычисленную в `onSubmit` (`:161-183`).
- **`MechanicsBuilder`** — инлайн-своп при переносе эффекта продублирован для вверх/вниз (`:566-583`) →
  вынести `move(idx,dir)`. **`ChoiceEditor`** — инлайн-патч элемента повторён 3× (`:175-208`) → `patchItem`.
- **`CardCreator.memoizedWatchedValues`** — заменить ручной список из 35 полей на цельный `watch()`/`useWatch`.

---

## 5. Предлагаемые исправления (по фазам)

**Фаза A — удаление мёртвого (низкий риск, максимум эффекта):**

> **Статус на 2026-07-13:** пункты 1, 3 (частично), 5 (console.log) — ВЫПОЛНЕНЫ и проверены
> (`tsc --noEmit` = 0, vite компилится, конструктор рендерит 6 секций без «Эффектов»). Остальное — на паузе
> по правилу «визуально отображаемое не удалять» и по просьбе владельца перепроверять.

1. ✅ **Сделано.** Удалить предметные «Эффекты»: вкладку, рендер, `EffectsSection.tsx`, `descriptionAnalyzer.ts`.
   Поле `effects` оставлено как невидимый round-trip (не терять данные; поле ещё красит номер карты в библиотеке).
2. ⏸ **Держим (владелец не уверен).** `PropertiesSection`: сопротивления/владения пишутся в `script`, который
   движок не читает **и** нигде не отображается → механически и визуально инертны. Но удалять только после
   явного согласия; альтернатива — перенести на примитивы движка.
3. ◐ **Частично.** Убран мёртвый `script`-round-trip из `ActionCreator` (UI нет, движок не читает). `script`
   в `EffectCreator` пока оставлен — он завязан на удерживаемый `PropertiesSection`.
4. ⏸ **Держим.** `battle_profile` **отображается** в `CardDetailModal` → оставляем (правило display-safe).
   `starting_equipment` JSON в `ClassCreator` мёртв, но отложен до подтверждения.
5. ◐ `console.log` вычищены (Action/Effect). `rarity`-селект и passthrough-поля `ActionCreator` — отложены.

**Фаза B — дедупликация (среднее усилие):**

> **Статус:** сделаны не-визуальные дедупликации (проверяются `tsc`, commit `ce1f155`). Визуальные части
> (общий каркас/навигация/UI-компоненты) отложены: они **меняют отрисовку** и требуют визуальной проверки.

6. ✅ **Сделано.** `<CreatorShell>` (шапка + спиннер + ошибка + сетка/превью) + `<CreatorActions>` +
   `CREATOR_INPUT_CLS`/`CREATOR_LABEL_CLS`. Переведены Background/Feat/Class/Race; состояние показа превью
   теперь живёт в каркасе. Попутно нормализован отступ превью (у Background/Feat был `mb-8`+`pt-4`, у
   Class/Race `mb-4`; overhang'а у превью нет — разница была случайным дрейфом).
7. ✅ **Сделано.** Единая сборка payload `buildCardPayload` в `CardCreator` — убрана вторая копия в
   `handleCreateCardForGeneration`; попутно устранён дрейф (генерация теряла mechanics/effects/enchant и др.).
8. ◐ **Частично.** ✅ `useEffectActionLoaders()` (load/resolve) вместо 3 копий в Feat/Class/Race.
   ⏸ `useEntityId()` (regex+uniqueness) — отложен (маргинально, трогает валидацию сабмита).
   ⏸ `<EquipmentOptionsEditor>` / `<ChipToggleList>` — визуальные компоненты, отложены.
9. ⏸ **Отложено (визуальное).** Унификация навигации на `NavRail` (в т.ч. `SpellCreator`, `ActionCreator`).

**Отдельно (баг, не дедуп):** `FeatCreator` — `EntityRefSelector` без `resolveItems` (показывает UUID).
Теперь `useEffectActionLoaders` уже отдаёт `resolveEffects`/`resolveActions` — фикс = передать их в селекторы.

**Фаза C — упрощение (точечно):**
10. Исправить `FeatCreator`: передать `resolveItems` в `EntityRefSelector` (баг с UUID).
11. Свернуть дубли: `MechanicsBuilder.move()`, `ChoiceEditor.patchItem()`, `RaceCreator.darkvision`,
    общий `inputCls`/`<RowList>` в `components/mechanics/*`, единый мультиселект-чип (убрать нативный в `ChoiceEditor`).
12. `CardCreator` — цельный `watch()` вместо ручного мемо; добавить `validateMechanics` для паритета.

Приоритет №1 по соотношению «эффект/риск»: **Фаза A.1–A.3** (убрать три легаси-подсистемы `effects`/`script`)
и **Фаза B.6–B.7** (общий каркас + единый payload). Они же дают самое заметное сокращение кода.
