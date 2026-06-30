# План реализации: блочный конструктор механик (Фаза 1)

Пошаговый план для реализации **визуального конструктора механик** эффектов и
действий по схеме [`unified-mechanics-schema.md`](unified-mechanics-schema.md).
Написан так, чтобы исполнитель (в т.ч. менее мощная модель) сделал всё **без
серьёзных доработок**. Читать вместе со схемой и [`mechanics.schema.json`](mechanics.schema.json).

> Сейчас конструктор нужен, чтобы **авторить способности видов (рас) PHB 2024**.
> Архитектурные решения уже зафиксированы (см. §1). Не переизобретать — следовать плану.

---

## 0. Что входит в Фазу 1 (и что НЕ входит)

**Входит:**
1. Поле `mechanics` (jsonb) у сущностей **Effect** и **Action** (бэкенд + фронт).
2. Связь вида со способностями: у **Race** — `related_effects` и `related_actions` (jsonb).
3. **Блочный конструктор** `MechanicsBuilder` — собирает объект `mechanics` из готовых
   блоков-шаблонов (триггер + эффекты). Встраивается в `EffectCreator` и `ActionCreator`.
4. Хранение **pending-choice** на персонаже (только поле в БД, на будущее).

**НЕ входит (Фаза 2, отдельно):** движок-интерпретатор; окно разрешения выбора; «!» в
листе персонажа; интеграция в создание/левелап; применение grant'ов к персонажу.
**Не писать движок и не трогать лист персонажа в этой фазе.**

---

## 1. Зафиксированные решения (не менять)

- **Хранилище механики:** `Effect.mechanics` и `Action.mechanics` (jsonb). Способность
  расы = это Effect или Action, привязанный к Race через `related_effects`/`related_actions`.
- **Объём:** только конструктор + данные (см. §0).
- **Стиль конструктора:** **блочный, под расы.** Готовые блоки-шаблоны; каждый блок —
  это выпадающие списки из enum-реестров. Расширение = добавить блок/пункт реестра.
- **Расширяемость:** все списки — это массивы-реестры (§4.2); добавление новой
  способности = новый блок (§4.3) или пункт реестра, без переписывания билдера. Плюс
  есть блок-«сырой JSON» как escape-hatch.

---

## 2. Бэкенд (Go) — точные изменения

### 2.1 Поле `mechanics` у Effect и Action

В `backend/models.go` тип `JSONMap` (map[string]interface{} с Scan/Value) **уже есть** —
переиспользовать его. НЕ создавать новый тип.

В структуре **`Effect`** добавить поле (рядом с `Script`):
```go
Mechanics *JSONMap `json:"mechanics" gorm:"type:jsonb"`
```
То же добавить в `CreateEffectRequest`, `UpdateEffectRequest`, `EffectResponse` и в
маппинги (`ToEffectResponse`/ручной маппинг в `EffectController.Create/Update`, как
сделано для `Script`). В `UpdateEffect`: `if req.Mechanics != nil { effect.Mechanics = req.Mechanics }`.

Аналогично для **`Action`** (структура `Action`, `CreateActionRequest`,
`UpdateActionRequest`, `ActionResponse`, маппинги в `controller.go`).

> Эти структуры лежат: `Effect` и `Action` — в `backend/models.go`; контроллеры —
> в `backend/controller.go` (`EffectController`, `ActionController`). Искать по
> существующему полю `Script` и повторить всё рядом 1:1.

### 2.2 Связь Race → способности

В `backend/models_races.go`, структура `Race` (+ Create/Update/Response + `ToRaceResponse`):
```go
RelatedEffects *Properties `json:"related_effects" gorm:"type:jsonb"` // массив id эффектов
RelatedActions *Properties `json:"related_actions" gorm:"type:jsonb"` // массив id действий
```
`Properties` (`[]string` с jsonb Scan/Value) уже есть. В `UpdateRace` обновлять как
остальные nil-проверяемые поля.

### 2.3 Миграция

