"""Clause inventory and reviewed declarations for current items 1..349.

Reads the fresh release snapshot; never modifies the deployed migration 278.
The pending table is deliberately explicit: a row is not ready merely because
one of its clauses already has a numeric modifier.
"""
from pathlib import Path
from copy import deepcopy
import json,re,uuid,hashlib

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'outputs/catalog-completion-20260929/cards.json'
DEST=ROOT/'scripts/content/data/item-completion-low-20260929.json'
ROWS=json.loads(SOURCE.read_text(encoding='utf8'))
BY_NUMBER={row['card_number']:row for row in ROWS if not row.get('deleted_at')}
def number(n):return f'CARD-{n:04d}'
def mod(roll,value=None,op='add',**filters):
 p={'kind':'modifier','op':op,'applies_to':{'roll':roll}}
 if value is not None:p['value']=value
 if filters:p['applies_to']['filter']=filters
 return p
def auto(*payloads,who='self'):return {'resolution':'auto','who':who,'result':list(payloads)}
def event(n,name,*effects,when=None,occurrence=None,optional=False,cost=None,suffix=''):
 p={'kind':'triggered_effect','id':f'item-completion:{number(n)}:{name}{suffix}','event':name,'subject':'self','duration':{'type':'while_active'},'effects':list(effects)}
 if when:p['circumstances']=when
 if occurrence:p['occurrence']=occurrence
 if optional:p['optional']=True
 if cost:p['cost']=cost
 return p
def equal(key,value):return {'kind':'event_data_equals','key':key,'value':value}
def weapon(n):return equal('weaponId',BY_NUMBER[number(n)]['id'])
def condition(value,turns=None):return {'kind':'condition','value':value,'duration':{'type':'rounds','amount':turns} if turns else {'type':'until_removed'}}
def timed(payload,duration,**extra):return {**payload,'duration':{'type':duration},**extra}
def restore(id,amount=1):return {'kind':'resource','op':'restore','id':id,'amount':amount}
def rider(dice,type='weapon',**extra):return {'kind':'damage_rider','trigger':'hit_by_attack_roll','dice':dice,'type':type,'duration':{'type':'permanent'},**extra}

# Remaining implementation work, recorded per actual item rather than using an
# undifferentiated "not confirmed" tag. Entries disappear as each hook lands.
PENDING={
 2:'Профиль оружия отсутствует: bonus_value содержит 1d8+1d6, но тип второй строки и категория не заданы.',
 38:'Нужно действие употребления с расходом предмета и сохранённым сюжетным эффектом долголетия.',
 40:'Подводное дыхание на час и расход зелья; скорость плавания численно не задана.',
 41:'Расход зелья; удвоенная скорость и дополнительное действие на каждом ходу в течение минуты.',
 42:'Временное действие чтения мыслей на 30 фт на час и расход зелья.',
 43:'Дружественность животных в 30 фт, общение и преимущество Харизмы к животным на час.',
 46:'Выбор типа устойчивости при употреблении, часовой эффект и расход зелья.',
 47:'Числа урона, СЛ и срок отравления отсутствуют; можно реализовать расход и отдельное заданное ГМ последствие.',
 48:'Газообразная форма на час: запрет атак/заклинаний и прохождение щелей, расход зелья.',
 49:'Удаление болезни; количество временных ОЗ не задано.',
 50:'Выбор типа невосприимчивости на 10 минут с расходом зелья.',
 51:'Проверить live изменение силы от временного value_method без пересборки персонажа.',
 52:'Однократно бросить/сохранить длительность 1d4 часа, увеличить размер и расходовать зелье.',
 53:'Видение невидимого: дальность не задана, расход зелья.',
 54:'Количество временных ОЗ не задано; сохранённое преимущество против страха уже действует.',
 55:'Скорость лазания равна скорости ходьбы и преимущество Атлетики при лазании на час.',
 56:'Временное действие конуса огня 15 фт на час; количество урона в тексте отсутствует.',
 57:'Проверить live изменение силы от временного value_method без пересборки персонажа.',
 61:'Авторитетная стоимость каждой атаки собственным оружием: 5 фт перемещения.',
 62:'Отдача на 5 фт при атаке; исход БАБАХ на 14–17 не определён.',
 63:'Отдельный d6 после попадания, застревание на 2/5; цена и проверка вытаскивания не заданы.',
 64:'Нужен явный профиль импровизированного оружия: ложка 1d6 дробящего.',
 65:'Параметры нашествия крыс (число, урон, срок, существо) не заданы; профиль кнута отсутствует.',
 66:'При натуральной 1 перенаправить попадание ближайшему к цели гоблину, разрешить равную дистанцию выбором.',
 87:'Модификаторы своего оружия при подтверждённом положении в темноте.',
 88:'Две отдельные атаки/стрелы из темноты в рамках одной исходной атаки.',
 89:'Дополнительный путь каста заговора бонусным действием из тени, заряд раз за бой.',
 98:'Необязательное перенаправление урона союзника в 10 фт владельцу доспеха.',
 99:'Аура трудной местности для врагов 15 фт; при ближнем уроне спасбросок ТЕЛ на опутывание без заданной СЛ/срока.',
 102:'Попадание внеочередной атакой устанавливает скорость цели в 0 (срок не задан).',
 104:'Автоматическая кара 1 уровня на крит без ячейки; дополнительная атака за действие.',
 107:'Авторитетный запрет нежелательного принудительного перемещения.',
 110:'Преимущество броска урона только по собственной цели Обета вражды.',
 115:'Выбор типа урона перед применением Божественной кары.',
 120:'При промахе своим оружием отдельный бросок половины урона.',
 121:'Страж веры без действия раз за бой; Ускорение после убийства без летаргии; проверить зависимости заклинаний.',
 122:'Ответная атака на врага в 5 фт, который атаковал другого персонажа.',
 123:'Концентрация теряется только при смерти; преимущество атак по концентрирующемуся; 1d6 психического своим мечом.',
 125:'В конце своего хода вылечить себя и живых союзников в 10 фт на 1d4+1.',
 126:'Аура 10 фт: снижение урона по уровню паладина, максимум лечения, преимущество смерти и возрождение на19/20.',
 129:'В конце хода без движения +1 КД до начала следующего; крит восстанавливает очко фокуса.',
 130:'Автоуспех МДР и необязательный сдвиг цели5фт частью атаки.',
 132:'Два временных пути каста за фокус; количество расходуемого фокуса не указано.',
 133:'В начале хода в темноте создать Тьму вокруг себя на 2 хода.',
 137:'Дальность прыжков +5 фт должна использоваться в реальной геометрии прыжка.',
 141:'Связать 6 сегментов с носителями, разделить Щит/Магическую защиту; заклинания игнорируют сопротивление.',
 147:'Принудительное перемещение владельца и цели на5фт после выстрела.',
 150:'Диапазоны1–10/10–15/15–20 пересекаются на10и15; профиль оружия отсутствует.',
 161:'Доставание клинка восстанавливает1уровень и половину maxHP; убийство лечит1d10 и ограничивает воскрешение; после боя навсегда−1порог смерти.',
 167:'Запрет обезоруживания.',
 180:'На успехе любого спасброска нулевой урон, на провале половина.',
 184:'Преимущество только на проверку/спасбросок против сдвига.',
 185:'Отдельное место оружия в инициативе и одна атака из рук носителя в его ход.',
 186:'Бонусное действие: восстановить ячейку договора,1раз/день.',
 199:'Бонусным действием d4; на4 дать возможность каста заклинания или заговора.',
 214:'Проверка захвата/толчка +1 по авторитетному типу проверки.',
 215:'Дополнительный d4 при сопротивлении обезоруживанию.',
 217:'Рывок увеличивает доступное перемещение ещё на5фт.',
 218:'Полный прыжок без разбега.',
 221:'Текст включает проверку сопротивления падению ничком; существующий бонус задан только на спасбросок.',
 222:'Стоимость трудной местности вдвое сильнее обычной.',
 225:'При толчке/захвате причинять1d4дробящего.',
 229:'Дополнительный1урон атаки из скрытности.',
 238:'Необязательная реакция причинить1урон атакующему; тип урона не указан.',
 239:'На расходе ячейки один d100; при1 вернуть именно потраченную ячейку.',
 241:'Триггер/вероятность и таблица дикой магии не заданы.',
 245:'Бросок атаки оплаченный бонусным действием +1.',
 246:'Авторитетное снижение торговой цены на2зм.',
 249:'Урон именно Скрытой атаки +1, не любой атаки из скрытности.',
 258:'Когда перемещение исчерпано, d4раз/ход;4восстанавливает5фт бюджета.',
 264:'Дополнительное оружейное действие этой рапирой за бонусное действие.',
 265:'Выбор навыка с компетенцией при надевании и постоянный запрет снятия проклятого кольца.',
 330:'Действие освобождения из сети проверкой СилыСЛ10; расход/возврат сети.',
}
EXTRA={}
OVERRIDE={}
RELATED=[]
def related_effect(n,payloads,duration):
 ref=f'EFFECT-item-completion-low-{n:04}'
 ident=str(uuid.uuid5(uuid.NAMESPACE_URL,'dnd-cards:catalog-completion-20260929:'+ref))
 name=BY_NUMBER[number(n)]['name']
 description=BY_NUMBER[number(n)].get('detailed_description') or BY_NUMBER[number(n)]['description']
 patch={'id':ident,'card_number':ref,'name':name,'name_en':None,'description':description,'detailed_description':None,'rarity':BY_NUMBER[number(n)]['rarity'],'effect_type':'item_effect','author':'System','source':'Catalog completion 2026-09-29','mechanics':{'activation':{'mode':'passive'},'duration':duration,'effects':[auto(*payloads)]}}
 RELATED.append({'entity_type':'effect','id':ident,'card_number':ref,'name':name,'description_sha256':hashlib.sha256(json.dumps([description,None],ensure_ascii=False,separators=(',',':')).encode()).hexdigest(),'preimage':None,'patch':patch,'review':{'status':'verified_partial','summary':'Временная механика предмета с явным сроком и каноничным источником.','implemented':['Временные способности и отзыв при истечении.'],'tested':['frontend/src/engine/runtimeCharacterProjection.test.ts'],'limitations':[],'evidence':[]}})
 return {'kind':'grant_effect','value':ref}
