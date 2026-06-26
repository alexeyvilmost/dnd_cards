"""Seed D&D 2024 rule definitions (backgrounds, origin feats, general feats,
fighting styles) into ``battle_definitions`` via the universal constructor.

Descriptions are short paraphrases of the mechanics (no rulebook text). Numeric
effects are modelled with structured ``effects`` so the engine applies them in
combat; complex effects are stored as ``feature`` entries + description.

Idempotent and re-runnable. Usage:  python seed_definitions.py
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import dbcore
import effects
from definitions_repo import definitions


# ─── effect builders ─────────────────────────────────────────────────────────

def ab_choose(opts: List[str]) -> Dict[str, Any]:
    # Background distribution: player picks +2/+1 or +1/+1/+1 among these three.
    return {"type": "ability_score", "mode": "choose", "from": opts, "amount": 1, "count": 3}


def ab_fixed(ability: str, amount: int = 1) -> Dict[str, Any]:
    return {"type": "ability_score", "mode": "fixed", "ability": ability, "amount": amount}


def skills(*names: str) -> Dict[str, Any]:
    return {"type": "skill_proficiency", "fixed": list(names)}


def skills_choose(count: int) -> Dict[str, Any]:
    return {"type": "skill_proficiency", "choose_from": effects.SKILLS, "choose_count": count}


def tool(*names: str) -> Dict[str, Any]:
    return {"type": "tool_proficiency", "fixed": list(names)}


def origin(feat_id: str) -> Dict[str, Any]:
    return {"type": "grant_origin_feat", "feat": feat_id}


def combat(stat: str, amount: int, condition: str = "always") -> Dict[str, Any]:
    return {"type": "combat_mod", "stat": stat, "amount": amount, "condition": condition}


def feature(key: str, label: str) -> Dict[str, Any]:
    return {"type": "feature", "key": key, "label": label}


def proficiency(category: str, *values: str) -> Dict[str, Any]:
    return {"type": "proficiency", "category": category, "values": list(values)}


def save_prof(*abilities: str) -> Dict[str, Any]:
    return {"type": "saving_throw_proficiency", "abilities": list(abilities)}


def grant_cantrip(count: int) -> Dict[str, Any]:
    return {"type": "grant_cantrip", "count": count}


def grant_spell(count: int, max_level: int = 1) -> Dict[str, Any]:
    return {"type": "grant_spell", "count": count, "max_level": max_level}


def make(
    def_id: str,
    kind: str,
    name: str,
    name_ru: str,
    desc: str,
    eff: Optional[List[Dict[str, Any]]] = None,
    ability_options: Optional[List[str]] = None,
    prerequisites: Optional[Dict[str, Any]] = None,
    repeatable: bool = False,
) -> Dict[str, Any]:
    doc: Dict[str, Any] = {
        "id": def_id,
        "kind": kind,
        "name": name,
        "name_ru": name_ru,
        "description": desc,
        "source": "PHB2024",
        "effects": eff or [],
        "repeatable": repeatable,
    }
    if ability_options:
        doc["ability_options"] = ability_options
    if prerequisites:
        doc["prerequisites"] = prerequisites
    return doc


# ─── origin feats ────────────────────────────────────────────────────────────

ORIGIN_FEATS = [
    make("feat_alert", "origin_feat", "Alert", "Бдительный",
         "Преимущество восприятия порядка хода: можно меняться инициативой с союзником.",
         [feature("alert", "Гибкая инициатива")]),
    make("feat_crafter", "origin_feat", "Crafter", "Ремесленник",
         "Владение тремя ремесленными инструментами, скидки на снаряжение и ускоренное крафтовое изготовление.",
         [feature("crafter", "Скидки и быстрый крафт")]),
    make("feat_healer", "origin_feat", "Healer", "Лекарь",
         "Аптечкой можно восстанавливать хиты броском к6 за заряд (бонусное действие).",
         [feature("healer", "Лечение аптечкой")]),
    make("feat_lucky", "origin_feat", "Lucky", "Везунчик",
         "Очки удачи (по бонусу мастерства): преимущество на бросок или помеха врагу.",
         [{"type": "resource", "key": "luck", "amount": 3, "recharge": "long"}, feature("lucky", "Очки удачи")]),
    make("feat_magic_initiate_wizard", "origin_feat", "Magic Initiate (Wizard)", "Посвящённый в магию (волшебник)",
         "Два заговора и одно заклинание 1 круга из списка волшебника.",
         [grant_cantrip(2), grant_spell(1, 1), feature("magic_initiate", "Заговоры и заклинание")]),
    make("feat_magic_initiate_cleric", "origin_feat", "Magic Initiate (Cleric)", "Посвящённый в магию (жрец)",
         "Два заговора и одно заклинание 1 круга из списка жреца.",
         [grant_cantrip(2), grant_spell(1, 1), feature("magic_initiate", "Заговоры и заклинание")]),
    make("feat_magic_initiate_druid", "origin_feat", "Magic Initiate (Druid)", "Посвящённый в магию (друид)",
         "Два заговора и одно заклинание 1 круга из списка друида.",
         [grant_cantrip(2), grant_spell(1, 1), feature("magic_initiate", "Заговоры и заклинание")]),
    make("feat_musician", "origin_feat", "Musician", "Музыкант",
         "Владение тремя музыкальными инструментами; вдохновение союзникам после отдыха.",
         [feature("musician", "Вдохновение союзникам")]),
    make("feat_savage_attacker", "origin_feat", "Savage Attacker", "Свирепый боец",
         "Раз в ход можно перебросить кости урона рукопашной атаки и взять лучший результат.",
         [feature("savage_attacker", "Переброс урона раз в ход")]),
    make("feat_skilled", "origin_feat", "Skilled", "Одарённый",
         "Владение тремя навыками или инструментами на выбор.",
         [skills_choose(3)]),
    make("feat_tavern_brawler", "origin_feat", "Tavern Brawler", "Кабацкий драчун",
         "Безоружный урон к4, переброс единицы урона, толчок целей; владение импровизированным оружием.",
         [feature("tavern_brawler", "Усиленный безоружный бой")]),
    make("feat_tough", "origin_feat", "Tough", "Стойкий",
         "Максимум хитов увеличен на 2 за каждый уровень персонажа.",
         [combat("hp_per_level", 2)]),
]


# ─── fighting styles ─────────────────────────────────────────────────────────

FIGHTING_STYLES = [
    make("style_archery", "fighting_style", "Archery", "Стрельба",
         "+2 к броскам дальних атак оружием.", [combat("ranged_attack", 2)]),
    make("style_defense", "fighting_style", "Defense", "Защита",
         "+1 к КЗ, пока вы носите доспех.", [combat("ac", 1, "wearing_armor")]),
    make("style_dueling", "fighting_style", "Dueling", "Дуэлянт",
         "+2 к урону одноручным оружием, когда во второй руке нет оружия.", [combat("damage", 2)]),
    make("style_great_weapon", "fighting_style", "Great Weapon Fighting", "Большое оружие",
         "Переброс 1 и 2 на костях урона двуручного оружия.", [feature("great_weapon", "Переброс малого урона")]),
    make("style_two_weapon", "fighting_style", "Two-Weapon Fighting", "Бой двумя оружиями",
         "Добавляйте модификатор характеристики к урону атаки второй рукой.", [feature("two_weapon", "Урон второй руки")]),
    make("style_blind_fighting", "fighting_style", "Blind Fighting", "Слепой бой",
         "Слепое зрение на 10 футов: видите скрытых рядом существ.", [feature("blind_fighting", "Слепое зрение 10 фт")]),
    make("style_interception", "fighting_style", "Interception", "Перехват",
         "Реакцией снижаете урон по соседнему союзнику.", [feature("interception", "Снижение урона союзнику")]),
    make("style_protection", "fighting_style", "Protection", "Защитник",
         "Реакцией с щитом накладываете помеху на атаку по соседнему союзнику.", [feature("protection", "Помеха атаке по союзнику")]),
    make("style_thrown_weapon", "fighting_style", "Thrown Weapon Fighting", "Метательное оружие",
         "Быстрое извлечение метательного оружия и +2 к его урону.", [feature("thrown_weapon", "+2 урон метанием")]),
    make("style_unarmed", "fighting_style", "Unarmed Fighting", "Безоружный бой",
         "Усиленный безоружный урон (к6/к8) и урон захваченной цели.", [feature("unarmed_fighting", "Усиленный безоружный урон")]),
]


# ─── backgrounds (16) ────────────────────────────────────────────────────────

BACKGROUNDS = [
    make("bg_acolyte", "background", "Acolyte", "Прислужник",
         "Служитель храма: знания веры и обрядов.",
         [ab_choose(["intelligence", "wisdom", "charisma"]), skills("insight", "religion"),
          tool("Принадлежности каллиграфа"), origin("feat_magic_initiate_cleric")],
         ability_options=["intelligence", "wisdom", "charisma"]),
    make("bg_artisan", "background", "Artisan", "Ремесленник",
         "Мастеровой, выросший в лавке или мастерской.",
         [ab_choose(["strength", "dexterity", "intelligence"]), skills("investigation", "persuasion"),
          tool("Ремесленные инструменты"), origin("feat_crafter")],
         ability_options=["strength", "dexterity", "intelligence"]),
    make("bg_charlatan", "background", "Charlatan", "Шарлатан",
         "Ловкач и обманщик, живущий хитростью.",
         [ab_choose(["dexterity", "constitution", "charisma"]), skills("deception", "sleight_of_hand"),
          tool("Набор для подделки"), origin("feat_skilled")],
         ability_options=["dexterity", "constitution", "charisma"]),
    make("bg_criminal", "background", "Criminal", "Преступник",
         "Знаток теневой стороны города.",
         [ab_choose(["dexterity", "constitution", "intelligence"]), skills("sleight_of_hand", "stealth"),
          tool("Воровские инструменты"), origin("feat_alert")],
         ability_options=["dexterity", "constitution", "intelligence"]),
    make("bg_entertainer", "background", "Entertainer", "Артист",
         "Выступающий перед публикой исполнитель.",
         [ab_choose(["strength", "dexterity", "charisma"]), skills("acrobatics", "performance"),
          tool("Музыкальный инструмент"), origin("feat_musician")],
         ability_options=["strength", "dexterity", "charisma"]),
    make("bg_farmer", "background", "Farmer", "Фермер",
         "Выносливый труженик земли.",
         [ab_choose(["strength", "constitution", "wisdom"]), skills("animal_handling", "nature"),
          tool("Инструменты плотника"), origin("feat_tough")],
         ability_options=["strength", "constitution", "wisdom"]),
    make("bg_guard", "background", "Guard", "Стражник",
         "Дозорный, привыкший к бдительности.",
         [ab_choose(["strength", "intelligence", "wisdom"]), skills("athletics", "perception"),
          tool("Игровой набор"), origin("feat_alert")],
         ability_options=["strength", "intelligence", "wisdom"]),
    make("bg_guide", "background", "Guide", "Проводник",
         "Следопыт диких земель.",
         [ab_choose(["dexterity", "constitution", "wisdom"]), skills("stealth", "survival"),
          tool("Инструменты картографа"), origin("feat_magic_initiate_druid")],
         ability_options=["dexterity", "constitution", "wisdom"]),
    make("bg_hermit", "background", "Hermit", "Отшельник",
         "Живший в уединении искатель истины.",
         [ab_choose(["constitution", "wisdom", "charisma"]), skills("medicine", "religion"),
          tool("Набор травника"), origin("feat_healer")],
         ability_options=["constitution", "wisdom", "charisma"]),
    make("bg_merchant", "background", "Merchant", "Торговец",
         "Странствующий купец с деловой хваткой.",
         [ab_choose(["constitution", "intelligence", "charisma"]), skills("animal_handling", "persuasion"),
          tool("Инструменты навигатора"), origin("feat_lucky")],
         ability_options=["constitution", "intelligence", "charisma"]),
    make("bg_noble", "background", "Noble", "Аристократ",
         "Выходец из знатного рода.",
         [ab_choose(["strength", "intelligence", "charisma"]), skills("history", "persuasion"),
          tool("Игровой набор"), origin("feat_skilled")],
         ability_options=["strength", "intelligence", "charisma"]),
    make("bg_sage", "background", "Sage", "Мудрец",
         "Учёный, посвятивший жизнь знаниям.",
         [ab_choose(["constitution", "intelligence", "wisdom"]), skills("arcana", "history"),
          tool("Принадлежности каллиграфа"), origin("feat_magic_initiate_wizard")],
         ability_options=["constitution", "intelligence", "wisdom"]),
    make("bg_sailor", "background", "Sailor", "Моряк",
         "Морской волк, привыкший к качке и дракам.",
         [ab_choose(["strength", "dexterity", "wisdom"]), skills("acrobatics", "perception"),
          tool("Инструменты навигатора"), origin("feat_tavern_brawler")],
         ability_options=["strength", "dexterity", "wisdom"]),
    make("bg_scribe", "background", "Scribe", "Писарь",
         "Кропотливый переписчик и делопроизводитель.",
         [ab_choose(["dexterity", "intelligence", "wisdom"]), skills("investigation", "perception"),
          tool("Принадлежности каллиграфа"), origin("feat_skilled")],
         ability_options=["dexterity", "intelligence", "wisdom"]),
    make("bg_soldier", "background", "Soldier", "Солдат",
         "Ветеран военной службы.",
         [ab_choose(["strength", "dexterity", "constitution"]), skills("athletics", "intimidation"),
          tool("Игровой набор"), origin("feat_savage_attacker")],
         ability_options=["strength", "dexterity", "constitution"]),
    make("bg_wayfarer", "background", "Wayfarer", "Странник",
         "Уличный скиталец, полагающийся на удачу.",
         [ab_choose(["dexterity", "wisdom", "charisma"]), skills("insight", "stealth"),
          tool("Воровские инструменты"), origin("feat_lucky")],
         ability_options=["dexterity", "wisdom", "charisma"]),
]


# ─── general feats (level 4+) ────────────────────────────────────────────────
# Numeric effects modelled; complex combat tricks stored as feature + description.

L4 = {"min_level": 4}

GENERAL_FEATS = [
    make("feat_ability_score_improvement", "general_feat", "Ability Score Improvement", "Повышение характеристик",
         "Повысьте одну характеристику на 2 или две характеристики на 1 (макс. 20).",
         [feature("asi", "+2 одной или +1 двум характеристикам")], prerequisites=L4, repeatable=True),
    make("feat_actor", "general_feat", "Actor", "Актёр",
         "+1 Харизма; преимущество на обман и имитацию голосов.",
         [ab_fixed("charisma", 1), feature("actor", "Имитация и обман")], prerequisites=L4),
    make("feat_athlete", "general_feat", "Athlete", "Атлет",
         "+1 Сила или Ловкость; вставание стоит меньше движения, лазание не замедляет.",
         [ab_fixed("dexterity", 1), feature("athlete", "Подвижность")], prerequisites=L4),
    make("feat_charger", "general_feat", "Charger", "Таранящий",
         "После рывка — усиленная атака или толчок.",
         [ab_fixed("strength", 1), feature("charger", "Атака после рывка")], prerequisites=L4),
    make("feat_chef", "general_feat", "Chef", "Повар",
         "+1 Тел или Мдр; еда восстанавливает хиты после отдыха.",
         [ab_fixed("constitution", 1), feature("chef", "Лечащая еда")], prerequisites=L4),
    make("feat_crossbow_expert", "general_feat", "Crossbow Expert", "Эксперт с арбалетом",
         "Игнор перезарядки, нет помехи в ближнем бою, бонусная атака ручным арбалетом.",
         [ab_fixed("dexterity", 1), feature("crossbow_expert", "Скорострельность")], prerequisites=L4),
    make("feat_crusher", "general_feat", "Crusher", "Сокрушитель",
         "+1 Сила или Тел; дробящий урон позволяет толкать цель, криты дают преимущество.",
         [ab_fixed("strength", 1), feature("crusher", "Толчок дробящим")], prerequisites=L4),
    make("feat_defensive_duelist", "general_feat", "Defensive Duelist", "Дуэльная защита",
         "+1 Ловкость; реакцией добавляете бонус мастерства к КЗ против рукопашной атаки.",
         [ab_fixed("dexterity", 1), feature("defensive_duelist", "Парирование реакцией")], prerequisites=L4),
    make("feat_dual_wielder", "general_feat", "Dual Wielder", "Боец двумя оружиями",
         "+1 Сила или Ловкость; бой двумя более тяжёлыми оружиями и быстрый их захват.",
         [ab_fixed("dexterity", 1), feature("dual_wielder", "Парное оружие")], prerequisites=L4),
    make("feat_durable", "general_feat", "Durable", "Живучий",
         "+1 Телосложение; на отдыхе лечение костью здоровья всегда максимально.",
         [ab_fixed("constitution", 1), feature("durable", "Лучшее лечение на отдыхе")], prerequisites=L4),
    make("feat_elemental_adept", "general_feat", "Elemental Adept", "Стихийный адепт",
         "Заклинания выбранной стихии игнорируют сопротивление и сильнее по урону.",
         [ab_fixed("intelligence", 1), feature("elemental_adept", "Пробитие сопротивления")], prerequisites=L4, repeatable=True),
    make("feat_fey_touched", "general_feat", "Fey Touched", "Прикосновение фей",
         "+1 Инт/Мдр/Хар; заклинание 'Туманный шаг' и одно заклинание 1 круга школы прорицания/очарования.",
         [ab_fixed("intelligence", 1), grant_spell(1, 1), feature("fey_touched", "Туманный шаг")], prerequisites=L4),
    make("feat_grappler", "general_feat", "Grappler", "Борец",
         "+1 Сила или Ловкость; преимущество атак по схваченной цели.",
         [ab_fixed("strength", 1), feature("grappler", "Атака по схваченным")], prerequisites=L4),
    make("feat_great_weapon_master", "general_feat", "Great Weapon Master", "Мастер большого оружия",
         "+1 Сила; доп. урон при крите/убийстве и тяжёлая силовая атака с бонус-атакой.",
         [ab_fixed("strength", 1), feature("great_weapon_master", "Силовая атака (данные)")], prerequisites=L4),
    make("feat_heavily_armored", "general_feat", "Heavily Armored", "Тяжёлая броня",
         "+1 Сила; владение тяжёлыми доспехами.",
         [ab_fixed("strength", 1), proficiency("armor", "heavy")], prerequisites=L4),
    make("feat_heavy_armor_master", "general_feat", "Heavy Armor Master", "Мастер тяжёлой брони",
         "+1 Сила; снижение получаемого физического урона в тяжёлой броне.",
         [ab_fixed("strength", 1), feature("heavy_armor_master", "Снижение физ. урона")], prerequisites=L4),
    make("feat_inspiring_leader", "general_feat", "Inspiring Leader", "Вдохновляющий лидер",
         "+1 Мдр или Хар; речью выдаёте союзникам временные хиты.",
         [ab_fixed("charisma", 1), feature("inspiring_leader", "Временные хиты союзникам")], prerequisites=L4),
    make("feat_keen_mind", "general_feat", "Keen Mind", "Острый ум",
         "+1 Интеллект; идеальная память и ориентирование.",
         [ab_fixed("intelligence", 1), feature("keen_mind", "Память")], prerequisites=L4),
    make("feat_lightly_armored", "general_feat", "Lightly Armored", "Лёгкая броня",
         "+1 Сила или Ловкость; владение лёгкими доспехами.",
         [ab_fixed("dexterity", 1), proficiency("armor", "light")], prerequisites=L4),
    make("feat_mage_slayer", "general_feat", "Mage Slayer", "Истребитель магов",
         "+1 Сила или Ловкость; помехи заклинателям рядом и срыв концентрации.",
         [ab_fixed("strength", 1), feature("mage_slayer", "Давление на магов")], prerequisites=L4),
    make("feat_martial_weapon_training", "general_feat", "Martial Weapon Training", "Воинское оружие",
         "+1 Сила или Ловкость; владение воинским оружием.",
         [ab_fixed("strength", 1), proficiency("weapon", "martial")], prerequisites=L4),
    make("feat_medium_armor_master", "general_feat", "Medium Armor Master", "Мастер средней брони",
         "+1 Сила или Ловкость; средняя броня не мешает скрытности и даёт больше от Ловкости.",
         [ab_fixed("dexterity", 1), feature("medium_armor_master", "Эффективная средняя броня")], prerequisites=L4),
    make("feat_moderately_armored", "general_feat", "Moderately Armored", "Средняя броня",
         "+1 Сила или Ловкость; владение средними доспехами и щитами.",
         [ab_fixed("dexterity", 1), proficiency("armor", "medium", "shield")], prerequisites=L4),
    make("feat_mounted_combatant", "general_feat", "Mounted Combatant", "Наездник",
         "+1 Сила/Лов/Мдр; преимущества в бою верхом и защита скакуна.",
         [ab_fixed("strength", 1), feature("mounted_combatant", "Конный бой")], prerequisites=L4),
    make("feat_observant", "general_feat", "Observant", "Наблюдательный",
         "+1 Инт или Мдр; владение Восприятием или Анализом и быстрый осмотр.",
         [ab_fixed("wisdom", 1), skills_choose(1), feature("observant", "Внимательность")], prerequisites=L4),
    make("feat_piercer", "general_feat", "Piercer", "Пронзатель",
         "+1 Сила или Ловкость; переброс кости колющего урона и доп. урон при крите.",
         [ab_fixed("dexterity", 1), feature("piercer", "Усиленный колющий урон")], prerequisites=L4),
    make("feat_poisoner", "general_feat", "Poisoner", "Отравитель",
         "Изготовление и применение ядов, пробивающих сопротивление.",
         [ab_fixed("dexterity", 1), feature("poisoner", "Яды")], prerequisites=L4),
    make("feat_polearm_master", "general_feat", "Polearm Master", "Мастер древкового оружия",
         "+1 Сила или Ловкость; бонус-атака древком и атаки по входящим в зону.",
         [ab_fixed("strength", 1), feature("polearm_master", "Контроль зоны (данные)")], prerequisites=L4),
    make("feat_resilient", "general_feat", "Resilient", "Несгибаемый",
         "+1 к выбранной характеристике и владение её спасбросками.",
         [ab_fixed("constitution", 1), save_prof("constitution"), feature("resilient", "Владение спасбросками")],
         prerequisites=L4, repeatable=True),
    make("feat_ritual_caster", "general_feat", "Ritual Caster", "Ритуальный заклинатель",
         "+1 Инт/Мдр/Хар; колдовство ритуальных заклинаний из книги.",
         [ab_fixed("intelligence", 1), feature("ritual_caster", "Ритуалы")], prerequisites=L4),
    make("feat_sentinel", "general_feat", "Sentinel", "Страж",
         "+1 Сила или Ловкость; реакции-атаки останавливают и наказывают врагов.",
         [ab_fixed("strength", 1), feature("sentinel", "Контроль реакциями (данные)")], prerequisites=L4),
    make("feat_sharpshooter", "general_feat", "Sharpshooter", "Меткий стрелок",
         "+1 Ловкость; игнор укрытия/дальности и мощные дальние выстрелы.",
         [ab_fixed("dexterity", 1), feature("sharpshooter", "Мощный выстрел (данные)")], prerequisites=L4),
    make("feat_shield_master", "general_feat", "Shield Master", "Мастер щита",
         "+1 Сила; толчок щитом и бонусы к спасброскам Ловкости со щитом.",
         [ab_fixed("strength", 1), feature("shield_master", "Толчок щитом")], prerequisites=L4),
    make("feat_skill_expert", "general_feat", "Skill Expert", "Эксперт навыков",
         "+1 к любой характеристике; новое владение навыком и компетентность в одном навыке.",
         [ab_fixed("dexterity", 1), skills_choose(1), feature("skill_expert", "Компетентность")], prerequisites=L4),
    make("feat_slasher", "general_feat", "Slasher", "Рубака",
         "+1 Сила или Ловкость; рубящий урон замедляет, криты дают помеху цели.",
         [ab_fixed("strength", 1), feature("slasher", "Замедление рубящим")], prerequisites=L4),
    make("feat_speedy", "general_feat", "Speedy", "Быстрый",
         "+1 Ловкость; скорость +10 футов и отход не провоцирует атак.",
         [ab_fixed("dexterity", 1), combat("speed", 10), feature("speedy", "Манёвренность")], prerequisites=L4),
    make("feat_spell_sniper", "general_feat", "Spell Sniper", "Магический снайпер",
         "+1 Инт/Мдр/Хар; увеличенная дальность атакующих заклинаний и игнор укрытия.",
         [ab_fixed("intelligence", 1), feature("spell_sniper", "Дальнобойная магия")], prerequisites=L4),
    make("feat_telekinetic", "general_feat", "Telekinetic", "Телекинетик",
         "+1 Инт/Мдр/Хар; заговор 'Волшебная рука' и бонусом телекинетический толчок.",
         [ab_fixed("intelligence", 1), grant_cantrip(1), feature("telekinetic", "Толчок разумом")], prerequisites=L4),
    make("feat_telepathic", "general_feat", "Telepathic", "Телепат",
         "+1 Инт/Мдр/Хар; телепатия и заклинание 'Обнаружение мыслей'.",
         [ab_fixed("intelligence", 1), feature("telepathic", "Телепатия")], prerequisites=L4),
    make("feat_war_caster", "general_feat", "War Caster", "Боевой маг",
         "+1 Инт/Мдр/Хар; преимущество на концентрацию и заклинание вместо атаки реакцией.",
         [ab_fixed("constitution", 1), feature("war_caster", "Устойчивая концентрация")], prerequisites=L4),
]


ALL_DEFS = ORIGIN_FEATS + FIGHTING_STYLES + BACKGROUNDS + GENERAL_FEATS


def main() -> None:
    dbcore.run_migrations()
    errors = 0
    for doc in ALL_DEFS:
        err = effects.validate_definition(doc)
        if err:
            print(f"INVALID {doc['id']}: {err}")
            errors += 1
            continue
        definitions.save(doc)
    by_kind: Dict[str, int] = {}
    for d in ALL_DEFS:
        by_kind[d["kind"]] = by_kind.get(d["kind"], 0) + 1
    print(f"storage backend: {definitions.backend()}")
    print(f"seeded: {len(ALL_DEFS) - errors} / {len(ALL_DEFS)}  {by_kind}")
    if errors:
        print(f"validation errors: {errors}")


if __name__ == "__main__":
    main()
