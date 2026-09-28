"""Author the reviewed item trigger subset; output is consumed by root's item audit."""
import json
from pathlib import Path

def equals(key, value): return {"kind":"event_data_equals", "key":key, "value":value}
def auto(*result, who="self"): return {"resolution":"auto", "who":who, "result":list(result)}
def trigger(number, event, effects, conditions=None, uses=None):
    payload={"kind":"triggered_effect", "id":f"item-trigger:CARD-{number:04d}", "event":event, "subject":"self", "duration":{"type":"while_active"}, "effects":effects}
    if conditions: payload["circumstances"]=conditions
    if uses: payload["uses"]={"count":1,"per":uses}
    return payload

data={}
def add(n, payloads, implemented, tested, limitations=None):
    data[f"CARD-{n:04d}"]={"append_payloads":payloads,"implemented":implemented,"tested":tested,"limitations":limitations or [],"evidence":["frontend/src/engine/itemTriggersAudit.test.ts"]}

add(108,[trigger(108,"resource_spent",[auto({"kind":"temp_hp","amount":10})],[equals("resource","channel_divinity")])],
    ["Расход Божественного канала владельцем даёт ему 10 временных хитов."],
    ["Срабатывает после успешной оплаты; другой ресурс/чужой владелец/недостаток ресурса не срабатывают."],
    ["Поддерживается расход через общую оплату executeAction. Отдельные старые обработчики, напрямую списывающие пул, не создают это событие."])
add(418,[trigger(418,"long_rest",[auto({"kind":"resource","op":"grant_capped","id":"heroic_inspiration","amount":1,"max":1})])],
    ["Долгий отдых даёт одно Героическое вдохновение и не накапливает второе."],
    ["Вдохновение выдаётся обычной шиной долгого отдыха; короткий отдых его не выдаёт."])
add(457,[trigger(457,"resource_spent",[auto({"kind":"healing","amount":"1d6","healing_source":"item"},who="target")],[equals("resource","bardic_inspiration"),equals("has_target",True)])],
    ["При расходовании бардовского вдохновения выбранная реальная цель исцеляется на 1к6."],
    ["Разные состояния барда и цели; HP и кубик принадлежат цели, ресурс списывается у барда."],
    ["Поддерживается общий путь executeAction с явным runtime цели. Иные способы траты вдохновения без такого контекста не угадывают получателя."])
add(577,[trigger(577,"healing_given",[auto({"kind":"temp_hp","amount":3},who="target")])],
    ["Фактически исцелённый получатель получает 3 временных хита; лечение себя также работает."],
    ["Чужой получатель, сам владелец, несвязанная выбранная цель и нулевое восстановление HP."],
    ["Автоматические healing-события охватывают общий исполнитель, но не старые ручные изменения HP/отдых в обход него. Лечение при полных HP трактуется как отсутствие исцеления."])
add(594,[trigger(594,"spell_cast",[auto({"kind":"temp_hp","amount":8})],[equals("concentration",True)])],
    ["Сотворение заклинания с декларацией концентрации даёт владельцу 8 временных хитов."],
    ["Срабатывает только на подтверждённый concentration-факт; обычное заклинание и отсутствующий факт не подходят."],
    ["Каноничный бой берёт school/concentration из каталога действия. Старые вызовы, не передающие каталоговые факты, безопасно не срабатывают."])
add(615,[trigger(615,"healing_given",[auto({"kind":"healing","amount":2,"healing_source":"item"})],[equals("other_target",True)])],
    ["Фактическое лечение другого существа восстанавливает владельцу 2 хита; лечение себя не запускает бесконечную цепочку."],
    ["Разные владелец и получатель, последующее самоисцеление, отсутствие запуска при полном HP цели."],
    ["Срабатывание привязано к каждому healing-payload общего исполнителя. Составные заклинания из нескольких отдельных healing-payload требуют явного согласования частоты."])
add(636,[trigger(636,"hit",[auto({"kind":"healing","amount":"1d4","healing_source":"item"})],[{"kind":"attack_range","value":"melee"},{"kind":"hp_fraction_at_most","value":0.5}])],
    ["Попадание атакой ближнего боя лечит владельца на 1к4, если до лечения у него не больше половины максимальных HP."],
    ["Ближняя атака/дальняя атака/промах, граница Окровавлен, независимый HP цели."],
    ["Проверены атаки общего исполнителя; внешние ручные объявления попадания не создают скрытого лечения."])