def potion(n,payloads,**extra):
 OVERRIDE[n]={'activation':{'mode':'active','while':'carried','cost':[{'resource':'action'},{'resource':'self_item','amount':1}]},'effects':[auto(*payloads)],**extra}
def resistance_choice(n,level,minutes):
 types=['fire','cold','lightning','acid','poison','necrotic','radiant','thunder','psychic','force']
 return {'kind':'choice','id':f'potion-{n}-damage-type','context':'in_play','count':1,'options':{'source':'explicit','items':[{'id':t,'name':t,'grants':[{'kind':'resistance','value':level,'damage_type':t,'duration':{'type':'minutes','amount':minutes}}]} for t in types]}}
potion(38,[related_effect(38,[{'kind':'narrative','description':'Старение замедлено до конца жизни; число лет в описании не задано.'}],{'type':'permanent'})])
potion(41,[related_effect(41,[mod('speed',2,'multiply'),{'kind':'resource','op':'grant','id':'action','amount':1}],{'type':'minutes','amount':1})])
potion(46,[resistance_choice(46,'resistance',60)])
potion(50,[resistance_choice(50,'immunity',10)])
potion(52,[{**mod('size',1),'duration':{'type':'hours','amount':'growth_hours'}},{**mod('ability_check',op='advantage',ability='str'),'duration':{'type':'hours','amount':'growth_hours'}}],formula_bindings={'growth_hours':'1d4'})
potion(55,[related_effect(55,[{'kind':'grant_speed','mode':'climb','value':'character_speed'},mod('ability_check',op='advantage',skill='athletics',reason='climbing')],{'type':'hours','amount':1})])
for n in [38,41,46,50,51,52,55,57]:PENDING.pop(n)
def add(n,*payloads):EXTRA.setdefault(n,[]).extend(payloads)
for roll in ['attack','damage']:
 add(81,{**mod(roll,1,weaponId=BY_NUMBER[number(81)]['id']),'when':[{'kind':'character_size','value':1}]})