Добавить **одну** миграцию в `backend/migrations/migrations.go` (следующий свободный
номер — **проверить хвост списка**, сейчас последний `037`, значит `038`):
```go
"ALTER TABLE effects ADD COLUMN IF NOT EXISTS mechanics JSONB",
"ALTER TABLE actions ADD COLUMN IF NOT EXISTS mechanics JSONB",
"ALTER TABLE races   ADD COLUMN IF NOT EXISTS related_effects JSONB",
"ALTER TABLE races   ADD COLUMN IF NOT EXISTS related_actions JSONB",
```
Все — `ADD COLUMN IF NOT EXISTS`, nullable, **обратно совместимо** (старые строки → null).

### 2.4 ⚠️ Важно на бэкенде

- **Колонки — `JSONB`, НЕ `text[]`.** Тип `Properties`/`JSONMap` сериализуется в JSON;
  если колонку объявить `text[]`, вставка упадёт `malformed array literal`. (Урок из
  истории проекта: spells уже на это напарывались.)
- **НЕ валидировать форму `mechanics` на бэкенде.** Хранить как есть (jsonb). Схему
  знает только фронт. Это даёт расширяемость и не ломает старые/новые поля.
- Бэкенд про pending-choice в Фазе 1 ничего не делает, кроме (по желанию) добавления
  поля `pending_choices JSONB` персонажу — можно отложить до Фазы 2.

---

## 3. Фронтенд: модуль `src/mechanics/`

Создать папку `frontend/src/mechanics/` с тремя файлами.

### 3.1 `types.ts` — типы под схему

Зеркало схемы (минимально нужное Фазе 1). Юнионы по полю `kind`/`resolution`:
```ts
export type Mechanics = {
  meta?: { id?: string; name?: string };
  activation: Activation;
  effects: Interaction[];
};
export type Activation = {
  mode: 'passive' | 'active' | 'reaction' | 'triggered';
  cost?: Cost[];
  trigger?: Trigger;
  requirements?: Requirement[];
};
export type Trigger = { timing?: 'before'|'during'|'after'|'replaces'; event: string; subject?: string; circumstances?: any[] };
export type Interaction =
  | { resolution: 'auto'; result: Payload[] }
  | { resolution: 'save'; who: 'target'|'self'; ability: string; dc?: string; on_fail?: Payload[]; on_success?: Payload[] }
  | { resolution: 'attack_roll'; /* ... */ on_hit?: Payload[] };
export type Payload = { kind: string } & Record<string, any>; // union по kind (§6.5 схемы)
export type Choice = { kind:'choice'; id:string; prompt?:string; count?:number; options: ChoiceOptions; recommended?:string[]; grant?:Payload; resolution?:'on_acquire'|'immediate' };
// ... остальные по §6 схемы
```
Держать типы «широкими» (`Record<string,any>` для payload-полей) — не блокировать
расширение. Строгая типизация payload-ов не нужна; нужен рабочий конструктор.

### 3.2 `registries.ts` — реестры (расширяемые справочники)

Каждый — массив `{ id, label }` (RU). **Добавление пункта = одна строка.**
```ts
export const SKILLS = [{id:'acrobatics',label:'Акробатика'}, /* … 18 навыков */];
export const ABILITIES = [{id:'str',label:'Сила'}, /* str dex con int wis cha */];
export const DAMAGE_TYPES = [...]; // переиспользовать utils/damageTypes.ts
export const CONDITIONS = [{id:'charmed',label:'Очарован'}, {id:'frightened',label:'Испуган'}, {id:'poisoned',label:'Отравлен'}, ...];
export const LANGUAGES = [...];
export const SENSES = [{id:'darkvision',label:'Тёмное зрение'},{id:'tremorsense',label:'Чувство вибрации'},...];
export const SPEED_MODES = [{id:'walk',...},{id:'fly',...},{id:'swim',...},{id:'climb',...}];
export const RESOURCES = [{id:'heroic_inspiration',label:'Героическое вдохновение'},{id:'temp_hp',label:'Временные хиты'},...];
export const ORIGIN_FEATS = [{id:'skilled',label:'Одарённый'}, {id:'tough',label:'Стойкий'}, ...]; // черты происхождения PHB 2024
// Списки заклинаний/заговоров — тянуть из БД (spellsApi) с фильтром по классу/уровню;
// для choice source=spell отдавать spellsApi.getSpells({...}).
```
Эти реестры используются как `options` в `select`/`multiselect` блоков.

