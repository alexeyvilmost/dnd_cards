"""Build the reviewed item patch from a pinned local production snapshot.

This is an authoring tool, never a runtime name/ID dispatch or a production API
writer. All resulting declarations are ordinary entity-owned engine data.
"""
import copy, hashlib, json, pathlib, re, sys, uuid

ROOT = pathlib.Path(__file__).resolve().parents[2]
SNAPSHOT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'outputs/mechanics-20260929'
OUT = ROOT / 'backend/migrations/data/catalog-audit-20260929/items.json'
rows = [r for r in json.loads((SNAPSHOT / 'cards.json').read_text(encoding='utf-8')) if not r['deleted_at']]
spells = [r for r in json.loads((SNAPSHOT / 'spells.json').read_text(encoding='utf-8')) if not r['deleted_at']]
effects = [r for r in json.loads((SNAPSHOT / 'effects.json').read_text(encoding='utf-8')) if not r['deleted_at']]
snapshot_sha = json.loads((SNAPSHOT / 'catalog-summary.json').read_text())['source_snapshot_sha256']

def clone(x): return copy.deepcopy(x)
def mod(roll, value=None, op='add', **filters):
    p = {'kind':'modifier','op':op,'applies_to':{'roll':roll}}
    if filters: p['applies_to']['filter'] = filters
    if value is not None: p['value'] = str(value)
    return p
def skill(name,n=1,op='add'): return mod('ability_check',n,op,skill=name)
def save(name,n=1,op='add'): return mod('saving_throw',n,op,ability=name)
def asi(name,n,cap=20): return {'kind':'grant_ability_score','ability':name,'amount':n,'cap':cap}
def resist(typ,kind='resistance'): return {'kind':'resistance','damage_type':typ,'value':kind}
def reduce(n,*types): return {'kind':'reduce_damage','amount':str(n),**({'filter':{'damage_types':list(types)}} if types else {})}
def immune(*conditions): return [{'kind':'condition_immunity','condition':v} for v in conditions]
def value(ability,n): return {'kind':'value_method','target':ability,'formula':str(n)}
def auto(payloads): return {'resolution':'auto','result':payloads}
def passive(payloads,while_='equipped'): return {'activation':{'mode':'passive','while':while_},'effects':[auto(payloads)]}
def duration(payloads,kind='hours',amount=1): return [{**p,'duration':{'type':kind,'amount':amount}} for p in payloads]
def crit(n): return mod('attack',-n,'crit_range')
def pool(key,n): return {'kind':'resource','op':'grant','id':key,'amount':n}
def physical(): return [resist(t) for t in ['bludgeoning','piercing','slashing']]
def unarm(n): return [mod(r,n,attackKind='unarmed') for r in ['attack','damage']]
def magic(n): return [mod('spell_dc',n),mod('attack',n,attackKind='spell')]
def luck_dice(die=None):
    return [{**mod(roll,1,'die_bonus'),'applies_to':{'roll':roll,**({'die':die} if die else {})}} for roll in ['damage','healing']]
def no_armor(payloads):
    return [{**p,'when':[{'kind':'not','of':{'kind':'wearing_armor'}},{'kind':'not','of':{'kind':'wielding_shield'}}]} for p in payloads]

