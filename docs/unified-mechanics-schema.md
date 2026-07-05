# Унифицированная схема механик D&D 2024 (черновик 1.1)

Единый JSON-формат, которым можно описать **эффект**, **действие** и **заклинание**
(а также черту, видовую особенность, свойство предмета) так, чтобы движок мог
их интерпретировать, а конструктор — собирать без свободного текста.

> Статус: дизайн-документ. **План реализации блочного конструктора** (Фаза 1) —
> [`effect-constructor-implementation-plan.md`](effect-constructor-implementation-plan.md).
> Машинная схема — [`mechanics.schema.json`](mechanics.schema.json).
>
> **Изменения 1.1** (под способности видов PHB 2024): добавлены событие `on_acquire`
> и семантика «выбора до разрешения» (§5.3); grant-семейство постоянных приобретений
> (§6.5); конструкция `choice` и модель pending-choice (§6.7).

---

## 1. Терминология проекта

- **Эффект** — пассивное свойство: от класса, вида, предмета снаряжения или черты.
  Всегда «включён» (или включается по условию), ресурсов не тратит.
- **Действие** — всё, что **тратит ресурс действия**: основное / бонусное действие,
  реакцию, очко ярости, фокус (ки), кость превосходства и т.д.
- **Заклинание** — действие, которое тратит **ячейку заклинания** или является
  **заговором**.

Все три — частные случаи одной сущности **MechanicCard**. Различие — только в блоке
`activation` (что тратится и как включается).

---

## 2. Четыре категории взаимодействия

Любое влияние на другое существо сводится к одной из 4 механик разрешения
(`interaction.resolution`). Это ядро системы — на скриншоте «Взаимодействие между
персонажами DnD 2024»:

| Категория | `resolution` | Кто бросает | Примеры |
|---|---|---|---|
| Бросок атаки | `attack_roll` | вы — против КЗ цели | удар оружием, безоружный, атака заклинанием |
| Спасбросок | `save` | цель (вы принуждаете) **или** вы | Огненный шар, Внезапный удар, Дыхание дракона |
| Проверка характеристики | `ability_check` | вы / состязание | Толкание, Захват, Стабилизация |
| Безусловный эффект | `auto` | никто (без броска) | Лечение, Волшебная стрела, пассивные баффы |

`auto` — это и «безусловные эффекты» из наброска, и дом для **всех пассивных
модификаторов** (бонусы, сопротивления, преимущества) — см. §6.

---

## 3. Верхнеуровневая структура `MechanicCard`

```jsonc
{
  "schema_version": "1.0",
  "id": "barbarian-rage",            // стабильный slug
  "name": "Rage",
  "russian_name": "Ярость",
  "kind": "action",                  // passive_effect | action | spell | trait
  "source": "class:barbarian:1",     // см. §4.0
  "description": "...",              // текст правил (RU), поддерживает шорткаты :fire: [fire]…[/fire]
  "tags": ["combat", "buff"],

  "requirements": [ Requirement ],   // Требования — чтобы ИМЕТЬ/использовать (§4)
  "activation":   Activation,        // Время + Триггер + Стоимость (§5)
  "targeting":    Targeting,         // на кого направлено (§5.4)
  "interactions": [ Interaction ],   // 4 категории разрешения (§6)
  "duration":     Duration,          // как долго длится результат (§7)
  "uses":         Uses               // частота / перезарядка (§7)
}
```

Минимальные обязательные поля: `id`, `name`, `kind`, `activation`. Всё остальное —
по необходимости. Пассивный эффект может не иметь `interactions` (только модификаторы),
а простое лечение — не иметь `requirements`/`duration`.

> **Улучшение наброска №1.** В исходном эскизе `trigger` смешивал «когда срабатывает»
> и «что делает» (`effect` внутри `trigger`). Здесь это разделено: **`activation`** —
> когда/чем активируется, **`interactions`** — что происходит. Так один объект может
> иметь несколько эффектов (Ярость = и бафф урона, и сопротивление, и преимущество).

---

## 4. `requirements` — Требования (ветка «Требования»)

Список предикатов; все должны выполняться. Используется и как «можешь ли ты вообще
обладать этим» (класс/вид), и как «можешь ли применить сейчас» (ресурс/состояние/снаряжение).

```jsonc
{ "type": "class",        "value": "barbarian", "min_level": 1 }
{ "type": "subclass",     "value": "berserker" }
{ "type": "species",      "value": "orc" }
{ "type": "feat",         "value": "actor" }
{ "type": "ability_score","ability": "cha", "min": 13 }
{ "type": "proficiency",  "kind": "skill", "value": "deception" }
{ "type": "equipment",    "value": "no_heavy_armor" }   // armor:none|light|… | shield | free_hand | weapon:<property>
{ "type": "resource",     "id": "rage", "min": 1 }
{ "type": "state",        "value": "not_incapacitated", "present": false }
```

**Источники** (`source`, §3): `class:<id>:<lvl>`, `subclass:<id>:<lvl>`,
`species:<id>`, `feat:<id>`, `item:<id>`, `spell`, `background:<id>`.

---

## 5. `activation` — Время, Триггер, Стоимость

```jsonc
"activation": {
  "mode": "active",          // active | passive | reaction | triggered
  "cost": [ Cost ],          // что тратится (§5.1)
  "trigger": Trigger,        // только для reaction/triggered (§5.2)
  "casting_time": "action",  // для заклинаний (action|bonus_action|reaction|"1 minute"|"ritual")
  "range": "60 feet",
  "components": { "v": true, "s": true, "m": "щепотка серы" }
}
```