### 3.3 `blocks.ts` — КАТАЛОГ БЛОКОВ (ядро конструктора)

Каждый блок описывается данными, без логики UI:
```ts
export type Field =
  | { key:string; label:string; type:'select'; options:{id:string;label:string}[]; default?:string }
  | { key:string; label:string; type:'multiselect'; options:{id:string;label:string}[] }
  | { key:string; label:string; type:'number'; default?:number }
  | { key:string; label:string; type:'text' }
  | { key:string; label:string; type:'formula' }
  | { key:string; label:string; type:'choice-source' }   // спец-редактор выбора (§5)
  | { key:string; label:string; type:'damage-type' };
export type Block = {
  id:string; label:string; group:'trigger'|'effect';
  fields: Field[];
  build:(v:Record<string,any>)=>any;     // -> фрагмент: для trigger вернуть {activation-часть}; для effect вернуть Interaction|Payload
  summary:(v:Record<string,any>)=>string;// человекочитаемая строка
};
```
**Билдер собирает `mechanics` так:** берёт ОДИН trigger-блок (даёт `activation`) и
СПИСОК effect-блоков; каждый effect-блок возвращает `Payload`, который кладётся в один
`Interaction{resolution:'auto', result:[...]}`. Исключения: блок «Спасбросок→урон»
(E14) сам возвращает `Interaction{resolution:'save', …}` — он становится отдельным
interaction'ом. Правило: если блок вернул объект с полем `resolution` — это самостоятельный
interaction; иначе — payload в общий `auto`-interaction.

**Полный каталог блоков (Фаза 1):**

Триггеры (`group:'trigger'`):
| id | label | build → activation |
|---|---|---|
| `trg_passive` | Пассивный (всегда активен) | `{mode:'passive'}` |
| `trg_on_acquire` | При получении (выбор) | `{mode:'triggered', trigger:{event:'on_acquire', timing:'before'}}` |
| `trg_long_rest` | После длинного отдыха | `{mode:'triggered', trigger:{event:'long_rest', timing:'after'}}` |
| `trg_short_rest` | После короткого отдыха | `{…event:'short_rest', timing:'after'}` |
| `trg_zero_hp` | При падении до 0 хитов | `{…event:'reduced_to_0_hp', timing:'replaces'}` |
| `trg_d20_one` | Когда на к20 выпала 1 | `{…event:'attack_roll_made'/'ability_check_made'/'saving_throw_made', timing:'replaces', circumstances:[{kind:'d20_equals',value:1}]}` |
| `trg_active` | Активная способность | поля: ресурс (action/bonus_action/reaction), uses (число/`prof_bonus`), per (long_rest/short_rest) → `{mode:'active', cost:[…]}` + `uses` |
| `trg_level` | Доступно с уровня N (модификатор поверх) | добавляет `requirements:[{type:'level', min_level:N}]` к выбранному триггеру |

Эффекты (`group:'effect'`):
| id | label | build → payload/interaction |
|---|---|---|
| `eff_grant_resource` | Выдать ресурс | `{kind:'resource', op:'grant', id, amount}` |
| `eff_grant_prof` | Выдать владение | `{kind:'grant_proficiency', prof, value}` (или обернуть в choice — поле «из списка») |
| `eff_grant_feat` | Выдать черту | `{kind:'grant_feat', value}` (или choice) |
| `eff_grant_spell` | Выдать заклинание/заговор | `{kind:'grant_spell', value, level_gate, ability}` |
| `eff_grant_sense` | Дать чувство | `{kind:'grant_sense', sense, range}` |
| `eff_grant_speed` | Дать скорость | `{kind:'grant_speed', mode, value}` |
| `eff_grant_ability` | +характеристика | `{kind:'grant_ability_score', ability, amount}` |
| `eff_adv` | Преимущество/помеха на бросок | `{kind:'modifier', applies_to:{roll}, op:'advantage'/'disadvantage', when:[…]}` |
| `eff_bonus` | Числовой бонус к значению | `{kind:'modifier', applies_to:{roll:'max_hp'/'ac'/'speed'/…}, op:'add', value}` |
| `eff_resistance` | Сопротивление/иммун./уязв. | `{kind:'resistance', damage_type, value}` (или choice по типу урона) |
| `eff_temp_hp` | Временные хиты | `{kind:'temp_hp', amount}` |
| `eff_heal` | Лечение | `{kind:'healing', amount}` |
| `eff_dash` | Рывок/перемещение | `{kind:'grant_action', as:'bonus_action', options:['dash']}` |
| `eff_save_damage` | Спасбросок → урон по области | `{resolution:'save', who:'target', ability, dc, on_fail:[damage], on_success:[damage on_success:'half']}` + targeting area |
| `eff_reroll` | Переброс кубика | `{kind:'reroll', which:'d20', keep:'either'}` |
| `eff_set_value` | Установить значение | `{kind:'set_value', target:'hp'/…, formula}` |
| `eff_transform` | Преображение (форма) | `{kind:'narrative'/'modifier'}` + опц. `grant_speed` (для крыльев/полёта) |
| `eff_choice` | ВЫБОР из списка | `{kind:'choice', …}` — спец-блок (§5) |
| `eff_narrative` | Текстовый эффект | `{kind:'narrative', description}` |
| `eff_raw_json` | Сырой JSON (расширение) | пользователь вставляет JSON-фрагмент as-is |

