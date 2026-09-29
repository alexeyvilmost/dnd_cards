"""Author the middle catalog from its fresh immutable snapshot; never writes DB/278."""
from pathlib import Path
import copy, hashlib, json, re, uuid

ROOT=Path(__file__).resolve().parents[2]
SNAP=ROOT/'outputs/catalog-completion-20260929'
OUT=ROOT/'scripts/content/data/item-completion-middle-20260929.json'
RELATED=ROOT/'scripts/content/data/item-completion-middle-related-20260929.json'
CARDS={r['card_number']:r for r in json.loads((SNAP/'cards.json').read_text(encoding='utf-8')) if not r['deleted_at']}
SPELLS={r['card_number']:r for r in json.loads((SNAP/'spells.json').read_text(encoding='utf-8')) if not r['deleted_at']}
EFFECTS={r['card_number']:r for r in json.loads((SNAP/'effects.json').read_text(encoding='utf-8')) if not r['deleted_at']}
ACTIONS={r['card_number']:r for r in json.loads((SNAP/'actions.json').read_text(encoding='utf-8')) if not r['deleted_at']}
RECORDS={}
ENTITIES=[]

def card(n):return CARDS[f'CARD-{n:04}']
def auto(payloads,who=None):return {'resolution':'auto',**({'who':who} if who else {}),'result':payloads}
def modifier(roll,op='add',value=None,**extra):return {'kind':'modifier','op':op,'applies_to':{'roll':roll},**({'value':value} if value is not None else {}),**extra}
def eq(key,value):return {'kind':'event_data_equals','key':key,'value':value}
def duration(kind,amount=None):return {'type':kind,**({'amount':amount} if amount is not None else {})}
def condition(value,dur=None):return {'kind':'condition','op':'apply','value':value,**({'duration':dur} if dur else {})}
def trigger(n,event,effects,when=None,uses=None):
 return {'kind':'triggered_effect','id':f'item-completion:{n}:{event}','event':event,'subject':'self','duration':duration('while_active'),'effects':effects,**({'circumstances':when} if when else {}),**({'uses':uses} if uses else {})}

NARRATIVE={385,386,387,389,390,391,392,393,394,395,396,397,399,400,401,402,404,405,406,408,410,412,495,496,499,505,508,511,512,513,515,516,518,529,530,539,550,552,562,605,606,686,687,688,689,690,691,692,693,694,695,697,698,699}
COMPLETE={350,351,357,358,359,360,361,363,367,370,371,377,383,398,403,407,409,411,414,417,418,429,432,445,446,448,453,455,457,458,459,460,461,465,466,467,468,469,470,472,474,476,483,485,487,488,490,491,492,493,494,520,523,527,537,538,543,544,546,547,548,549,554,557,558,564,565,566,567,568,569,570,571,572,575,577,581,582,583,584,585,586,587,591,592,593,594,598,600,604,608,609,610,611,612,613,614,615,616,617,618,619,620,623,624,625,626,628,629,633,634,635,636,637,638,640,646,647,648,649,650,651,652,653,654,655,656,657,658,660,661,662,665,666,667,668,670,671,682}

def record(n):
 key=f'CARD-{n:04}'
 if key not in RECORDS:
  row=card(n)
  parts=[line.strip() for line in re.split(r'\n+',row.get('description') or '') if line.strip()]
  if row.get('detailed_description'):parts.append(row['detailed_description'])
  state='narrative' if n in NARRATIVE else 'implemented' if n in COMPLETE else 'pending'
  RECORDS[key]={'mechanics':copy.deepcopy(row.get('mechanics')),'patch':{},'clauses':[{'text':text,'classification':state,'implementation':'Декларации актуального каталога.' if state=='implemented' else 'Повествовательное применение.' if state=='narrative' else '', 'evidence':['frontend/src/engine/itemCatalogAudit.test.ts'] if state=='implemented' else []} for text in parts], 'limitations':[]}
  if not parts or parts==['Описание эффекта']:
   RECORDS[key]['clauses']=[{'text':'Описание эффекта отсутствует.' if not parts else parts[0],'classification':'unspecified','implementation':'Сохранены базовые параметры предмета; дополнительных правил в описании нет.','evidence':[]}]
 return RECORDS[key]

def declare(n,payloads,replace=False):
 r=record(n);m=r['mechanics'] or {}
 m['activation']={'mode':'passive','while':'equipped' if card(n).get('slot') else 'carried'}
 if replace:m['effects']=[]
 m.setdefault('effects',[]).append(auto(payloads))
 r['mechanics']=m

def evidence(n,needle,implementation,paths):
 r=record(n)
 for clause in r['clauses']:
  if needle is None or needle.lower() in clause['text'].lower():clause.update(classification='implemented',implementation=implementation,evidence=paths)

def action(n,label,mechanics,suffix=''):
 row=card(n);ref=f'ACT-item-completion-{n:04}{suffix}'
 identity=str(uuid.uuid5(uuid.NAMESPACE_URL,'catalog-completion-20260929/'+ref))
 activation=mechanics.setdefault('activation',{'mode':'active','cost':[]})
 mechanics['requires_item_source']=row['id']
 mechanics.setdefault('targeting',{'shape':'self','domain':'actor','range_ft':0,'min_targets':0,'max_targets':1,'actor_targets':False,'allowed_relations':['self'],'requires_line_of_sight':False})
 patch={'id':identity,'card_number':ref,'name':row['name']+' — '+label,'name_en':None,'description':row['description'],'detailed_description':row['detailed_description'],'rarity':row['rarity'],'type':'other','action_type':'base_action','resource':next((x['resource'] for x in activation.get('cost',[]) if x['resource'] in ['action','bonus_action','reaction']),'free_action'),'author':'System','source':'Catalog completion 2026-09-29','mechanics':mechanics,'deleted_at':None}
 ENTITIES.append({'entity_type':'action','id':identity,'card_number':ref,'name':patch['name'],'description_sha256':hashlib.sha256(json.dumps([row['description'],row['detailed_description']],ensure_ascii=False,separators=(',',':')).encode()).hexdigest(),'preimage':None,'patch':patch})
 declare(n,[{'kind':'grant_action','value':ref}])
 return ref

def effect(n,label,payloads,suffix=''):
 row=card(n);ref=f'EFFECT-item-completion-{n:04}{suffix}';identity=str(uuid.uuid5(uuid.NAMESPACE_URL,'catalog-completion-20260929/'+ref))
 patch={'id':identity,'card_number':ref,'name':row['name']+' — '+label,'name_en':None,'description':row['description'],'detailed_description':row['detailed_description'],'rarity':row['rarity'],'effect_type':'item_effect','repeatable':False,'author':'System','source':'Catalog completion 2026-09-29','mechanics':{'activation':{'mode':'passive'},'effects':[auto(payloads)]},'deleted_at':None}
 ENTITIES.append({'entity_type':'effect','id':identity,'card_number':ref,'preimage':None,'patch':patch})
 return ref

def pool(n,count,recharge='long_rest'):
 ref=f'item_completion_{n}';identity=str(uuid.uuid5(uuid.NAMESPACE_URL,'catalog-completion-20260929/'+ref))
 ENTITIES.append({'entity_type':'resource','id':identity,'preimage':None,'patch':{'id':identity,'resource_id':ref,'name':card(n)['name']+' — заряды','description':card(n)['description'],'category':'character_resource','recharge':recharge,'sort_order':200,'author':'System','deleted_at':None}})
 declare(n,[{'kind':'resource','op':'grant','id':ref,'amount':count}]);return ref

def active(cost='action',uses=None):
 return {'activation':{'mode':'active','cost':[{'resource':cost}] if cost else []},**({'uses':uses} if uses else {})}

def target(range=5,relations=['ally','self'],max=1,min=1):
 return {'shape':'single','domain':'actor','range_ft':range,'min_targets':min,'max_targets':max,'actor_targets':True,'allowed_relations':relations,'requires_line_of_sight':True}

def remove_narrative(n):
 m=record(n)['mechanics']
 for e in (m or {}).get('effects',[]):
  if 'result' in e:e['result']=[p for p in e['result'] if p.get('kind')!='narrative']

def gap(n,needle,why):
 r=record(n);r['limitations'].append(why)
 for c in r['clauses']:
  if needle is None or needle.lower() in c['text'].lower():c.update(classification='unspecified',implementation=why,evidence=[])


