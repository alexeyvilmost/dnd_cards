"""Data authoring only. Builds additive card overrides and ordinary Action rows."""
import hashlib, json, pathlib, uuid

ROOT = pathlib.Path(__file__).resolve().parents[2]
CARDS = {row['card_number']: row for row in json.loads((ROOT/'outputs/mechanics-20260929/cards.json').read_text(encoding='utf-8')) if not row['deleted_at']}
SHA = '079b69c5cdcbff81d9346a97a3717ef2abf48c54306d62778824bcbc96a3f291'
ENTITIES, OVERRIDES = [], {}
EVIDENCE = ['frontend/src/engine/itemRollInfluences.test.ts', 'frontend/src/solo-combat/d20Interrupt.integration.test.ts']

def override(number):
    return OVERRIDES.setdefault(f'CARD-{number:04}', {'append_payloads': [], 'implemented': [], 'tested': [], 'limitations': [], 'evidence': EVIDENCE.copy(), 'status': 'verified_partial'})

def action(number, label, operation, timing='before_roll', rolls=None, uses=None, reaction=False, extra=None, suffix='', pool=None):
    card = CARDS[f'CARD-{number:04}']
    ref = f'ACT-item-influence-{number:04}{suffix}'
    cost = ([{'resource': 'reaction', 'amount': 1}] if reaction else [])
    if uses: cost.append({'resource': 'self_uses', 'amount': 1})
    elif pool: cost.append({'resource': pool, 'amount': 1})
    payload = {'kind': 'roll_influence', 'operation': operation, 'timing': timing, 'eligible_rolls': rolls or ['attack', 'save', 'check'], **(extra or {})}
    mechanics = {'requires_item_source':card['id'], 'activation': {'mode':'triggered', 'optional':True, 'cost':cost}, 'effects':[{'resolution':'auto','result':[payload]}]}
    if uses: mechanics['uses'] = {'count':uses[0], 'per':uses[1]}
    row = {'id':str(uuid.uuid5(uuid.NAMESPACE_URL,'catalog-audit-20260929/'+ref)), 'card_number':ref, 'name':card['name']+' — '+label,
           'name_en':None, 'description':card['description'], 'detailed_description':card['detailed_description'], 'rarity':card['rarity'],
           'type':'other', 'action_type':'base_action', 'resource':'reaction' if reaction else 'free_action',
           'author':'System', 'source':'Catalog mechanics audit 2026-09-29', 'mechanics':mechanics, 'deleted_at':None}
    descriptor = json.dumps([row['description'],row['detailed_description']],ensure_ascii=False,separators=(',',':'))
    ENTITIES.append({'entity_type':'action','id':row['id'],'card_number':ref,'name':row['name'],
                     'description_sha256':hashlib.sha256(descriptor.encode()).hexdigest(),'preimage':None,'patch':row,
                     'review':{'status':'verified_partial','summary':'Действие влияния, предоставляемое активным предметом.','implemented':[label,'Повторная проверка источника, фазы и стоимости при принятии сохранённого решения.'],'tested':['Общие операции и сохранённое продолжение проверены отдельными тестами двух различных сущностей.'],'limitations':[],'evidence':EVIDENCE.copy()}})
    data=override(number)
    data['append_payloads'].append({'kind':'grant_action','value':ref})
    data['mechanics_set']={'activation':{'mode':'passive','while':'equipped' if card.get('slot') else 'carried'}}
    data['mechanics_remove']=['uses']
    data['implemented'].append(label)
    data['tested'].append('Фазы, сохранение броска, плата и проверка актуального предмета общим исполнителем.')
    return row, payload