---

## 4. UI: компонент `MechanicsBuilder.tsx`

`frontend/src/components/mechanics/MechanicsBuilder.tsx`.

**Пропсы:** `{ value: Mechanics | null; onChange: (m: Mechanics | null) => void }`.

**Внутреннее состояние:** выбранный trigger-блок + его значения; массив effect-блоков
(каждый: `{blockId, values}`).

**Разметка (3 секции):**
1. **Триггер/Активация** — один `select` со списком trigger-блоков; ниже рендерятся
   `fields` выбранного блока (по `Field.type`).
2. **Эффекты** — список карточек. Кнопка «Добавить эффект» → `select` effect-блока →
   рендер его `fields`. У каждой карточки: удалить, (опц.) переместить.
3. **Превью** — внизу: (а) человекочитаемая сводка (`block.summary` через запятую) и
   (б) сворачиваемый JSON (`JSON.stringify(buildMechanics(), null, 2)`).

**Сборка `mechanics`** (функция `buildMechanics()`):
```
const activation = triggerBlock.build(triggerValues);          // {mode, cost?, trigger?, uses?, requirements?}
const fragments  = effectBlocks.map(b => BLOCKS[b.id].build(b.values));
const interactions = [];
const autoResult = [];
for (const f of fragments) {
  if (f && f.resolution) interactions.push(f);   // самостоятельный interaction (save/attack)
  else autoResult.push(f);                       // payload в общий auto
}
if (autoResult.length) interactions.unshift({ resolution:'auto', result: autoResult });
return { activation, effects: interactions };
```
На каждое изменение — `onChange(buildMechanics())`.

**Рендер полей по типу:** select/multiselect (из `options`), number, text, formula
(text + подсказка по §8 схемы), damage-type (использовать `DAMAGE_TYPES`), choice-source
(§5).

**Интеграция:**
- В `EffectCreator.tsx`: добавить секцию «Механика» (в существующую навигацию секций
  рядом с «Свойства»); внутри — `<MechanicsBuilder value={watch('mechanics')} onChange={(m)=>setValue('mechanics', m)} />`.
  В onSubmit включить `mechanics: data.mechanics ?? null` в create/update payload и в
  defaultValues/reset на edit (`mechanics: effect.mechanics ?? null`).
- В `ActionCreator.tsx`: то же самое.
- В `types/index.ts`: добавить `mechanics?: Record<string,any> | null` в `Effect`/`Action`
  и их Create/Update реквесты; `related_effects?/related_actions?` в `Race`.

---

## 5. Спец-редактор выбора (`choice`) — самое важное

Блоки `eff_choice` (и опции «из списка» у `eff_grant_prof`/`eff_grant_feat`/`eff_resistance`)
используют под-редактор **ChoiceEditor**:

Поля:
- `prompt` (text) — «Выберите навык».
- `count` (number, по умолч. 1).
- `source` (select): `skill | tool | saving_throw | language | feat | spell | damage_type | subfeature | explicit`.
- если `source` — «плоская категория» (skill/feat/…): `filter` = `all` (по умолч.) или
  multiselect конкретных id; `grant`-шаблон выбирается автоматически по source
  (skill→grant_proficiency prof:skill, feat→grant_feat, spell→grant_spell, damage_type→resistance).
