# Система переменных (Variables)

Именованные значения персонажа (число или dice), которые **задают эффекты** и
которые доступны в **формулах** эффектов/действий/заклинаний. Заменяет точечный
хардкод («Кость боевых искусств») на данные (парадигма [[no-hardcode-paradigm]],
единый интерпретатор [[value-methods-paradigm]], [[engine-universal-substrate]]).

## Переменная сама по себе — это три параметра

Сущность-справочник Variable: `name` + `type` + `default_value`. И всё.

| Поле | Тип | Смысл |
|---|---|---|
| `variable_id` | slug | идентификатор для ссылок в формулах, напр. `martial_arts_die` |
| `name` | string | человекочитаемое имя |
| `var_type` | `number` \| `dice` | числовая (2) или dice (`1d6`) |
| `default_value` | string | значение по умолчанию: `"0"`, `"1d6"` |

Никаких уровней/скоупов на самой переменной — это **не** её ответственность.

## Значение задают ЭФФЕКТЫ

Эффект несёт payload:

```json
{ "kind": "variable", "op": "set" | "add" | "remove", "id": "martial_arts_die", "value": "1d8" }
```

- `set` — присвоить/перекрыть (добавить переменную персонажу или сменить значение).
- `add` — прибавить (для числовых; к отсутствующей/dice ведёт себя как `set`).
- `remove` — удалить переменную у персонажа.
- `value` опционально: если не задано, берётся `default_value` справочника.

Эффекты привязаны к уровням класса через `level_progression`, поэтому «уровневый»
рост переменной — это просто эффект на нужном уровне:

- Варвар, `level_progression[1]`: эффект `set rage_damage_modifier = 2`.
- Монах, `level_progression[1]`: эффект `set martial_arts_die = 1d6`.
- Монах, `level_progression[5]`: эффект `set martial_arts_die = 1d8` — **перекрывает** d6.

**Мультикласс работает нативно:** эффекты собираются со всех классов персонажа.
Монах 5 / варвар 3 получит `martial_arts_die = 1d8` (из монашеских эффектов ≤ ур. 5)
и `rage_damage_modifier = 2` (из варварских ≤ ур. 3).

## Резолв (сворачивание)

`gatherFeatureRefs` собирает эффекты из `level_progression` только для уровней ≤
уровня персонажа, **по возрастанию уровня** (числовые ключи в JS всегда по
возрастанию), `Promise.all` сохраняет порядок. `collectVariablesFromEffects`
(`frontend/src/character/variables.ts`) сворачивает variable-payload'ы в этом
порядке → карта `id → значение`. Старший уровень применяется последним и
перекрывает младший. Тип значения определяется из строки (`"1d8"` → dice,
`"2"` → число) или из справочника.

## Синтаксис в формулах

Переменная — обычный токен формулы, рядом с `prof_bonus`, `wis`, `self_level`:

```
martial_arts_die + wis      → 1d8 + мод.Мудрости
3 * martial_arts_die        → 3 × брошенной кости (см. ограничение ниже)
rage_damage_modifier        → +3 (варвар 9), как плоский модификатор с источником
```

- **dice-переменная** раскрывается в бросок кости (count из значения, обычно 1).
- **number-переменная** — плоский модификатор (с источником для breakdown).

Ограничение: `N * dice_var` умножает результат одного броска на N (среднее
корректно), а не бросает N костей. Для «N костей» используйте dice-значение с
count (`"3d8"`) или разложите. Это может быть уточнено позже (deferred-dice).

## Мягкая деградация при отсутствии

Если формула ссылается на переменную, которой у персонажа **нет** (эффект её не
задал), резолв не роняет лист/действие:

- `formula.ts resolveId` кидает **`MissingVariableError`** (не общий throw).
- Исполнитель `execute.ts` ловит его на уровне эффекта → эффект **пропускается**
  с логом `Переменная «X» недоступна — эффект «…» не применён`. Действие не падает.
- Правила `resolveCharacterRules` (`collectNumericModifier`) уже в try/catch →
  такой модификатор просто не применяется.

Эффект, завязанный на переменную, у «неподходящего» персонажа просто не срабатывает.

## Точки интеграции (код)

- Backend: сущность `Variable` (`variables` таблица, миграция 063) + контроллер
  `variable_controller.go` + роуты `/api/variables`. Значения — в эффектах, не в классе.
- `frontend/src/engine/formula.ts`: `FormulaContext.variables`, ветка в `resolveId`,
  `MissingVariableError`, тип `VariableValue`.
- `frontend/src/character/variables.ts`: `collectVariablesFromEffects`, `parseDice`, `parseValue`.
- `frontend/src/character/assemble.ts`: `loadBundle` грузит `variableDefs`; `assemble`
  сворачивает variable-payload'ы эффектов/действий → `AssembledCharacter.variables`.
- `resolveCharacterRules.ts`: `formulaCtx.variables` + `ruleState.variables`.
- `runtime.ts buildCharacterContext`: `ctx.variables` для рантайма листа/боя.
- `execute.ts`: `formulaCtx.variables` + skip-эффекта при `MissingVariableError`.

## Базовые переменные (сид, миграция 063)

`martial_arts_die` (dice, def 1d6), `rage_damage_modifier` (number, def 2),
`bardic_inspiration_die` (dice, def 1d6), `superiority_die` (dice, def 1d8),
`superiority_dice_count` (number, def 4). Значения по уровням задают эффекты классов.