action(113,'Преимущество проверки Харизмы', 'advantage', rolls=['check'],uses=(1,'short_rest'),extra={'ability':'cha'})
action(378,'Переброс к20 реакцией','reroll_kept_d20','after_roll_before_outcome',reaction=True,extra={'affects':'any','combat_only':True,'once_per_turn':'item-0378-time'})
override(378)['limitations'] += ['Автоматизированы собственные и чужие броски к20 в бою. Переброс костей урона, откат мира на 30 секунд и обмен действия с бонусным действием не реализованы.']
override(378)['status']='partial_narrative_verified_partial'
action(381,'Переброс к20','reroll_kept_d20','after_roll_before_outcome',uses=(1,'day'))
action(383,'Критическое попадание этим мечом','critical_on_hit','after_roll_before_outcome',rolls=['attack'],uses=(1,'day'),extra={'eligible_outcomes':['hit'],'weapon_id':CARDS['CARD-0383']['id']})
action(428,'Рискованное преимущество','advantage',extra={'failure_disadvantage_until_rest':True})
override(428)['limitations'] += ['Неизвестная СЛ оставляет исход проверки игроку: штраф требует известного провала. Автоматический штраф действует до долгого отдыха; календарная граница «до конца дня» пока не моделируется.']
gift,_=action(445,'Критический успех до броска','force_success')
gift['mechanics']['activation']['cost']=[{'resource':'self_item','amount':1}]
override(445)['implemented'].append('Свойство single_use: принятие влияния расходует ровно один экземпляр через каноничный self_item cost.')
override(445)['limitations'] += ['Особая таблица критических успехов проверок и спасбросков в описании отсутствует; обычные проверки и спасброски получают успех.']
row, payload=action(538,'Помеха атаке против владельца','disadvantage',rolls=['attack'],reaction=True)
payload.clear();payload.update({'kind':'d20_interrupt','operation':'impose_disadvantage','timing':'before_roll','eligible_rolls':['attack_roll'],
                                'requires_line_of_sight':False,'target_self':True,'once_per_encounter':True})
first,_=action(544,'Преимущество','advantage',uses=(3,'day'),suffix='-adv')
action(544,'Помеха','disadvantage',suffix='-dis',pool='uses_'+first['card_number'])
override(544)['implemented'].append('Оба выбора расходуют один общий дневной запас из трёх зарядов.')
action(640,'Успешный спасбросок Ловкости','force_success','after_roll_before_outcome',rolls=['save'],uses=(1,'day'),reaction=True,extra={'ability':'dex','eligible_outcomes':['fail']})
action(646,'Преимущество к20','advantage',uses=(1,'day'))
for number,faces in [(950,10),(951,8),(952,6)]:
    action(number,f'Штраф 2к{faces}, критическое попадание','critical_on_hit',rolls=['attack'],extra={'penalty_dice':f'2d{faces}'})
for number,amount in [(637,1),(890,-1),(954,1)]:
    data=override(number);data['append_payloads'].append({'kind':'attunement_capacity','amount':amount})
    data['implemented'].append(f'Число мест настройки изменяется на {amount:+d} через общий предметный gate.')
    data['tested'].append('Положительная и отрицательная ёмкость, экипировка/инвентарь/настройка, серверная проверка владения и сохранение прежних выборов.')
    data['evidence']=['frontend/src/character/attunementCapacity.test.ts','backend/item_attunement_capacity_test.go']
data=override(504);data['status']='not_verified';data['limitations'].append('Постоянная потеря места настройки и восстановление всех ячеек действием не реализованы; существующий профиль посоха сохранён.')
override(954)['mechanics_set']={'activation':{'mode':'passive','while':'equipped'}}
for number in [113,428,445,544,646]:
    override(number)['limitations'].append('Выбор до броска подключён к действиям боя, проверкам и спасброскам. Предварительный выбор при инициативе и спасброске смерти требует отдельного продолжения.')
for number in [381,383,544,640,646]:
    override(number)['limitations'].append('Суточные заряды используют существующий цикл восстановления долгим отдыхом; независимого игрового календаря нет.')
for entry in ENTITIES:
    number=int(entry['card_number'].split('-')[3])
    entry['review']['limitations']=override(number)['limitations'].copy()
for path,value in [
    (ROOT/'scripts/content/data/item-influences-20260929.json',OVERRIDES),
    (ROOT/'backend/migrations/data/catalog-audit-20260929/item-influences.json',{'schema_version':1,'audit_id':'item-influences-20260929','source_snapshot_sha256':SHA,'entities':ENTITIES})]:
    path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print(f'{len(ENTITIES)} new actions; {len(OVERRIDES)} card overrides')
