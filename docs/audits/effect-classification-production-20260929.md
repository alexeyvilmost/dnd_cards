# Проверка классификации на свежем production snapshot

Дата: 2026-09-29. Проверка и применение выполняются только на локальной копии базы.

Сопоставлены все **761** эффекта: исходные 707 из неизменённого [манифеста 282](../../backend/migrations/effect_classification_278_manifest.json) и 54 новых из [манифеста 285](../../backend/migrations/effect_classification_285_manifest.json). У исходных 707 нет пропавших UUID, конфликтов UUID/card_number или неожиданных типов. Миграция 282 меняет 238 классификаций. Среди 54 новых 53 уже корректны, одна запись требует `item_effect → spell_effect`.

Фактические связи взяты из механического индекса после 281 и сверены с mechanics источников и эффектов. Происхождение через actions/effects прослежено до card/feat/spell; текстовые упоминания не использовались. Полные UUID, пути и цепочки сохранены в манифесте 285.

## Обнаруженная ошибка

`EFFECT-item-completion-0627-spell-bond` выдаётся самостоятельным заклинанием `SPELL-0250` («Охраняющая связь») через `mechanics.effects[0].result[0].value`. В его `bond_policy` нет требований к предметам. Кольцо `CARD-0627` использует другое действие и отдельный `...0627-ring-bond` с `source_item_id` и `target_item_id`. Поэтому первый эффект относится к заклинаниям, несмотря на префикс и скопированное название. Исправляется только классификация; переименование и изменение механики в задачу не входят.

## Все 54 новые записи