# Explicitly reviewed complete passive clauses. Complex remaining clauses are
# recorded separately below, rather than silently interpreted as unconditional.
P = {
 84:magic(1), 91:[reduce(1,'bludgeoning'),skill('athletics')],92:[reduce(2,'bludgeoning'),mod('saving_throw',1)],
 93:[resist('bludgeoning'),asi('str',2)],94:physical()+[asi('str',2),mod('ac',1)],
 95:[skill('stealth',None,'disadvantage'),skill('athletics')],
 96:[skill('stealth',None,'disadvantage'),skill('athletics',2),skill('religion',2)],
 97:[skill('stealth',None,'disadvantage'),skill('athletics',3),skill('religion',3),asi('cha',1)],
 99:[asi('cha',4,24),reduce(4)],100:[{'kind':'unarmed_damage_profile','dice':'1d4','damage_type':'bludgeoning'},skill('athletics')],
 102:[mod('attack',2),mod('damage',2)],103:[asi('str',3,24),mod('damage','str',attackKind='weapon')],
 104:[asi('str',2,24),crit(2)],105:[save('con')],106:[save('con',2),skill('athletics')],107:[save('con',None,'advantage')],
 111:[skill('religion'),skill('persuasion'),skill('insight')],112:[mod('saving_throw',1),skill('persuasion',2)],113:[asi('cha',1)],
 118:[skill('religion')],120:[asi('cha',1),asi('str',1)],130:[asi('dex',2),asi('wis',2),{'kind':'grant_speed','mode':'fly','value':'character_speed'}],
 133:immune('blinded'),134:unarm(1),135:no_armor([mod('ac',1),mod('speed',5),mod('attack',1),mod('damage',1)]),
 136:[asi('wis',2),skill('sleight_of_hand',3)],137:[skill('acrobatics',2)],
 138:[save('dex',None,'advantage'),save('con',None,'advantage'),skill('acrobatics',2),skill('survival',2)],
 141:[mod('spell_dc',3)],144:[skill('acrobatics')],145:[mod('speed',5)],149:[mod('damage',2,attackKind='spell')],
 160:[crit(2),{**mod('d20','crit_miss','outcome'),'natural':{'min':10,'max':14}}],
 168:[skill('stealth'),mod('ability_check',1,ability='dex'),save('dex')],169:[reduce(1,'bludgeoning'),mod('initiative',1)],
 172:[skill('stealth',2)],173:magic(1),179:[mod('ability_check',1,ability='cha')],
 183:[{'kind':'grant_proficiency','prof':'weapon','value':'simple'},{'kind':'grant_proficiency','prof':'weapon','value':'martial'},mod('attack',1),mod('ac',1)],
 187:[asi('cha',2,22)],208:[skill('nature'),skill('survival')],209:[skill('sleight_of_hand')],210:[mod('attack',1,attackKind='unarmed')],
 211:[mod('damage',1,attackDamage=True)],212:[mod('attack',1,attackKind='weapon',weaponCategory='ranged')],213:[save('dex')],216:[skill('athletics')],
 220:[skill('acrobatics')],222:[mod('speed',5)],223:[mod('speed',-5),save('con',None,'advantage')],224:[save('con')],
 226:[mod('damage',1,damageType='fire')],228:[skill('stealth')],
 231:[{**mod('saving_throw',1),'when':[{'kind':'any_of','of':[{'kind':'save_avoids_condition','value':v} for v in ['frightened','stunned']]}]}],
 235:[skill('intimidation')],236:[skill('persuasion')],237:[skill('religion')],242:[reduce(1,'cold')],244:[skill('persuasion')],
 248:[skill('stealth',None,'disadvantage'),mod('attack',-2),reduce(2)],251:[skill('survival')],252:[skill('acrobatics')],253:[save('dex')],
 255:[skill('sleight_of_hand'),skill('acrobatics'),save('dex')],256:[mod('max_hp',2)],259:[mod('damage',2,attackKind='unarmed')],
 266:[asi('str',-1),reduce(1)],267:[mod('speed',-5),skill('athletics'),save('str')],270:[reduce(1,'slashing')],
 272:[skill('stealth',None,'disadvantage'),reduce(1,'bludgeoning','piercing','slashing')],288:[skill('stealth',None,'disadvantage'),reduce(1,'piercing')],
 289:[skill('stealth',None,'disadvantage'),{**mod('attack',None,'advantage'),'scope':'target'},reduce(3)],
 341:[mod('initiative',1,'set'),mod('speed',0.5,'multiply')],350:[{'kind':'grant_proficiency','prof':'armor','value':'medium'}],
 354:[asi('dex',3,24)],357:[save('dex',3),save('wis',-3)],358:[save('dex',-3),save('wis',3)],
 359:[save('dex',None,'disadvantage'),save('wis',None,'advantage')],360:[save('wis',None,'disadvantage'),save('dex',None,'advantage')],
 363:[mod('damage',5),mod('attack',-2),mod('speed',-5)],370:[resist('necrotic')]+magic(1),
 377:[mod('d20',1)],416:[mod('saving_throw',3)],417:[skill('performance',2)],421:[skill('stealth'),skill('acrobatics')],
 424:[crit(1)],425:[crit(1)],426:[crit(1)],444:[skill('stealth',None,'disadvantage')],446:[skill('sleight_of_hand',None,'advantage')],
 447:[],448:[mod('damage',2,attackKind='weapon',weaponType=['shortbow','longbow','light_crossbow','heavy_crossbow','hand_crossbow'])],
 454:[mod('speed',5)],458:[value('int',17)],459:immune('blinded'),460:[skill('nature'),skill('survival')],461:[skill('arcana'),skill('religion')],
 463:[reduce(1,'piercing')],465:[skill('stealth'),save('dex'),mod('ability_check',1,ability='dex')],
 466:[mod('initiative',1),reduce(1,'bludgeoning')],467:[reduce(1,'piercing'),mod('ability_check',1,ability='dex'),skill('stealth',None,'disadvantage')],
 468:[reduce(1,'slashing'),skill('stealth',None,'disadvantage')],469:[asi('con',2),skill('stealth',None,'disadvantage')],
 470:[asi('con',2),reduce(1)],471:[resist('fire')],472:no_armor([mod('ac',2)]),474:[mod('spell_dc',1)],476:[save('dex',None,'advantage')],
 494:magic(1),519:[skill('survival',2)],520:[mod('speed',5)],
 522:unarm(1),523:[save('con',None,'advantage'),mod('speed',-10)],531:[resist('fire')],
 546:[{'kind':'grant_sense','sense':'darkvision','range':60}],547:[mod('speed',10)],548:[mod('ac',1),mod('saving_throw',1)],549:[value('str',21)],
 557:[crit(1)],560:[crit(2)],575:[value('str',19)],581:[mod('attack',1,attackKind='spell')],
 582:[save('cha'),mod('ability_check',1,ability='cha')],583:[mod('saving_throw',2,reason='maintain_concentration')],
 586:[skill('athletics'),save('str'),save('con')],587:[mod('ac',1),save('dex',None,'disadvantage')],592:[skill('acrobatics'),mod('ac',1)],
 593:[skill('athletics'),mod('speed',10)],597:[mod('ac',1),asi('con',2),mod('speed',10)]+immune('prone'),
 598:[mod('speed',20)],600:[mod('ac',2),skill('athletics',3),asi('con',2)],
 602:[{'kind':'grant_speed','mode':'fly','value':'character_speed'},mod('speed',15),save('con',None,'advantage'),save('dex',None,'advantage')],
 603:[mod('ac',2),asi('str',2),asi('con',2)]+physical()+immune('prone'),609:[mod('speed',5)],610:[mod('saving_throw',2,kind='death')],
 612:[mod('damage',1,weaponHasThrownProperty=True)],617:[save('cha'),save('wis')],619:[resist('lightning')],624:[mod('ac',1),mod('saving_throw',1)],
 625:[skill('perception',None,'advantage')],626:[resist('poison')],629:[mod('ability_check',1,ability=a) for a in ['str','dex','con']],
 633:[mod('initiative',None,'advantage')],634:[mod('attack',2,attackKind='weapon',weaponCategory='ranged')],
 635:[mod('ability_check',2,ability='wis'),save('wis',None,'advantage')],647:[value('con',23),save('con',None,'advantage')],
 650:[skill('performance'),skill('persuasion')],654:[resist('slashing'),resist('bludgeoning','vulnerability')],658:[mod('saving_throw',2,kind='death')],
 666:[mod('spell_dc',2)],668:[save(a,None,'advantage') for a in ['int','wis','cha']],670:[mod('spell_dc',1)],682:[asi('wis',1)],
 756:[skill('nature')],760:[skill('intimidation',None,'advantage'),skill('persuasion',None,'disadvantage'),skill('deception',None,'disadvantage')],
 762:[mod('saving_throw',1,reason='maintain_concentration')],764:[save('wis',2)],768:[resist('fire')],769:immune('blinded','stunned'),
 866:magic(2),887:[skill('insight',7)],891:[mod('ability_check',None,'disadvantage',ability=a) for a in ['int','cha','wis']],
 892:[mod('speed',0.5,'multiply')],895:[mod('saving_throw',None,'disadvantage',kind='death')],
 896:[{**mod('d20','crit_miss','outcome'),'natural':{'min':1,'max':5}}],898:[mod('saving_throw',None,'disadvantage')],906:[mod('ac',-2)],
 910:[mod('concentration',None,'deny')],926:[mod('ability_check',None,'disadvantage',ability=a) for a in ['str','dex']],
 927:[{**mod('d20','crit_miss','outcome'),'natural':{'eq':19}}],932:[mod('saving_throw',None,'advantage',kind='death')],
 954:[mod('max_hp','-2*level')],982:[reduce('wis_score')],
 372:luck_dice(4),373:luck_dice(6),374:luck_dice(8),375:luck_dice(10),376:luck_dice(12),384:luck_dice()+[mod('d20',1)],
}
P.update({
 227:[mod('attack',1,attackKind='spell',spellLevel=0)],
 230:[{'kind':'reduce_damage','amount':1,'filter':{'source':'attack','critical':True}}],
 232:[{'kind':'reduce_damage','amount':2,'filter':{'source':'attack','critical':True}}],
 665:[{**mod('damage',None,'reroll_damage',attackKind='spell'),'natural':{'max':2},'keep':'new'}],
 584:[mod('movement_cost',1,'set',terrain='difficult')],
 888:[{**mod('saving_throw','success','outcome',kind='death',firstAttempt=True),'natural':{'min':1,'max':19}}],
 170:[mod('saving_throw',None,'advantage',saveSource='spell')],
 221:[{**mod('saving_throw',1),'when':[{'kind':'save_avoids_condition','value':'prone'}]}],
 233:[{**mod('saving_throw',1),'when':[{'kind':'save_avoids_condition','value':'stunned'}]}],
 351:[skill('stealth',None,'advantage')],
 367:[pool('action',1),mod('bonus_action',None,'deny'),mod('reaction',None,'deny')],
 368:[mod('d20',8,'minimum_die')],
 432:[pool('wild_shape',1)],
 219:[{'kind':'reduce_damage','amount':'1d4','filter':{'source':'fall'}}],
 585:[{'kind':'reduce_damage','amount':'1d6','filter':{'source':'fall'}}],
 520:[mod('speed',5),mod('fall_damage',0,'multiply')],
 598:[mod('speed',20),mod('fall_damage',0,'multiply')],
 114:[{**mod('damage',2,attackDamage=True),'when':[{'kind':'concentrating'}]}],
 101:[mod('damage',2,attackDamage=True,attackRange='melee'),mod('damage',2,attackDamage=True,attackRange='ranged',weaponHasThrownProperty=True)],
 174:[mod('attack',1,attackKind='weapon',attackRange='ranged')],
 414:[{**mod('damage',1,attackKind='weapon'),'when':[{'kind':'you_have_effect_stack','value':'rage'}]}],
 455:[{**immune('prone')[0],'when':[{'kind':'concentrating'}]}],
})