- если `source = subfeature`: редактор **списка вариантов** (`items`), где каждый
  вариант = `{id, name, grants:[…]}`, а `grants` собираются ВЛОЖЕННЫМ мини-набором
  effect-блоков (минимум: grant_spell, resistance, modifier). Для уровневых заклинаний
  у grant_spell заполняется `level_gate`.
- `recommended` (multiselect из доступных вариантов) — для «Рекомендуется Одарённый».
- `resolution` = `on_acquire` (по умолчанию).

`build` блока `eff_choice` собирает объект §6.7 с **уникальным стабильным `id`**
(сгенерировать из prompt/source, напр. `human_skill`). ⚠️ `choice.id` обязан быть
стабильным и уникальным внутри одного `mechanics`.

---

## 6. Авторинг способностей расы (RaceCreator)

В `RaceCreator.tsx` добавить секцию **«Способности»**: пикер, привязывающий к виду
существующие **эффекты** и **действия** (по id). Технически — как `ItemRefSelector`,
но запрашивает `effectsApi.getEffects` / `actionsApi.getActions` (а не cards). Сохранять
выбранные id в `related_effects` / `related_actions`. Текстовый список `traits` (название
+ описание) **оставить** — он для отображения; механику несут привязанные эффекты/действия.

Рабочий процесс: автор создаёт Effect «Находчивый» с механикой → создаёт Race «Человек»
→ в секции «Способности» привязывает этот эффект.

---

## 7. Матрица покрытия PHB 2024 (все 10 видов → блоки)

Доказательство, что каталога §3.3 хватает. (Размер/скорость/тёмное зрение, если это
просто числа вида, можно держать полями Race; здесь — как эффекты-способности.)

| Вид | Способность | Триггер-блок | Эффект-блок(и) |
|---|---|---|---|
| Человек | Находчивый | `trg_long_rest` | `eff_grant_resource`(heroic_inspiration) |
| Человек | Умелый | `trg_on_acquire` | `eff_choice`(skill, all → grant_proficiency) |
| Человек | Гибкий | `trg_on_acquire` | `eff_choice`(feat=origin_feats, recommended:skilled) |
| Дворф | Дворфская стойкость | `trg_passive` | `eff_adv`(save vs poisoned) + `eff_resistance`(poison) |
| Дворф | Дворфская выносливость | `trg_passive` | `eff_bonus`(max_hp, `self_level`) |
| Дворф | Камнечувствие | `trg_active`(bonus, prof/long) | `eff_grant_sense`(tremorsense 60) |
| Эльф | Происхождение фей | `trg_passive` | `eff_adv`(save vs charmed) |
| Эльф | Острые чувства | `trg_on_acquire` | `eff_choice`(skill from [perception,insight,survival]) |
| Эльф | Эльфийское наследие | `trg_on_acquire` | `eff_choice`(subfeature: drow/high/wood, grants=cantrip+spells w/ level_gate) |
| Гном | Гномья хитрость | `trg_passive` | `eff_adv`(saves int/wis/cha) |
| Гном | Гномье наследие | `trg_on_acquire` | `eff_choice`(subfeature: forest/rock) |
| Полурослик | Храбрость | `trg_passive` | `eff_adv`(save vs frightened) |
| Полурослик | Везение | `trg_d20_one` | `eff_reroll`(d20) |
| Полурослик | Природная скрытность | `trg_passive` | `eff_narrative` |
| Орк | Адреналиновый рывок | `trg_active`(bonus, prof/short|long) | `eff_dash` + `eff_temp_hp`(`prof_bonus`) |
| Орк | Неумолимая стойкость | `trg_zero_hp` | `eff_set_value`(hp=1) (uses 1/long) |
| Драконорождённый | Драконье наследие | `trg_on_acquire` | `eff_choice`(damage_type) |
| Драконорождённый | Оружие дыхания | `trg_active`(action/replace, prof/long) | `eff_save_damage`(area, type из выбора) |
| Драконорождённый | Сопротивление урону | `trg_passive` | `eff_resistance`(chosen type) |
| Драконорождённый | Драконий полёт | `trg_level`(5)+`trg_active`(bonus) | `eff_grant_speed`(fly) |
| Тифлинг | Потустороннее присутствие | `trg_passive` | `eff_grant_spell`(thaumaturgy) |
| Тифлинг | Дьявольское наследие | `trg_on_acquire` | `eff_choice`(subfeature: abyssal/chthonic/infernal) |
| Аасимар | Небесное сопротивление | `trg_passive` | `eff_resistance`(radiant)+`eff_resistance`(necrotic) |
| Аасимар | Целебные руки | `trg_active`(1/long) | `eff_heal`(`self_level` d4) |
| Аасимар | Светоч | `trg_passive` | `eff_grant_spell`(light) |
| Аасимар | Небесное откровение | `trg_level`(3)+`trg_on_acquire` | `eff_choice`(1 of wings/radiant/necrotic → transform) |
| Голиаф | Наследие великанов | `trg_on_acquire` | `eff_choice`(1 of 6 → each `trg_active` benefit) |
| Голиаф | Большая форма | `trg_level`(5)+`trg_active`(bonus) | `eff_transform` |
| Голиаф | Мощное телосложение | `trg_passive` | `eff_bonus`(carry ×2) + `eff_adv`(grapple) |