| Эффект | Название | Тип после проверки | Механический источник | Изменение |
| --- | --- | --- | --- | --- |
| EFF-audit-FEAT-0064 | Дар боевой удали | feat_ability | FEAT-0064 | не требуется |
| EFF-audit-FEAT-0065 | Дар восстановления | feat_ability | FEAT-0065 | не требуется |
| EFF-audit-FEAT-0066 | Дар восстановления заклинаний | feat_ability | FEAT-0066 | не требуется |
| EFF-audit-FEAT-0067 | Дар истинного зрения | feat_ability | FEAT-0067 | не требуется |
| EFF-audit-FEAT-0068 | Дар межпространственного перемещения | feat_ability | FEAT-0068 | не требуется |
| EFF-audit-FEAT-0069 | Дар неотразимого нападения | feat_ability | FEAT-0069 | не требуется |
| EFF-audit-FEAT-0070 | Дар ночного духа | feat_ability | FEAT-0070 | не требуется |
| EFF-audit-FEAT-0071 | Дар скорости | feat_ability | FEAT-0071 | не требуется |
| EFF-audit-FEAT-0072 | Дар сопротивления энергии | feat_ability | FEAT-0072 | не требуется |
| EFF-audit-FEAT-0073 | Дар стойкости | feat_ability | FEAT-0073 | не требуется |
| EFF-audit-FEAT-0074 | Дар судьбы | feat_ability | FEAT-0074 | не требуется |
| EFF-audit-FEAT-0075 | Дар умелости | feat_ability | FEAT-0075 | не требуется |
| EFFECT-item-audit-45 | Зелье полёта | item_effect | CARD-0045 | не требуется |
| EFFECT-item-audit-51 | Зелье силы великана | item_effect | CARD-0051 | не требуется |
| EFFECT-item-audit-57 | Зелье силы холмового великана | item_effect | CARD-0057 | не требуется |
| EFFECT-item-audit-885 | Огненное дыхание зелья | item_effect | CARD-0885 | не требуется |
| EFFECT-item-completion-0369-shadow-traits | Свойства Тени | item_effect | CARD-0369 | не требуется |
| EFFECT-item-completion-0379-haste | Сапоги времени — Ускорение | item_effect | CARD-0379 | не требуется |
| EFFECT-item-completion-0379-lethargy | Сапоги времени — Летаргия | item_effect | CARD-0379 | не требуется |
| EFFECT-item-completion-0424-state | Шлем жестокости — Кровотечение | item_effect | CARD-0424 | не требуется |
| EFFECT-item-completion-0541 | Штандарт стойкости — Стойкость позиции | item_effect | CARD-0541 | не требуется |
| EFFECT-item-completion-0551-link | Диадема крови — Кровная связь | item_effect | CARD-0551 | не требуется |
| EFFECT-item-completion-0553-state | Зазубренный кинжал +1 — Кровотечение | item_effect | CARD-0553 | не требуется |
| EFFECT-item-completion-0556-state | Ледяной кинжал — Охлаждён | item_effect | CARD-0556 | не требуется |
| EFFECT-item-completion-0580-state | Огненные сапоги — Горение | item_effect | CARD-0580 | не требуется |
| EFFECT-item-completion-0622 | Кольцо боевого мага — Боевое плетение | item_effect | CARD-0622 | не требуется |
| EFFECT-item-completion-0627-ring-bond | Кольцо уз — Охраняющая связь кольца | item_effect | CARD-0627 | не требуется |
| EFFECT-item-completion-0627-spell-bond | Кольцо уз — Охраняющая связь заклинания | spell_effect | SPELL-0250 | item_effect → spell_effect |
| EFFECT-item-completion-high-829-chained | Цепь — Скован цепью | item_effect | CARD-0829 | не требуется |
| EFFECT-item-completion-high-883-haste | Ускорение зелья | item_effect | CARD-0883 | не требуется |
| EFFECT-item-completion-high-937-vitality | Кадуцей — Жизненная сила | item_effect | CARD-0937 | не требуется |
| EFFECT-item-completion-low-0038 | Зелье долголетия | item_effect | CARD-0038 | не требуется |
| EFFECT-item-completion-low-0040 | Зелье подводного дыхания | item_effect | CARD-0040 | не требуется |
| EFFECT-item-completion-low-0041 | Зелье скорости | item_effect | CARD-0041 | не требуется |
| EFFECT-item-completion-low-0042 | Зелье чтения мыслей | item_effect | CARD-0042 | не требуется |
| EFFECT-item-completion-low-0043 | Зелье дружбы с животными | item_effect | CARD-0043 | не требуется |
| EFFECT-item-completion-low-0048 | Зелье газообразной формы | item_effect | CARD-0048 | не требуется |
| EFFECT-item-completion-low-0055 | Зелье лазания | item_effect | CARD-0055 | не требуется |
| EFFECT-item-completion-low-0056 | Зелье огненного дыхания | item_effect | CARD-0056 | не требуется |
| EFFECT-item-completion-low-0063 | Кревой кароткий меч | item_effect | CARD-0063 | не требуется |
| EFFECT-item-completion-low-0121 | Молот Защитника Света | item_effect | CARD-0121 | не требуется |
| EFFECT-item-completion-low-0133 | Бандана тьмы | item_effect | CARD-0133 | не требуется |
| EFFECT-item-completion-low-0199 | Наручи ловкого мага | item_effect | CARD-0199 | не требуется |
| EFFECT-item-completion-low-0330 | Сеть | item_effect | CARD-0330 | не требуется |
| EFFECT-spell-audit-call-lightning | Вызвать повторную молнию | spell_effect | call_lightning | не требуется |
| EFFECT-spell-audit-dragon-breath-acid | Дыхание дракона: кислота | spell_effect | SPELL-0197, SPELL-VAR-SPELL-0197-acid | не требуется |
| EFFECT-spell-audit-dragon-breath-cold | Дыхание дракона: холод | spell_effect | SPELL-0197, SPELL-VAR-SPELL-0197-cold | не требуется |
| EFFECT-spell-audit-dragon-breath-fire | Дыхание дракона: огонь | spell_effect | SPELL-0197, SPELL-VAR-SPELL-0197-fire | не требуется |
| EFFECT-spell-audit-dragon-breath-lightning | Дыхание дракона: электричество | spell_effect | SPELL-0197, SPELL-VAR-SPELL-0197-lightning | не требуется |
| EFFECT-spell-audit-dragon-breath-poison | Дыхание дракона: яд | spell_effect | SPELL-0197, SPELL-VAR-SPELL-0197-poison | не требуется |
| EFFECT-spell-audit-expeditious-retreat | Рывок поспешного отступления | spell_effect | SPELL-0269 | не требуется |
| EFFECT-spell-audit-flame-blade | Атаковать горящим клинком | spell_effect | SPELL-0184 | не требуется |
| EFFECT-spell-audit-produce-flame | Метнуть сотворённое пламя | spell_effect | SPELL-0297 | не требуется |
| EFFECT-spell-audit-witch-bolt | Поддержать ведьмин разряд | spell_effect | SPELL-0167 | не требуется |

Среди новых записей 12 эффектов черт, 31 эффект предмета и 11 эффектов заклинаний после исправления. «Свойства Тени» остаются эффектом предмета: шаблон призыва выдаётся мечом `CARD-0369`. Именованные кровотечение, охлаждение и горение остаются эффектами соответствующих предметов; их narrative-описания не превращены в отдельные каноничные состояния. Цепь и сеть предоставляют каноничное `restrained` вместе с собственным действием освобождения и также остаются эффектами предметов.

## Итог 761

| Тип | Количество |
| --- | ---: |
| class_ability | 388 |
| condition | 16 |
| eldritch_invocation | 21 |
| feat_ability | 75 |
| fighting_style | 15 |
| item_effect | 39 |
| maneuver_variant | 10 |
| passive | 3 |
| run_aura | 5 |
| species_ability | 75 |
| spell_effect | 106 |
| weapon_mastery | 8 |

## Воспроизводимость и сохранность