# These cards contain additional mechanical clauses; their review never claims
# completion merely because the safe subset above can be represented.
PARTIAL = {99,102,104,107,113,120,130,133,136,137,141,149,160,183,211,222,231,354,417,421,424,425,426,444,447,448,454,463,471,474,519,520,522,531,536,560,583,597,598,602,603,612,629,647,666,682,756,768,866,891,892,895,896,898,906,910,926,927,932,954,982}
PARTIAL.update({101,174,414,455})
PARTIAL.add(368)
PARTIAL.update({230,232})
PARTIAL.difference_update({520,598})

WEAPON_TYPES={60:'dagger',61:'rapier',62:'light_crossbow',63:'shortsword',122:'greatsword',123:'greatsword',161:'greatsword',398:'club',427:'longbow',501:'longsword',517:'glaive',560:'dagger',561:'handaxe',575:'club',779:'longsword',862:'longbow',863:'greataxe',864:'longsword',866:'quarterstaff',937:'quarterstaff',963:'dagger',964:'quarterstaff',972:'rapier',974:'quarterstaff',984:'quarterstaff'}

# These descriptions contain only story, appearance, mundane physical utility,
# or campaign information; no automated roll/sheet rule is implied.
NARRATIVE={38,40,42,67,80,143,148,162,163,164,239,241,246,385,386,389,390,393,394,395,396,397,399,400,401,402,404,405,406,408,410,412,495,496,499,503,505,508,511,512,513,515,516,518,529,530,532,539,550,562,606,686,687,688,689,690,691,692,693,694,695,697,698,699,700,704,705,707,709,710,711,713,715,716,717,718,719,720,721,722,723,727,729,731,740,750,751,788,792,794,796,797,798,800,801,808,809,810,812,813,814,816,817,818,820,821,822,823,824,825,826,827,828,830,831,843,844,845,846,847,848,849,867,868,869,901,902,904,916,917,931,933,955,969,975,976,979}
NARRATIVE.difference_update({239,241,246,550,715,727,822,868,904,917,955,975})
NARRATIVE.update({82,140,387,391,392})
# Do not label saved inventory containers/charges/world actions narrative: the
# existing mechanical declaration still participates in the sheet and remains.