Все способности выражаются комбинацией блоков. Непокрытых нет; самые нестандартные
(преображения) опираются на `eff_transform`/`eff_narrative` как escape-hatch.

---

## 8. Готовые JSON-примеры (для проверки билдера)

**Находчивый** (`trg_long_rest` + `eff_grant_resource`):
```json
{ "activation": { "mode":"triggered", "trigger":{ "event":"long_rest", "timing":"after" } },
  "effects": [ { "resolution":"auto", "result":[
    { "kind":"resource", "op":"grant", "id":"heroic_inspiration", "amount":1 } ] } ] }
```
**Умелый** (`trg_on_acquire` + `eff_choice` skill):
```json
{ "activation": { "mode":"triggered", "trigger":{ "event":"on_acquire", "timing":"before" } },
  "effects": [ { "resolution":"auto", "result":[
    { "kind":"choice", "id":"human_skill", "prompt":"Выберите навык", "count":1,
      "options":{ "source":"skill", "filter":"all" },
      "grant":{ "kind":"grant_proficiency", "prof":"skill" }, "resolution":"on_acquire" } ] } ] }
```
**Гибкий** (выбор черты происхождения, рекомендация):
```json
{ "activation": { "mode":"triggered", "trigger":{ "event":"on_acquire", "timing":"before" } },
  "effects": [ { "resolution":"auto", "result":[
    { "kind":"choice", "id":"human_feat", "prompt":"Выберите черту Происхождения", "count":1,
      "options":{ "source":"feat", "filter":"origin_feats" },
      "recommended":["skilled"], "grant":{ "kind":"grant_feat" }, "resolution":"on_acquire" } ] } ] }
```
**Эльфийское наследие** (subfeature + уровневые заклинания):
```json
{ "activation": { "mode":"triggered", "trigger":{ "event":"on_acquire", "timing":"before" } },
  "effects": [ { "resolution":"auto", "result":[
    { "kind":"choice", "id":"elf_lineage", "prompt":"Выберите происхождение", "count":1,
      "resolution":"on_acquire",
      "options":{ "source":"subfeature", "items":[
        { "id":"high_elf", "name":"Высший эльф", "grants":[
          { "kind":"grant_spell", "value":"prestidigitation", "ability":"int", "level_gate":1 },
          { "kind":"grant_spell", "value":"detect_magic", "ability":"int", "level_gate":3 },
          { "kind":"grant_spell", "value":"misty_step", "ability":"int", "level_gate":5 } ] },
        { "id":"wood_elf", "name":"Лесной эльф", "grants":[
          { "kind":"grant_speed", "mode":"walk", "value":"35" },
          { "kind":"grant_spell", "value":"longstrider", "ability":"wis", "level_gate":3 } ] } ] } } ] } ] }
```
**Неумолимая стойкость** (`trg_zero_hp`, 1/long):
```json
{ "activation": { "mode":"triggered", "trigger":{ "event":"reduced_to_0_hp", "timing":"replaces" } },
  "uses": { "count":1, "per":"long_rest" },
  "effects": [ { "resolution":"auto", "result":[ { "kind":"set_value", "target":"hp", "formula":"1" } ] } ] }
```
**Оружие дыхания** (active, save→area damage):
```json
{ "activation": { "mode":"active", "cost":[{"resource":"action"}] },
  "uses": { "count":"prof_bonus", "per":"long_rest" },
  "targeting": { "shape":"area", "area":{"kind":"cone","size":15}, "filter":"any" },
  "effects": [ { "resolution":"save", "who":"target", "ability":"dex", "dc":"8+prof+con",
    "on_fail":[{"kind":"damage","dice":"1d10","type":"fire","scaling":{"per":"self_level_tier","dice":"1d10"}}],
    "on_success":[{"kind":"damage","dice":"1d10","type":"fire","on_success":"half"}] } ] }
```

