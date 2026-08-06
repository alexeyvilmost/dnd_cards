# Состояния (conditions) — механика PHB 2024

_Обновлено 2026-08-05. Runtime: все 15 состояний как эффекты `effect_type='condition'` (`COND-*`). Механика —
scoped-модификаторы в `mechanics.effects[].result[]` (+ `mechanics.includes` для композиции).
Реестр/движок: [engine/conditions.ts](../frontend/src/engine/conditions.ts)._

Production-БД этим набором изменений не модифицируется напрямую. Каталог
`scripts/content/update-conditions-2024-full.mjs` теперь только экспортирует/аудирует 15 строк и
намеренно отклоняет `--apply`. Единственный разрешённый путь записи — versioned patch
`frontend/src/canon/data/micro-mvp-l1-content-patch.v1.json` через общий мигратор с точным preimage,
CAS-проверкой, дампом, post-verify и rollback bundle:

1. создать custom-format `pg_dump`, проверить восстановление `pg_restore --exit-on-error` и записать
   hash/размер/время проверки в backup metadata;
2. создать неизменяемый plan bundle:
   `node scripts/content/migrate-micro-mvp-l1-mechanics.mjs --bundle <preimage.json>`;
3. вручную сверить операции, API и patch hash;
4. применить только с точным API acknowledgement:
   `API_TOKEN=… node scripts/content/migrate-micro-mvp-l1-mechanics.mjs --apply --bundle <preimage.json> --backup-metadata <backup.json> --confirm-api <exact-api-url>`;
5. при необходимости выполнить тот же guarded CLI с `--rollback`; CAS postimage не позволит
   затереть изменения, появившиеся после apply.

## Итог: 15/15 представлены данными

Первый проход закрыл представимую часть (Скорость 0, инициатива). Второй проход добавил новые
примитивы движка и закрыл A, B, C, D, E, F, H. G — нарративное. I отложено (трекер — отдельный компонент).

### Новые примитивы движка (единый канал `modifier`)

| Примитив | op / поле | Потребитель |
|---|---|---|
| Автопровал спаса (A) | `op:'auto_fail'` на `saving_throw`+filter | `CollectResult.autoFail`; `runSave` и оба спас-пути листа фиксируют провал без броска |
| Автокрит (B) | `op:'auto_crit'`, `scope:'target'`, `when:[distance_to_condition_owner ≤5]` | `projectedAgainst` → `runAttackRoll`: попадание в пределах 5 футов → крит |
| Дальность (C) | явный predicate `distance_to_condition_owner` | board/GM/scenario передаёт расстояние в футах; неизвестный факт закрывает гейт |
| Запрет способности (D) | `op:'deny'` на `action`/`bonus_action`/`reaction`/`concentration`/`speech`/отношение | общий `conditionCapabilityDenied`; UI/handler выбирает требуемую capability без ветвления по состоянию |
| Композиция (F) | `ConditionRule.includes[]` | `conditionModifierPayloads` раскрывает транзитивно (страж циклов); `expandConditionSet` для предикатов |
| Источник (E) | `ActiveEffectEntry.sourceId` (id кастера) | `ExecuteContext.selfId` → стемпится в `applyCondition`; пикер цели блокирует очаровавшего |
| Скорость→правила (H) | `op:'set'/'multiply'` speed | `resolveCharacterRules.speed` сворачивает ops; лист передаёт состояния как condition-источники |
| Истощение | повторяемый condition + `stacking.mode:'levels'`; `-2 d20`, `-5 speed` на экземпляр | общий stacking, modifier algebra, Long Rest `remove_levels:1`, threshold-факт смерти на 6 |
| Иммунитет состоянию | `kind:'condition_immunity'` | общий `applyCondition`, включая иммунитет Окаменевшего к Отравлению |
| Всё сопротивление | `kind:'resistance', damage_type:'all'` | общий damage adjustment; Окаменение вдвое уменьшает любой тип урона |
| Связь с источником | `when:[condition_source_*]` + `ActiveEffectEntry.sourceId` | generic predicates; правила не ветвятся по `frightened/grappled/charmed` |
| Видимость | `observer_can_see_condition_owner` | направленный факт observer→owner подавляет боевые преимущества Невидимости для видящего существа |
| Явные факты мира | `mechanics.world_facts` | materializer сохраняет факты трансформации/веса/старения без притворной геометрии |