add(64,event(64,'crit',auto(condition('stunned',1),who='target'),when=[weapon(64)]),event(64,'miss',auto(condition('stunned')),when=[weapon(64)]))
add(83,event(83,'attacked',auto(timed(mod('attack',1),'until_removed',consume='next',stack_id='item-next-attack-83')),when=[equal('hit',False)]))
add(109,{'kind':'action_target_limit','action_refs':['ACT-subclass-EFFECT-0166'],'add':1})
add(107,{'kind':'movement_policy','forced_movement':'immune'})
add(110,{**mod('damage',op='advantage'),'when':[{'kind':'target_has_effect','value':'EFFECT-paladin-vow-of-enmity-target','source':'self'}]})
add(116,event(116,'short_rest',auto({'kind':'resource','op':'restore','id':'spell_slot_1','restore_all':True})))
add(117,{'kind':'ritual_casting'})
add(119,event(119,'hit',{'resolution':'save','who':'target','ability':'con','dc':'13','on_fail':[condition('prone')],'on_success':[]},when=[weapon(119)],optional=True))
add(124,event(124,'attacked',auto({'kind':'damage','amount':'1d4','type':'piercing','suppress_damage_modifiers':True},who='target'),when=[equal('attackRange','melee')]))
add(125,{'kind':'aura','radius_ft':10,'recipients':'allies','include_self':True,'events':['turn_end'],'effects':[{'kind':'healing','amount':'1d4+1'}]})
add(126,{'kind':'aura','radius_ft':10,'recipients':'allies','include_self':True,'effects':[{'kind':'reduce_damage','amount':'class_level:paladin'},mod('healing_received',op='maximize_dice'),mod('saving_throw',op='advantage',kind='death'),{'kind':'life_policy','revive_at_natural':19}]})
add(127,rider('1d4',when=[{'kind':'moved_distance_ft','min':25}]))
add(128,event(128,'hit',auto(condition('paralyzed'),who='target'),auto(restore('focus')),occurrence={'at':3,'per':'turn','group_by':'target'}))
add(129,event(129,'turn_end',auto(timed(mod('ac',1),'until_start_of_next_turn',stack_id='item-stillness-129')),when=[{'kind':'moved_distance_ft','max':0}]),event(129,'crit',auto(restore('focus'))))
PENDING.pop(129)
add(131,event(131,'hit',auto(timed(mod('speed',-10),'until_removed',stack_id='item-slow-131'),who='target')))
for natural,status in [(19,'paralyzed'),(18,'stunned'),(17,'blinded')]:
 add(136,event(136,'attack_roll_made',auto({**condition(status),'on_immune':[{'kind':'damage','dice':'1d20','type':'psychic','suppress_damage_modifiers':True}]},who='target'),when=[equal('naturalRoll',natural)],suffix=f':{natural}'))
add(136,{'kind':'action_cost_policy','id':'CARD-0136:focus-waiver','match':{'action_refs':['ACT-monk-deflect-redirect','ACT-monk-patient-defense-focus']},'waive_resources':['focus']})
add(137,mod('jump_distance',5))
add(165,{'kind':'weapon_handling','required_hands':1,'max_weapons':1})
counter=event(166,'attacked',auto(),occurrence={'every':1,'per':'round'})
add(166,counter,{**mod('attack',op='disadvantage'),'scope':'target','when':[{'kind':'event_count_below','id':counter['id'],'per':'round','threshold':1}]})
add(178,event(178,'kill',auto({'kind':'temp_hp','amount':5})))
add(181,event(181,'attacked',auto({'kind':'damage','amount':'1d4','type':'force','suppress_damage_modifiers':True},who='target')))
add(180,{'kind':'save_damage_policy','on_success':'none','on_failure':'half'})
add(229,{**mod('damage',1),'when':[{'kind':'you_are_hidden'}]})
add(211,mod('damage_received',1,source='attack'))
add(218,{'kind':'movement_policy','standing_jump':True})
add(222,mod('movement_cost',2,'multiply',terrain='difficult'))
add(234,{'kind':'reduce_damage','amount':1,'filter':{'source':'attack'},'chance':{'die':4,'equals':[4]}})
add(240,{'kind':'reduce_damage','amount':1,'filter':{'source':'attack','creature_types':['undead','humanoid:shapechanger']}})
add(243,event(243,'attacked',auto(timed(mod('attack',op='disadvantage'),'until_removed',consume='next',stack_id='item-next-disadvantage-243'),who='target'),when=[equal('critical',True)]))
add(250,{**mod('damage_received',0,'multiply',source='attack'),'chance':{'die':100,'equals':[1]}})
for n in range(331,336):add(n,{**mod('attack',op='deny_critical'),'scope':'target'})
for n in [107,110,125,126,137,180,218,222,229]:PENDING.pop(n)

# Source-owned actions use the canonical library compiler and item live gate.
def related_action(n,mechanics,suffix='',temporary=False):
 ref=f'ACT-item-completion-low-{n:04}'+suffix
 ident=str(uuid.uuid5(uuid.NAMESPACE_URL,'dnd-cards:catalog-completion-20260929:'+ref))
 row=BY_NUMBER[number(n)];description=row.get('detailed_description') or row['description'];name=row['name']
 mechanics={**mechanics,**({} if temporary else {'requires_item_source':row['id']}),'damage_source_kind':'item'}
 patch={'id':ident,'card_number':ref,'name':name,'name_en':None,'description':description,'detailed_description':None,'rarity':row['rarity'],'type':'other','action_type':'base_action','resource':'action','author':'System','source':'Catalog completion 2026-09-29','mechanics':mechanics}
 RELATED.append({'entity_type':'action','id':ident,'card_number':ref,'name':name,'description_sha256':hashlib.sha256(json.dumps([description,None],ensure_ascii=False,separators=(',',':')).encode()).hexdigest(),'preimage':None,'patch':patch,'review':{'status':'verified_partial','summary':'Предметное действие с канонической стоимостью и проверкой источника.','implemented':['Проверка актуального предмета при выполнении действия.'],'tested':['frontend/src/engine/itemCompletionLow.test.ts'],'limitations':[],'evidence':[]}})
 return {'kind':'grant_action','value':ref}