- **`mode`**:
  - `active` — вы тратите действие в свой ход (Ярость, Рывок, большинство заклинаний).
  - `passive` — всегда активно (Защита без доспехов, Аура защиты, Чувство опасности).
  - `reaction` — тратит реакцию в ответ на событие (Щит, Адское возмездие, Атака
    при возможности).
  - `triggered` — срабатывает само при событии **без** траты реакции
    (Скрытая атака, Внезапный удар при попадании, Неумолимая стойкость).

### 5.1 `cost` — стоимость

```jsonc
{ "resource": "action" }                 // основное действие
{ "resource": "bonus_action" }
{ "resource": "reaction" }
{ "resource": "movement", "amount": 10 } // футы
{ "resource": "spell_slot", "level": 1 } // ячейка (level=0 → заговор)
{ "resource": "rage_charge",  "amount": 1 }
{ "resource": "focus", "amount": 2 }     // очки фокуса (ки) 2024
{ "resource": "superiority_die", "amount": 1 }
{ "resource": "channel_divinity", "amount": 1 }
{ "resource": "hp", "amount": "self_level" } // формула, см. §8
```

Несколько элементов = «и то, и то»: например, Ярость тратит
`bonus_action` **и** `rage_charge`, поэтому `cost` содержит два объекта.

### 5.2 `trigger` — Время + Триггер + Обстоятельства

Это объединённые ветки наброска «Время», «Триггер», «Обстоятельства».

```jsonc
"trigger": {
  "timing": "after",            // Время: before | during | after | replaces
  "event": "damage_taken",      // Триггер (§5.3)
  "subject": "self",            // чьё событие: self | ally | enemy | attacker | target | any_creature
  "circumstances": [ Condition ]// Обстоятельства (§5.5)
}
```

- **`timing`** (Время):
  - `before` — перехват **до** разрешения: можно изменить вход (Щит даёт +5 КЗ до
    того, как атака сравнивается с КЗ).
  - `during` / `when` — одновременно с событием.
  - `after` — реакция **на результат** (Адское возмездие после получения урона).
  - `replaces` — **заменяет** бросок/результат (Удача — переброс; Предсказание — подмена d20).

> **Улучшение наброска №2.** Добавлен `replaces` к трём вариантам времени из эскиза
> (`before/during/after`). Без него нельзя описать переброс (Удача, Меткий талант) и
> подмену кубика (Предсказание).

### 5.3 `event` — словарь триггеров

`attack_roll_made`, `hit`, `miss`, `crit`, `damage_dealt`, `damage_taken`,
`saving_throw_made`, `forced_save`, `ability_check_made`, `reduced_to_0_hp`,
`creature_enters_reach`, `creature_leaves_reach`, `creature_moves`,
`turn_start`, `turn_end`, `spell_cast`, `condition_applied`, `initiative_roll`,
`short_rest`, `long_rest`,
**`on_acquire`** (особенность получена персонажем — при создании или повышении уровня),
**`level_gained`** (получен новый уровень — для особенностей, открывающихся на уровне N).

> **`on_acquire` + `timing:"before"` = выбор (pending choice).** Так описываются
> особенности «при получении, до разрешения»: персонаж должен **сделать выбор**
> (навык, черта, заклинание, происхождение). Выбор постоянный и **не развеивается**
> (такие эффекты в принципе не диспеллятся). Механика выбора — §6.7.

### 5.4 `targeting` — цель

```jsonc
"targeting": {
  "shape": "single",     // self | single | multi | area | aura
  "range": "120 feet",   // touch | self | "<N> feet"
  "max_targets": 1,
  "area": { "kind": "sphere", "size": 20 },   // sphere|cube|cone|line|cylinder|emanation
  "filter": "enemy"      // any | enemy | ally | creature_type:<...>
}
```

### 5.5 `circumstances` / `Condition` — предикаты обстоятельств

Переиспользуются в `trigger.circumstances`, в условиях модификаторов (`when`) и в
`save_ends`.

```jsonc
{ "kind": "attack_is", "value": "finesse_or_ranged" }       // свойство атаки
{ "kind": "has_advantage" }
{ "kind": "ally_within", "range": 5, "of": "target" }       // союзник рядом с целью
{ "kind": "creature_within", "range": 5, "filter": "enemy" }
{ "kind": "target_has_condition", "value": "prone" }
{ "kind": "target_type", "value": "undead" }
{ "kind": "target_wears", "value": "armor:heavy" }          // носит/несёт
{ "kind": "wielding", "value": "weapon:heavy" }
{ "kind": "you_have_condition", "value": "raging" }
{ "kind": "unseen_by_target" }
{ "kind": "narrative", "description": "ГМ решает, уместна ли маскировка" }
```

---

## 6. `interactions` — что происходит (4 категории)

Список. Каждый `Interaction` имеет `resolution` (одна из 4 категорий) и набор
**исходов** (`Outcome`), которые применяют **полезную нагрузку** (`Payload`, §6.5).

### 6.1 `attack_roll`

```jsonc
{
  "resolution": "attack_roll",
  "attack_kind": "weapon_melee",     // weapon_melee|weapon_ranged|unarmed|spell_melee|spell_ranged
  "ability": "auto",                  // auto = по оружию; str|dex|spellcasting
  "vs": "ac",
  "advantage": "none",                // none|advantage|disadvantage
  "on_hit":  [ Payload ],
  "on_crit": [ Payload ],             // опц.
  "on_miss": [ Payload ]              // опц.
}
```