def build():
 for key in sorted(CARDS):
  match=re.fullmatch(r'CARD-(\d+)',key)
  if match and 350<=int(match[1])<=699:record(int(match[1]))
 perfume_effect=EFFECTS['EFFECT-item-perfume-check']
 perfume_mechanics={**modifier('ability_check','advantage',applies_to={'roll':'ability_check','filter':{'skill':'persuasion'}}),
  'when':[{'kind':'target_creature_type_in','values':['humanoid']},{'kind':'target_relation_in','values':['neutral']}],
  'duration':duration('hours',1)}
 ENTITIES.append({'entity_type':'effect','id':perfume_effect['id'],'card_number':perfume_effect['card_number'],
  'preimage':{'mechanics':perfume_effect['mechanics']},'patch':{'mechanics':perfume_mechanics}})
 perfume=record(696)['mechanics'];perfume['activation']={'mode':'active','while':'carried','cost':[{'resource':'action'}]}
 perfume['effects']=[auto([{'kind':'grant_effect','value':perfume_effect['card_number'],'duration':duration('hours',1)}],'self')]
 record(696)['mechanics']=perfume
 evidence(696,None,'Действие наносит на владельца эффект на час; преимущество Убеждения действует только против гуманоида с нейтральным отношением, без расхода на первом броске.', ['frontend/src/engine/itemPerfume.test.ts'])
 deck=active(None);deck['targeting']=target(5,['ally','enemy','neutral']);deck['effects']=[{'resolution':'ability_check','who':'target',
  'ability':'int','skill':'investigation','dc':12,'on_success':[{'kind':'information_reveal','reveal':'marked_cards_fraud','fields':['cheating_detected']}]}]
 action(413,'Заметить краплёную колоду',deck)
 evidence(413,None,'Наблюдатель, а не владелец колоды, проходит каноничную проверку Интеллекта (Расследование) СЛ12; на успехе результат раскрывается и сохраняется в журнале.', ['frontend/src/engine/itemObserverCheck.test.ts'])
 roll_tests=['frontend/src/engine/itemCompletionRolls.test.ts']
 declare(449,[{'kind':'item_failure_policy','card_id':card(702)['id'],'break_after_failures':2}],True)
 evidence(449,None,'Первый окончательный провал действия воровских инструментов сохраняет повреждение вместо списания; второй списывает один комплект и очищает его счётчик. Число провалов переживает загрузку, улучшение проваленного броска предшествует повреждению.',['frontend/src/rules-core/itemTools.integration.test.ts','frontend/src/rules-core/itemFailureCost.integration.test.ts'])
 charge=pool(674,1,'encounter');record(674)['mechanics']['effects'][0]['result'][0]['recharge']='encounter'
 evidence(674,None,'Экипированный кулон предоставляет отдельный пул «Блок» с максимумом 1 и восстановлением при начале встречи; расход сохраняется и повторная загрузка не пополняет заряд.',['frontend/src/character/itemResourceCapacity.test.ts'])
 gap(674,'§НЕСОВПАДЕНИЕ§','Источник не определяет, что делает «Блок»: нет описания его активации, стоимости, продолжительности и результата; в каноничном каталоге такого правила не найдено.')
 record(674)['clauses'].append({'text':'Правило применения заряда «Блок».','classification':'underspecified','implementation':record(674)['limitations'][-1],'evidence':[]})
 declare(507,[{**modifier('attack','add',1,when=[{'kind':'target_nearby_enemies','range_ft':5,'min':1}]),'applies_to':{'roll':'attack','filter':{'weaponId':card(507)['id']}}},
  {'kind':'damage_rider','trigger':'hit_by_attack_roll','dice':'1d4','type':'slashing','filter':{'weaponId':card(507)['id'],'attackFromBehind':True},'duration':duration('while_active')}])
 evidence(507,None,'Бонус атаки проверяет врагов цели в 5 фт по фактическим позициям. Дополнительная к4 рубящего урона применяется только при атаке этим скимитаром сзади относительно сохранённого направления цели; при крите удваивается. Направление задаётся на карте, движением и собственной атакой, сохраняется после загрузки; полученная атака цель не разворачивает.',['frontend/src/solo-combat/itemTraversal.test.ts'])
 record(507)['limitations'].append('«Рядом» трактуется как 5 фт; враг определяется относительно цели, включая атакующего, поскольку слово «другой» отсутствует. «Со спины» — задняя полуплоскость явно заданного направления; неизвестное направление не предоставляет бонус.')
 declare(419,[modifier('d20','advantage_dice',3)],True)
 evidence(419,None,'При преимуществе/помехе бросаются три кости; выбирается наибольшая/наименьшая, отброшенные сохраняются.',roll_tests)
 declare(420,[modifier('attack','deny_critical'),modifier('attack','deny_critical',scope='target')],True)
 evidence(420,None,'Запрет крита применяется к собственным атакам и проецируется на атаки по носителю.',roll_tests+['frontend/src/engine/itemCompletionEvents.test.ts'])
 for n in [425,426]:
  declare(n,[modifier('damage','critical_extra_die',1,faces=20)])
  evidence(n,'1к20','Отдельная к20 добавляется после удвоения основных костей критического урона.',roll_tests)
 declare(426,[modifier('attack','deny_critical',scope='target')])
 evidence(426,'По вам','Проецируемый запрет критического урона.',roll_tests)
 for n,to in [(433,'bonus_action'),(434,'free_action')]:
  declare(n,[{'kind':'action_cost_policy','id':f'item-cost-{n}','match':{'costs_resource':'wild_shape'},'replace':{'action':to},'priority':2 if to=='free_action' else 1}])
  evidence(n,'Дикий облик' if n==434 else 'дикий облик','Общий исполнитель заменяет стоимость действия, сохраняя расход Дикого Облика.',['frontend/src/engine/actionCostPolicy.test.ts'])
 for n,payloads in [(436,[modifier('attack',value=2),modifier('damage',value=2)]),(437,[modifier('attack','advantage'),modifier('attack','crit_range',-1)])]:
  declare(n,[{**p,'when':[{'kind':'you_have_effect_stack','value':'wild_shape_form'}]} for p in payloads],True)
  evidence(n,None,'Пассивы применяются только пока активен каноничный stack wild_shape_form.',['frontend/src/engine/circumstances.test.ts'])
 declare(439,[{'kind':'damage_rider','trigger':'hit_by_attack_roll','dice':'1d6','type':'necrotic','filter':{'weaponId':card(439)['id']},'when':[{'kind':'hp_fraction_below','value':.5}],'duration':duration('permanent')}])
 for n in [519,602]:
  declare(n,[modifier('movement_cost','set',1,applies_to={'roll':'movement_cost','filter':{'terrain':'difficult'}})])
  evidence(n,'Труднопроходим','Декларация стоимости труднопроходимой местности = обычной стоимости.',['frontend/src/engine/itemCatalogAudit.test.ts'])
 declare(675,[modifier('d20','advantage'),modifier('attack','disadvantage',scope='target')],True)
 evidence(675,None,'Постоянные эффекты Предвидения: все тесты к20 с преимуществом, входящие атаки с помехой.',roll_tests+['frontend/src/engine/itemCompletionEvents.test.ts'])
 for n in [422,553,559,663,664]:
  if n==422:payload=trigger(n,'crit',[{'resolution':'save','who':'target','ability':'con','dc':16,'on_fail':[condition('prone')],'on_success':[]}])
  elif n==553:payload=trigger(n,'hit',[auto([condition('bleeding')],'target')],[eq('weaponId',card(n)['id'])])
  elif n==559:payload=trigger(n,'kill',[auto([{'kind':'resource','op':'restore','id':'action','amount':1}],'self')],uses={'count':1,'per':'turn'})
  elif n==663:payload=trigger(n,'crit',[auto([condition('paralyzed',duration('until_end_of_source_next_turn'))],'target')],[eq('targetCreatureType','humanoid')],{'count':1,'per':'day'})
  else:payload=trigger(n,'kill',[auto([{'kind':'resource','op':'restore','id':'spell_slot_1','amount':1}],'self')],[eq('weaponId',card(n)['id'])],{'count':1,'per':'turn'})
  declare(n,[payload])

 # Content-owned passives and action declarations share the normal interpreter.
 declare(352,[{'kind':'modifier','op':'set','value':'dex','applies_to':{'stat':'medium_armor_dex_cap'}}])
 evidence(352,'полный','КД среднего доспеха учитывает полный модификатор Ловкости; помеха Скрытности сохранена.',['frontend/src/engine/generalFeatArmorRuntime.test.ts'])
 remove_narrative(352)
 for n,faces in [(372,4),(373,6),(374,8),(375,10),(376,12)]:
  declare(n,[modifier('d20','die_bonus',1,applies_to={'roll':'d20','die':faces})])
  evidence(n,None,'Бонус каждой кости указанного размера учитывается в уроне, лечении и дополнительных костях тестов к20.',roll_tests)
 # Universal luck already had a flat +1 to d20: replace it with the die rule to avoid doubling.
 r=record(384)
 for e in r['mechanics']['effects']:
  e['result']=[p for p in e.get('result',[]) if not(p.get('kind')=='modifier' and p.get('op')=='add' and p.get('applies_to',{}).get('roll') in ['attack','saving_throw','ability_check'])]
 declare(384,[modifier('d20','die_bonus',1)])
 evidence(384,None,'+1 к каждой основной и дополнительной кости, без повторного плоского бонуса.',roll_tests)
 for original,replacement in [('action','bonus_action'),('bonus_action','action')]:
  declare(378,[{'kind':'action_cost_policy','id':f'item-cost-378-{original}','match':{'costs_resource':original},'replace':{original:replacement},'optional':True}])
 evidence(378,'использовать','В момент объявления действия можно выбрать замену действия на бонусное или обратно.',['frontend/src/rules-core/actionCostPolicy.integration.test.ts'])
 time_action=ACTIONS['ACT-item-influence-0378']
 time_mechanics=copy.deepcopy(time_action['mechanics'])
 time_influence=time_mechanics['effects'][0]['result'][0]
 time_influence['operation']='reroll_roll'
 time_influence['eligible_rolls']=['attack','save','check','damage','healing','other']
 ENTITIES.append({'entity_type':'action','id':time_action['id'],'card_number':time_action['card_number'],
  'patch':{'mechanics':time_mechanics}})
 evidence(378,'перебросить','Для удержанного броска действия или спасброска реакция после оплаты повторяет все неотброшенные кости и продолжает исходную команду один раз.',['frontend/src/solo-combat/d20Interrupt.integration.test.ts'])
 record(378)['limitations'].append('Переброс охватывает броски каноничного действия, решения спасброска и спасброска от смерти; отдельные броски опасностей, перемещения и автоматических событий хода пока не имеют общего сохраняемого продолжения.')
 gap(378,'Вне боя','Для отката на 30 физических секунд нет авторитетных временных меток и снимков мира; правила о судьбе действий других игроков и внешних событий не заданы. Действие отката не предоставляется.')
 gap(378,'(1 раз/короткий отдых)','Расход на короткий отдых относится к откату мира и не может оплачиваться без самого действия отката.')
 for effect_row in record(378)['mechanics']['effects']:
  if 'result' in effect_row:effect_row['result']=[payload for payload in effect_row['result']
   if payload.get('kind')!='narrative' or 'перебросить' not in payload.get('description','')]
 # The item's wording guarantees a surge on every spell cast, unlike the
 # subclass's optional d20 gate.  The source catalog omits the d100 outcome
 # table, so the authoritative die is persisted without inventing effects.
 declare(641,[trigger(641,'spell_cast',[auto([{'kind':'roll_die','sides':100,'label':'Волна дикой магии'}],'self')])])
 gap(641,None,'Таблица результатов Волны дикой магии d100 отсутствует в актуальном каталоге: после обязательного броска эффект соответствующей строки определяет ведущий.')
 record(641)['clauses'].append({'text':'Обязательный бросок d100 при каждом сотворении заклинания.',
  'classification':'implemented','implementation':'Общий слушатель spell_cast исполняет и сохраняет бросок d100 без проверки d20 и без расхода заряда.',
  'evidence':['frontend/src/engine/itemWildMagic.test.ts']})
 declare(382,[modifier(roll,'set_die_result',1) for roll in ['d20','damage','healing']]+[modifier(roll,'set_die_result',1,scope='target') for roll in ['d20','damage']],True)
 evidence(382,'выпадает','Объявленная грань 1 применяется к собственным и направленным против носителя броскам.',roll_tests)
 declare(431,[{'kind':'action_target_limit','healing_spells':True,'add':1},trigger(431,'healing_given',[auto([{'kind':'temp_hp','amount':'event_amount'}],'target')])],True)
 evidence(431,None,'Лечебное заклинание получает дополнительную цель, а каждая фактически исцелённая цель получает столько же временных хитов.',['frontend/src/engine/itemCompletionEvents.test.ts'])
 declare(435,[{'kind':'action_cost_policy','id':'item-cost-435','match':{'concentrating_spell':True},'optional':True,'concentration':False,'duration_cap_rounds':2}],True)
 evidence(435,None,'Сохранённый выбор отменяет концентрацию, ограничивая эффекты заклинания двумя раундами.',['frontend/src/engine/actionCostPolicy.test.ts','frontend/src/rules-core/actionCostPolicy.integration.test.ts'])
 evidence(439,None,'Дополнительная 1к6 некротического урона только этим оружием, когда текущие хиты строго меньше половины максимума.',['frontend/src/engine/circumstances.test.ts'])
 declare(443,[modifier(roll,value=2,applies_to={'roll':roll,'filter':{'weaponId':card(443)['id']}},when=[{'kind':'class_id_in','values':['cleric','paladin']}]) for roll in ['attack','damage']])
 evidence(443,None,'+2 к попаданию и урону только данным оружием для классов cleric/paladin.',['frontend/src/engine/circumstances.test.ts'])
 declare(447,[{'kind':'grant_ability_score','ability':'str','amount':2,'when':[{'kind':'nearby_enemies','min':2,'range_ft':5}]}])
 declare(456,[modifier('spell_save_dc',value=1,when=[{'kind':'nearby_enemies','min':1,'range_ft':5}])])
 declare(502,[{'kind':'aura','radius_ft':10,'recipients':'others','effects':[modifier('ac',value=2)]}])
 # The equipment slots, rather than card names, select the conditional benefits.
 for n in [556,560]:
  declare(n,[modifier('ac',value=1,when=[{'kind':'equipment_slot_equals','slot':'off_hand','id':card(n)['id']}])])
  evidence(n,'рук','Бонус КД включается только при удержании предмета в off_hand.',['frontend/src/engine/circumstances.test.ts'])
 record(560)['mechanics']['weapon_profile']['enchantment'].update(attack_bonus=3,damage_bonus=3)
 record(560)['patch']['enchant_bonus']=3
 evidence(560,'Зачарование','Каноничный профиль оружия содержит +3 к попаданию и урону однократно.',['frontend/src/engine/weaponProfile.test.ts'])
 for n in [563,573,574]:evidence(n,None,'Мастерство из weapon_profile исполняется каноничным путём Slow/Sap.',['frontend/src/engine/weaponMastery2024.test.ts'])
 # Exact event facts bind retaliations/rewards to the source attack.
 declare(517,[trigger(517,'kill',[auto([{'kind':'healing','amount':4}],'self')],[eq('weaponId',card(517)['id']),{'kind':'not','of':eq('targetCreatureType','undead')}]),
  {**trigger(517,'kill',[auto([{'kind':'damage','amount':4,'type':'necrotic'}],'self')],[eq('weaponId',card(517)['id']),eq('targetCreatureType','undead')]),'id':'item-completion:517:kill-undead'}])
 declare(522,[trigger(522,'hit',[{'resolution':'save','who':'target','ability':'con','dc':12,'on_fail':[{'kind':'movement','value':'push','distance':5}],'on_success':[]}],[eq('attackKind','unarmed')])])
 # Ordinary bounded action pools also model finite consumable charges (no recovery).
 for n,label,count,per,payloads in [(509,'Сопротивление',3,None,[{'kind':'resistance','value':'resistance','damage_type':t,'duration':duration('until_start_of_next_turn')} for t in ['cold','necrotic']])]:
  uses={'count':count,'per':per or 'never'};m=active('reaction',uses);m['activation']['cost'].append({'resource':'self_uses'});m['effects']=[auto(payloads,'self')];action(n,label,m)
  evidence(n,None,'Реакция тратит один из трёх невосстанавливаемых зарядов и даёт оба сопротивления до начала следующего хода.',['frontend/src/engine/sharedActionUses.test.ts'])
 m=active('bonus_action');m['activation']['counts_as']='dash';m['effects']=[];action(521,'Рывок',m)
 declare(521,[modifier('fall_damage','multiply',.5)])
 evidence(521,'Рывок','Предмет предоставляет обычное действие Рывка со стоимостью bonus_action.',['frontend/src/rules-core/actionCostPolicy.integration.test.ts'])
 m=active('bonus_action',{'count':5,'per':'never'});m['activation']['cost'].append({'resource':'self_uses'});m['targeting']=target()
 m['damage_source_kind']='item';m['formula_bindings']={'healing_roll':'2d4+2'};m['effects']=[auto([{'kind':'healing','amount':'healing_roll'}],'target'),auto([{'kind':'damage','type':'untyped','amount':'healing_roll/2'}],'self')]
 record(542)['mechanics']=None;action(542,'Кровавое исцеление',m)
 evidence(542,None,'Один сохранённый бросок 2к4+2 лечит цель; половина того же значения наносится владельцу. Бонусное действие и один из пяти конечных зарядов.',['frontend/src/engine/itemCompletionEvents.test.ts'])
 m=active('bonus_action');m['targeting']=target(5,['enemy','neutral']);m['effects']=[{'resolution':'attack_roll','vs':'ac','ability':'str','attack_kind':'unarmed','on_hit':[{'kind':'damage','type':'bludgeoning','dice':'3d10'}]}];action(603,'Удар ногой',m)
 evidence(603,'Бонусным','Отдельная атака ногой использует каноничный бросок атаки и наносит 3к10 при попадании.',['frontend/src/engine/itemCompletionEvents.test.ts'])
 # A shared resource makes every slot-level choice spend the same daily charge.
 charge=pool(669,1)
 for level in range(1,10):
  m=active('bonus_action');m['activation']['cost'].append({'resource':charge});m['effects']=[auto([{'kind':'resource','op':'restore','id':f'spell_slot_{level}','amount':1}],'self')]
  action(669,f'Восстановить ячейку {level}',m,f'-slot-{level}')
 evidence(669,None,'Выбор уровня представлен каноничными действиями с общим дневным зарядом; восстановление ограничено максимумом соответствующего ресурса.',['frontend/src/engine/itemCost.test.ts'])
 charge=pool(672,2)
 declare(672,[{'kind':'action_cost_policy','id':'item-cost-672','match':{'spell_level':0,'costs_resource':'action'},'replace':{'action':'bonus_action'},'optional':True,'additional_cost':[{'resource':charge,'amount':1}]}])
 evidence(672,None,'Перед заговором предлагается сохранённый выбор бонусного действия с расходом одного из двух дневных зарядов.',['frontend/src/rules-core/actionCostPolicy.integration.test.ts'])
 declare(659,[{'kind':'modifier','op':'deny','applies_to':{'interaction':'opportunity_attack','trigger':'self_movement'},'hp_fraction_at_most':.5}])
 evidence(659,None,'Пока хиты не выше половины максимума, движение не провоцирует внеочередную атаку.',['frontend/src/solo-combat/soloCombat.engine.integration.test.ts'])
 # Rules that lack indispensable numeric parameters stay explicit, while other clauses execute.
 gap(438,None,'Описание не задаёт СЛ спасброска Телосложения; нельзя определить успех удержания без выдуманного значения.')
 gap(441,'промах','Описание не задаёт величину и тип самоурона при промахе. Базовый профиль оружия +3 сохранён.')
 gap(450,None,'Ослепление после урона и СЛ 15 указаны, но длительность ослепления отсутствует; необходимо правило окончания.')
 gap(514,None,'Бонус КД +7 указан, но описание не задаёт длительность защитного эффекта и момент утраты магии.')
 gap(630,None,'«Парировать» не определяет уменьшение урона/бонус КД/автопромах; нельзя однозначно применить эту часть реакции.')

 # Same-die damage, source-specific triggers, and explicit action choices.
 p=trigger(364,'hit',[auto([{'kind':'damage','amount':'shared_damage','type':'slashing'}],'target'),auto([{'kind':'damage','amount':'shared_damage','type':'slashing'}],'self')],[eq('weaponId',card(364)['id'])])
 p['event_formula_bindings']={'shared_damage':'2d6'};declare(364,[p]);remove_narrative(364)
 evidence(364,None,'На попадании этим мечом один бросок 2к6 применяется к цели и владельцу, без повторного броска.',['frontend/src/engine/itemCompletionEvents.test.ts'])
 m=active('bonus_action');m['requires_held_item']=card(354)['id'];m['targeting']={**target(10,['enemy'],99),'shape':'area','area':{'kind':'sphere','size_ft':10}}
 m['effects']=[{'resolution':'attack_roll','vs':'ac','ability':'auto','attack_kind':'weapon_melee','on_hit':[{'kind':'damage','dice':'weapon','type':'weapon','ability':'auto'}]}];action(354,'Круговая атака',m)
 evidence(354,None,'Каноничные атаки удерживаемым оружием по противникам в радиусе 10 фт стоят одно бонусное действие; +3 Ловкости до 24 сохранено.',['frontend/src/rules-core/areaSpellPinnedSemantics.test.ts'])
 for n in [352,368,388,425,426,555]:
  needles={352:'Скрытность',425:'Шанс',426:'Шанс'}
  evidence(n,needles.get(n),'Базовое правило сохранено в декларации: модификатор, профиль оружия или мастерство Nick.',['frontend/src/engine/itemCompletionRolls.test.ts','frontend/src/engine/weaponMastery2024.test.ts'])
 for n in [421,444]:evidence(n,'Скрытност','Узкий модификатор Скрытности включён на надетом предмете.',['frontend/src/engine/itemCatalogAudit.test.ts'])
 evidence(421,'Акробатик','+1 к проверкам Акробатики.',['frontend/src/engine/itemCatalogAudit.test.ts'])
 for n in [381,428]:
  evidence(n,None,'Предоставленное действие изменения броска проходит сохранённый выбор, авторитетную оплату и одноразовое применение.',['frontend/src/engine/itemRollInfluences.test.ts'])
  remove_narrative(n)
 evidence(378,'скорость','Постоянный бонус скорости +10 фт сохраняется.',['frontend/src/engine/itemCatalogAudit.test.ts'])
 # Healing listeners use the actual healed actor, not the source's current selection.
 ward=copy.deepcopy(SPELLS['SPELL-0202']['mechanics']['effects'][0]['result'])
 for payload in ward:
  payload['duration']={'type':'rounds','amount':10,'concentration':False}
 declare(430,[trigger(430,'healing_given',[auto(ward,'target')])])
 evidence(430,None,'После лечения получатель получает эффект Защиты от оружия на 10 раундов без отдельной концентрации.',['frontend/src/engine/itemCompletionEvents.test.ts'])
 m=active('reaction',{'count':2,'per':'encounter'});m['activation'].update(mode='reaction',trigger={'event':'damage_taken','timing':'before'});m['activation']['cost'].append({'resource':'self_uses'})
 m['effects']=[auto([{'kind':'movement','value':'teleport','distance':15}],'self')]
 record(440)['mechanics']=None;action(440,'Ускользнуть после урона',m)
 evidence(440,None,'Предмет предоставляет реакцию на damage_taken с двумя зарядами на бой; движение телепортации ограничено 15 фт.',['frontend/src/engine/itemCompletionEvents.test.ts'])
 declare(444,[trigger(444,'attacked',[auto([{'kind':'damage','amount':1,'type':'slashing'}],'target')])])
 evidence(444,'Атакующие','attacked отправляет один рубящий урон атакующему после его атаки.',['frontend/src/engine/itemCompletionEvents.test.ts'])
 for n,roll in [(454,'jump_distance')]:declare(n,[modifier(roll,value=5)])
 # Shield strike remains an action entity, never a special equipment button.
 m=active('bonus_action');m['requires_held_item']=card(489)['id'];m['targeting']=target(5,['enemy','neutral']);m['effects']=[{'resolution':'attack_roll','vs':'ac','ability':'str','attack_kind':'unarmed','on_hit':[{'kind':'damage','dice':'1d4','type':'bludgeoning','ability':'str'}]}];action(489,'Удар щитом',m)
 evidence(489,None,'Бонусным действием можно выполнить бросок атаки щитом и нанести 1к4 дробящего урона с модификатором Силы.',['frontend/src/engine/itemCompletionEvents.test.ts'])
 m=active('action');m['activation']['requires_attunement_capacity']=1;m['effects']=[auto([{'kind':'resource','op':'restore','id':f'spell_slot_{level}','restore_all':True} for level in range(1,10)]+[{'kind':'attunement_capacity','op':'add','amount':-1,'duration':duration('permanent')}],'self')];action(504,'Восстановить все ячейки',m)
 evidence(504,None,'После проверки доступной ёмкости действие заполняет существующие ячейки и сохраняет отдельную постоянную потерю слота настройки.',['frontend/src/character/attunementCapacity.test.ts'])
 m=active(None,{'count':1,'per':'day'});m['activation'].update(mode='triggered',cost=[{'resource':'self_uses'}]);m['effects']=[auto([{'kind':'roll_influence','operation':'add_modifier','value':0,'bonus_dice':'1d6','eligible_rolls':['attack','save','check'],'timing':'before_roll'}])];action(506,'Божественный совет',m)
 evidence(506,None,'Одно действие влияния +1к6 к выбранному броску, один заряд до рассвета.',['frontend/src/engine/itemRollInfluences.test.ts'])
 m=active(None,{'count':5,'per':'never'});m['activation']['cost']=[{'resource':'self_uses'}];m['effects']=[auto([modifier('initiative','advantage',consume='next',duration=duration('permanent'))],'self')];action(510,'Выпить порцию кофе',m)
 evidence(510,None,'Каждая из пяти конечных порций предоставляет расходуемое преимущество на следующий бросок инициативы.',['frontend/src/engine/boons.test.ts'])
 for n in [517,522,559,663,664]:evidence(n,None,'Событие исполняет описанные последствия с указанными проверкой/частотой и принадлежностью оружию.',['frontend/src/engine/itemCompletionEvents.test.ts','frontend/src/engine/eventOccurrence.test.ts'])
 declare(526,[modifier('damage',value=1,when=[{'kind':'target_unarmored'}])])
 evidence(526,None,'Бонус урона действует только при подтверждённом отсутствии доспеха у цели.',['frontend/src/engine/itemCircumstances.test.ts'])
 # Secondary damage carries an explicit event marker to avoid self-recursion.
 for n,types,dice in [(531,['fire'],'1d4'),(632,['bludgeoning','piercing','slashing'],'1d6')]:
  for damage_type in types:
   p=trigger(n,'damage_dealt',[auto([{'kind':'damage','dice':dice,'type':damage_type}],'target')],[eq('damageType',damage_type),{'kind':'not','of':eq('secondary_source',True)}]);p['id']+=f':{damage_type}';declare(n,[p])
  evidence(n,None,'Дополнительный урон совпадает с исходным типом, а вторичные последствия не запускают самих себя.',['frontend/src/engine/itemCompletionEvents.test.ts'])
 declare(536,[condition('blinded'),condition('frightened')])
 evidence(536,'ослеплены','Активное слепое состояние берётся из данных предмета.',['frontend/src/rules-core/conditions2024.integration.test.ts'])
 evidence(536,'испуганы','Активное испуганное состояние берётся из данных предмета.',['frontend/src/rules-core/conditions2024.integration.test.ts'])
 declare(621,[modifier('ability_check','bonus_die',faces=4,when=[{'kind':'you_transformed_or_disguised'}])])
 evidence(621,None,'+1к4 к проверкам только при активном облике или каноничной маскировке.',['frontend/src/engine/itemCircumstances.test.ts'])
 for roll in ['attack','damage']:declare(631,[modifier(roll,value=2,when=[{'kind':'you_are_hidden'}])])
 evidence(631,None,'+2 к попаданию и урону применяется из состояния Hide, а не любой невидимости.',['frontend/src/engine/itemCircumstances.test.ts'])
 declare(639,[trigger(639,'kill',[auto([modifier('attack','critical_on_hit',consume='next',duration=duration('permanent'))],'self')],uses={'count':1,'per':'day'})])
 evidence(639,None,'Первое убийство за день даёт расходуемое превращение попадания следующей атаки в критическое.',['frontend/src/engine/itemCompletionRolls.test.ts'])
 declare(682,[trigger(682,'healing_given',[auto([{'kind':'resource','op':'restore','id':'spell_slot_1','amount':1}],'target')],[{'kind':'event_data_number','key':'spellLevel','min':1}])])
 evidence(682,None,'Лечение заклинанием 1+ уровня восстанавливает получателю одну ячейку 1-го уровня в пределах его максимума; +1 Мудрости сохранено.',['frontend/src/engine/itemCompletionEvents.test.ts'])
 # Source literals without another game rule are narrative; retain them verbatim.
 for n in [353,378,382,536,597,602,603]:
  for c in record(n)['clauses']:
   if c['text']==card(n).get('detailed_description') or c['text']=='Вы видите неведомое.' or c['text']=='Вы левитируете в 10 дюймах над землёй.':c.update(classification='narrative',implementation='Художественное описание предмета.',evidence=[])
 for n in [597,602,603]:
  for c in record(n)['clauses']:
   if c['classification']=='pending' and any(x in c['text'] for x in ['Защите','Защита','Телосложение +2','Сила и','Скорость перемещения','Спасброски ТЕЛ','скоростью полёта','устойчивость к физическому']):c.update(classification='implemented',implementation='Сохранён соответствующий постоянный модификатор/тип скорости из актуальной механики.',evidence=['frontend/src/engine/itemCatalogAudit.test.ts'])
 for n in [500]:gap(n,None,'Не определены конкретный бросок, требуемый успех и игровая цена потерянного воспоминания; эффект нельзя выразить однозначным числовым правилом.')

 for n in [602,603]:
  declare(n,[{'kind':'movement_policy','forced_movement':'immune'}])
  evidence(n,'сдвин','Общий movement_policy запрещает перемещение против воли, в том числе толчок.',['frontend/src/solo-combat/itemTraversal.test.ts'])
 for n in [423]:
  declare(n,[modifier('attack','reroll',natural={'min':1,'max':5},once_per_turn='item:423')])
  evidence(n,None,'При первой подходящей к20 автоматически выполняется один переброс; факт использования сохраняется на текущий ход.',['frontend/src/engine/itemCompletionRolls.test.ts'])
 for n,label,amount,cost,count,period in [(473,'Отклонить выстрел','1d10+5',None,1,'short_rest'),(535,'Принять удар','1d10+5','reaction',1,'day'),(601,'Невероятное уклонение','floor(incoming_damage/2)','reaction',6,'day')]:
  m=active(cost,{'count':count,'per':period});m['activation'].update(mode='reaction',trigger={'event':'damage_taken','timing':'before','circumstances':[]});m['activation']['cost'].append({'resource':'self_uses'})
  if n==473:m['activation']['trigger']['circumstances']=[eq('delivery','attack'),eq('attackRange','ranged')]
  if n==601:
   m['activation']['trigger']['circumstances']=[eq('delivery','attack'),eq('source_visible',True)]
   m['uses']['pool']='item-completion-601'
   m['uses']['recovery']={'short_rest':{'mode':'none'},'long_rest':{'mode':'dice','dice':'1d6'}}
  m['effects']=[auto([{'kind':'reduce_damage','amount':amount}],'self')]
  if n==535:
   m['effects'][0]['result'].append({'kind':'triggered_effect','id':'item:535:next-turn','event':'turn_start','subject':'self','uses':{'count':1,'per':'turn'},'duration':duration('until_end_of_source_next_turn'),'effects':[auto([modifier('speed','set',0,duration=duration('until_end_of_turn'))],'self')]})
  if n==535:record(n)['mechanics']=None
  action(n,label,m)
  if n!=601:evidence(n,None,'Сохранённое решение до применения урона уменьшает фактический урон, повторная команда не бросает кости и не тратит заряд снова.',['frontend/src/rules-core/damageReaction.integration.test.ts'])
  else:evidence(n,'заряд','Шесть зарядов общего пула; при дневном восстановлении бросается 1к6 с ограничением максимумом.',['frontend/src/engine/itemChargeRecovery.test.ts'])
 for e in record(599)['mechanics']['effects']:
  for p in e.get('result',[]):
   if p.get('kind')=='grant_spell':p['freeuse']['recovery']={'short_rest':{'mode':'none'},'long_rest':{'mode':'dice','dice':'1d6'}}
 evidence(599,None,'Бесплатный Туманный шаг тратит один из шести зарядов; восстановление ограничено выпавшей к6 и максимумом.',['frontend/src/engine/itemChargeRecovery.test.ts'])
 declare(353,[{'kind':'grant_spell','value':'sunbeam','freeuse':{'count':1,'recharge':'day'}}])
 evidence(353,'Солнечный','Каноничный Солнечный луч предоставлен с одним бесплатным использованием в день.',['frontend/src/character/itemSpellGrants.test.ts'])

 p=trigger(353,'reduced_to_0_hp',[auto([{'kind':'healing','amount':'burst'},{'kind':'area_healing','amount':'burst','radius_ft':60,'recipients':'allies'}],'self')],uses={'count':1,'per':'long_rest'})
 p['event_formula_bindings']={'burst':'2d6+3'};declare(353,[p])
 evidence(353,'хиты опускаются','При 0 хитов одно восстановление 2к6+3 применяется себе и союзникам в 60 фт до потери сознания.',['frontend/src/rules-core/damageReaction.integration.test.ts'])
 evidence(353,'долгого отдыха','Использование события ограничено одним применением до долгого отдыха.',['frontend/src/rules-core/damageReaction.integration.test.ts'])
 declare(642,[{'kind':'life_policy','on_death':{'rest':'long','cost':[{'resource':'item','card_id':card(642)['id'],'amount':1,'bound_self_item':True}]}}])
 evidence(642,None,'Смерть вызывает полное восстановление по правилам долгого отдыха и единожды расходует кольцо.',['frontend/src/rules-core/damageReaction.integration.test.ts'])
 m=active(None);m['effects']=[];m['active_slot_recovery']={'charge_resource':'magic_recovery_charge','kind':'slot_recovery','decision_type':'arcane_recovery','rest':'short_rest','capability_id':'arcane_recovery','level_source':{'kind':'class_level','class_id':'wizard','minimum':1,'maximum':20},'budget':{'mode':'ceil_divide_level','divisor':2},'slot_resource':{'prefix':'spell_slot_','minimum_level':1,'maximum_level':5,'restore_amount':1},'maximum_per_rest':1}
 action(451,'Магическое восстановление',m)
 evidence(451,None,'Предмет выдаёт дополнительную единицу восстановления и действие выбора ячеек в бою. Выбор и расход используют общий примитив с отдыхом и сохраняются в снимке.',['frontend/src/rules-core/activeSlotRecovery.integration.test.ts'])
 declare(416,[{'kind':'save_reflection','on_total':'dc'}])
 evidence(416,None,'Сохранены +3 к спасброскам; точное равенство итогового спасброска СЛ отражает эффект провала на источник без нового расхода.',['frontend/src/rules-core/damageReaction.integration.test.ts'])
 for n,contents in [(409,[(816,1),(820,1),(814,5),(812,1)]),(415,[(813,1),(703,1),(846,1),(820,1),(823,10),(812,10),(718,1),(706,1)])]:
  record(n)['patch'].update(container_mode='all',contents=[{'card_id':card(ref)['id'],'quantity':qty} for ref,qty in contents]);record(n)['mechanics']=None
  evidence(n,None,'Каноничная распаковка выдаёт весь объявленный состав и расходует контейнер.',['frontend/src/character/actionSheetContainer.test.ts'])
 evidence(685,None,'Сохранён mode=choice с девятью конкретными инструментами: общий picker выдаёт один выбранный предмет и расходует мешок.',['frontend/src/character/actionSheetContainer.test.ts'])
 for n,why in [(447,'Динамическая проекция Силы по соседним врагам.'),(456,'Условный модификатор КС заклинаний по соседнему врагу.'),(502,'Аура +2 КД прочим существам в 10 фт.')]:evidence(n,None,why,['frontend/src/solo-combat/combatAuras.test.ts'])
 evidence(454,None,'Постоянные +5 фт скорости и дистанции прыжка исполняются общим live movement path.',['frontend/src/solo-combat/itemTraversal.test.ts'])
 evidence(422,None,'Критический удар открывает спасбросок Телосложения СЛ16 против падения ничком.',['frontend/src/engine/itemCompletionMiddle.test.ts'])
 evidence(521,'паден','Половина урона от падения за счёт модификатора входящего fall_damage.',['frontend/src/engine/itemCatalogAudit.test.ts'])
 for e in record(506)['mechanics'].get('effects',[]):
  for payload in e.get('result',[]):
   if payload.get('kind')=='roll_influence':payload['timing']='before_roll'
 for outcome,amount in [('success','incoming_damage'),('failure','ceil(incoming_damage/2)')]:
  m=active(None,{'count':6,'per':'day','pool':'item-completion-601','recovery':{'short_rest':{'mode':'none'},'long_rest':{'mode':'dice','dice':'1d6'}}})
  m['activation'].update(mode='reaction',trigger={'event':'damage_taken','timing':'before','circumstances':[eq('saveAbility','dex'),eq('saveDamage','half'),eq('saveOutcome',outcome)]});m['activation']['cost'].append({'resource':'self_uses'})
  m['effects']=[auto([{'kind':'reduce_damage','amount':amount}],'self')];action(601,'Увёртливость — '+('успех' if outcome=='success' else 'провал'),m,'-'+outcome)
 evidence(601,None,'Общий пул 6 зарядов обслуживает Невероятное уклонение и Увёртливость: выбор до применения урона, половина при провале DEX, ноль при успехе DEX на половинный урон. Восстанавливается 1к6 зарядов.',['frontend/src/rules-core/saveDamageReaction.integration.test.ts','frontend/src/engine/sharedActionUses.test.ts','frontend/src/engine/itemChargeRecovery.test.ts'])
 m=active(None,{'count':1,'per':'day'});m['activation']['mode']='triggered';m['activation']['cost'].append({'resource':'self_uses'});m['effects']=[auto([{'kind':'roll_influence','operation':'set_die_result','value':1,'eligible_rolls':['attack','save','check'],'eligible_outcomes':['success','hit','crit'],'timing':'after_roll_before_outcome','affects':'any'}])]
 action(382,'Заменить успешный бросок',m)
 evidence(382,None,'Каждая собственная кость принимает значение 1; направленные против носителя d20/damage также единицы. Один успешный d20 в день можно заменить 1 до результата.',['frontend/src/engine/itemCompletionRolls.test.ts','frontend/src/engine/itemBookInfluences.test.ts'])
 declare(673,[{'kind':'choice','id':'weapon-mastery','context':'in_play','prompt':'Выберите оружие для мастерства','count':1,'options':{'source':'weapon'},'apply':{'kind':'weapon_mastery'}}],True)
 evidence(673,None,'Выбор одного типа оружия открывается общим диалогом мастерства, сохраняется по ключу предмета и применяется лишь пока предмет активен; перевыбор доступен при долгом отдыхе.',['frontend/src/character/itemChoices.test.ts'])
 m=active(None);m['activation']['cost']=[{'resource':'item','card_id':card(579)['id'],'amount':1,'bound_self_item':True}];m['effects']=[auto([modifier('damage','add_dice_drop_lowest',extra=2,drop=1,consume='next',duration=duration('permanent'))],'self')]
 action(579,'Применить заряд Эха',m)
 evidence(579,None,'Расход одного предмета создаёт сохранённое усиление следующего броска урона: +2 кости того же размера и исключение одной наименьшей.',['frontend/src/engine/itemCompletionRolls.test.ts','frontend/src/engine/itemExecutionCompletion.test.ts'])
 declare(528,[modifier('damage','explode',natural={'eq':7},limit=1,once_per_turn='item:528',applies_to={'roll':'damage','filter':{'spellId':SPELLS['SPELL-0315']['id']}})])
 evidence(528,None,'Одна натуральная 7 урона Чародейского выброса за ход добавляет кость; его исходные взрывы на 8 и их бюджет сохраняются.',['frontend/src/engine/itemCompletionHooks.test.ts','frontend/src/engine/itemCompletionRolls.test.ts'])
 declare(578,[trigger(578,'condition_applied',[auto([{'kind':'add_item','card_id':card(579)['id'],'qty':1}],'self')])])
 evidence(578,None,'После фактического наложения состояния на другую цель выдаётся один предмет Заряд Эха; иммунитет не выдаёт заряд.',['frontend/src/engine/itemCompletionHooks.test.ts'])
 declare(471,[trigger(471,'forced_save',[auto([{'kind':'damage','dice':'1d4','type':'fire'}],'target')])])
 evidence(471,None,'Сохранено сопротивление огню. Каждая цель, совершившая спасбросок против носителя, получает отдельную 1к4 огня.',['frontend/src/engine/itemCompletionHooks.test.ts'])

 light_tests=['frontend/src/rules-core/itemLight.integration.test.ts']
 for n,bright,dim,daylight in [(353,15,15,True),(355,20,20,False),(532,0,15,False),(562,15,0,False)]:
  declare(n,[{'kind':'illumination','bright_radius_ft':bright,'dim_additional_radius_ft':dim,**({'daylight':True} if daylight else {})}])
  evidence(n,'свет','Радиус света проецируется из активного предмета в реальные проверки видимости карты; стены и тьма учитываются.',light_tests)
 for needle in ['15 футов','30 футов','яркий','тусклый']:evidence(353,needle,'Дневной свет: яркий до 15 фт, тусклый от 15 до 30 фт, видимость пересчитывается при перемещении.',light_tests)
 evidence(355,None,'Сохранён дополнительный урон излучением; постоянный Свет даёт яркий радиус 20 фт и ещё 20 фт тусклого.',light_tests)
 declare(540,[{'kind':'illumination','darkness_radius_ft':15,'magical':True}])
 evidence(540,None,'Магическая тьма радиуса 15 фт перемещается с предметом и исключает обычное и тёмное зрение в реальном targeting.',light_tests)
 declare(607,[{'kind':'damage_rider','trigger':'damage_by_attack_or_spell','duration':duration('while_active'),'dice':'2','type':'radiant','when':[{'kind':'target_illuminated'}]}])
 evidence(607,None,'Дополнительные 2 излучением применяются при актуальном ярком или тусклом освещении цели.',light_tests)
 declare(421,[{'kind':'equipment_policy','cannot_remove':True}])
 evidence(421,None,'Снятие предмета запрещено общим canonical equipment guard.',['frontend/src/engine/itemEquipmentPolicy.test.ts'])
 # A named state with no published numeric rule is still a real removable effect;
 # do not invent damage, a DC, or a duration for it.
 for n,state_name,event,extra_when,turns in [(424,'Кровотечение','crit',[],None),(553,'Кровотечение','hit',[],None),(556,'Охлаждён','attacked',[eq('outcome','miss'),{'kind':'equipment_slot_equals','slot':'off_hand','value':card(556)['id']}],None),(580,'Горение','damage_dealt',[eq('damageType','fire'),eq('secondary_source',False)],2)]:
  ref=effect(n,state_name,[{'kind':'narrative','description':state_name+': именованное состояние из описания предмета.'}],'-state')
  grant={'kind':'grant_effect','value':ref,**({'duration':duration('rounds',turns)} if turns else {})}
  filters=extra_when+([eq('weaponId',card(n)['id'])] if n in [424,553] else [])
  declare(n,[trigger(n,event,[auto([grant],'target')],filters)])
  why='Накладывается отдельный видимый снимаемый эффект '+state_name+('. Эффект истекает через 2 хода.' if turns else '. Длительность в исходнике не задана; эффект снимается явно.')
  evidence(n,None,why,['frontend/src/engine/itemCompletionHooks.test.ts'])
  record(n)['limitations'].append('Исходник называет состояние «'+state_name+'», но не определяет его числовой урон, модификаторы или способ окончания'+(' (кроме длительности 2 хода).' if turns else '.'))
 # Charge count is mechanical even when the information itself needs a GM.
 m=active(None,{'count':3,'per':'never'});m['activation']['cost']=[{'resource':'self_uses'}];m['effects']=[auto([{'kind':'narrative','description':'Узнать об утраченном или забытом по отражению; ответ определяет ведущий.'}],'self')]
 action(530,'Воспоминание',m)
 evidence(530,None,'Действие расходует один из трёх невосстанавливаемых зарядов; содержание полученного воспоминания определяет ведущий.',['frontend/src/engine/sharedActionUses.test.ts'])
 record(530)['limitations'].append('В описании трёх зарядов не указан способ их восстановления; автоматическое восстановление не назначено.')
 declare(462,[{'kind':'spell_projectiles','spell_refs':[SPELLS['SPELL-0174']['id'],'SPELL-0174'],'add':1}])
 evidence(462,None,'Сохранён бесплатный каст 1/день. Общая проекция увеличивает число стрел на одну в picker и каноничном исполнении, включая платные касты и повышение круга.',['frontend/src/rules-core/itemSpellProjectiles.integration.test.ts'])
 declare(503,[{'kind':'grant_spell','value':'SPELL-0245','label':'always_prepared','freeuse':{'count':2,'recharge':'long_rest'}}])
 evidence(503,None,'Предмет даёт каноничное Опознание с двумя бесплатными применениями за долгий отдых и общим world-target исполнителем.',['frontend/src/character/itemSpellGrants.test.ts'])

 declare(427,[{'kind':'weapon_attack_policy','weapon_id':card(427)['id'],'separate_d20_modes':['disadvantage']}])
 m={'activation':{'mode':'triggered','optional':True,'trigger':{'event':'attack_dice_followup','subject':'self','circumstances':[eq('weaponId',card(427)['id'])]},'cost':[{'resource':'equipped_weapon_ammo','amount':1}]},'effects':[{'resolution':'attack_roll','ability':'auto','attack_kind':'weapon_ranged','attack_dice_child':True,'on_hit':[{'kind':'damage','dice':'weapon','type':'weapon','ability':'auto'}]}],'targeting':target(600,['enemy','ally','neutral'])}
 action(427,'Дополнительная стрела помехи',m)
 evidence(427,None,'При помехе каждый d20 становится отдельным обычным выстрелом: второй открывается каноничным действием после окон первого; боеприпас каждого оплачивается отдельно.',['frontend/src/rules-core/itemEventReactions.integration.test.ts'])

 # Missing duration is recorded, while the specified attack, DC and outcome run.
 p=trigger(441,'miss',[auto([{'kind':'damage','dice':'weapon','type':'weapon','ability':'auto'}],'self')],[eq('weaponId',card(441)['id'])]);declare(441,[p])
 evidence(441,None,'Промах своим кинжалом наносит владельцу обычный урон его актуального профиля (кости, характеристика и зачарование), без критического удвоения.',['frontend/src/engine/itemCompletionEvents.test.ts'])
 record(441)['limitations']=['Величина самоурона не расписана отдельно: применяется обычный профиль самого кинжала, что следует из формулировки «наносите урон себе».']
 m=active(None,{'count':1,'per':'short_rest'});m['activation']={'mode':'triggered','optional':True,'cost':[{'resource':'self_uses'}],'trigger':{'event':'damage_taken','timing':'after','circumstances':[eq('delivery','attack')]}}
 m['targeting']=target(1000,['enemy','ally','neutral']);m['targeting']['requires_line_of_sight']=False;m['effects']=[{'resolution':'save','who':'target','ability':'con','dc':15,'on_fail':[condition('blinded',duration('permanent'))],'on_success':[]}];action(450,'Ослепить атакующего',m)
 evidence(450,None,'После урона атакой доступно одно применение до короткого отдыха: атакующий делает CON15, при провале получает Ослепление до явного снятия.',['frontend/src/rules-core/itemEventReactions.integration.test.ts'])
 record(450)['limitations']=['Исходник не задаёт окончание ослепления; эффект остаётся до явного снятия и не получает выдуманный таймер.']
 m=active('reaction',{'count':1,'per':'never'});m['activation'].update(mode='reaction',trigger={'event':'hit_by_attack'});m['activation']['cost'].append({'resource':'self_uses'});m['attack_defense']={'scope':'triggering_attack','ac_bonus':7};m['effects']=[];action(514,'Последний шанс',m)
 evidence(514,None,'Реакция повышает КД на 7 для входящей атаки; единственный невосстанавливаемый заряд расходуется атомарно, предмет остаётся без этой способности.',['frontend/src/rules-core/damageReaction.integration.test.ts'])
 record(514)['limitations']=['Длительность +7 КД в исходнике не названа: реализована защита от входящей атаки, на которую потрачена реакция.']
 m=active('reaction',{'count':1,'per':'day'});m['activation'].update(mode='triggered',optional=True,trigger={'event':'attacked','timing':'after','circumstances':[eq('attackRange','melee')]});m['activation']['cost'].append({'resource':'self_uses'});m['targeting']=target(10,['enemy','ally','neutral']);m['effects']=[{'resolution':'attack_roll','ability':'auto','attack_kind':'weapon_melee','on_hit':[{'kind':'damage','dice':'weapon','type':'weapon','ability':'auto'}]}];action(630,'Контратака',m)
 evidence(630,None,'После входящей ближней атаки доступна контратака удерживаемым оружием за реакцию и один дневной заряд.',['frontend/src/rules-core/itemEventReactions.integration.test.ts'])
 record(630)['limitations']=['Часть «парировать» не задаёт бонус КД, уменьшение урона или автоматический промах; числовая защита не выдумана. Контратака реализована.']
 lethargy=effect(379,'Летаргия',[condition('incapacitated'),modifier('speed','set',0)],'-lethargy')
 haste=effect(379,'Ускорение',[modifier('speed','multiply',2),modifier('ac','add',2),modifier('saving_throw','advantage',applies_to={'roll':'saving_throw','filter':{'ability':'dex'}}),{'kind':'resource','op':'grant','id':'haste_action','amount':1,'recharge':'turn'}, {'kind':'action_cost_policy','id':'item-379-haste','optional':True,'match':{'action_categories':['attack','dash','disengage','hide','utilize']},'replace':{'action':'haste_action'},'max_attacks':1},trigger(379,'turn_end',[auto([{'kind':'grant_effect','value':lethargy,'duration':duration('until_end_of_source_next_turn')}],'self')])],'-haste')
 m=active(None);m['effects']=[auto([{'kind':'grant_effect','value':haste,'duration':duration('until_start_of_next_turn')}],'self')];action(379,'Ускорить время',m)
 evidence(379,None,'Свободное действие даёт удвоенную скорость, +2 КД, преимущество DEX и ограниченное действие Ускорения до следующего хода; конец текущего хода вызывает Летаргию до конца следующего.',['frontend/src/engine/itemCompletionNamedEffects.test.ts','frontend/src/rules-core/actionCostPolicy.integration.test.ts'])

 declare(497,[modifier('saving_throw','add',10,applies_to={'roll':'saving_throw','filter':{'ability':'wis'}},when=[{'kind':'in_open_night_sky'}])])
 evidence(497,None,'+10 к испытаниям Мудрости действует при явных фактах сценария: открытое небо и ночь; отсутствие факта не активирует бонус.',light_tests)
 declare(545,[{'kind':'movement_policy','forced_movement':'immune','when':[{'kind':'near_sea','range_ft':120}]}])
 evidence(545,None,'Запрет принудительного перемещения применяется, если ближайшая объявленная морская/океанская клетка находится не дальше 120 фт; расстояние пересчитывается по позиции.',light_tests+['frontend/src/solo-combat/itemTraversal.test.ts'])
 m=active(None,{'count':1,'per':'turn'});m['activation']['mode']='triggered';m['activation']['cost']=[{'resource':'self_uses'}];m['concentration_preservation']=True;m['effects']=[auto([condition('exhaustion')],'self')];action(595,'Сохранить концентрацию',m)
 evidence(595,None,'После неудачного спасброска концентрация остаётся до выбора. Действие сохраняет её ценой уровня Истощения и одного использования за ход; отказ завершает концентрацию.',['frontend/src/rules-core/itemConcentrationPreservation.integration.test.ts'])
 m=active('bonus_action',{'count':1,'per':'encounter'});m['activation']['cost'].append({'resource':'self_uses'});m['effects']=[auto([{'kind':'movement','value':'additional','distance':15,'traversal':'jump','on_arrival':[{'kind':'area_damage','origin':'self','amount':'2d6','type':'piercing','radius_ft':5,'recipients':'all','exclude_source':True}]}],'self')];action(597,'Прыжок с шипами',m)
 evidence(597,'Бонусным действием','Прыжок до 15 фт проходит по проверенному маршруту с провоцированными атаками. После фактического приземления один бросок 2к6 поражает остальных существ в 5 фт от конечной клетки; цена и применение за бой сохранены.',['frontend/src/solo-combat/itemJumpArrival.integration.test.ts'])
 declare(442,[{'kind':'projectile_reflection','chance':{'die':20,'equals':[20]}}])
 evidence(442,None,'Физический снаряд проверяет 1к20; при 20 исходная атака с сохранённым броском отражается в стрелка, проходят его реакции защиты; цена и боеприпас не повторяются.',['frontend/src/rules-core/itemEventReactions.integration.test.ts'])
 m=active('reaction',{'count':1,'per':'day'});m['activation']['cost'].append({'resource':'self_uses'});m['activation'].update(mode='reaction',trigger={'event':'effect_received','timing':'after','circumstances':[eq('negative',True)]});m['effects']=[auto([{'kind':'remove_effect','event_effect':True}],'self')];action(475,'Отвергнуть новый отрицательный эффект',m)
 evidence(475,None,'После наложения отрицательного экземпляра можно реакцией снять ровно его, один раз в день. Полярность берётся из данных эффекта/реестра состояния; способность реагировать проверяется до наложения этого экземпляра, остальные запреты и текущие ресурсы сохраняются.',['frontend/src/rules-core/itemEffectReceived.integration.test.ts'])
 evidence(597,'Телосложению','Действующий grant_ability_score con+2 с пределом20 сохраняется только при экипировке.',['frontend/src/character/rules/abilityScoreGrants.test.ts'])
 evidence(597,'упасть','Экипировка даёт condition_immunity prone и +10 фт скорости через общий collector.',['frontend/src/solo-combat/itemTraversal.test.ts'])
 # Canonical condition polarity is content, shared by every effect-received listener.
 for e in json.loads((SNAP/'effects.json').read_text(encoding='utf-8')):
  cond=(e.get('mechanics') or {}).get('condition',{})
  if e.get('deleted_at') or not isinstance(cond,dict) or not cond.get('id') or cond['id']=='polymorphed':continue
  mech=copy.deepcopy(e['mechanics']);mech['condition']['polarity']='positive' if cond['id']=='invisible' else 'negative'
  ENTITIES.append({'entity_type':'effect','id':e['id'],'card_number':e['card_number'],'preimage':{'mechanics':e['mechanics']},'patch':{'mechanics':mech}})
 m=active('bonus_action',{'count':1,'per':'encounter'});m['activation']['cost'].append({'resource':'self_uses'});m['teleport_destination']={'illumination':['dark']};m['effects']=[auto([{'kind':'movement','value':'teleport','distance':40}],'self')];action(596,'Шаг в темноту',m)
 evidence(596,None,'Бонусное действие и заряд за бой оплачиваются только после выбора свободной тёмной клетки в 40 фт; освещение вычисляется по текущему полю, лампам и аурным источникам.',['frontend/src/solo-combat/itemTeleportDestination.integration.test.ts'])
 declare(498,[{'kind':'effect_end_policy','trigger':'actor_makes_attack_roll','scope':'hidden','retain_chance':{'die':4,'equals':[4]}}])
 evidence(498,None,'После завершённого броска атаки бросается 1к4; на4 конкретная Засада сохраняется. Предварительный бросок до влияния не бросает эту кость и не прекращает скрытность.',['frontend/src/engine/itemCompletionNamedEffects.test.ts'])
 # SRD5.2.1 Shadow is a pinned ordinary monster template compiled by the shared monster compiler.
 # Attribution/source retained in each related library entity.
 source='System Reference Document 5.2.1, pp.322–323. Wizards of the Coast LLC. CC BY 4.0. https://www.dndbeyond.com/srd'
 def shadow_action(suffix,name,mechanics):
  ref='ACT-srd52-shadow-'+suffix;identity=str(uuid.uuid5(uuid.NAMESPACE_URL,ref))
  patch={'id':identity,'card_number':ref,'name':name,'name_en':None,'description':name,'detailed_description':source,'image_url':'','rarity':'common','type':'other','action_type':'base_action','resource':'bonus_action' if suffix=='stealth' else 'action','author':'System','source':source,'mechanics':mechanics,'deleted_at':None}
  ENTITIES.append({'entity_type':'action','id':identity,'card_number':ref,'preimage':None,'patch':patch});return patch
 swipe=shadow_action('draining-swipe','Иссушающий удар',{'activation':{'mode':'active','cost':[{'resource':'action'}]},'targeting':target(5,['enemy','ally','neutral']),'effects':[{'resolution':'attack_roll','attack_kind':'unarmed','ability':'dex','attack_bonus_override':4,'on_hit':[{'kind':'damage','amount':'1d6+2','type':'necrotic'},{'kind':'ability_damage','ability':'str','amount':'1d4','fatal_at':0,'duration':duration('permanent')}]}]})
 stealth=shadow_action('stealth','Теневая засада',{'activation':{'mode':'active','counts_as':'hide','cost':[{'resource':'bonus_action'}],'when':[{'kind':'in_dim_light_or_darkness'}]},'targeting':target(0,['self']),'effects':[]})
 eref=effect(369,'Свойства Тени',[modifier('d20','disadvantage',when=[{'kind':'in_daylight'}]),*[{'kind':'resistance','damage_type':t,'value':'resistance'} for t in ['acid','cold','fire','lightning','thunder']],{'kind':'movement_policy','minimum_passage_inches':1}],'-shadow-traits')
 trait=next(e['patch'] for e in ENTITIES if e.get('card_number')==eref);trait['name']='Свойства Тени';trait['description']='Аморфность и слабость на солнечном свету.';trait['source']=source
 monsterid=str(uuid.uuid5(uuid.NAMESPACE_URL,'MONSTER-srd52-shadow'))
 monster={'id':monsterid,'slug':'shadow-srd52','name':'Тень','name_en':'Shadow','description':'Обычная Тень по SRD5.2.1. '+source,'size':'medium','creature_type':'undead','alignment':'chaotic evil','challenge_rating':'1/2','armor_class':12,'max_hp':27,'speed':40,'initiative_bonus':2,'proficiency_bonus':2,'abilities':{'str':6,'dex':14,'con':13,'int':6,'wis':10,'cha':8},'action_ids':[swipe['id'],stealth['id']],'effect_ids':[trait['id']],'ai':{'strategy':'melee_chase','preferred_range_ft':5,'darkvision_ft':60,'skill_expertise':['stealth'],'skill_proficiencies':['stealth'],'damage_vulnerabilities':['radiant'],'damage_immunities':['necrotic','poison'],'condition_immunities':['exhaustion','frightened','grappled','paralyzed','petrified','poisoned','prone','restrained','unconscious']},'token_url':'','source':source,'author':'System','deleted_at':None}
 ENTITIES.append({'entity_type':'monster','id':monsterid,'preimage':None,'patch':monster})
 m=active('action',{'count':1,'per':'day'});m['activation']['cost'].append({'resource':'self_uses'});m['primitive']={'type':'owned_summon','summon_key':'item-369-shadow','name':'Тень','creature_type':'undead','size':2,'speed_ft':40,'armor_class':{'base':12,'per_spell_level':0},'hit_points':{'base':27,'per_spell_level':0,'scale_from_level':0},'duration':'until_destroyed','initiative':'immediately_after_owner','replace_existing':True,'monster_template':{'monster':monster,'actions':[swipe,stealth],'effects':[trait]}};m['targeting']={'domain':'world','shape':'single','actor_targets':False,'min_targets':0,'max_targets':0,'range_ft':5,'requires_line_of_sight':False,'allowed_relations':[]};m['effects']=[];action(369,'Призвать обычную Тень',m)
 evidence(369,None,'Действие раз в день создаёт союзную Тень из закреплённого профиля SRD5.2.1 с собственными атаками, защитами, инициативой и состоянием; создание переживает загрузку.', ['frontend/src/solo-combat/ownedSummons.test.ts'])
 record(369)['limitations']=['Исходник предмета не определяет клетку и длительность призыва: используется свободная соседняя клетка, Тень остаётся до уничтожения, новый призыв заменяет предыдущий. Редакция обычной Тени — SRD5.2.1, согласована с ruleset dnd5e-2024.']
 m=active('bonus_action');m['effects']=[auto([{'kind':'movement','value':'push','distance':10,'direction':'random_compass'}],'self')];action(362,'Позволить оттолкнуть',m)
 evidence(362,None,'Оплаченное бонусное действие бросает одну сохраняемую к8 направления; физическое принудительное перемещение до10фт останавливается препятствиями, не расходует скорость и не провоцирует атаки.',['frontend/src/solo-combat/itemTraversal.test.ts'])
 record(362)['limitations'].append('У ожерелья нет описанной личности или алгоритма выбора направления; используется равновероятное направление из восьми сторон света.')
 for n in [356,561]:
  declare(n,[{'kind':'weapon_return','weapon_id':card(n)['id'],'after_throw':True}])
  evidence(n,None,'После завершённой метательной атаки возвращается тот же физический экземпляр в исходную руку; незавершённый бросок не перемещает оружие, повтор команды не создаёт копий.',['frontend/src/rules-core/itemWeaponLifecycle.integration.test.ts'])
 m=active('bonus_action');m['activation']['weapon_bond_recall']=True;m['targeting']=target(0,['self']);m['effects']=[];ref=action(560,'Призвать связанный клинок',m,'-recall')
 record(560)['mechanics']['weapon_bond']={'inherent':True,'recall_action_ref':next(e['id'] for e in ENTITIES if e.get('card_number')==ref)}
 declare(560,[{'kind':'equipment_policy','cannot_be_disarmed':True,'weapon_id':card(560)['id']}])
 evidence(560,'связан','Связь фиксируется с физическим экземпляром; нельзя выбить этот клинок, а бонусное действие возвращает его с того же плана в выбранную свободную руку. Связанный объект сохраняет действие владельцу даже вне его инвентаря.',['frontend/src/rules-core/itemWeaponLifecycle.integration.test.ts','frontend/src/engine/itemEquipmentPolicy.test.ts'])
 evidence(560,'критического','Профиль критического диапазона +2 исполняется общим сборщиком критических модификаторов.',['frontend/src/engine/itemCompletionRolls.test.ts'])
 # One standing effect owns the complete Warding Bond lifecycle.
 wb=[modifier('ac',value=1),modifier('saving_throw',value=1),{'kind':'resistance','damage_type':'all','value':'resistance'},{'kind':'damage_echo','recipient':'effect_source','fraction':1}]
 basebond={'group':'warding_bond','max_source_distance_ft':60,'end_on_source_zero_hp':True,'exclusive_on_either':True}
 ringref=effect(627,'Охраняющая связь кольца',wb,'-ring-bond')
 next(e['patch'] for e in ENTITIES if e.get('card_number')==ringref)['mechanics']['bond_policy']={**basebond,'source_item_id':card(627)['id'],'target_item_id':card(627)['id']}
 m=active(None);m['activation']['when']=[{'kind':'target_item_active','value':card(627)['id']}];m['targeting']={**target(5,['ally','neutral']),'requires_willing':True};m['effects']=[auto([{'kind':'grant_effect','value':ringref,'duration':duration('permanent'),'bind_action_context':True}],'target')];action(627,'Защитить владельца второго кольца',m,'-link')
 evidence(627,None,'Бесплатное согласованное связывание двух надетых колец фиксирует роли защитника и защищаемого. Один эффект даёт+1КД/спасброскам/сопротивление и копирует итоговый урон защитнику; прекращается после снятия кольца, превышения60фт, нуляHP защитника или новой связи участника.',['frontend/src/rules-core/itemEventReactions.integration.test.ts'])
 spellref=effect(627,'Охраняющая связь заклинания',wb,'-spell-bond')
 next(e['patch'] for e in ENTITIES if e.get('card_number')==spellref)['mechanics']['bond_policy']=basebond
 spell=SPELLS['SPELL-0250'];mech=copy.deepcopy(spell['mechanics']);mech['effects']=[auto([{'kind':'grant_effect','value':spellref,'duration':duration('hours',1),'bind_action_context':True}],'target')];mech['targeting']['requires_willing']=True
 ENTITIES.append({'entity_type':'spell','id':spell['id'],'card_number':spell['card_number'],'preimage':{'mechanics':spell['mechanics']},'patch':{'mechanics':mech}})
 declare(576,[{'kind':'effective_level','amount':1}])
 evidence(576,None,'Пока кулон настроен и активен, общий уровень для формул, масштабирования заговоров и бонуса мастерства повышен на1; базовые уровни классов не переписываются.',['frontend/src/engine/effectiveLevel.test.ts'])
 record(576)['clauses'].append({'text':'Классовое развитие дополнительного уровня.','classification':'underspecified','implementation':'В исходнике не задан класс/подкласс для дополнительного уровня и не определено получениеHP,костейхитов,ASIs,заклинаний и классовых способностей. Эти отдельные параметры нельзя вывести из total level.','evidence':[]})
 record(576)['limitations'].append('Не указан класс/подкласс дополнительного уровня, получениеHP,костейхитов,ASIs,списковзаклинаний и классовых способностей; применяется определённый общий уровень, без выдуманных классовых наград.')
 declare(643,[{'kind':'aura','radius_ft':10,'recipients':'all','include_self':True,'effects':[{'kind':'magic_suppression'}]}],True)
 evidence(643,None,'Постоянная антимагическая сфера10фт подавляет магию по текущей геометрии и происхождению эффектов, включая владельца; сама сфера остаётся активной.',['frontend/src/solo-combat/itemAntimagic.integration.test.ts','frontend/src/rules-core/areaMagic.integration.test.ts'])
 ref=effect(541,'Стойкость позиции',[modifier('ac',value=1),modifier('saving_throw',value=1)])
 next(e['patch'] for e in ENTITIES if e.get('card_number')==ref)['mechanics']['end_triggers']=['actor_moves']
 m=active('action');m['effects']=[auto([{'kind':'world_interaction','operation':'deploy_item','parameters':{'card_id':card(541)['id'],'at':'self'}},{'kind':'area_effect','all_scene':True,'recipients':'allies','effects':[{'kind':'grant_effect','value':ref,'duration':duration('permanent')}]}],'self')];action(541,'Установить штандарт',m)
 evidence(541,None,'Действие ставит реальный экземпляр штандарта на поле и один раз даёт текущим союзникам+1КД/спасброскам. Эффект снимается событием первого реального перемещения получателя, включая толчок и телепорт; перезагрузка не восстанавливает его.',['frontend/src/solo-combat/itemTraversal.test.ts'])
 declare(452,[{'kind':'movement_policy','slip_immune':['ice']}])
 declare(533,[{'kind':'movement_policy','slip_immune':True},{'kind':'aura','radius_ft':5,'recipients':'all','include_self':True,'effects':[{'kind':'terrain','material':'ice'}]}])
 for n in [452,533]:evidence(n,None,'Защита отменяет падение только с фактической причиной slip (для452 дополнительноice), сохраняя обычные толчки. Лёд533 представлен действующим материалом клеток в радиусе5фт и виден на поле.',['frontend/src/engine/itemSlipPolicies.test.ts'])
 record(533)['limitations'].append('Описание льда не задаёт СЛ падения, затраты движения или толщину; материал создаётся без выдуманных числовых правил, явные опасности сцены разрешаются обычным путём.')
 # Blood pact keeps one source-scoped link; consent is explicit canonical targeting.
 link=effect(551,'Кровная связь',[],'-link')
 next(e['patch'] for e in ENTITIES if e.get('card_number')==link)['mechanics']={'kind':'damage_transfer_link','key':'blood-link','polarity':'neutral','duration':duration('permanent')}
 m=active(None);m['targeting']={**target(5,['ally','neutral']),'requires_willing':True};m['effects']=[auto([{'kind':'grant_effect','value':link,'duration':duration('permanent')}],'target')];action(551,'Связать кровь',m,'-bind')
 m=active('reaction');m['damage_transfer']={'fraction':.5,'requires_link':'blood-link'};m['activation'].update(mode='reaction',trigger={'event':'damage_taken','timing':'before'});m['effects']=[];action(551,'Принять половину урона',m,'-transfer')
 evidence(551,None,'Согласие проверяется до создания постоянной связи с конкретным источником; реакция переносит половину пакета урона владельцу и применяет его собственные защиты, переживая сохранение и повтор команды.',['frontend/src/rules-core/itemEventReactions.integration.test.ts'])
 record(551)['limitations'].append('Связывание крови трактуется как контакт в5фт; исходник не задаёт время процедуры или стоимость, поэтому дополнительное действие не расходуется. Дальность самой реакции не ограничена источником.')
 # A weapon hit grants a school-filtered cost replacement until the owner's current turn ends.
 policy={'kind':'action_cost_policy','id':'item-cost-622','optional':True,'match':{'spell_schools':['illusion','enchantment'],'costs_resource':'action'},'replace':{'action':'bonus_action'}}
 ref=effect(622,'Боевое плетение',[policy])
 declare(622,[trigger(622,'hit',[auto([{'kind':'grant_effect','value':ref,'duration':duration('end_of_turn'),'stack_id':'item-war-mage-opportunity'}],'self')],[eq('attackKind','weapon')])])
 evidence(622,None,'Попадание оружием предоставляет до конца текущего хода выбор оплаты заклинания Иллюзии/Очарования бонусным действием; ячейка и прочие стоимости сохраняются.',['frontend/src/engine/actionCostPolicy.test.ts','frontend/src/rules-core/actionCostPolicy.integration.test.ts'])
 record(622)['limitations'].append('В тексте не указано время окончания возможности после попадания; принято окончание текущего хода, чтобы не сохранять безгранично старое попадание.')
 # RL shop copies in the same numerical interval preserve their actual current declarations.
 for key,row in sorted(CARDS.items()):
  match=re.fullmatch(r'RL-SHOP-(\d+)',key)
  if not match or not 350<=int(match[1])<=699:continue
  base=record(int(match[1]));RECORDS[key]=copy.deepcopy(base)
  # IDs inside scoped predicates and weapon filters belong to the shop entity.
  value=json.dumps(RECORDS[key],ensure_ascii=False).replace(card(int(match[1]))['id'],row['id'])
  RECORDS[key]=json.loads(value)
  RECORDS[key]['patch']={}
 # Mark only explicit magical rules; rarity alone is not a magic declaration.
 def kinds(value):
  if isinstance(value,dict):
   yield value.get('kind')
   for child in value.values():yield from kinds(child)
  elif isinstance(value,list):
   for child in value:yield from kinds(child)
 magical=set()
 for key,row in RECORDS.items():
  mech=row.get('mechanics') or {};enchantment=mech.get('weapon_profile',{}).get('enchantment',{})
  explicit_weapon=any(enchantment.get(k,0)>0 for k in ['attack_bonus','damage_bonus']) or bool(enchantment.get('extra_damage_lines'))
  if explicit_weapon or 'grant_spell' in set(kinds(mech)) or key=='CARD-0643':mech['magical']=True;row['mechanics']=mech;magical.add(key)
 for entity in ENTITIES:
  patch=entity['patch'];ref=entity.get('card_number','');match=re.search(r'item-completion-(\d+)',ref)
  if match and f'CARD-{int(match[1]):04}' in magical and patch.get('mechanics'):patch['mechanics']['magical']=True
 rage_refs=[row['id'] for row in json.loads((SNAP/'actions.json').read_text(encoding='utf-8'))
   if row.get('card_number') in ('ACT-rage','action_barbarian_rage_2') and not row.get('deleted_at')]
 declare(463,[{'kind':'automatic_action','event':'encounter_start','requires_owned':True,'target':'self',
   'action_refs':rage_refs}])
 evidence(463,'Оказываясь в бою','Если владелец действительно имеет действующее действие Ярости и может оплатить его обычную стоимость, начало боя исполняет именно это действие после восстановления ресурсов. Расход, эффекты и повтор команды остаются каноническими; без способности или ресурса автоматического входа нет.',['frontend/src/rules-core/itemCombatHistory.integration.test.ts'])
 evidence(463,'-1 к входящему','Пассивное уменьшение входящего колющего урона на1 продолжает применяться только пока предмет активен.',['frontend/src/engine/incomingDamagePolicies.test.ts'])
 declare(501,[modifier('attack','advantage',when=[{'kind':'target_damage_since_source_turn','value':True}],
   applies_to={'roll':'attack','filter':{'weaponId':card(501)['id']}}),
   modifier('attack','disadvantage',when=[{'kind':'target_damage_since_source_turn','value':False}],
   applies_to={'roll':'attack','filter':{'weaponId':card(501)['id']}})])
 evidence(501,None,'Факт урона цели записывается после окончательных реакций и сравнивается с завершением предыдущего хода владельца. Оба варианта броска используют тот же журнал и перезагрузку; правило относится к этому оружию.',['frontend/src/rules-core/itemCombatHistory.integration.test.ts'])
 # Additional families are authored below once their authoritative hooks exist.



 for row in RECORDS.values():
  for clause in row['clauses']:
   if clause['classification']=='unspecified' and clause['implementation'] not in row['limitations']:row['limitations'].append(clause['implementation'])
 OUT.parent.mkdir(parents=True,exist_ok=True)
 OUT.write_text(json.dumps(RECORDS,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
 RELATED.write_text(json.dumps({'schema_version':1,'audit_id':'item-completion-middle-20260929','entities':ENTITIES},ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
 print(f'{len(RECORDS)} cards, {len(ENTITIES)} related entities; '+str(sum(c['classification']=='pending' for r in RECORDS.values() for c in r['clauses']))+' pending clauses')

if __name__=='__main__':build()