SPELL_GRANTS={
 86:[('Тьма',None)],139:[('Пылающие ладони',(1,'encounter'))],453:[('Падение пёрышком',(1,'long_rest'))],
 462:[('Волшебная стрела',(1,'long_rest'))],537:[('Маскировка','at_will')],543:[('Туманный шаг',(2,'long_rest'))],
 591:[('Переносящая дверь',(1,'long_rest'))],599:[('Туманный шаг',(6,'day'))],604:[('Туманный шаг','at_will')],
 611:[('Волна грома',(1,'long_rest'))],614:[('Прыжок',(1,'long_rest'))],616:[('Теневой клинок',(1,'long_rest'))],
 623:[('Невидимость',(1,'long_rest'))],628:[('Маяк надежды',(1,'long_rest'))],648:[('Щит',(2,'long_rest'))],649:[('Щит',(3,'long_rest'))],
 651:[('Подмога',(1,'long_rest'))],652:[('Туманный шаг',(1,'short_rest'))],653:[('Малое восстановление',(1,'long_rest'))],
 656:[('Ледяной кинжал',(1,'long_rest'))],657:[('Наставление','at_will')],667:[('Газообразная форма',(1,'long_rest')),('Порыв ветра',(1,'long_rest'))],
 671:[('Волна грома','at_will'),('Волшебная стрела','at_will')],763:[('Язвительная насмешка','at_will')],765:[('Маскировка','at_will')],
 774:[('Починка','at_will'),('Фокусы','at_will')],852:[('Палящий луч',(1,'long_rest'))],854:[('Невидимость',(1,'long_rest'))],
 914:[('Луч холода','at_will')],915:[('Огненный снаряд','at_will')],920:[('Сообщение',(1,'long_rest'))],
}

def spell_by_name(name):
    normalize=lambda v: re.sub(r'[^а-яa-z0-9]','',v.lower().replace('ё','е'))
    aliases={'газообразнаяформа':'газообразность','падениеперышком':'падениепера','пылающиеладони':'огненныеладони','язвительнаянасмешка':'злаянасмешка'}
    key=normalize(name)
    matches=[s for s in spells if normalize(s['name']) in [key,aliases.get(key)]]
    if len(matches)==1: return matches[0]
    # Explicitly named canonical linked spells remain the data authority.
    if len(matches)>1:
        preferred=[s for s in matches if s.get('source')=="Player's Handbook"]
        if len(preferred)==1: return preferred[0]
    return None

def extra_damage(dice,typ,**filters):
    return {'kind':'damage_rider','trigger':'hit_by_attack_roll','dice':str(dice),'type':typ,'filter':filters,'duration':{'type':'permanent'}}