### 6.2 `save`

```jsonc
{
  "resolution": "save",
  "who": "target",                    // target (вы принуждаете) | self (вы спасаетесь)
  "ability": "dex",
  "dc": "spell_dc",                   // spell_dc | "8+prof+con" | число (§8)
  "on_fail":    [ Payload ],
  "on_success": [ Payload ],          // напр. "half_damage" (см. §6.5 damage.on_success)
  "repeat": { "when": "turn_end", "ends_effect": true }   // повтор спасброска
}
```

### 6.3 `ability_check`

```jsonc
{
  "resolution": "ability_check",
  "ability": "str",
  "skill": "athletics",               // опц.
  "mode": "dc",                       // dc | contest
  "dc": "8+prof+str",                 // для mode=dc (Захват 2024)
  "contest_vs": ["athletics","acrobatics"], // для mode=contest (Захват 2014)
  "on_success": [ Payload ],
  "on_fail":    [ Payload ]
}
```

### 6.4 `auto` — безусловный эффект / пассивный модификатор

```jsonc
{ "resolution": "auto", "result": [ Payload ] }
```

Сюда попадают: лечение, авто-урон (Волшебная стрела), наложение состояния без
спасброска — и **все пассивные модификаторы** (через `Payload.modifier`).

### 6.5 `Payload` — полезная нагрузка исходов

Единый словарь «что применить». Используется в `on_hit/on_fail/on_success/result`.

```jsonc
// Урон
{ "kind": "damage", "dice": "2d6", "type": "fire",
  "scaling": { "per": "spell_slot_above", "dice": "1d6" }, // апкаст/масштаб заговора
  "on_success": "half" }                                    // поведение при успехе спасброска

// Лечение / временные хиты
{ "kind": "healing", "amount": "1d8+spellcasting" }
{ "kind": "temp_hp", "amount": "2d4+self_level" }

// Состояние
{ "kind": "condition", "value": "stunned", "op": "apply",
  "duration": { "type": "rounds", "amount": 1 },
  "save_ends": { "ability": "con", "when": "turn_end" } }

// Модификатор (ядро пассивных эффектов и баффов) — см. §6.6
{ "kind": "modifier", ... }

// Перемещение
{ "kind": "movement", "value": "push", "distance": 10 }     // push|pull|teleport|extra_speed|knock_prone

// Ресурсы
{ "kind": "resource", "op": "grant", "id": "action", "amount": 1 }   // Прилив действий
{ "kind": "resource", "op": "restore", "id": "spell_slot", "level": 1 }

// Сопротивление/иммунитет/уязвимость
{ "kind": "resistance", "damage_type": "fire", "value": "resistance" } // resistance|immunity|vulnerability

// Выдать варианты действий (Хитрое действие)
{ "kind": "grant_action", "as": "bonus_action", "options": ["dash","disengage","hide"] }

// «Талон»/boon — отложенный бонус, который получатель тратит позже
{ "kind": "boon", "id": "bardic_inspiration", "die": "1d6",
  "applies_to": ["attack_roll","ability_check","saving_throw"], "expires": "10 minutes" }

// Переброс / подмена кубика
{ "kind": "reroll", "which": "d20", "keep": "either" }       // Удача
{ "kind": "set_die", "which": "d20", "source": "portent" }   // Предсказание

// Установка значения
{ "kind": "set_value", "target": "ac_base", "formula": "10+dex+con" } // Защита без доспехов

// Превращение
{ "kind": "transform", "into": "beast_statblock", "cr_max": "self_level/3" } // Дикий облик

// ── Постоянные приобретения (grant-семейство) — выживают развеивание ──
// Владение (навык/инструмент/спасбросок/оружие/доспех/язык)
{ "kind": "grant_proficiency", "prof": "skill", "value": "perception" }   // prof: skill|tool|saving_throw|weapon|armor|language
// Черта
{ "kind": "grant_feat", "value": "skilled" }
// Известное заклинание/заговор (часто с уровневым гейтом через requirements)
{ "kind": "grant_spell", "value": "prestidigitation", "level_gate": 1, "ability": "int" }
// Постоянный прирост характеристики / чувств / скорости
{ "kind": "grant_ability_score", "ability": "con", "amount": 1 }
{ "kind": "grant_sense", "sense": "darkvision", "range": 60 }            // darkvision|tremorsense|blindsight
{ "kind": "grant_speed", "mode": "fly", "value": "walk_speed" }          // walk|fly|swim|climb

// Ссылка на другой эффект (композиция «бусины») — получить весь набор
{ "kind": "grant_effect", "value": "EFF-disadvantage-attacks" }          // один эффект по slug/card_number
{ "kind": "grant_effect", "values": ["EFF-frightened", "EFF-slowed"] }   // или сразу набор

// Выбор из списка (см. §6.7) — оборачивает один из grant-payload'ов
{ "kind": "choice", "id": "...", ... }

// Чистый текст
{ "kind": "narrative", "description": "..." }
```

> **Зачем отдельное grant-семейство.** `modifier` описывает **временные** бонусы к
> броскам/значениям (бафф/дебафф, может развеяться). `grant_*` описывает **постоянные
> приобретения** персонажа (навык, черта, заклинание, чувство). Они применяются один
> раз при получении/выборе и не откатываются. Движок хранит их в самом персонаже, а не
> в активном эффекте.