### Данные состояний (прод + миграция + offline-сид)

- **paralyzed**: `auto_fail` СИЛ/ЛВК, `auto_crit` при явном расстоянии ≤5 футов, Скорость 0,
  `includes:[incapacitated]`.
- **unconscious**: собственные `auto_fail`/`auto_crit`/Скорость 0 + `includes:[incapacitated,prone]`.
  **Не включает `paralyzed`**: это исправляет ложные срабатывания предикатов «цель Парализована».
- **stunned**: `auto_fail` СИЛ/ЛВК, `includes:[incapacitated]`.
- **incapacitated**: `deny` действие/бонусное/реакция/концентрация/речь + помеха инициативы.
- **invisible**: боевые advantage/disadvantage зависят от явного направленного visibility-факта;
  требование «нельзя выбрать целью требующего зрения эффекта» сохранено как `world_facts` до wiring targeting gate.
- **prone**: target-проекция `advantage(≤5 ft)` / `disadvantage(>5 ft)`; ползание/вставание и цена
  половины Скорости объявлены в `world_facts`.
- **grappled**: Скорость 0; помеха атак только если `rollTargetActorId !== sourceId`.
- **frightened**: помеха на d20 только при явном LOS-факте к `sourceId`; запрет добровольного
  приближения привязан к точному `sourceId`, но не исчезает при потере LOS.
- **charmed**: запрет `harm` точному `sourceId`; source-only преимущество социальной проверки.
- **blinded/deafened**: `auto_fail` проверки только с явным `sense:'sight'|'hearing'`.
- **exhaustion**: уровни 1–6, модификаторы на каждый уровень, один уровень снимается долгим отдыхом.
- **petrified**: Недееспособность, Скорость 0, авто-провалы, входящее преимущество, сопротивление
  всему урону, иммунитет к Отравлению; transformation/weight/aging сохранены как `world_facts`.

Канонический исходник строк для подготовки patch: `scripts/content/update-conditions-2024-full.mjs`
(audit-only). Production apply выполняется только общим guarded-мигратором versioned content patch.

## Проверка и область доказательства

Тесты: `engine/conditions2024*.test.ts`, pure materializer и обязательный параметризованный
`rules-core/conditions2024.integration.test.ts`: 15 отдельных сценариев, в каждом один PC накладывает
состояние на второго, после чего проверяется исполняемое взаимодействие. Machine-readable denominator:
`rules-core/coverage/phb2024ConditionEvidence.ts`. Проверка реального production-листа выполняется
только после guarded apply и post-verify; тесты не подменяют это действие и не утверждают, что БД уже обновлена.

## Оставшиеся дыры / заметки

- **Интеграция команд.** `rules-core/conditionsRuntime.ts` уже переводит IDs и наблюдения в generic
  condition facts, но основной `handler.ts` ещё должен вызывать harm/movement gates и передавать LOS,
  distance и visibility
  в `ExecuteContext`; до этого они доказаны adapter/integration-тестом, а не каждым UI-командным путём.
- **Истощение 6.** Runtime выдаёт machine-readable terminal fact `death`. Превращение его в
  `ActorDeathAdjudicated` должно быть подключено как общий post-condition command handler.
- **Крит не удваивает кости** (пре-существующий баг движка, отдельно от auto_crit): auto_crit корректно
  помечает крит и запускает on_crit/райдеры, но удвоение костей урона — общая задача по криту.
- **Явная дистанция.** Категория оружия больше не подменяет расстояние. Если board/GM/scenario не
  передал distance fact, гейт закрыт: нет ложного автокрита/преимущества/помехи.
- **Невидимость и особые чувства.** Модификаторы корректно подавляются явным visibility-фактом.
  Запрет выбора целью эффекта, требующего зрения, пока объявлен как world fact, но не подключён ко
  всем targeting-командам.
- **Нарратив/мир.** Речь уже исполняется как capability deny. Падение удерживаемых предметов,
  ползание/вставание, масса и прекращение старения представлены явными фактами, но не мутируют
  inventory/физику до появления соответствующего world primitive.
- **I — трекер инициативы.** Отдельный компонент (монстры/игроки), состояния листа туда не заведены —
  по решению владельца доработка пока не нужна.

Связано: [[granular-effects-paradigm]], [[everything-is-effect]], [[engine-universal-substrate]], [[value-methods-paradigm]].
