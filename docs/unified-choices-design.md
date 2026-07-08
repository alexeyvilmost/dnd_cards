# Унифицированные выборы (choice) — дизайн

Статус: **на согласование** (2026-07-08). Автор набросал по решению владельца «сначала дизайн-док». Реализация — по слайсам после согласования. D2 (ASI на 4 уровне) — первый потребитель этого механизма, а не отдельная фича.

Решения владельца, зафиксированные в этом доке:
1. Двигаемся **дизайн-док → реализация по слайсам**.
2. Домены выбора — **значения-каталог** (skill/ability/tool/language/instrument — именованные значения из каталога по виду), БЕЗ миграции каждого навыка/инструмента в числовой реестр `docs/variables.md`.
3. ASI — **полный 2024**: «+2 к одной ИЛИ +1 к двум».

---

## 0. Цель

Выбор игрока (`payload kind:'choice'`) должен разрешаться **по единым правилам** независимо от того, ЧТО выбирается и В КАКОМ контексте. Сегодня это не так: логика размазана, вложенные выборы части доменов молча теряются, на листе выбора нет вообще. Итог — «Одарённый» не спрашивает 3 навыка, «Музыкант» не спрашивает инструменты, а ASI пришлось бы делать костылём.

Три опоры видения:
- **Три домена выбора:** `variable` (навык/характеристика/язык/инструмент — значения из каталога), `entity` (эффекты и действия — оба суть эффекты; сюда же черты и заклинания), `item` (предметы).
- **Три контекста:** создание персонажа, повышение уровня, лист персонажа (в игре) — разрешение **одинаковое**.
- **Рекурсивность:** выбранная сущность может САМА нести `choice` — он всплывает и разрешается тут же, по тем же правилам (Одарённый → выбор навыков; ASI-черта → выбор характеристики; Музыкант → выбор инструментов).

---

## 1. Текущее состояние (по коду, 2026-07-08)

**Разрешение НЕ унифицировано — размазано по ~8 функциям в 2 файлах, в ДВА слоя:**

- **Сущностные домены** (`effect` / `feat` / `effect_type`) разрешаются в `character/assemble.ts`: выбранная сущность ЗАГРУЖАЕТСЯ, её `related_effects` вливаются в сборку. Вложенность здесь РАБОТАЕТ — через повторный `collectChoices` (BFS, глубина ≤6, `expandEffectGrants` assemble.ts:449): свои `choice` загруженной сущности всплывают новыми pending-выборами.
  - Точки: `collectFeatChoiceRefs` (assemble.ts:365), `collectEffectGrantRefs` (assemble.ts:320), `materializeEffectTypeChoices` (assemble.ts:416, `effect_type`→`effect`), `expandEffectGrants` (assemble.ts:449).
- **Значимые домены** (`skill` / `tool` / `language` / `ability_score` / `sense` / `speed` / `damage_type`) разрешаются в `character/rules/resolveCharacterRules.ts` превращением выбора в грант, **каждый своей веткой**. Вложенность здесь ТЕРЯЕТСЯ: `choice` внутри `options.items[].grants` проходит `grantFromPayload`→`null` и молча выпадает (resolveCharacterRules.ts:374-380).
  - Точки: `selectedChoicePayloads` (63), `grantFromPayload` (203), `collectNumericModifier` (266), `collectSenseSpeed` (329), `collectAbilityDeltas` (пред-скан ASI, 297).

**Другие факты:**
- Хранилище выбора: `draft.resolvedChoices: Record<string, string[]>` (ключ→массив выбранных id). Ключ `choiceInstanceId = \`${kind}:${entityId}:${effectId}:${choiceId}\`` — **дублируется строковым шаблоном в 4 местах без общего helper'а** (resolveCharacterRules.ts:40, collectChoices.ts:32, assemble.ts:344, 380).
- Единственный `source` со встроенным дефолт-грантом — `feat` (selectedChoicePayloads:82). Остальные «немые», если конструктор (`blocks.ts:grantBySource`) не «запёк» `choice.grant`. Универсального маппинга `домен → грант` нет.
- Выбор всплывает, **только если лежит в related-эффекте** — у `Feat` нет своего `mechanics` (types/index.ts:1227), `collectChoices` сканирует лишь `effect.mechanics`/`action.mechanics`.
- `collectChoices` (collectChoices.ts:46) берёт `choice` как top-level `effects[]` ИЛИ внутри `resolution:'auto'` result[]. **По resolution НЕ фильтрует** — значит `resolution:'on_acquire'` не мешает всплытию.
- **На листе выбора НЕТ** — только кузня (создание + левелап делят один UI: `ChoiceList` в `character/components.tsx`). Лист гонит `runtimeSources` через ту же `applyPayload`, но UI разрешения не даёт.
- Схема `mechanics.schema.json` (source enum) не включает фактически используемые `effect`/`effect_type` — дрейф.