### 6.6 `modifier` — подсистема модификаторов (расширяет существующий `Script`)

Покрывает все пассивные эффекты, баффы и дебаффы. Совместима с текущими
`attack_modifier / ability_check_modifier / saving_throw_modifier / resistance`
из `effect_interpreter.go`, но обобщена.

```jsonc
{
  "kind": "modifier",
  "applies_to": {                 // на что влияет
    "roll": "attack",             // attack|damage|ability_check|saving_throw|ac|speed|spell_dc|initiative
    "filter": { "attack_kind": "weapon_melee", "ability": "str" } // уточнения
  },
  "op": "add",                    // add | set | advantage | disadvantage | reroll | multiply
  "value": "+2",                  // "+2" | "rage_bonus" | формула (§8)
  "when": [ Condition ],          // условия применения (§5.5)
  "duration": Duration            // если временный
}
```

Примеры `applies_to.roll`: Аура защиты → `saving_throw` (+cha) для союзников в радиусе;
Безрассудная атака → `attack` advantage (свои) **и** `attack` advantage (входящие по вам);
Ярость → `damage` (+2 рукопашные Силой) и `saving_throw`/`ability_check` (advantage, Сила).

### 6.7 `choice` — выбор из списка и pending-choice

Ключевая конструкция для видов/черт «при получении». Описывает, что **игрок выбирает
N вариантов из списка**, и каждый выбор превращается в постоянный grant (§6.5).

```jsonc
{
  "kind": "choice",
  "id": "human_skill",             // СТАБИЛЬНЫЙ id (нужен движку для pending-choice)
  "prompt": "Выберите навык",
  "count": 1,                       // сколько выбрать
  "options": {
    "source": "skill",              // skill|tool|saving_throw|language|feat|spell|damage_type|subfeature|explicit|effect
    "filter": "all",                // "all" | именованный список ("origin_feats","wizard_cantrips") | [id,...]
    "items": [ ChoiceItem ]         // только для source = subfeature | explicit (см. ниже)
  },
  "recommended": ["skilled"],       // подсветить рекомендованные (необязательно)
  "grant": { "kind": "grant_proficiency", "prof": "skill" }, // шаблон: применяется к каждому выбранному
  "resolution": "on_acquire"        // когда спрашивать: on_acquire (создание/левелап или «!» позже)
}
```

- **`grant`-шаблон** — для `source` из «плоских» категорий (skill/feat/spell/…): к
  каждому выбранному id применяется этот grant с подставленным `value` = id.
- **`source: "subfeature"`** — для **происхождений/подвидов** (Эльфийское/Гномье/
  Драконье наследие), где каждый вариант — это **пакет** из нескольких grant'ов, часть
  с уровневым гейтом. Тогда `options.items` — массив:

```jsonc
// ChoiceItem (для subfeature/explicit)
{
  "id": "high_elf", "name": "Высший эльф",
  "grants": [
    { "kind": "grant_spell", "value": "prestidigitation", "ability": "int", "level_gate": 1 },
    { "kind": "grant_spell", "value": "detect_magic",      "ability": "int", "level_gate": 3 },
    { "kind": "grant_spell", "value": "misty_step",        "ability": "int", "level_gate": 5 }
  ]
}
```

#### Pending-choice (модель разрешения)

«До разрешения» означает: при получении особенности движок создаёт **запись о
незакрытом выборе** на персонаже и предлагает закрыть её. Хранение (Фаза 1) — поле
`pending_choices` (jsonb) у персонажа:

```jsonc
{
  "id": "<uuid>",
  "source": "race:elf:elf_lineage",   // откуда пришёл выбор
  "choice_id": "elf_lineage",         // = choice.id
  "prompt": "Выберите происхождение",
  "count": 1,
  "options": { ... },                  // снимок options на момент получения
  "recommended": ["high_elf"],
  "status": "pending",                 // pending | resolved
  "resolved": []                       // выбранные id после закрытия
}
```

- **Когда спрашивать:** если особенность получена в потоке создания персонажа или
  повышения уровня → сразу показать окно выбора. Иначе — отложить; в листе персонажа
  у незакрытых выборов горит «**!**», по клику открывается то же окно.
- **Постоянство:** после разрешения grant'ы применяются к персонажу навсегда и
  переживают развеивание. Эффекты с `on_acquire`-выбором **помечаются как
  неразвеиваемые**.

> Фаза 1 (этот план): конструктор **авторит** `choice`/`grant` и бэкенд **хранит**
> `mechanics` и `pending_choices`. Само окно разрешения и лист персонажа — Фаза 2.

---

## 7. `duration` и `uses`

```jsonc
"duration": {
  "type": "minutes",              // instantaneous|rounds|minutes|hours|while_active|
                                  // until_long_rest|until_dispelled|permanent
  "amount": 10,
  "concentration": false,
  "ends_when": [ Condition ],     // досрочное завершение (Ярость 2024: incapacitated / снял доспех)
  "requires_each_turn": [ Condition ] // если нужно поддерживать (Ярость 2014: атаковать/получать урон)
}

"uses": {
  "count": "prof_bonus",          // число или формула (§8)
  "per": "long_rest",             // turn|round|short_rest|long_rest|day
  "recharge": "5-6"               // опц.: бросок перезарядки (для монстров/предметов)
}
```

---

## 8. Формулы (`formula`)

Строки-формулы вместо чисел там, где значение зависит от персонажа. Грамматика:
числа, `+ - * /`, скобки и переменные:

`prof_bonus`, `self_level`, `class_level:<id>`, `str|dex|con|int|wis|cha` (модификаторы),
`spellcasting` (модификатор заклинательной хар-ки), `spell_slot_level`,
`spell_slot_above` (выше базового уровня заклинания), `rage_bonus`.

Примеры: `"1d8+spellcasting"`, `"8+prof+dex"`, `"self_level"`, `"prof_bonus"`,
`"class_level:rogue/2 d6"` (Скрытая атака: (уровень плута)/2, округление вверх, костей d6).

---

## 9. Рабочие примеры (проверка выразительности)

### 9.1 Ярость (Варвар) — действие + набор баффов

```jsonc
{
  "id": "barbarian-rage", "name": "Rage", "russian_name": "Ярость",
  "kind": "action", "source": "class:barbarian:1",
  "requirements": [
    { "type": "class", "value": "barbarian", "min_level": 1 },
    { "type": "equipment", "value": "no_heavy_armor" },
    { "type": "resource", "id": "rage", "min": 1 }
  ],
  "activation": { "mode": "active", "cost": [ {"resource":"bonus_action"}, {"resource":"rage","amount":1} ] },
  "targeting": { "shape": "self" },
  "interactions": [
    { "resolution": "auto", "result": [
      { "kind": "modifier", "applies_to": {"roll":"damage","filter":{"attack_kind":"weapon_melee","ability":"str"}},
        "op": "add", "value": "rage_bonus" },
      { "kind": "modifier", "applies_to": {"roll":"ability_check","filter":{"ability":"str"}}, "op": "advantage" },
      { "kind": "modifier", "applies_to": {"roll":"saving_throw","filter":{"ability":"str"}}, "op": "advantage" },
      { "kind": "resistance", "damage_type": "bludgeoning", "value": "resistance" },
      { "kind": "resistance", "damage_type": "piercing",   "value": "resistance" },
      { "kind": "resistance", "damage_type": "slashing",   "value": "resistance" }
    ]}
  ],
  "duration": { "type": "minutes", "amount": 10, "ends_when": [
    { "kind": "you_have_condition", "value": "incapacitated" },
    { "kind": "narrative", "description": "вы надели Тяжёлый доспех" }
  ]},
  "uses": { "count": "rage_per_day", "per": "long_rest" }
}
```

### 9.2 Защита без доспехов (Варвар/Монах) — пассив, установка значения

```jsonc
{
  "id": "unarmored-defense-barb", "russian_name": "Защита без доспехов",
  "kind": "passive_effect", "source": "class:barbarian:1",
  "requirements": [ { "type": "equipment", "value": "armor:none" } ],
  "activation": { "mode": "passive" },
  "interactions": [ { "resolution": "auto", "result": [
    { "kind": "set_value", "target": "ac_base", "formula": "10+dex+con" }
  ]}]
}
```

### 9.3 Скрытая атака (Плут) — `triggered`, условие, раз в ход

```jsonc
{
  "id": "rogue-sneak-attack", "russian_name": "Скрытая атака",
  "kind": "passive_effect", "source": "class:rogue:1",
  "requirements": [ { "type": "class", "value": "rogue", "min_level": 1 } ],
  "activation": {
    "mode": "triggered",
    "trigger": {
      "timing": "during", "event": "hit", "subject": "self",
      "circumstances": [
        { "kind": "attack_is", "value": "finesse_or_ranged" },
        { "kind": "any_of", "of": [
          { "kind": "has_advantage" },
          { "kind": "ally_within", "range": 5, "of": "target" }
        ]}
      ]
    }
  },
  "interactions": [ { "resolution": "auto", "result": [
    { "kind": "damage", "dice": "class_level:rogue/2 d6", "type": "weapon" }
  ]}],
  "uses": { "count": 1, "per": "turn" }
}
```

### 9.4 Внезапный удар (Монах) — при попадании, фокус, принуждение к спасброску

```jsonc
{
  "id": "monk-stunning-strike", "russian_name": "Внезапный удар",
  "kind": "action", "source": "class:monk:5",
  "activation": {
    "mode": "triggered",
    "cost": [ {"resource":"focus","amount":1} ],
    "trigger": { "timing":"after", "event":"hit", "subject":"self",
                 "circumstances":[ {"kind":"attack_is","value":"monk_weapon_or_unarmed"} ] }
  },
  "targeting": { "shape": "single", "filter": "enemy" },
  "interactions": [ { "resolution": "save", "who": "target", "ability": "con", "dc": "8+prof+wis",
    "on_fail": [ { "kind": "condition", "value": "stunned", "op": "apply",
                   "duration": {"type":"rounds","amount":1} } ]
  }],
  "uses": { "count": "prof_bonus", "per": "long_rest" }
}
```

### 9.5 Божественная кара (Паладин) — **заклинание** 2024, урон при попадании, апкаст

```jsonc
{
  "id": "spell-divine-smite", "russian_name": "Божественная кара",
  "kind": "spell", "source": "spell",
  "activation": {
    "mode": "triggered",
    "cost": [ {"resource":"spell_slot","level":1} ],
    "casting_time": "bonus_action",
    "trigger": { "timing":"after", "event":"hit", "subject":"self",
                 "circumstances":[ {"kind":"attack_is","value":"weapon_melee"} ] }
  },
  "interactions": [ { "resolution": "auto", "result": [
    { "kind": "damage", "dice": "2d8", "type": "radiant",
      "scaling": { "per": "spell_slot_above", "dice": "1d8" },
      "bonus": { "condition": {"kind":"target_type","value":"undead_or_fiend"}, "dice": "1d8" } }
  ]}]
}
```