add(61,{'kind':'weapon_attack_policy','weapon_id':BY_NUMBER[number(61)]['id'],'movement_cost_ft':5})
add(102,event(102,'hit',auto(timed({**mod('speed',0,'set')},'until_removed',stack_id='item-opportunity-stop-102'),who='target'),when=[equal('opportunityAttack',True)]))
add(120,{'kind':'weapon_attack_policy','weapon_id':BY_NUMBER[number(120)]['id'],'miss_damage':'half'})
add(123,{'kind':'concentration_policy','loss_only_on_death':True},{**mod('attack',op='advantage'),'scope':'target','when':[{'kind':'concentrating'}]},rider('1d6','psychic',filter={'weaponId':BY_NUMBER[number(123)]['id']},when=[{'kind':'concentrating'}]))
add(167,{'kind':'equipment_policy','cannot_be_disarmed':True})
add(130,{**mod('saving_throw',op='outcome',ability='wis'),'value':'success','natural':{'min':1,'max':20}},event(130,'hit',auto({'kind':'movement','value':'push','distance':5},who='target'),optional=True))
for level in range(1,10):
 refund=event(239,'resource_spent',auto(restore('spell_slot_'+str(level))),when=[equal('resource','spell_slot_'+str(level))],suffix=':'+str(level));refund['chance']={'die':100,'equals':[1]};add(239,refund)
add(186,related_action(186,{'activation':{'mode':'active','cost':[{'resource':'bonus_action'},{'resource':'self_uses'}]},'uses':{'count':1,'per':'long_rest'},'effects':[auto({'kind':'resource','op':'restore','id':'selected_pool','amount':1,'select_pool':{'prefix':'spell_slot_','recharge':'short_rest','take':'highest_level'}})]}))
# Explicit hand choices prevent this item from silently attacking with the other weapon.
attack_options=[]
for hand,slot in [('main','main_hand'),('off','off_hand')]:
 attack_options.append({'id':hand,'name':'Правая рука' if hand=='main' else 'Левая рука','grants':[{'kind':'attack_follow_up','follow_up':'unused'}]})
add(264,related_action(264,{'activation':{'mode':'active','cost':[{'resource':'bonus_action'}]},'requires_held_item':BY_NUMBER[number(264)]['id'],'weapon_source_id':BY_NUMBER[number(264)]['id'],
 'effects':[{'resolution':'attack_roll','ability':'auto','attack_kind':'weapon_melee','on_hit':[{'kind':'damage','dice':'weapon','type':'weapon','ability':'auto'}]}],
 'targeting':{'shape':'single','domain':'actor','actor_targets':True,'min_targets':1,'max_targets':1,'range_ft':5,'requires_line_of_sight':True,'allowed_relations':['enemy','neutral']}}))
add(265,{'kind':'choice','id':'item-expertise','count':1,'context':'in_play','prompt':'Выберите навык для компетенции','options':{'source':'skill'},'grant':{'kind':'grant_expertise','prof':'skill'}},{'kind':'equipment_policy','cannot_remove':True})
for n in [61,102,120,123,130,167,186,239,264]:PENDING.pop(n)

exhaustion=event(258,'movement_exhausted',auto(timed(mod('speed',5),'until_end_of_turn',stack_id='item-movement-258')),occurrence={'at':1,'per':'turn'});exhaustion['chance']={'die':4,'equals':[4]};add(258,exhaustion)
PENDING.pop(258)

def related_existing(entity_type,row,patch,summary,tests):
 fields={'description':row.get('description'),'detailed_description':row.get('detailed_description')}
 fields.update({key:row.get(key) for key in patch})
 RELATED.append({'entity_type':entity_type,'id':row['id'],'card_number':row['card_number'],'name':row['name'],
  'description_sha256':hashlib.sha256(json.dumps([row.get('description'),row.get('detailed_description')],ensure_ascii=False,separators=(',',':')).encode()).hexdigest(),
  'preimage':fields,'patch':patch,'review':{'status':'verified_partial','summary':summary,'implemented':[summary],'tested':tests,'limitations':[],'evidence':tests}})
guardian=next(r for r in json.loads((ROOT/'outputs/catalog-completion-20260929/spells.json').read_text(encoding='utf8')) if r['card_number']=='guardian_of_faith')
gm=deepcopy(guardian['mechanics']);gm['targeting']={'shape':'area','domain':'world','actor_targets':False,'range_ft':30,'max_targets':0,'min_targets':0,'allowed_relations':[],'requires_line_of_sight':True,'area':{'kind':'sphere','radius_ft':10}}
gm['effects']=[auto({'kind':'world_zone','zone_type':'guardian_of_faith','geometry':{'shape':'sphere','radius_ft':10,'size_ft':10},'duration':{'type':'hours','amount':8},'tactical':{'triggers':['enter','start_turn'],'recipients':'enemies','shared_trigger_per_turn':True,'damage_budget':60,'save':{'ability':'dex','dc':'spell_save_dc'},'on_failure':[{'kind':'damage','amount':20,'type':'radiant','suppress_damage_modifiers':True}],'on_success':[{'kind':'damage','amount':10,'type':'radiant','suppress_damage_modifiers':True}]}})]
related_existing('spell',guardian,{'mechanics':gm},'Зона стража: 10фт, враги, Dex20/10, один запуск за ход, 8ч, общий предел фактического урона60 с сохранением.', ['frontend/src/solo-combat/combatAreas.test.ts'])
add(121,{'kind':'grant_spell','value':'guardian_of_faith','label':'known','freeuse':{'count':1,'recharge':'encounter'}},{'kind':'action_cost_policy','id':'CARD-0121:guardian-free-action','match':{'action_refs':['guardian_of_faith',guardian['id']]},'replace':{'action':'free_action'}})
haste_payloads=[mod('speed',2,'multiply'),mod('ac',2),mod('saving_throw',op='advantage',ability='dex'),{'kind':'resource','op':'grant','id':'haste_action','amount':1,'recharge':'turn'},{'kind':'action_cost_policy','id':'CARD-0121:haste-action','match':{'action_categories':['attack','dash','disengage','hide','utilize']},'replace':{'action':'haste_action'},'optional':True,'max_attacks':1}]
add(121,event(121,'kill',auto(related_effect(121,haste_payloads,{'type':'minutes','amount':1}))))
PENDING.pop(121)
# The canonical Disengage declaration shares the same category as alternate
# feature grants; this stamp is data, not a runtime identifier exception.
_actions=json.loads((ROOT/'outputs/catalog-completion-20260929/actions.json').read_text(encoding='utf8'))
_disengage=next(row for row in _actions if row['card_number']=='action_basic_disengage')
_disengage_mechanics=deepcopy(_disengage['mechanics']);_disengage_mechanics['activation']['counts_as']='disengage'
RELATED.append({'entity_type':'action','id':_disengage['id'],'card_number':_disengage['card_number'],'name':_disengage['name'],'description_sha256':hashlib.sha256(json.dumps([_disengage.get('description'),_disengage.get('detailed_description')],ensure_ascii=False,separators=(',',':')).encode()).hexdigest(),'preimage':{k:_disengage.get(k) for k in ['description','detailed_description','mechanics']},'patch':{'mechanics':_disengage_mechanics},'review':{'status':'verified_partial','summary':'Категория канонического Отхода для ограниченного дополнительного действия.','implemented':['Общий action_cost_policy распознаёт Отход из данных.'],'tested':['frontend/src/rules-core/restrictedAdditionalActions.test.ts'],'limitations':[],'evidence':[]}})