**Почему конкретно ломаются примеры владельца:**
- **Одарённый** смоделирован ПРАВИЛЬНО: related-эффект «Одарённый — выбор навыков» несёт `{kind:'choice', count:3, source:'skill', grant:{kind:'grant_proficiency',prof:'skill'}, resolution:'on_acquire'}`. Не всплывает из-за того, что это `origin`-черта предыстории, и её related-эффекты не попадают в набор, который прогоняется через `collectChoices` (путь origin-феата в assemble). → **баг сборки, не контента**.
- **Музыкант** — related-эффект «Обученность инструментам» = чистый `narrative` («владение тремя инструментами по вашему выбору»). Выбор **не смоделирован вообще**, и домена «инструмент» не существует. → **нужен контент + каталог инструментов**.

---

## 2. Принципы дизайна

1. **Один резолвер выбора.** Функция `resolvePick(from, value, apply) → payload[]` — единственная точка «разреши выбранное во что-то», доменно-диспетчеризованная. Заменяет 8 разрозненных функций.
2. **Fix-point рекурсия для ВСЕХ доменов.** Разрешили выбор → материализовали пики → если пик тянет новые эффекты/выборы, пересобрали и повторили до стабилизации. Сейчас так только для сущностных доменов; станет универсально.
3. **Домен подразумевает дефолтный грант.** `from.domain/kind` даёт грант по умолчанию (variable/skill→grant_proficiency, variable/ability→grant_ability_score, entity/feat→grant_feat, item→grant_item…). Контенту не нужно «запекать» грант вручную — но `apply` может переопределить (ASI: amount:2).
4. **Обратная совместимость.** Старый формат (`options:{source, filter}` + `grant`) нормализуется в новый при чтении. Существующий контент и `resolved_choices`-ключи работают без миграции.
5. **Единый UI во всех контекстах.** Один компонент разрешения (`ChoiceList`), доменно-параметризованный рендер. Лист получает ту же поверхность для `when != on_acquire` выборов.
6. **Каталоги — данные (парадигма №1).** Значения доменов (навыки, характеристики, инструменты, языки, типы урона) — статические каталоги (как `weapon_types.json`), расширяемые данными.

---

## 3. Единая модель `choice`

Расширяем текущий payload аддитивно (старые поля читаются как алиасы):

```jsonc
{
  "kind": "choice",
  "id": "asi_ability",          // стабильный локальный id (для ключа resolved_choices)
  "count": 1,                    // сколько выбрать (min=max=count; либо count_min/count_max)
  "distinct": true,              // выбранные значения должны различаться (для +1/+1)
  "prompt": "Повысьте характеристику",
  "when": "on_acquire",          // КОГДА разрешать: on_acquire | on_levelup | on_cast | per_turn | manual
  "from": {
    "domain": "variable",        // variable | entity | item
    "kind": "ability",           // variable: skill|ability|tool|language|instrument|damage_type
                                 // entity:   effect|action|feat|spell
                                 // item:     (по слоту/тегам)
    "filter": { "category": "general" }  // доменно-специфичный отбор; напр. general-черты, исключить уже имеющиеся
  },
  "apply": { "kind": "grant_ability_score", "amount": 2 }  // ШАБЛОН гранта; выбранное значение подставляется
}
```