### 9.6 Щит (заклинание) — реакция, `before`, модификатор КЗ

```jsonc
{
  "id": "spell-shield", "russian_name": "Щит", "kind": "spell", "source": "spell",
  "activation": {
    "mode": "reaction",
    "cost": [ {"resource":"reaction"}, {"resource":"spell_slot","level":1} ],
    "casting_time": "reaction", "components": { "v": true, "s": true },
    "trigger": { "timing":"before", "event":"attack_roll_made", "subject":"enemy",
                 "circumstances":[ {"kind":"narrative","description":"цель атаки — вы"} ] }
  },
  "targeting": { "shape": "self" },
  "interactions": [ { "resolution": "auto", "result": [
    { "kind": "modifier", "applies_to": {"roll":"ac"}, "op": "add", "value": "+5",
      "duration": { "type":"rounds", "amount":1 } }
  ]}]
}
```

### 9.7 Адское возмездие — реакция, `after damage_taken`, спасбросок, half on success

```jsonc
{
  "id": "spell-hellish-rebuke", "russian_name": "Адское возмездие", "kind": "spell", "source": "spell",
  "activation": {
    "mode": "reaction",
    "cost": [ {"resource":"reaction"}, {"resource":"spell_slot","level":1} ],
    "casting_time": "reaction",
    "trigger": { "timing":"after", "event":"damage_taken", "subject":"self" }
  },
  "targeting": { "shape": "single", "range": "60 feet", "filter": "enemy" },
  "interactions": [ { "resolution":"save", "who":"target", "ability":"dex", "dc":"spell_dc",
    "on_fail":    [ {"kind":"damage","dice":"2d10","type":"fire",
                     "scaling":{"per":"spell_slot_above","dice":"1d10"}} ],
    "on_success": [ {"kind":"damage","dice":"2d10","type":"fire","on_success":"half"} ]
  }]
}
```

### 9.8 Волшебная стрела — авто-урон, несколько целей, апкаст по дротикам

```jsonc
{
  "id": "spell-magic-missile", "russian_name": "Волшебная стрела", "kind": "spell", "source": "spell",
  "activation": { "mode":"active", "cost":[{"resource":"spell_slot","level":1}], "casting_time":"action" },
  "targeting": { "shape":"multi", "range":"120 feet", "max_targets": 3, "filter":"any" },
  "interactions": [ { "resolution":"auto", "result":[
    { "kind":"damage", "dice":"1d4+1", "type":"force", "per_dart": true,
      "scaling": { "per":"spell_slot_above", "darts": 1 } }
  ]}]
}
```

### 9.9 Огненный шар — принуждение к спасброску, область, half on success

```jsonc
{
  "id": "spell-fireball", "russian_name": "Огненный шар", "kind": "spell", "source": "spell",
  "activation": { "mode":"active", "cost":[{"resource":"spell_slot","level":3}], "casting_time":"action" },
  "targeting": { "shape":"area", "range":"150 feet", "area":{"kind":"sphere","size":20}, "filter":"any" },
  "interactions": [ { "resolution":"save", "who":"target", "ability":"dex", "dc":"spell_dc",
    "on_fail":    [ {"kind":"damage","dice":"8d6","type":"fire",
                     "scaling":{"per":"spell_slot_above","dice":"1d6"}} ],
    "on_success": [ {"kind":"damage","dice":"8d6","type":"fire","on_success":"half"} ]
  }]
}
```

### 9.10 Лечение ран — авто-лечение, касание

```jsonc
{
  "id": "spell-cure-wounds", "russian_name": "Лечение ран", "kind": "spell", "source": "spell",
  "activation": { "mode":"active", "cost":[{"resource":"spell_slot","level":1}], "casting_time":"action" },
  "targeting": { "shape":"single", "range":"touch", "filter":"ally" },
  "interactions": [ { "resolution":"auto", "result":[
    { "kind":"healing", "amount":"2d8+spellcasting",
      "scaling":{ "per":"spell_slot_above", "dice":"2d8" } }
  ]}]
}
```

### 9.11 Захват (безоружный, 2024) — проверка/принуждение к спасброску

```jsonc
{
  "id": "action-grapple", "russian_name": "Захват", "kind": "action", "source": "spell",
  "activation": { "mode":"active", "cost":[{"resource":"action"}] },  // часть атаки
  "targeting": { "shape":"single", "range":"5 feet", "filter":"enemy" },
  "interactions": [ { "resolution":"save", "who":"target", "ability":"dex_or_str", "dc":"8+prof+str",
    "on_fail": [ { "kind":"condition", "value":"grappled", "op":"apply",
                   "save_ends": {"ability":"escape","when":"action"} } ]
  }]
}
```

### 9.12 Прилив действий (Воин) — выдать действие

```jsonc
{
  "id": "fighter-action-surge", "russian_name": "Прилив действий",
  "kind": "action", "source": "class:fighter:2",
  "activation": { "mode":"active", "cost":[{"resource":"action_surge","amount":1}] },
  "interactions": [ { "resolution":"auto", "result":[
    { "kind":"resource", "op":"grant", "id":"action", "amount":1 }
  ]}],
  "uses": { "count":1, "per":"short_rest" }
}
```