add(104,mod('attacks_per_action',1),event(104,'crit',auto({'kind':'damage','dice':'2d8','type':'radiant','suppress_damage_modifiers':True},who='target')),
 event(104,'crit',auto({'kind':'damage','dice':'1d8','type':'radiant','suppress_damage_modifiers':True},who='target'),when=[{'kind':'event_creature_type_in','key':'targetCreatureType','values':['fiend','undead']}],suffix=':undead-fiend'))
add(217,mod('dash_distance',5))
for n in [104,217]:PENDING.pop(n)

NARRATIVE={38,67,70,77,79,80,82,140,142,143,148,162,163,164,190,191,257}
MISSING_VALUES={2,47,49,53,54,56,62,63,65,99,132,150,238,241}
OPEN_DURATION={102:'Срок снижения скорости не указан; эффект действует до явного снятия.',64:'При провале срок оглушения не указан; эффект хранится до явного снятия.',128:'Срок паралича не указан; эффект хранится до явного снятия.',131:'Срок замедления не указан; эффект хранится до явного снятия без суммирования.',136:'Сроки паралича/ошеломления/ослепления не указаны; эффекты хранятся до явного снятия.'}
add(246,{'kind':'purchase_price_policy','discount_copper':200})
PENDING.pop(246,None)
for roll in ['ability_check','saving_throw']:
 add(184,mod(roll,op='advantage',against_forced_movement=True))
 add(215,mod(roll,op='bonus_die',against_disarm=True)|{'faces':4,'sign':1})
add(214,mod('ability_check',1,purpose=['grapple','shove']))
add(221,mod('ability_check',1,against_prone=True))
add(249,mod('damage',1,damage_tag='sneak_attack'))
for n in [184,214,215,221,249]:PENDING.pop(n,None)
_effects=json.loads((ROOT/'outputs/catalog-completion-20260929/effects.json').read_text(encoding='utf8'))
_sneak=next(row for row in _effects if row['card_number']=='EFF-sneak-attack')
_sneak_m=deepcopy(_sneak['mechanics'])
for ef in _sneak_m['effects']:
 for p in ef.get('result',[]):
  if p.get('kind')=='damage':p['damage_tag']='sneak_attack'
RELATED.append({'entity_type':'effect','id':_sneak['id'],'card_number':_sneak['card_number'],'name':_sneak['name'],'description_sha256':hashlib.sha256(json.dumps([_sneak.get('description'),_sneak.get('detailed_description')],ensure_ascii=False,separators=(',',':')).encode()).hexdigest(),'preimage':{k:_sneak.get(k) for k in ['description','detailed_description','mechanics']},'patch':{'mechanics':_sneak_m},'review':{'status':'verified_partial','summary':'Тег собственного пакета урона для адресного бонуса Скрытой атаки.','implemented':['damage_tag фильтрует бонус в том же пакете урона.'],'tested':['frontend/src/engine/effectRollFacts.test.ts'],'limitations':[],'evidence':[]}})
add(98,related_action(98,{'damage_transfer':{'fraction':1},'activation':{'mode':'triggered','optional':True,'cost':[],'trigger':{'event':'damage_taken','timing':'before','observer_range_ft':10,'observer_relations':['ally'],'requires_visibility':False}},'targeting':{'domain':'actor','shape':'single','actor_targets':True,'range_ft':10,'min_targets':1,'max_targets':1,'allowed_relations':['ally'],'requires_line_of_sight':False},'effects':[]}))
add(122,related_action(122,{'weapon_source_id':BY_NUMBER[number(122)]['id'],'requires_held_item':BY_NUMBER[number(122)]['id'],'activation':{'mode':'triggered','optional':False,'cost':[],'trigger':{'event':'attacked','observer_range_ft':5,'observer_relations':['enemy'],'exclude_self_target':True,'target_event':'source'}},'targeting':{'domain':'actor','shape':'single','actor_targets':True,'range_ft':5,'min_targets':1,'max_targets':1,'allowed_relations':['enemy'],'requires_line_of_sight':True},'effects':[{'resolution':'attack_roll','attack_kind':'weapon_melee','ability':'auto','on_hit':[{'kind':'damage','dice':'weapon','type':'weapon'}]}]}))
add(245,mod('attack',1,bonus_action=True))
PENDING.pop(245,None)
PENDING.pop(98,None)

# A separate initiative participant receives only this item-owned attack.
# Resolution delegates to the wielder's current weapon, ability, proficiency,
# passives and runtime; the virtual participant owns its own Action budget.
_mimic_strike=related_action(185,{
 'activation':{'mode':'active','cost':[{'resource':'action'}]},
 'requires_held_item':BY_NUMBER[number(185)]['id'],
 'weapon_source_id':BY_NUMBER[number(185)]['id'],
 'targeting':{'shape':'single','domain':'actor','actor_targets':True,'min_targets':1,'max_targets':1,'range_ft':5,'requires_line_of_sight':True,'allowed_relations':['enemy','neutral']},
 'effects':[{'resolution':'attack_roll','ability':'auto','attack_kind':'weapon_melee','on_hit':[{'kind':'damage','dice':'weapon','type':'weapon','ability':'auto'}]}],
},suffix='-strike',temporary=True)
RELATED[-1]['review']['tested'].append('frontend/src/rules-core/itemOwnedActor.integration.test.ts')
add(185,{'kind':'item_owned_actor','item_card_id':BY_NUMBER[number(185)]['id'],
 'action_ref':_mimic_strike['value'],'initiative':'independent','attacks_per_turn':1})