P.update({
 60:[extra_damage(2,'necrotic',attackKind='weapon')],
 129:[extra_damage('1d4','force',attackKind='unarmed'),resist('psychic')],
 167:[extra_damage('2d4','force',attackKind='weapon',weaponWieldedInTwoHands=True)],
 355:[extra_damage(1,'radiant',attackKind='weapon')],
 554:[{**extra_damage('1d4','necrotic',attackKind='weapon'),'when':[{'kind':'target_has_condition','value':'incapacitated'}]}],
 558:[{**extra_damage('1d6','force',attackKind='weapon'),'when':[{'kind':'has_advantage'}]}],
 608:[extra_damage(2,'poison',attackKind='weapon')],
 613:[extra_damage('1d4','weapon',attackKind='weapon',weaponHasThrownProperty=True,attackRange='ranged')],
 618:[{**extra_damage('1d4','psychic',attackKind='weapon'),'when':[{'kind':'concentrating'}]}],
 914:[mod('damage',2,attackKind='spell',damageType='cold')],915:[mod('damage',2,attackKind='spell',damageType='fire')],
})
PARTIAL.update({129,167,355,554,558,613,914,915})
P[612]=[mod('damage',1,weaponHasThrownProperty=True,attackRange='ranged')]
for number,key,amount in [(130,'bonus_action',1),(361,'reaction',1),(417,'bardic_inspiration',2),(431,'wild_shape',1),(451,'magic_recovery_charge',1),(474,'spell_slot_2',1),(662,'spell_slot_2',1),(666,'channel_divinity',1),(756,'wild_shape',1),(934,'spell_slot_2',1),(935,'spell_slot_2',1)]:
    P.setdefault(number,[]).append(pool(key,amount))
PARTIAL.update({431,451,934,935})

def consumable(payloads,cost='action'):
    return {'activation':{'mode':'active','while':'carried','cost':[{'resource':cost},{'resource':'self_item','amount':1}]},'effects':[auto(payloads)]}

def trigger(event,payloads,conditions=None):
    return {'activation':{'mode':'triggered','while':'equipped','trigger':{'event':event,'timing':'after','subject':'self',**({'circumstances':conditions} if conditions else {})}},'uses':{'count':1,'per':'turn'},'effects':[auto(payloads)]}

POTIONS={
 39:consumable([{'kind':'healing','amount':'2d4+2'}]),78:consumable([{'kind':'healing','amount':'2d4+2'}]),
 44:consumable(duration([{'kind':'condition','op':'apply','value':'invisible','end_triggers':['actor_makes_attack_roll','actor_casts_spell']}])) ,
 49:consumable(duration([save('con',None,'advantage'),{'kind':'condition','op':'remove','value':'poisoned'},{'kind':'condition','op':'remove','value':'exhaustion'}],'hours',24)),
 54:consumable(duration([{**mod('saving_throw',None,'advantage'),'when':[{'kind':'save_avoids_condition','value':'frightened'}]}])),
 884:consumable(duration([resist('all')],'minutes',1),'bonus_action'),
 882:consumable(duration([extra_damage('1d6','force',attackKind='unarmed')],'minutes',10),'bonus_action'),
 811:consumable(duration([{**mod('saving_throw',None,'advantage'),'when':[{'kind':'save_avoids_condition','value':'poisoned'}]}]),'bonus_action'),
 839:consumable([{'kind':'healing','amount':'2d4+2'}],'bonus_action'),
 840:consumable([{'kind':'healing','amount':'4d4+4'}],'bonus_action'),
 841:consumable([{'kind':'healing','amount':'8d4+8'}],'bonus_action'),
 842:consumable([{'kind':'healing','amount':'10d4+20'}],'bonus_action'),
}
TRIGGERS={
 620:trigger('turn_start',[{'kind':'healing','amount':'1d4'}],[{'kind':'hp_fraction_at_most','value':0.5}]),
 638:trigger('turn_start',[{'kind':'healing','amount':'1d4'}]),
 966:trigger('turn_start',[{'kind':'temp_hp','amount':'1d4'}]),
}

def add_effect(records,number,name,payloads):
    card_number=f'EFFECT-item-audit-{number}'
    row={'id':str(uuid.uuid5(uuid.NAMESPACE_URL,'bagofholding/catalog-audit-20260929/'+card_number)),
         'card_number':card_number,'name':name,'description':name,'detailed_description':None,
         'rarity':'common','effect_type':'item_effect','mechanics':{**passive(payloads),'duration':{'type':'hours','amount':1}},
         'author':'Admin','source':'Bag Of Holding','image_url':''}
    records.append({'entity_type':'effect','id':row['id'],'card_number':card_number,'name':name,
        'description_sha256':canonical_hash(row),'preimage':None,'patch':row,
        'review':{'status':'not_verified','summary':'Пассивный эффект расходуемого предмета.','implemented':['Длительность и эффект принадлежат данным предмета.'],'tested':[],'limitations':[],'evidence':[]}})
    return card_number