---

## 9. ⚠️ Подводные камни (читать перед кодом)

1. **Колонки jsonb, не text[]** (см. §2.4). Самая частая ошибка проекта.
2. **Обратная совместимость:** `mechanics`/`related_*` nullable; у старых эффектов
   `mechanics === null` — билдер должен корректно открываться с пустым значением.
3. **Не валидировать mechanics на бэкенде** — хранить as-is.
4. **Номер миграции** — взять следующий свободный (проверить хвост `migrations.go`,
   сейчас `037` → делать `038`). Не дублировать номера.
5. **Сборка/деплой:** бэкенд — `go build ./...`; фронт — **`npx vite build`** (НЕ
   `npm run build`: в репозитории есть предсуществующие ошибки `tsc`, не связанные с
   задачей; деплой-пайплайн использует vite). Railway деплоит при push в `main`; после
   push дождаться пересборки (поллинг). В curl-тестах с кириллицей слать UTF-8 через
   `--data-binary @file`, иначе мойбейк.
6. **`build()` блоков — чистые данные.** Никаких сайд-эффектов; билдер только мёржит.
7. **`choice.id` стабильный и уникальный** в пределах одного `mechanics`.
8. **Уровневый гейт** — через `grant_spell.level_gate` или `requirements:[{type:'level',min_level:N}]`. Не изобретать третий способ.
9. **Escape-hatch обязателен:** блок `eff_raw_json` (textarea с парсингом JSON) — чтобы
   автор мог выразить то, чего нет в каталоге, не дожидаясь нового блока.
10. **Не трогать движок/лист персонажа** — это Фаза 2. Сейчас только авторинг + хранение.
11. **`mechanics` не ломает старые поля** Effect/Action (`Script`, и т.д.) — добавлять,
    не заменять.

---

## 10. Пошаговый чек-лист исполнителю

1. Бэкенд: добавить `mechanics` в Effect (модель/реквесты/респонс/маппинги/контроллер).
2. Бэкенд: то же для Action.
3. Бэкенд: `related_effects`/`related_actions` в Race.
4. Бэкенд: миграция `038` (4 × ADD COLUMN IF NOT EXISTS … JSONB). `go build ./...`. Коммит+пуш, дождаться деплоя, проверить round-trip (`POST /api/effects` с `mechanics`).
5. Фронт: `types/index.ts` — поля `mechanics`/`related_*`.
6. Фронт: `src/mechanics/types.ts`, `registries.ts`, `blocks.ts` (каталог §3.3).
7. Фронт: `components/mechanics/MechanicsBuilder.tsx` + `ChoiceEditor.tsx`.
8. Фронт: встроить билдер в `EffectCreator` и `ActionCreator` (секция + payload + reset).
9. Фронт: секция «Способности» в `RaceCreator` (пикер эффектов/действий → `related_*`).
10. `npx vite build`. Коммит+пуш. Проверить в браузере: собрать «Находчивый»,
    «Умелый», «Гибкий» (примеры §8 должны получаться), привязать к Человеку.

---

## 11. Фаза 2 (вне этого плана — для контекста)

Движок-интерпретатор `mechanics`; создание `pending_choices` при получении эффекта;
окно разрешения выбора в потоке создания/левелапа; «!» в листе персонажа; применение
постоянных grant'ов к персонажу. Конструктор Фазы 1 уже выдаёт всё необходимое для этого
на вход.