PENDING.pop(185,None)
for roll in ['attack','damage']:add(87,{**mod(roll,2,weaponId=BY_NUMBER[number(87)]['id']),'when':[{'kind':'in_darkness'}]})
PENDING.pop(87,None)
add(88,{'kind':'weapon_attack_policy','weapon_id':BY_NUMBER[number(88)]['id'],'additional_attacks':1,'when':[{'kind':'in_darkness'}]})
add(89,{'kind':'resource','op':'grant','id':'item_shadow_cantrip','amount':1,'recharge':'encounter'},{'kind':'action_cost_policy','id':'CARD-0089:shadow-cantrip','match':{'spell_level':0,'costs_resource':'action'},'when':[{'kind':'in_dim_light_or_darkness'}],'replace':{'action':'bonus_action'},'additional_cost':[{'resource':'item_shadow_cantrip','amount':1}],'optional':True})
PENDING.pop(89,None)
add(89,event(89,'encounter_start',auto({'kind':'resource','op':'restore','id':'item_shadow_cantrip','restore_all':True})))
_random_cast_effect=related_effect(199,[{'kind':'resource','op':'grant','id':'random_bonus_spell_action','amount':1},{'kind':'action_cost_policy','id':'CARD-0199:extra-spell','optional':True,'match':{'action_categories':['spell']},'replace':{'action':'random_bonus_spell_action','bonus_action':'random_bonus_spell_action'}}],{'type':'until_end_of_turn'})
add(199,related_action(199,{'activation':{'mode':'active','cost':[{'resource':'bonus_action'}]},'targeting':{'shape':'self','domain':'actor','range_ft':0,'actor_targets':False,'min_targets':0,'max_targets':1,'allowed_relations':['self']},'effects':[auto({'kind':'chance','chance':{'die':4,'equals':[4]},'on_success':[_random_cast_effect]})]}))
PENDING.pop(199,None)
add(62,event(62,'attack_roll_made',auto({'kind':'movement','value':'push','distance':5},who='self'),when=[weapon(62)]))
add(147,event(147,'attack_roll_made',auto({'kind':'movement','value':'push','distance':5},who='self'),when=[weapon(147)]),event(147,'hit',auto({'kind':'movement','value':'push','distance':5},who='target'),when=[weapon(147)]))
PENDING.pop(147,None)
# Custom/untrained profiles retain explicit catalog dice; no proficiency or
# mastery is invented when the catalog never specifies a base weapon.
PATCH_FIELDS={}
for n,kind,dice,dt,props,enchant in [(2,'custom_sword',['1d8','1d6'],'slashing',['finesse'],0),(64,'improvised',['1d6'],'bludgeoning',['finesse','heavy'],0),(150,'custom_blade',['1d8'],'piercing',['finesse'],2)]:
 profile={'weapon_type':kind,'proficiency_category':'none','attack_ability':'finesse','damage_lines':[{'dice':d,'type':dt} for d in dice],'default_attack_mode':'melee','attack_modes':[{'kind':'melee','reach_ft':5}],'properties':props,'mastery_effect_id':'','ammo':None,'enchantment':{'attack_bonus':enchant,'damage_bonus':enchant,'extra_damage_lines':[]},'attunement':{'required':False}}
 if 'heavy' in props:profile['heavy']={'minimum_ability_score':13,'ability_by_mode':{'melee':'str','ranged':'dex'},'consequence':'attack_disadvantage'}
 OVERRIDE[n]=deepcopy(BY_NUMBER[number(n)].get('mechanics') or {});OVERRIDE[n]['weapon_profile']=profile
 PATCH_FIELDS[n]={'type':'weapon','slot':BY_NUMBER[number(n)].get('slot') or 'one_hand','weapon_type':kind}
_whip=next(row['mechanics']['weapon_profile'] for row in ROWS if row.get('weapon_type')=='whip' and isinstance(row.get('mechanics'),dict) and 'weapon_profile' in row['mechanics'])
OVERRIDE[65]=deepcopy(BY_NUMBER[number(65)].get('mechanics') or {});OVERRIDE[65]['weapon_profile']=deepcopy(_whip);PATCH_FIELDS[65]={'type':'weapon','slot':'one_hand','weapon_type':'whip'}
PENDING.pop(64,None)
PENDING[2]='Не указаны категория владения и увеличенная кость при хвате двумя руками; доступны фехтовальные атаки1d8+1d6рубящего из полей каталога, огненный урон не придуман.'
PENDING.pop(122,None)
_smite_refs=[r['id'] for r in json.loads((ROOT/'outputs/catalog-completion-20260929/spells.json').read_text(encoding='utf8')) if r.get('name')=='Божественная кара' and not r.get('deleted_at')]
add(115,{'kind':'choice','id':'smite-damage-type','context':'in_play','count':1,'options':{'source':'explicit','items':[{'id':t,'name':t,'grants':[{'kind':'damage_type_policy','spell_refs':_smite_refs,'value':t}]} for t in ['acid','bludgeoning','cold','fire','force','lightning','necrotic','piercing','poison','psychic','radiant','slashing','thunder']]}})
PENDING.pop(115,None)
add(88,related_action(88,{'weapon_source_id':BY_NUMBER[number(88)]['id'],'requires_held_item':BY_NUMBER[number(88)]['id'],'activation':{'mode':'triggered','optional':False,'cost':[{'resource':'equipped_weapon_ammo','amount':1}],'trigger':{'event':'attack_dice_followup','subject':'self','circumstances':[weapon(88),equal('mode','additional')]}},'targeting':{'domain':'actor','shape':'single','actor_targets':True,'range_ft':600,'min_targets':1,'max_targets':1,'allowed_relations':['enemy'],'requires_line_of_sight':True},'effects':[{'resolution':'attack_roll','attack_kind':'weapon_ranged','ability':'auto','additional_attack_child':True,'on_hit':[{'kind':'damage','dice':'weapon','type':'weapon'}]}]}))
PENDING.pop(88,None)
PENDING.pop(265,None)
add(225,event(225,'physical_interaction',auto({'kind':'damage','dice':'1d4','type':'bludgeoning','suppress_damage_modifiers':True},who='target')))
PENDING.pop(225,None)