add(655,[trigger(655,"healing_received",[auto({"kind":"damage_rider","trigger":"hit_by_attack_roll","dice":"1d6","type":"poison","consume":"next_attack","duration":{"type":"until_dispelled"},"stack_id":"item:revenge-beads:next-attack","stack_type":"overwrite"})])],
    ["Фактическое лечение владельца готовит 1к6 ядом на следующую атаку; повторное лечение обновляет один эффект. Попадание наносит урон, промах расходует подготовку."],
    ["Эффект сохраняет sourceId/ownerId получателя, не целителя; попадание, промах и новый эффект после попадания проверяются отдельно."],
    ["Лечение при полном HP не активирует предмет. Ручные изменения HP вне healing не создают событие."])
add(661,[trigger(661,"turn_start",[auto({"kind":"stabilize"})],[{"kind":"living_at_zero_hp"}])],
    ["В начале хода живой владелец с нулём HP стабилизируется без лечения."],
    ["Ноль HP, положительные HP и умерший персонаж; стабилизация не воскрешает и не добавляет HP."])
illusion=trigger(766,"spell_cast",[auto({"kind":"condition","op":"apply","value":"invisible","duration":{"type":"until_start_of_next_turn"}})],
    [equals("school","illusion"),equals("leveled",True)],uses="short_rest")
add(766,[illusion],["Первое подходящее уровневое заклинание Иллюзии до короткого отдыха делает владельца невидимым до начала следующего хода."],
    ["Иллюзия первого круга, заговор, другая школа, неизвестная школа, повтор до отдыха, сохранение счётчика и восстановление после короткого отдыха."],
    ["Длительность «1 ход» трактуется как до начала следующего хода владельца. Старые вызовы без каталоговой школы безопасно не срабатывают."])
data["CARD-0766"]["replace_mechanics"]={"activation":{"mode":"passive","while":"equipped"},"effects":[auto(illusion)]}
data["CARD-0766"]["append_payloads"]=[]
add(770,[trigger(770,"encounter_start",[auto({"kind":"modifier","op":"add","value":10,"applies_to":{"roll":"speed"},"duration":{"type":"until_end_of_round"}})])],
    ["Начало авторитетного столкновения даёт +10 футов скорости до общей границы конца первого раунда."],
    ["Бонус сохраняется на первом ходу любого участника; удаляется у всех при переходе ко второму раунду. Повтор StartEncounter не обновляет эффект."],
    [])
add(897,[trigger(897,"encounter_start",[auto({"kind":"set_value","target":"current_hp","formula":"ceil(current_hp / 2)"})])],
    ["При входе в авторитетное столкновение владелец теряет половину текущих HP (потеря округляется вниз), не тратя временные HP и не применяя сопротивления."],
    ["Разные текущие HP, независимый другой участник, временные HP/сопротивление; повтор команды и повторный StartEncounter не списывают HP снова."],
    [])
for number in ["CARD-0770","CARD-0897"]:
    data[number]["evidence"]=["frontend/src/rules-core/itemEncounterLifecycle.test.ts","frontend/src/solo-combat/soloCombat.engine.integration.test.ts","frontend/src/roguelike/combatInitialization.test.ts"]
    data[number]["tested"].append("Новый одиночный бой и доверенный roguelike initializer проходят StartEncounter до сохранения; загрузка сохранённого боя не повторяет эффекты/восстановление пулов.")
for n, limitation in {
    178:"Нет достоверного события убийства противника: падение до 0 HP не доказывает смерть и не подменяется убийством.",
    757:"Нет достоверного события уничтожения существа в бою с владельцем-источником. Простой урон или падение до 0 HP недостаточны.",
    936:"Нет отдельной сохраняемой границы дня. Подмена первого обморока за день первым падением до 0 после долгого отдыха была бы неточной; пробуждение при сне также отличается от 0 HP.",
}.items(): add(n,[],[],[],[limitation])

dest=Path("scripts/content/data/item-triggers-20260929.json")
dest.parent.mkdir(parents=True,exist_ok=True)
dest.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
print(f"Prepared {len(data)} item audits ({sum(bool(v['implemented']) for v in data.values())} implemented subsets)")