### 9.13 Хитрое действие (Плут) — выдать варианты бонусного действия

```jsonc
{
  "id": "rogue-cunning-action", "russian_name": "Хитрое действие",
  "kind": "passive_effect", "source": "class:rogue:2",
  "activation": { "mode":"passive" },
  "interactions": [ { "resolution":"auto", "result":[
    { "kind":"grant_action", "as":"bonus_action", "options":["dash","disengage","hide"] }
  ]}]
}
```

### 9.14 Второе дыхание (Воин) — бонусное действие, лечение, заряды

```jsonc
{
  "id": "fighter-second-wind", "russian_name": "Второе дыхание",
  "kind": "action", "source": "class:fighter:1",
  "activation": { "mode":"active", "cost":[{"resource":"bonus_action"},{"resource":"second_wind","amount":1}] },
  "targeting": { "shape":"self" },
  "interactions": [ { "resolution":"auto", "result":[
    { "kind":"healing", "amount":"1d10+class_level:fighter" }
  ]}],
  "uses": { "count":"2-3", "per":"long_rest", "recharge_note":"частично за короткий отдых" }
}
```

### 9.15 Вдохновение барда — выдать «талон» союзнику

```jsonc
{
  "id": "bard-inspiration", "russian_name": "Вдохновение барда",
  "kind": "action", "source": "class:bard:1",
  "activation": { "mode":"active", "cost":[{"resource":"bonus_action"},{"resource":"bardic_inspiration","amount":1}] },
  "targeting": { "shape":"single", "range":"60 feet", "filter":"ally" },
  "interactions": [ { "resolution":"auto", "result":[
    { "kind":"boon", "id":"bardic_inspiration", "die":"bardic_die",
      "applies_to":["attack_roll","ability_check","saving_throw"], "expires":"long_rest" }
  ]}],
  "uses": { "count":"cha", "per":"long_rest" }
}
```

### 9.16 Аура защиты (Паладин) — пассивная аура, модификатор спасбросков союзников

```jsonc
{
  "id": "paladin-aura-of-protection", "russian_name": "Аура защиты",
  "kind": "passive_effect", "source": "class:paladin:6",
  "activation": { "mode":"passive" },
  "targeting": { "shape":"aura", "range":"10 feet", "filter":"ally_and_self" },
  "interactions": [ { "resolution":"auto", "result":[
    { "kind":"modifier", "applies_to":{"roll":"saving_throw"}, "op":"add", "value":"cha_min_1" }
  ]}]
}
```

### 9.17 Удача (черта) — `replaces`, переброс, ресурс

```jsonc
{
  "id": "feat-lucky", "russian_name": "Удача", "kind": "passive_effect", "source": "feat:lucky",
  "activation": {
    "mode":"triggered",
    "cost":[{"resource":"luck_points","amount":1}],
    "trigger": { "timing":"replaces", "event":"attack_roll_made", "subject":"self" }
  },
  "interactions": [ { "resolution":"auto", "result":[
    { "kind":"reroll", "which":"d20", "keep":"either" }
  ]}],
  "uses": { "count":"prof_bonus", "per":"long_rest" }
}
```

### 9.18 Происхождение фей (вид) — пассивные преимущество и иммунитет

```jsonc
{
  "id": "species-fey-ancestry", "russian_name": "Происхождение фей",
  "kind": "passive_effect", "source": "species:elf",
  "activation": { "mode":"passive" },
  "interactions": [ { "resolution":"auto", "result":[
    { "kind":"modifier", "applies_to":{"roll":"saving_throw"}, "op":"advantage",
      "when":[ {"kind":"narrative","description":"спасбросок против состояния Очарован"} ] }
  ]}]
}
```

### 9.19 Неумолимая стойкость (Орк) — `reduced_to_0_hp`, раз за отдых

```jsonc
{
  "id": "species-relentless-endurance", "russian_name": "Неумолимая стойкость",
  "kind": "passive_effect", "source": "species:orc",
  "activation": { "mode":"triggered",
    "trigger": { "timing":"replaces", "event":"reduced_to_0_hp", "subject":"self",
                 "circumstances":[ {"kind":"narrative","description":"не мгновенная смерть"} ] } },
  "interactions": [ { "resolution":"auto", "result":[
    { "kind":"set_value", "target":"hp", "formula":"1" }
  ]}],
  "uses": { "count":1, "per":"long_rest" }
}
```

### 9.20 Артистичный → Вживание в роль (черта) — пример заказчика в новой схеме

```jsonc
{
  "id": "feat-actor-impersonation", "name": "Actor: Impersonation",
  "russian_name": "Артистичный: Вживание в роль",
  "kind": "passive_effect", "source": "feat:actor",
  "requirements": [ { "type":"ability_score", "ability":"cha", "min":13 } ],
  "activation": {
    "mode":"triggered",
    "trigger": {
      "timing":"during", "event":"ability_check_made", "subject":"self",
      "circumstances": [
        { "kind":"proficiency_skill_in", "value":["deception","performance"] },
        { "kind":"narrative", "description":"вы выдаёте себя за кого-то другого" }
      ]
    }
  },
  "interactions": [ { "resolution":"auto", "result":[
    { "kind":"modifier", "applies_to":{"roll":"ability_check","filter":{"skill":["deception","performance"]}},
      "op":"advantage" }
  ]}]
}
```

> Та же информация, что в наброске заказчика, но: (1) `effect` вынесен из `trigger`
> в `interactions`; (2) `allowed_skills` стало `circumstances.proficiency_skill_in`;
> (3) `roll_modifier/advantage` стало `Payload.modifier{op:advantage}` — единым с
> остальными модификаторами.