Манифест 285 хранит SHA-256 исходного каталога, индекса и неизменённого манифеста 707. Локальные исходные файлы находятся в `outputs/crossrefs-prod-check/`; их полный экспорт не включается в репозиторий. Миграция использует явные UUID/card_number и допустимые before/after типы, фиксирует receipt/audit и не классифицирует будущие сущности автоматически. Повтор после успешного применения не перезаписывает позднейшие ручные изменения.

Обе классификационные миграции временно отключают только `invalidate_effects_support` под блокировкой записи effects в одной транзакции и восстанавливают его точный режим O/D/R/A. Так сохраняются существующие NULL/legacy support при новом валидаторе 277. Индекс ссылок и остальные триггеры продолжают работать; конфликт или ошибка откатывает также состояние триггера. Защищённый fingerprint исключает только effect_type и updated_at.

## Повторная проверка 25 прежних эффектов с изменившейся механикой

Сравнение свежей базы с прежним экспортом выявило 25 изменений mechanics среди исходных 707 записей. Каждая актуальная механика и её входящие источники проверены повторно: **дополнительная переклассификация не требуется**. Это 15 каноничных состояний, 8 эффектов черт, 1 эффект предмета и 1 классовая способность. Исходный манифест не изменён.

| Эффект | Подтверждённый тип | Основание по текущим данным |
| --- | --- | --- |
| EFF-general-FEAT-0016 | feat_ability | FEAT-0016, related_effects[0]; выборы, модификаторы или действия по-прежнему выдаются чертой. |
| EFF-general-FEAT-0033 | feat_ability | FEAT-0033, related_effects[0]; выборы, модификаторы или действия по-прежнему выдаются чертой. |
| EFF-general-FEAT-0038 | feat_ability | FEAT-0038, related_effects[0]; выборы, модификаторы или действия по-прежнему выдаются чертой. |
| EFF-general-FEAT-0051 | feat_ability | FEAT-0051, related_effects[0]; выборы, модификаторы или действия по-прежнему выдаются чертой. |
| EFFECT-item-perfume-check | item_effect | CARD-0696, mechanics.effects[0].result[0].value; часовое преимущество Убеждения по-прежнему выдаётся духами. |
| COND-petrified | condition | Собственная декларация mechanics.condition.id=petrified; общие правила состояния и их потребители сохранены. |
| COND-exhaustion | condition | Собственная декларация mechanics.condition.id=exhaustion; общие правила состояния и их потребители сохранены. |
| COND-frightened | condition | Собственная декларация mechanics.condition.id=frightened; общие правила состояния и их потребители сохранены. |
| COND-incapacitated | condition | Собственная декларация mechanics.condition.id=incapacitated; общие правила состояния и их потребители сохранены. |
| COND-deafened | condition | Собственная декларация mechanics.condition.id=deafened; общие правила состояния и их потребители сохранены. |
| COND-paralyzed | condition | Собственная декларация mechanics.condition.id=paralyzed; общие правила состояния и их потребители сохранены. |
| COND-grappled | condition | Собственная декларация mechanics.condition.id=grappled; общие правила состояния и их потребители сохранены. |
| COND-invisible | condition | Собственная декларация mechanics.condition.id=invisible; общие правила состояния и их потребители сохранены. |
| COND-restrained | condition | Собственная декларация mechanics.condition.id=restrained; общие правила состояния и их потребители сохранены. |
| COND-poisoned | condition | Собственная декларация mechanics.condition.id=poisoned; общие правила состояния и их потребители сохранены. |
| COND-stunned | condition | Собственная декларация mechanics.condition.id=stunned; общие правила состояния и их потребители сохранены. |
| COND-unconscious | condition | Собственная декларация mechanics.condition.id=unconscious; общие правила состояния и их потребители сохранены. |
| COND-blinded | condition | Собственная декларация mechanics.condition.id=blinded; общие правила состояния и их потребители сохранены. |
| COND-prone | condition | Собственная декларация mechanics.condition.id=prone; общие правила состояния и их потребители сохранены. |
| COND-charmed | condition | Собственная декларация mechanics.condition.id=charmed; общие правила состояния и их потребители сохранены. |
| EFF-feat-crafter-tools | feat_ability | FEAT-0010, related_effects[0]; выборы, модификаторы или действия по-прежнему выдаются чертой. |
| EFF-feat-healer-reroll | feat_ability | FEAT-0006, related_effects[0]; выборы, модификаторы или действия по-прежнему выдаются чертой. |
| EFF-sneak-attack | class_ability | CLASS-rogue, level_progression.1.effects[0]; урон скрытой атаки зависит от class_level:rogue и выдаётся классом плута. |
| magic_initiate_wizard | feat_ability | FEAT-0009, related_effects[0]; выборы, модификаторы или действия по-прежнему выдаются чертой. |
| EFF-savage-attacker | feat_ability | FEAT-0004, related_effects[0]; выборы, модификаторы или действия по-прежнему выдаются чертой. |