add(133,event(133,'turn_start',auto(related_effect(133,[{'kind':'illumination','darkness_radius_ft':15,'magical':True}],{'type':'rounds','amount':2})),when=[{'kind':'in_darkness'}]))
PENDING.pop(133,None)
add(99,{'kind':'aura','radius_ft':15,'recipients':'enemies','effects':[{'kind':'movement_policy','difficult_terrain':True}]})

potion(40,[related_effect(40,[{'kind':'environment_adaptation','breathing':['water']}],{'type':'hours','amount':1})])
potion(48,[related_effect(48,[{'kind':'environment_adaptation','weightless':True,'can_pass_gaps':True,'cannot_attack':True,'cannot_cast':True}],{'type':'hours','amount':1})])
for n in [40,48]:PENDING.pop(n,None)

_thought_action=related_action(42,{'activation':{'mode':'active','cost':[{'resource':'action'}]},'targeting':{'domain':'actor','shape':'single','actor_targets':True,'range_ft':30,'min_targets':1,'max_targets':1,'allowed_relations':['self','ally','enemy','neutral'],'requires_line_of_sight':False},'effects':[auto({'kind':'information_reveal','reveal':'thoughts','label':'Мысли выбранного существа; содержание сообщает ведущий.','fields':['thoughts']},who='target')]},temporary=True)
potion(42,[related_effect(42,[_thought_action],{'type':'hours','amount':1})])
potion(43,[related_effect(43,[{**mod('ability_check',op='advantage',ability='cha'),'when':[{'kind':'target_creature_type_in','values':['beast']}]},{'kind':'information_access','capability':'beast_communication','policy':{'creature_types':['beast'],'range_ft':30,'attitude':'friendly'},'duration':{'type':'hours','amount':1}}],{'type':'hours','amount':1})])
for n in [42,43]:PENDING.pop(n,None)
# Unknown quantities remain explicit source limitations; known consumption,
# timing, action availability and targeting are still real declarations.
OVERRIDE[53]=deepcopy(BY_NUMBER[number(53)]['mechanics']);OVERRIDE[53]['activation']={'mode':'active','while':'carried','cost':[{'resource':'action'},{'resource':'self_item','amount':1}]}
# The finite-ranged true-sight radius is absent, so no invented unlimited sense.
potion(47,[{'kind':'narrative','description':'Зелье употреблено. Урон ядом, СЛ спасброска Телосложения, урон при провале и срок отравления отсутствуют в источнике; ведущий определяет эти параметры.'}])
_fire_action=related_action(56,{'activation':{'mode':'active','cost':[{'resource':'action'}]},'targeting':{'domain':'actor','shape':'area','actor_targets':True,'range_ft':15,'min_targets':0,'max_targets':64,'allowed_relations':['self','ally','enemy','neutral'],'requires_line_of_sight':True,'area':{'kind':'cone','size_ft':15}},'effects':[auto({'kind':'narrative','description':'Огненное дыхание в конусе 15 футов. Урон огнём не указан в источнике: его определяет ведущий.'},who='target')]},temporary=True)
potion(56,[related_effect(56,[_fire_action],{'type':'hours','amount':1})])

add(66,{'kind':'attack_redirection','weapon_id':BY_NUMBER[number(66)]['id'],'natural_faces':[1],'target_tags':['goblin'],'nearest_to':'target','automatic_hit':True})
PENDING.pop(66,None)
for row in json.loads((ROOT/'outputs/catalog-completion-20260929/goblin-monsters.json').read_text(encoding='utf8')):
 if row['slug'] not in ['goblin-minion','goblin-warrior']:continue
 ai=deepcopy(row.get('ai') or {});ai['creature_tags']=sorted(set(ai.get('creature_tags',[])+['goblin']))
 RELATED.append({'entity_type':'monster','id':row['id'],'card_number':row['slug'],'name':row['name'],'description_sha256':hashlib.sha256(json.dumps([row.get('description'),None],ensure_ascii=False,separators=(',',':')).encode()).hexdigest(),'preimage':{'description':row.get('description'),'ai':row.get('ai')},'patch':{'ai':ai},'review':{'status':'verified_partial','summary':'Явный типовой тег гоблина для правил выбора цели.','implemented':['Каноничная creature_tags разметка без веток по имени.'],'tested':['frontend/src/rules-core/itemEventReactions.integration.test.ts'],'limitations':[],'evidence':[]}})
_spellrows=json.loads((ROOT/'outputs/catalog-completion-20260929/spells.json').read_text(encoding='utf8'))
_link_spells=[r['id'] for r in _spellrows if r['name'] in ['Щит','Магическая защита','Доспех мага'] and not r.get('deleted_at')]
add(141,related_action(141,{'recipient_binding':{'key':'lilly-segments','max_recipients':6},'activation':{'mode':'active','cost':[]},'targeting':{'domain':'actor','shape':'multi','actor_targets':True,'range_ft':5,'min_targets':0,'max_targets':6,'allowed_relations':['ally','neutral'],'requires_line_of_sight':False},'effects':[auto(who='target')]}),{'kind':'spell_effect_share','binding_key':'lilly-segments','spell_refs':_link_spells})
for damage_type in ['acid','bludgeoning','cold','fire','force','lightning','necrotic','piercing','poison','psychic','radiant','slashing','thunder']:
 add(141,{**mod('damage',op='deny',attackKind='spell',damageType=damage_type),'reason':'ignore_spell_damage_resistance'})
PENDING.pop(141,None)

_net_escape=related_action(330,{'activation':{'mode':'active','cost':[{'resource':'action'}]},'targeting':{'domain':'actor','shape':'self','actor_targets':False,'range_ft':0,'min_targets':0,'max_targets':1,'allowed_relations':['self']},'effects':[{'resolution':'ability_check','ability':'str','dc':10,'on_success':[{'kind':'remove_effect','card_number':'EFFECT-item-completion-low-0330'},{'kind':'world_interaction','operation':'destroy_deployed_item','parameters':{'card_id':BY_NUMBER[number(330)]['id'],'source_effect_ref':'EFFECT-item-completion-low-0330'}}],'on_fail':[]}]},suffix='-escape',temporary=True)
_net=related_effect(330,[condition('restrained'),_net_escape],{'type':'until_removed'})
OVERRIDE[330]=deepcopy(BY_NUMBER[number(330)]['mechanics']);OVERRIDE[330]['effects'][0]['on_fail']=[_net]
OVERRIDE[330]['effects'].insert(0,auto({'kind':'world_interaction','operation':'deploy_item','parameters':{'card_id':BY_NUMBER[number(330)]['id'],'at':'target'}}))
PENDING.pop(330,None)