def fire_breath_potion(records):
    key='potion_fire_breath';action_ref='ACT-item-audit-fire-breath';effect_ref='EFFECT-item-audit-885'
    add_effect(records,885,'Огненное дыхание зелья',[pool(key,3),{'kind':'grant_action','value':action_ref}])
    action={'id':str(uuid.uuid5(uuid.NAMESPACE_URL,'bagofholding/catalog-audit-20260929/'+action_ref)),
      'card_number':action_ref,'name':'Выдохнуть огонь','description':'Бонусным действием выдохнуть огонь в цель в пределах 30 футов: спасбросок Ловкости Сл 13, 4к6 огнём или половина при успехе. Три выдоха в течение часа.',
      'detailed_description':None,'rarity':'common','action_type':'item_property','resource':'bonus_action','author':'Admin','source':'Bag Of Holding','image_url':'',
      'mechanics':{'activation':{'mode':'active','cost':[{'resource':'bonus_action'},{'resource':key}]},
        'targeting':{'shape':'single','domain':'actor','min_targets':1,'max_targets':1,'range_ft':30,'requires_line_of_sight':True,'actor_targets':True,'allowed_relations':['ally','enemy','neutral']},
        'effects':[{'resolution':'save','who':'target','ability':'dex','dc':13,
          'on_fail':[{'kind':'damage','dice':'4d6','type':'fire'}],
          'on_success':[{'kind':'damage','dice':'4d6','type':'fire','on_success':'half'}]},
          {'resolution':'auto','who':'self','result':[{'kind':'remove_effect','card_number':effect_ref,'when':[{'kind':'resource_at_most','id':key,'value':0}]}]}]}}
    records.append({'entity_type':'action','id':action['id'],'card_number':action_ref,'name':action['name'],'description_sha256':canonical_hash(action),'preimage':None,'patch':action,
      'review':{'status':'verified_partial','summary':'Временное действие от зелья, проверенное общим исполнителем.','implemented':['Выбор цели, спасбросок, половина урона, бонусное действие и три заряда.'],'tested':['Расход, сохранение заряда, прекращение выдачи после третьего выдоха.'],'limitations':['Не является ручным подтверждением всех боевых сценариев.'],'evidence':['frontend/src/engine/itemTemporaryActions.test.ts']}})
    return consumable([{'kind':'grant_effect','value':effect_ref},{'kind':'resource','op':'grant_capped','id':key,'amount':3,'max':3}],'bonus_action')

# Standard weapon profiles are reused from the current catalog, then specialized
# with this item's explicit damage/enchantment fields. Existing profiles win.
weapon_templates={}
for r in rows:
    profile=(r.get('mechanics') or {}).get('weapon_profile')
    if profile and r.get('source')=="Player's Handbook":
        weapon_templates.setdefault(profile['weapon_type'],profile)

def equipment_profile(r,after):
    notes=[]
    typ=r.get('weapon_type')
    if r.get('type')=='weapon' and not after.get('weapon_profile') and typ in weapon_templates:
        p=clone(weapon_templates[typ])
        raw=(r.get('bonus_value') or '').replace('к','d').replace(' ','')
        base=re.match(r'^(\d+d\d+|\d+)',raw)
        if not base or base[0]=='0': return notes
        p['damage_lines']=[{'dice':base[0],'type':r.get('damage_type') or p['damage_lines'][0]['type']}]
        versatile=re.search(r'(?:\(|/)(\d+d\d+)',raw)
        if versatile and 'versatile_grip' in p: p['versatile_grip']['dice']=versatile[1]
        enchant=r.get('enchant_bonus') or 0
        p['enchantment']={'attack_bonus':enchant,'damage_bonus':enchant,'extra_damage_lines':[]}
        if r.get('elemental_damage_type') and r.get('elemental_damage_value'):
            extra=r['elemental_damage_value'].replace('к','d').strip().lstrip('+')
            has_rider=any(payload.get('kind')=='damage_rider' for effect in after.get('effects',[]) for payload in effect.get('result',[]))
            if not has_rider and re.fullmatch(r'(?:[1-9]\d*d(?:[2468]|1[02]|20|100)|[1-9]\d*)',extra):
                p['enchantment']['extra_damage_lines'].append({'dice':extra,'type':r['elemental_damage_type']})
        if r.get('range') and re.fullmatch(r'\d+/\d+',r['range']):
            normal,long=map(int,r['range'].split('/'))
            for mode in p['attack_modes']:
                if mode['kind']=='ranged': mode.update(normal_ft=normal,long_ft=long)
        p['attunement']={'required':bool(r.get('requires_attunement'))}
        after['weapon_profile']=p
        notes.append('Профиль оружия: тип, бросок урона, режимы, свойства, боеприпас, зачарование и настройка.')
    if r.get('type') in ['chest','shield'] and not after.get('armor_profile'):
        category='shield' if r['type']=='shield' else r.get('defense_type')
        formula=r.get('bonus_value') or ''
        cloth='cloth' in (r.get('properties') or '') or (r['type']=='chest' and formula in ['9','10','11','12','14'] and 'одеян' in r['name'].lower())
        if category in ['light','medium','heavy','shield'] and formula and not cloth:
            if category=='medium' and re.fullmatch(r'\d+',formula): formula+=' + min(dex, 2)'
            stealth=bool(re.search(r'скрытност.{0,20}(помех|препятств)',r['description'],re.I))
            requirement=re.search(r'Силе ниже (\d+)',r['description'])
            after['armor_profile']={'category':category,'ac_formula':formula,'training_required':True,'stealth_disadvantage':stealth,'strength_requirement':int(requirement[1]) if requirement else 0}
            after.setdefault('activation',{'mode':'passive','while':'equipped'})
            after.setdefault('effects',[])
            notes.append('Профиль доспеха/щита: КД, владение и ограничения из описания.')
    return notes