**Нормализация старого формата → новый (при чтении, без правки контента):**
| Старое | Новое `from` | Дефолтный `apply` |
|---|---|---|
| `source:'skill'` | `variable/skill` | `grant_proficiency(prof:'skill', value)` |
| `source:'tool'` | `variable/tool` | `grant_proficiency(prof:'tool', value)` |
| `source:'saving_throw'` | `variable/saving_throw` | `grant_proficiency(prof:'saving_throw', value)` |
| `source:'language'` | `variable/language` | `grant_language(value)` |
| `source:'damage_type'` | `variable/damage_type` | `resistance(value)` |
| `source:'ability'` | `variable/ability` | `grant_ability_score(ability:value, amount:1)` |
| `source:'instrument'` (новый) | `variable/instrument` | `grant_proficiency(prof:'tool', value)` |
| `source:'feat'` | `entity/feat` | `grant_feat(value)` |
| `source:'effect'` | `entity/effect` | `grant_effect(value)` |
| `source:'effect_type'` | `entity/effect` (через каталог типа) | `grant_effect(value)` |
| `source:'spell'` | `entity/spell` | `grant_spell(value)` |
| `source:'subfeature'`/`explicit` + `items[]` | items-режим | `item.grants` как есть (могут содержать вложенный `choice`) |
| `item`/`card` (новый) | `item` | `grant_item(value)` |

Явный `choice.grant`/`item.grants` в контенте всегда переопределяет дефолт (совместимость + гибкость).

---

## 4. Единый резолвер + fix-point рекурсия

Псевдокод разрешения (заменяет размазанную логику; живёт рядом с resolveCharacterRules/assemble):

```
resolveAllChoices(sources, resolvedChoices):
  effects := related-эффекты всех источников (раса/класс/предыстория/черты/runtime)
  pending := []
  seen := ∅
  loop:                                  # fix-point
    newChoices := collectChoices(effects) \ seen
    if newChoices == ∅: break
    seen ∪= newChoices
    for ch in newChoices:
      picks := resolvedChoices[key(ch)]   # что игрок выбрал (может быть пусто)
      if picks == ∅:
        pending += ch                     # не разрешён → показать игроку
        continue
      for value in picks:
        payloads := resolvePick(ch.from, value, ch.apply)   # ЕДИНАЯ точка
        for p in payloads:
          if p is choice: continue        # всплывёт на следующей итерации loop
          if p is entity-grant (effect/feat/spell):
            effects += load(p).related_effects   # рекурсия домена entity
          else:
            applyGrant(p)                 # variable/item домен → грант
  return { grants, pending }
```

Ключевые следствия:
- **Вложенность работает для всех доменов**: `item.grants` с вложенным `choice` (ASI-режим → выбор характеристики) больше не теряется — он собирается в `newChoices` на следующей итерации и разрешается тем же путём.
- **Одна точка `resolvePick`** — новый домен = одна запись в таблице, а не правки в 8 местах.
- `key(ch)` — вынесенный общий helper (устраняет дублирование формата ключа в 4 местах).

---

## 5. Три контекста

- **Создание / левелап** — уже через `collectChoices → ChoiceList`. Меняем: `pending` считается fix-point-циклом (§4) → вложенные выборы появляются. Левелап показывает только НОВЫЕ (диф по уровню) — как сейчас.
- **Лист (в игре)** — НОВОЕ. Выборы с `when ∈ {on_cast, per_turn, manual}` разрешаются на листе тем же `ChoiceList` в отдельной панели «Требуется выбор» (напр. заклинание «выберите тип урона при касте», черта, полученная посреди сессии). Сохранение — в `turn_state`/`resolved_choices`. Реализуется отдельным слайсом (см. §8).

---

## 6. ASI на 4 уровне (полный 2024)

**Механизм 2024:** на 4/8/12/16 (и 19) уровне класс даёт черту. ASI — повторяемая general-черта «Улучшение характеристик»: «+2 к одной ИЛИ +1 к двум разным». Игрок может вместо неё взять любую подходящую general-черту.

**Данные:**
1. `level_progression["4"/"8"/"12"/"16"/"19"]` у 12 базовых классов → эффект с `choice { from: entity/feat, filter: {category:'general'} }` (выбор general-черты). Разблокирует и «взять другую черту вместо ASI».
2. Новая general-черта **«Улучшение характеристик»** (repeatable) с ВЛОЖЕННЫМ выбором:

```jsonc
{ "activation": { "mode": "passive" },
  "effects": [ {
    "kind": "choice", "id": "asi_mode", "count": 1, "prompt": "Как повысить характеристики?",
    "when": "on_acquire",
    "options": { "items": [
      { "id": "plus2", "name": "+2 к одной характеристике", "grants": [
        { "kind": "choice", "id": "asi_p2", "count": 1, "prompt": "Характеристика (+2)",
          "from": { "domain": "variable", "kind": "ability" },
          "apply": { "kind": "grant_ability_score", "amount": 2 } } ] },
      { "id": "plus1x2", "name": "+1 к двум разным", "grants": [
        { "kind": "choice", "id": "asi_p1", "count": 2, "distinct": true, "prompt": "Две характеристики (+1)",
          "from": { "domain": "variable", "kind": "ability" },
          "apply": { "kind": "grant_ability_score", "amount": 1 } } ] }
    ] }
  } ] }
```

Это ровно «вложенный choice внутри `item.grants`» — то, что сейчас теряется. Значит **фундамент §4 = прямой разблокиратор ASI** (опирается на D3, где `grant_ability_score` уже применяется). Клампинг ≥ верхнего предела (по умолчанию 20) — доменным правилом ability.

---

## 7. Контент-модель примеров

- **Одарённый** — контент НЕ меняем (choice уже правильный). Фикс — в сборке: related-эффекты origin-черты прогонять через `collectChoices` (слайс 1).
- **Музыкант** — заменить narrative-эффект «Обученность инструментам» на `choice { from: variable/instrument, count: 3, apply: grant_proficiency(tool) }`. Нужен **каталог инструментов** (`frontend/utils/instruments.json` по образцу `weapon_types.json`, либо подмножество tool-каталога с тегом «музыкальный»). Упрощение (по решению): выбор из ТИПОВ инструментов допустим, если полный список избыточен.
- **ASI** — новая черта §6 + сидинг level_progression (слайс 3).

---

## 8. Слайсы реализации (после согласования дока)

1. **Фундамент — единый резолвер + fix-point.** Общий `resolvePick(from,value,apply)` + доменная таблица дефолтных грантов; нормализация старого формата; fix-point-цикл, разрешающий вложенные `choice` всех доменов (в т.ч. `item.grants`); общий `choiceKey`-helper. Фикс всплытия выборов origin-черт (**Одарённый начинает спрашивать навыки**). Юнит-тесты на каждый домен + вложенность. Схема: `from`/`apply` + enum source (+effect/effect_type). *Гейты: tsc, vitest.*
2. **Каталоги-значения.** Формализовать каталоги (skill/ability/tool/language/instrument/damage_type) + дефолтный apply по виду. Каталог инструментов. Клампинг ability ≤ предел.
3. **ASI / D2.** Черта «Улучшение характеристик» (§6) + `level_progression["4"/8/12/16/19]` с choice(entity/feat, general) — сидинг 12 классам через API. Кузня: мультивыбор черт по уровням. Live-проверка: L4 → выбор черты → ASI → выбор режима → выбор характеристик → прирост на листе.
4. **Контент-свип.** Пере-моделировать narrative-«выберите N» в реальные choice (Музыкант и др.); аудит.
5. **Лист (в игре).** Панель «Требуется выбор» на листе для `when ∈ {on_cast, per_turn, manual}`; персист в turn_state.
6. **Схема/валидатор/AI-промпт** — доработать под новый формат (ai_mechanics_controller промпт, lint-mechanics, sync-mechanics-schema).

Порядок ценности: слайс 1 чинит «Одарённый» и даёт фундамент; слайс 3 — ASI (D2); дальше по убыванию.

---

## 9. Риски и открытые вопросы

- **Ключи `resolved_choices` уже сохранённых персонажей** — формат сохраняем 1:1 (helper только выносит существующий шаблон), миграция не нужна. Проверить на реальных персонажах.
- **Глубина рекурсии** — сейчас BFS≤6; fix-point с `seen` защищает от циклов данных. Оставить лимит-предохранитель.
- **Каталог инструментов/языков** — где хранить и на каком уровне детализации (полный список vs типы). Решение владельца: допускается упрощение до типов.
- **Клампинг характеристик** (ASI не выше 20 без особых черт) — доменное правило ability; подтвердить предел (по умолчанию 20).
- **`when` на листе** — какие именно выборы должны быть in-play (заклинания с выбором при касте?) — уточнить при слайсе 5.

---

Готово к согласованию. После «ок» начинаю со слайса 1 (фундамент + фикс «Одарённого»), затем слайс 3 (ASI/D2).