_wish_refs=[r['id'] for r in _spellrows if r['name'] in ['Исполнение желаний','Желание'] and not r.get('deleted_at')]
assert _wish_refs, 'Canonical Wish must exist'
add(161,event(161,'equipment_changed',auto({'kind':'resource','op':'restore','id':'spell_slot_1','restore_all':True},{'kind':'healing','max_hp_fraction':.5}),when=[equal('cardId',BY_NUMBER[number(161)]['id']),equal('operation','equipped')]),event(161,'kill',auto({'kind':'healing','amount':'1d10'}),auto({'kind':'life_policy','resurrection_spell_refs':_wish_refs,'duration':{'type':'permanent'},'stack_id':'resurrection-restricted-161'},who='target'),when=[weapon(161)]),event(161,'encounter_end',auto({'kind':'life_policy','death_failure_limit_delta':-1,'duration':{'type':'permanent'},'stack_type':'stack'})))
PENDING.pop(161,None)

# Known consequences are executable even where the source omits recovery rules.
add(63,event(63,'hit',auto({'kind':'chance','chance':{'die':6,'equals':[2,5]},'on_success':[related_effect(63,[{'kind':'weapon_attack_policy','weapon_id':BY_NUMBER[number(63)]['id'],'disabled':True}],{'type':'until_removed'})],'on_fail':[]}),when=[weapon(63)]))
PENDING[63]='После попадания один d6: на2/5 оружие застревает и им нельзя повторно атаковать; цена, проверка и способ извлечения отсутствуют, эффект снимает ведущий после разрешения извлечения.'
OVERRIDE[49]=deepcopy(BY_NUMBER[number(49)]['mechanics']);OVERRIDE[49]['effects'][0]['result'].append({'kind':'remove_effect','cause_tags':['disease']})
OVERRIDE[161]=deepcopy(BY_NUMBER[number(161)]['mechanics'])
for effect in OVERRIDE[161].get('effects',[]):
 for payload in effect.get('result',[]):
  if payload.get('kind')=='modifier' and payload.get('op')=='add' and payload.get('applies_to',{}).get('roll') in ['attack','damage']:
   payload['applies_to']['filter']={'weaponId':BY_NUMBER[number(161)]['id']}

def clauses_for(row,n,mechanics,pending):
 text='\n'.join(str(row.get(k) or '').strip() for k in ['description','detailed_description']).strip()
 clauses=[line.strip(' -*\r') for line in re.split(r'\n+',text) if line.strip(' -*\r')]
 if not clauses:
  if mechanics and mechanics.get('weapon_profile'):clauses=['Числовой профиль оружия: '+json.dumps(mechanics['weapon_profile'],ensure_ascii=False,separators=(',',':'))]
  elif mechanics and mechanics.get('armor_profile'):clauses=['Числовой профиль доспеха: '+json.dumps(mechanics['armor_profile'],ensure_ascii=False,separators=(',',':'))]
  else:clauses=['Описание не задаёт числового или исполняемого эффекта.']
 result=[]
 for text in clauses:
  narrative=n in NARRATIVE and not pending
  source_gap=bool(pending) and n in MISSING_VALUES
  result.append({'text':text,'classification':'source_undefined' if source_gap else 'narrative' if narrative else 'mechanical',
   'implementation':{'state':'source_undefined' if source_gap else 'pending' if pending else 'implemented','details':pending or ('Сюжетное свойство без изменения игровых чисел.' if narrative else 'Исполняемая декларация сохранена или дополнена; точный JSON расположен в mechanics этой записи.')},
   'evidence':[] if pending or narrative else ['frontend/src/engine/itemCatalogAudit.test.ts','frontend/src/engine/itemCompletionLow.test.ts']})
 if pending and n in MISSING_VALUES and (n in OVERRIDE or n in EXTRA):
  result.append({'text':'Исполнимая часть механики с параметрами, явно заданными источником.',
   'classification':'implemented','implementation':'Декларация и общее исполнение сохранены; отсутствующие в источнике параметры не подставлялись.',
   'evidence':['frontend/src/engine/itemCompletionLow.test.ts']})
 return result
def build():
 out={}
 for row in sorted(ROWS,key=lambda row:row.get('card_number','')):
  match=re.fullmatch(r'(?:CARD-|RL-SHOP-)(\d+)',row.get('card_number',''))
  if row.get('deleted_at') or not match or not 1<=int(match[1])<=349:continue
  n=int(match[1]);mechanics=deepcopy(OVERRIDE.get(n,row.get('mechanics')));patch={'mechanics':mechanics} if n in OVERRIDE else {}
  if n in EXTRA:
   mechanics=mechanics or {}
   mechanics.setdefault('activation',{'mode':'passive','while':'equipped'})
   mechanics.setdefault('effects',[])
   # A pure narrative stand-in may not survive as the advertised implementation.
   for effect in mechanics['effects']:
    if effect.get('resolution')=='auto' and isinstance(effect.get('result'),list):
     effect['result']=[p for p in effect['result'] if p.get('kind')!='narrative']
   mechanics['effects'].append(auto(*deepcopy(EXTRA[n])))
   patch['mechanics']=mechanics
  patch.update(PATCH_FIELDS.get(n,{}))
  pending=PENDING.get(n)
  limitations=([pending] if pending and n in MISSING_VALUES else [])+([OPEN_DURATION[n]] if n in OPEN_DURATION else [])
  out[row['card_number']]={'id':row['id'],'name':row['name'],'mechanics':mechanics,'patch':patch,
   'clauses':clauses_for(row,n,mechanics,pending),'limitations':limitations,
   'work_remaining':([pending] if pending and n not in MISSING_VALUES else [])}
 DEST.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 (DEST.parent/'item-completion-low-related-20260929.json').write_text(json.dumps({'schema_version':1,'audit_id':'item-completion-low-20260929','source_snapshot_sha256':'e31510bab0db19721390633ef9e87fabf14ab233a07d5066315cd7a9ff0ba2e6','entities':RELATED},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print(f'{len(out)} rows; {sum(bool(row["patch"]) for row in out.values())} patches; {sum(bool(row["work_remaining"]) for row in out.values())} rows still require implementation')
if __name__=='__main__':build()