def canonical_hash(r):
    return hashlib.sha256(json.dumps([r.get('description'),r.get('detailed_description')],ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

def build():
    records=[]
    overrides={}
    for path in sorted((ROOT/'scripts/content/data').glob('item-*-20260929.json')):
        for key,entry in json.loads(path.read_text(encoding='utf-8')).items():
            dest=overrides.setdefault(key,{})
            for field,field_value in entry.items():
                if isinstance(field_value,list): dest.setdefault(field,[]).extend(field_value)
                else: dest[field]=field_value
    for r in sorted(rows,key=lambda r:r['card_number']):
        match=re.fullmatch(r'(?:CARD-|RL-SHOP-)(\d+)',r['card_number'])
        number=int(match[1]) if match else None
        before=clone(r['mechanics'])
        after=clone(before) if before else {}
        patch={}; implemented=[]; limitations=[];tested=[];evidence=['catalog snapshot '+snapshot_sha]
        authored=clone(r)
        if number in WEAPON_TYPES and not authored.get('weapon_type'):
            authored['weapon_type']=WEAPON_TYPES[number]
            patch['weapon_type']=authored['weapon_type']
        if authored.get('weapon_type') and not authored.get('type'):
            authored['type']='weapon'; patch['type']='weapon'
        if authored.get('type')=='зелье': patch['type']='potion'
        if number==121:
            authored.update(enchant_bonus=4,damage_type='radiant')
            patch.update(enchant_bonus=4,damage_type='radiant')
        if number==954:
            authored['slot']='necklace';patch['slot']='necklace'
        if number in P and P[number]:
            # Replace only passive result clauses that have been explicitly
            # re-authored. Preserve profiles, grants and active interactions.
            payloads=clone(P[number])
            for p in payloads:
                if authored.get('type')=='weapon' and p.get('applies_to',{}).get('filter',{}).get('attackKind')!='spell' and (p.get('applies_to',{}).get('roll') in ['attack','damage'] or p['kind']=='damage_rider'):
                    target=p.setdefault('filter',{}) if p['kind']=='damage_rider' else p['applies_to'].setdefault('filter',{})
                    target['weaponId']=r['id']
            # Existing grants/resources remain available through the same item.
            preserved=[p for e in (before or {}).get('effects',[]) for p in e.get('result',[]) if p.get('kind') in ['grant_spell','grant_action','grant_effect','resource'] and not any(p.get('kind')==q.get('kind') and (p.get('id') or p.get('value'))==(q.get('id') or q.get('value')) for q in payloads)]
            after.update(passive(payloads+preserved,'equipped' if authored.get('slot') else 'carried'))
            implemented.append('Пассивные числовые правила и области применения сверены с текстом; декларации переописаны универсальными примитивами.')
            if number in PARTIAL: limitations.append('Остальные условия из описания требуют отдельной реализации или ручного решения; полный сценарий не подтверждён.')
            if r.get('effects'): patch['effects']=None
        implemented.extend(equipment_profile(authored,after))
        if number in {119,121,123,353,364,439,441}:
            for interaction in after.get('effects',[]):
                interaction['result']=[p for p in interaction.get('result',[]) if not (
                    p.get('kind')=='modifier' and p.get('op')=='add'
                    and p.get('applies_to',{}).get('roll') in ['attack','damage']
                    and not p.get('applies_to',{}).get('filter') and not p.get('when')
                    and str(p.get('value','')).lstrip('+')==str(authored.get('enchant_bonus')))]
            implemented.append('Зачарование учтено один раз в профиле оружия; старые глобальные дубли атаки/урона удалены.')
        if number==342:
            for interaction in after.get('effects',[]):
                interaction['result']=[p for p in interaction.get('result',[]) if not (p.get('kind')=='modifier' and p.get('applies_to',{}).get('roll')=='ac')]
            implemented.append('КД 19 из карточки уже включает зачарование; прежняя повторная добавка +1 удалена.')
        if number in SPELL_GRANTS:
            grants=[]
            for name,free in SPELL_GRANTS[number]:
                spell=spell_by_name(name)
                if not spell:
                    limitations.append('Не найдена однозначная актуальная ссылка заклинания: '+name)
                    continue
                grant={'kind':'grant_spell','value':spell['card_number']}
                if free=='at_will': grant['freeuse']={'at_will':True}
                elif free: grant['freeuse']={'count':free[0],'recharge':free[1]}
                grants.append(grant)
            if grants:
                after.setdefault('activation',{'mode':'passive','while':'equipped' if r.get('slot') else 'carried'})
                after.setdefault('effects',[])
                for interaction in after['effects']:
                    if isinstance(interaction.get('result'),list): interaction['result']=[p for p in interaction['result'] if p.get('kind')!='grant_spell']
                after['effects'].append(auto(grants))
                implemented.append('Выдача актуальных заклинаний и бесплатных использований с указанным периодом восстановления.')
                if number in {86,462,599,667,914,915}: limitations.append('Особые модификации заклинаний/случайная перезарядка отдельно не подтверждены.')
        if number in POTIONS:
            after=POTIONS[number]
            implemented.append('Употребление списывает один предмет; исцеление/состояние/сопротивление имеют явные длительности.')
            if number in {49,54}: limitations.append('Болезни либо величина временных хитов полностью не описаны/не автоматизированы.')
        if number in {45,51,57}:
            payloads=[{'kind':'grant_speed','mode':'fly','value':60}] if number==45 else [value('str',21),mod('ability_check',None,'advantage',ability='str')]
            ref=add_effect(records,number,r['name'],payloads)
            after=consumable([{'kind':'grant_effect','value':ref,'duration':{'type':'hours','amount':1}}])
            implemented.append('Часовой эффект через каноничную сущность: скорость полёта либо минимум Силы; расход флакона.')
        if number in TRIGGERS:
            after=TRIGGERS[number]
            implemented.append('Событие начала хода, один запуск за ход, исцеление/временные хиты и условие здоровья из данных.')
        if number==885:
            after=fire_breath_potion(records)
            implemented.append('Часовой эффект выдаёт временное действие выдоха, три заряда, прекращение после третьего выдоха; расход зелья.')
        override=overrides.get(r['card_number'],{})
        if override.get('replace_mechanics') is not None:
            after=clone(override['replace_mechanics'])
        for key in override.get('mechanics_remove',[]):
            after.pop(key,None)
        after.update(clone(override.get('mechanics_set',{})))
        if override.get('patch'):
            patch.update(clone(override['patch']))
        if override.get('append_payloads'):
            after.setdefault('activation',{'mode':'passive','while':'equipped' if r.get('slot') else 'carried'})
            after.setdefault('effects',[]).append(auto(clone(override['append_payloads'])))
        implemented.extend(override.get('implemented',[]));limitations.extend(override.get('limitations',[]))
        tested.extend(override.get('tested',[]));evidence.extend(override.get('evidence',[]))
        if number==254 and r.get('effects'):
            patch['effects']=None;implemented.append('Удалены неописанные бонусы Природы/Выживания из старого поля effects.')
        if after!=before and after: patch['mechanics']=after
        mechanical=bool(after) or r.get('bonus_type') in ['damage','defense'] or bool(r.get('effects')) or r.get('type')=='container' or bool(r.get('contents'))
        text=(r.get('description') or '').strip()
        placeholder=not text or text in ['Описание эффекта','Описания эффекта зелья']
        status='not_verified'
        if number in P and P[number] and number not in PARTIAL: status='verified_partial'
        elif not mechanical and placeholder: status='not_tested'
        elif number in NARRATIVE and not mechanical: status='narrative'
        if not implemented: implemented=['Существующая декларация сохранена; запись включена в поимённый аудит.'] if mechanical else []
        if status=='not_verified' and not limitations: limitations=['Полное исполнение правил описания не подтверждено; прежние сертификаты не использовались.']
        preimage={k:clone(r.get(k)) for k in ['name','description','detailed_description','mechanics','type','weapon_type','bonus_type','bonus_value','damage_type','elemental_damage_type','elemental_damage_value','enchant_bonus','defense_type','slot','requires_attunement','range','mastery','properties','effects','related_actions','related_effects','contents','container_mode','deleted_at']}
        if tested: status=override.get('status','verified_partial')
        if number==888: status='partial_narrative_verified_partial'
        if number==368: limitations=['Нижняя граница применяется к числу на к20 до модификаторов; натуральные 1/20 сохраняют особые исходы. Трактовка предмета для этих граней требует отдельной проверки.']
        if status=='narrative': limitations=['Описание не задаёт автоматизируемого броска или изменения сущностей листа; применение разрешается в повествовании.']
        if number in {170,221,233}: limitations.append('Проверено начальное разрешение спасброска; повторные спасброски для завершения старых эффектов требуют отдельного прогона.')
        if number in {372,373,374,375,376,384}:
            limitations.append('Добавка к каждой подходящей кости урона и лечения; у кольца невероятной удачи также +1 к к20. Дополнительные кости проверок, случайные таблицы и прочие небоевые броски отдельно не реализованы.')
            tested.append('Общий исполнитель: разные размеры костей, смешанные формулы лечения и урона, игнорирование отброшенных костей.')
            evidence.append('frontend/src/engine/itemCatalogAudit.test.ts; frontend/src/engine/itemHealingModifiers.test.ts')
        if number in P and P[number]:
            tested.append('Схема механик и каноничный парсер профиля; группа общих примитивов проверена на нескольких сущностях, без индивидуального ручного прогона каждой числовой записи.')
            evidence.append('frontend/src/engine/itemCatalogAudit.test.ts')
        records.append({'entity_type':'card','id':r['id'],'card_number':r['card_number'],'name':r['name'],'description_sha256':canonical_hash(r),'preimage':preimage,'patch':patch,'review':{'status':status,'summary':'Аудит механики предмета «'+r['name']+'» по актуальному описанию.','implemented':implemented,'tested':tested,'limitations':limitations,'evidence':evidence}})
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps({'schema_version':1,'audit_id':'items-20260929','source_snapshot_sha256':snapshot_sha,'entities':records},ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(f'Wrote {len(records)} items; {sum(bool(r["patch"]) for r in records)} changed')

if __name__=='__main__': build()