---

## 10. Матрица покрытия (классы / виды / черты → конструкции схемы)

| Особенность | Тип | Ключевые конструкции |
|---|---|---|
| Варвар: Ярость | action | cost(rage), modifier ×3, resistance ×3, duration.ends_when |
| Варвар: Безрассудная атака | action/passive | modifier(attack advantage свои) + modifier(attack advantage входящие) |
| Варвар: Защита без доспехов | passive | set_value(ac_base) + requirement(armor:none) |
| Воин: Прилив действий | action | resource.grant(action), uses(short_rest) |
| Воин: Второе дыхание | action | healing(формула), uses |
| Воин: Мастерство оружия (Cleave/Push/Topple…) | passive | modifier/condition с `when:attack_is` |
| Плут: Скрытая атака | triggered | trigger(hit)+circumstances(any_of), damage(формула), uses(per:turn) |
| Плут: Хитрое действие | passive | grant_action(bonus_action, options) |
| Плут: Невероятное уклонение | reaction | trigger(damage_taken,before)+modifier(damage ×0.5) |
| Плут: Уклонение (Evasion) | passive | modifier(save dex on_success/on_fail → 0/half) |
| Монах: Боевые искусства | passive | modifier(unarmed dice), set_value |
| Монах: Внезапный удар | triggered | cost(focus), save(con)→condition(stunned) |
| Монах: Шквал ударов / Терпеливая защита | action | cost(focus), grant_action / modifier |
| Жрец/Паладин: Божественный канал | action | cost(channel_divinity), options, uses |
| Паладин: Аура защиты | passive aura | targeting(aura), modifier(save +cha) для союзников |
| Паладин: Наложение рук | action | resource pool(lay_on_hands), healing/condition(remove) |
| Бард: Вдохновение | action | boon(die, applies_to, expires) |
| Бард: Мастер на все руки | passive | modifier(ability_check +prof/2 без владения) |
| Друид: Дикий облик | action | transform(statblock), uses |
| Чародей: Метамагия | passive/triggered | cost(sorcery_points), modifier к заклинанию |
| Колдун: Чародейские воззвания | passive | modifier / grant (по воззванию) |
| Волшебник: Предсказание (Прорицатель) | triggered | timing:replaces, set_die |
| Вид: Тёмное зрение | passive | set_value(senses) |
| Вид: Происхождение фей | passive | modifier(save advantage vs charm) |
| Вид: Неумолимая стойкость (Орк) | triggered | trigger(reduced_to_0), set_value(hp=1), uses |
| Вид: Дыхание (Драконорождённый) | action | save(area)→damage, uses(prof_bonus) |
| Вид: Удачливый (Полурослик) | triggered | timing:replaces, reroll (на 1) |
| Черта: Удача | triggered | cost(luck_points), reroll |
| Черта: Часовой (Sentinel) | reaction | trigger(creature attacks ally within 5) → attack |
| Черта: Внимательный (Alert) | passive | modifier(initiative) |

Все 12 классов, видовые особенности и черты сводятся к комбинации
`requirements / activation(cost+trigger) / interactions(4 категории) / Payload /
duration / uses`. Непокрытых «жёстких» кейсов в ядре правил не осталось; самые
нестандартные (Дикий облик, призыв существ) опираются на `transform` / ссылку на
внешний стат-блок + `narrative` как escape-hatch.

> **Полная матрица всех 10 видов PHB 2024 → блоки конструктора** — в
> [`effect-constructor-implementation-plan.md`](effect-constructor-implementation-plan.md) §7.
> Там каждая способность (Находчивый, Эльфийское наследие, Оружие дыхания, Наследие
> великанов и т.д.) разложена на триггер-блок + эффект-блоки.

---

## 11. Связь с текущим кодом и следующий шаг

- Текущее поле `Script` (jsonb) у `actions`/`effects` и его интерпретатор
  (`effect_interpreter.go`: `attack_modifier`, `resistance`, `ability_check_modifier`,
  `saving_throw_modifier`, `spell_restriction`) — это **частный случай** §6.6
  (`Payload.modifier`). Новая схема его обобщает; миграция: завернуть старые типы в
  `interactions:[{resolution:"auto", result:[modifier…]}]`.
- Предлагается единое поле `mechanics` (jsonb) на сущностях `spell`, `action`,
  `effect`, `feat` — со структурой §3. Сущности-карточки остаются как «презентация»
  (название, текст, иконка), а `mechanics` — «исполняемая» часть.

### Универсальный конструктор (следующий этап)

Так как схема — это конечный набор словарей (enum'ов), конструктор строится как
каскад выпадающих списков, повторяющий §3:

1. **Тип** (эффект/действие/заклинание) → задаёт дефолты `activation.mode`.
2. **Требования** — повторитель строк (§4).
3. **Активация**: режим → стоимость (мультиселект ресурсов) → если reaction/triggered:
   Время + Триггер + Обстоятельства (§5).
4. **Цель** (§5.4).
5. **Взаимодействия**: добавить блок → выбрать одну из 4 категорий → заполнить исходы
   (`Payload` через тот же редактор урона/состояний/модификаторов).
6. **Длительность / Использования**.

Каждый список — это enum из этого документа, поэтому конструктор валидируется схемой и
не допускает «свободного текста» кроме явных `narrative`-полей.
```
