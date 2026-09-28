// Editorial transform for the 2026-09-27 read-only catalog snapshot.
// Writes a guarded metadata patch; never connects to a database or the API.
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'output/content-readability-20260927');
const source = JSON.parse(await fs.readFile(path.join(out, 'source.json'), 'utf8')).catalogs;
const reference = JSON.parse(await fs.readFile(path.join(out, 'english-reference.json'), 'utf8'));
const draft = JSON.parse(await fs.readFile(path.join(out, 'english-fallback.json'), 'utf8'));
const conceptIDs = new Set(source.concepts.map((row) => row.concept_id));

const exactEnglish = {
  'Астральный рывок': 'Astral Rush', 'Дубинка': 'Shillelagh', 'Стихийность': 'Elementalism',
  'Защита от добра и зла': 'Protection from Evil and Good',
  'Обнаружение болезней и яда': 'Detect Poison and Disease',
  'Воплощение силы': 'Embodiment of Power', 'Паучье лазание': 'Spider Climb',
  'Ареал надежды': 'Haven of Hope', 'Очарование чудовища': 'Charm Monster',
  'Сияющая буря Джалларзи': "Jallarzi's Storm of Radiance",
  'Мгновенные вызовы Дромиджа': "Drawmij's Instant Summons",
  'Распад': 'Disintegrate', 'Подобие': 'Simulacrum', 'Замешательство': 'Befuddlement',
  'Подчинение чудовища': 'Dominate Monster', 'Смертный ужас': 'Weird',
  'Амбидекстр': 'Dual Wielder', 'Артистичный': 'Actor', 'Атлетичный': 'Athlete',
  'Везунчик': 'Lucky', 'Воинская подготовка': 'Martial Weapon Training',
  'Дикий атакующий': 'Savage Attacker', 'Мастер большого оружия': 'Great Weapon Master',
  'Мастер щитов': 'Shield Master', 'Обороняющийся дуэлянт': 'Defensive Duelist',
  'Посвященный в магию: Друид': 'Magic Initiate (Druid)',
  'Посвященный в магию: Жрец': 'Magic Initiate (Cleric)',
  'Самоделкин': 'Crafter', 'Эксперт в арбалетах': 'Crossbow Expert',
  'Мистическая кара': 'Eldritch Smite', 'Мистическое копьё': 'Eldritch Spear',
  'Восходящий шаг': 'Ascendant Step', 'Взгляд двух разумов': 'Gaze of Two Minds',
  'Дар глубин': 'Gift of the Depths', 'Вложение хозяина цепи': 'Investment of the Chain Master',
  'Уроки первых': 'Lessons of the First Ones', 'Мастер бесчисленных обликов': 'Master of Myriad Forms',
  'Туманные видения': 'Misty Visions', 'Слияние с тенями': 'One with Shadows',
  'Потусторонний прыжок': 'Otherworldly Leap', 'Отбрасывающий залп': 'Repelling Blast',
  'Жаждущий клинок': 'Thirsting Blade',
  'Защита': 'Protection',
  'Сияние рассвета': 'Radiance of the Dawn', 'Воплощение стихий': 'Elemental Epitome',
  'Воплощение битвы': 'Avatar of Battle', 'Двуличность': 'Invoke Duplicity',
  'Шаги феи': 'Steps of the Fey', 'Звёздный облик': 'Starry Form',
  'Гнев природы': "Nature's Wrath", 'Боевой священник': 'War Priest',
  'Воин богов': 'Warrior of the Gods', 'Поток хаоса': 'Tides of Chaos',
  'Благословение обманщика': 'Blessing of the Trickster', 'Связь с оружием': 'Weapon Bond',
  'Исцеляющая рука': 'Healing Hands', 'Гнев моря': 'Wrath of the Sea',
  'Несравненный атлет': 'Peerless Athlete', 'Быстрые руки': 'Fast Hands',
  'Помощь земли': "Land's Aid", 'Телепатическая речь': 'Telepathic Speech',
  'Священное оружие': 'Sacred Weapon', 'Лечащий свет': 'Healing Light',
  'Обет вражды': 'Vow of Enmity', 'Сохранение жизни': 'Preserve Life',
  'Мантия вдохновения': 'Mantle of Inspiration', 'Пробуждённый разум': 'Awakened Mind',
  'Хитрое действие: Рывок': 'Cunning Action: Dash',
  'Хитрое действие: Отход': 'Cunning Action: Disengage',
  'Хитрое действие: Засада': 'Cunning Action: Hide',
  'Дикая форма': 'Wild Shape', 'Всплеск действий': 'Action Surge',
  'Ярость': 'Rage', 'Уклонение': 'Dodge', 'Отход': 'Disengage',
  'Рывок': 'Dash', 'Атака второй рукой': 'Offhand Attack',
  'Второе дыхание': 'Second Wind', 'Толкнуть': 'Shove',
  'Выйти из Дикого облика': 'Dismiss Wild Shape',
  'Подготовить Ускоренное заклинание': 'Prepare Quickened Spell',
  'Подготовить Преобразованное заклинание': 'Prepare Transmuted Spell',
  'Крыса: Укус': 'Rat: Bite', 'Верховая лошадь: Копыта': 'Riding Horse: Hooves',
  'Паук: Укус': 'Spider: Bite', 'Волк: Укус': 'Wolf: Bite',
  'Телекинетическое перемещение': 'Telekinetic Movement',
  'Восстановить телекинетическое перемещение': 'Restore Telekinetic Movement',
  'Страж': 'Sentinel', 'Натиск': 'Charger', 'Рубака': 'Slasher',
  'Сглаз': 'Hex', 'Порча': 'Bane', 'Благословение': 'Bless',
  'Убежище': 'Sanctuary', 'Злая насмешка': 'Vicious Mockery',
  'Огонь фей': 'Faerie Fire', 'Вызов на дуэль': 'Compelled Duel',
  'Речь златоуста': 'Enthrall', 'Ускорение': 'Haste',
  'Охраняющая связь': 'Warding Bond', 'Расщепление разума': 'Mind Sliver',
  'Сияющая кара': 'Shining Smite', 'Луч слабости': 'Ray of Enfeeblement',
  'Бесследное передвижение': 'Pass without Trace',
  'Морозная поступь': 'Frost Step',
};

const exactEnglishByNumber = {
  'ACT-general-defensive-duelist': 'Defensive Duelist: Parry',
  'ACT-general-shield-master-push': 'Shield Master: Bash (Push)',
  'ACT-general-shield-master-prone': 'Shield Master: Bash (Prone)',
  'ACT-general-charger-damage': 'Charger: Extra Damage',
  'ACT-general-charger-push': 'Charger: Push',
  'ACT-general-sentinel-stop': 'Sentinel: Stop',
  'ACT-general-inspiring-leader': 'Inspiring Leader: Speech',
  'ACT-general-poisoner': 'Poisoner: Apply Poison',
  'ACT-general-durable': 'Durable: Quick Recovery',
  'ACT-general-chef-treat': 'Chef: Eat a Treat',
  'ACT-general-crusher-push': 'Crusher: Push',
  'ACT-general-great-weapon-master-hew': 'Great Weapon Master: Hew',
  'ACT-general-slasher-slow': 'Slasher: Slow',
  'ACT-goliath-storm': "Storm's Thunder", 'ACT-goliath-stone': "Stone's Endurance",
  'ACT-goliath-hill': "Hill's Tumble", 'ACT-goliath-frost': "Frost's Chill",
  'ACT-goliath-cloud': "Cloud's Jaunt", 'ACT-goliath-fire': "Fire's Burn",
  'ACT-aasimar-revelation': 'Celestial Revelation',
  'ACT-bardic-inspiration': 'Bardic Inspiration',
  'ACT-lay-on-hands': 'Lay on Hands',
  'ACT-feat-lucky-disadvantage': 'Lucky: Impose Disadvantage',
  'ACT-feat-lucky-advantage': 'Lucky: Gain Advantage',
  'EFFECT-tactical-mind-die': 'Tactical Mind: Die',
  'EFFECT-item-crowbar-check': 'Crowbar — Advantage on Strength Checks',
  'EFFECT-item-ram-check': 'Portable Ram — +4 to Strength Checks',
  'EFFECT-item-magnifier-check': 'Magnifying Glass — Advantage on Investigation Checks',
  'EFFECT-item-map-check': 'Map — +5 to Survival Checks',
  'EFFECT-item-perfume-check': 'Perfume — Advantage on Persuasion Checks',
  'EFFECT-item-pole-check': 'Pole — Advantage on Athletics Checks',
  'EFFECT-item-caltrops-speed': 'Caltrops — Speed 0',
  'EFFECT-item-hunting-trap-speed': 'Hunting Trap — Speed 0',
  'EFFECT-0248': 'Topple', 'EFFECT-0249': 'Sap', 'EFFECT-0250': 'Slow',
  'EFFECT-0251': 'Nick', 'EFFECT-0252': 'Vex', 'EFFECT-0253': 'Push',
  'EFFECT-0254': 'Cleave', 'EFFECT-0255': 'Graze',
  'EFFECT-0258': 'Wizard Cantrips', 'EFFECT-0259': 'Steel Guardian',
  'EFF-weapon-mastery-2': 'Weapon Mastery', 'EFF-weapon-mastery-3': 'Weapon Mastery',
  'EFF-invoc-fiendish_vigor': 'Fiendish Vigor',
  'EFF-invoc-agonizing_blast': 'Agonizing Blast',
  'EFF-pact-tome': 'Pact of the Tome', 'EFF-pact-chain': 'Pact of the Chain',
  'EFF-pact-blade': 'Pact of the Blade',
  'EFFECT-0064': 'Evocation Savant', 'EFFECT-0065': 'Potent Cantrip',
  'EFFECT-0066': 'Sculpt Spells', 'EFFECT-0067': 'Empowered Evocation',
  'EFFECT-0068': 'Overchannel', 'EFFECT-0069': 'Illusion Savant',
  'EFFECT-0070': 'Improved Illusions', 'EFFECT-0072': 'Illusory Self',
  'EFFECT-0073': 'Illusory Reality', 'EFFECT-0074': 'Abjuration Savant',
  'EFFECT-0075': 'Arcane Ward', 'EFFECT-0076': 'Projected Ward',
  'EFFECT-0077': 'Spell Breaker', 'EFFECT-0078': 'Spell Resistance',
  'EFFECT-0079': 'Divination Savant', 'EFFECT-0080': 'Portent',
  'EFFECT-0081': 'Expert Divination', 'EFFECT-0082': 'The Third Eye',
  'EFFECT-0083': 'Greater Portent',
  'EFFECT-0187': 'Second-Story Work', 'EFFECT-0188': 'Supreme Sneak',
  'EFFECT-0189': 'Use Magic Device', 'EFFECT-0190': "Thief's Reflexes",
  'EFFECT-0197': 'Mage Hand Legerdemain', 'EFFECT-0198': 'Magical Ambush',
  'EFFECT-0200': 'Spell Thief', 'EFFECT-0201': 'Assassinate',
  'EFFECT-0202': "Assassin's Tools", 'EFFECT-0203': 'Infiltration Expertise',
  'EFFECT-0204': 'Envenom Weapons', 'EFFECT-0205': 'Death Strike',
  'EFFECT-0211': 'Primal Companion', 'EFFECT-0212': 'Exceptional Training',
  'EFFECT-0213': 'Bestial Fury', 'EFFECT-0215': 'Dreadful Strikes',
  'EFFECT-0216': 'Fey Wanderer Spells', 'EFFECT-0217': 'Otherworldly Glamour',
  'EFFECT-0218': 'Beguiling Twist', 'EFFECT-0219': 'Fey Reinforcements',
  'EFFECT-0220': 'Misty Wanderer', 'EFFECT-0221': 'Dread Ambusher',
  'EFFECT-0222': 'Gloom Stalker Spells', 'EFFECT-0223': 'Umbral Sight',
  'EFFECT-0224': 'Iron Mind', 'EFFECT-0225': "Stalker's Flurry",
  'EFFECT-0226': 'Shadowy Dodge',
  'EFFECT-0227': 'Psionic Spells', 'EFFECT-0229': 'Psionic Sorcery',
  'EFFECT-0230': 'Psychic Defenses', 'EFFECT-0231': 'Revelation in Flesh',
  'EFFECT-0232': 'Warping Implosion', 'EFFECT-0233': 'Draconic Resilience',
  'EFFECT-0234': 'Dragon Spells', 'EFFECT-0235': 'Elemental Affinity',
  'EFFECT-0236': 'Dragon Wings', 'EFFECT-0237': 'Dragon Companion',
  'EFFECT-0238': 'Clockwork Spells', 'EFFECT-0239': 'Restore Balance',
  'EFFECT-0240': 'Bastion of Law', 'EFFECT-0241': 'Trance of Order',
  'EFFECT-0242': 'Clockwork Cavalcade', 'EFFECT-0243': 'Wild Magic Surge',
  'EFFECT-0245': 'Bend Luck', 'EFFECT-0246': 'Controlled Chaos',
  'EFFECT-0191': 'Psionic Power', 'EFFECT-0192': 'Psychic Blades',
  'EFFECT-0193': 'Soul Blades', 'EFFECT-0194': 'Psychic Veil',
  'EFFECT-0195': 'Rend Mind', 'EFFECT-0196': 'Spellcasting',
  'EFFECT-0199': 'Versatile Trickster',
  'EFFECT-0179': 'Holy Nimbus', 'EFFECT-0180': 'Inspiring Smite',
  'EFFECT-0183': 'Aura of Alacrity', 'EFFECT-0184': 'Glorious Defense',
  'EFFECT-0185': 'Living Legend',
  'EFFECT-0169': 'Avenging Angel', 'EFFECT-0172': 'Aura of Warding',
  'EFFECT-0173': 'Undying Sentinel', 'EFFECT-0174': 'Elder Champion',
  'EFFECT-0177': 'Aura of Devotion', 'EFFECT-0178': 'Smite of Protection',
  'EFFECT-0164': 'Cloak of Shadows', 'EFFECT-0163': 'Improved Shadow Step',
  'EFFECT-0162': 'Shadow Step', 'EFFECT-0161': 'Shadow Arts',
  'EFFECT-0160': 'Elemental Epitome', 'EFFECT-0159': 'Stride of the Elements',
  'EFFECT-0158': 'Elemental Burst', 'EFFECT-0157': 'Elemental Attunement',
  'EFFECT-0155': 'Quivering Palm', 'EFFECT-0154': 'Fleet Step',
  'EFFECT-0153': 'Wholeness of Body', 'EFFECT-0152': 'Open Hand Technique',
  'EFFECT-0151': 'Hand of Ultimate Mercy',
  'EFFECT-0150': 'Flurry of Healing and Harm',
  'EFFECT-0149': 'Hand of Healing', 'EFFECT-0148': 'Implements of Mercy',
  'EFFECT-0146': 'Hand of Harm', 'EFFECT-0145': 'Searing Vengeance',
  'EFFECT-0144': 'Celestial Resistance', 'EFFECT-0143': 'Radiant Soul',
  'EFFECT-0141': 'Celestial Spells', 'EFFECT-0140': 'Hurl Through Hell',
  'EFFECT-0139': 'Fiendish Resilience', 'EFFECT-0138': "Dark One's Own Luck",
  'EFFECT-0137': 'Fiend Spells', 'EFFECT-0136': "Dark One's Blessing",
  'EFFECT-0135': 'Create Thrall', 'EFFECT-0134': 'Thought Shield',
  'EFFECT-0133': 'Eldritch Hex', 'EFFECT-0132': 'Clairvoyant Combatant',
  'EFFECT-0131': 'Psychic Spells', 'EFFECT-0130': 'Great Old One Spells',
  'EFFECT-0128': 'Beguiling Magic', 'EFFECT-0127': 'Bewitching Defenses',
  'EFFECT-0126': 'Misty Escape', 'EFFECT-0124': 'Archfey Spells',
  'EFFECT-0123': 'Corona of Light', 'EFFECT-0122': 'Improved Warding Flare',
  'EFFECT-0121': 'Warding Flare', 'EFFECT-0119': 'Light Domain Spells',
  'EFFECT-0118': 'Improved Duplicity',
  'EFFECT-0117': "Trickster's Transposition",
  'EFFECT-0116': 'Trickery Domain Spells',
  'EFFECT-0113': 'Supreme Healing', 'EFFECT-0112': 'Blessed Healer',
  'EFFECT-0110': 'Life Domain Spells', 'EFFECT-0109': 'Disciple of Life',
  'EFFECT-0108': 'Avatar of Battle', 'EFFECT-0107': "War God's Blessing",
  'EFFECT-0105': 'War Domain Spells', 'EFFECT-0104': 'Guided Strike',
  'EFFECT-0103': 'Oceanic Gift', 'EFFECT-0102': 'Stormborn',
  'EFFECT-0099': 'Circle of the Sea Spells',
  'EFFECT-0098': 'Lunar Form', 'EFFECT-0097': 'Moonlight Step',
  'EFFECT-0096': 'Improved Circle Forms',
  'EFFECT-0095': 'Circle of the Moon Spells', 'EFFECT-0094': 'Circle Forms',
  'EFFECT-0093': "Nature's Sanctuary", 'EFFECT-0092': "Nature's Ward",
  'EFFECT-0091': 'Natural Recovery', 'EFFECT-0089': 'Circle of the Land Spells',
  'EFFECT-0088': 'Full of Stars', 'EFFECT-0087': 'Twinkling Constellations',
  'EFFECT-0086': 'Cosmic Omen', 'EFFECT-0084': 'Star Map',
  'EFF-warlock-spellcasting': 'Warlock Spellcasting',
  'EFF-sorcerer-spellcasting': 'Sorcerer Spellcasting',
  'EFF-druid-spellcasting': 'Druid Spellcasting',
  'EFF-bard-spellcasting': 'Bard Spellcasting',
  'EFF-ranger-spellcasting': 'Ranger Spellcasting',
  'EFF-paladin-spellcasting': 'Paladin Spellcasting',
  'EFF-cleric-spellcasting': 'Cleric Spellcasting',
  'EFF-wizard-spellcasting': 'Wizard Spellcasting',
  'EFF-eldritch-invocations': 'Eldritch Invocations',
  'EFF-pact-boon': 'Pact Boon', 'EFF-font-of-magic': 'Font of Magic',
  'EFF-innate-sorcery': 'Innate Sorcery', 'EFF-primal-order': 'Primal Order',
  'EFF-deft-explorer': 'Deft Explorer', 'EFF-favored-enemy': 'Favored Enemy',
  'EFF-divine-sense': 'Divine Sense', 'EFF-uncanny-metabolism': 'Uncanny Metabolism',
  'EFF-unarmored-movement': 'Unarmored Movement', 'EFF-monk-focus': "Monk's Focus",
  'EFF-monk-unarmored': 'Unarmored Defense (Monk)',
  'EFF-martial-arts': 'Martial Arts', 'EFF-danger-sense': 'Danger Sense',
  'EFF-primal-knowledge': 'Primal Knowledge',
  'EFF-barbarian-unarmored': 'Unarmored Defense (Barbarian)',
  'EFF-channel-divinity': 'Channel Divinity', 'EFF-cunning-action': 'Cunning Action',
  'EFF-wizard-scholar': 'Scholar', 'EFF-sneak-attack': 'Sneak Attack',
  'EFF-skilled': 'Skilled — Skill Choice',
  'effect_barbarian_defense': 'Unarmored Defense',
  'effect_style_archery': 'Archery', 'effect_style_defence': 'Defense',
  'effect_style_duelling': 'Dueling', 'effect_style_two_weapons': 'Two-Weapon Fighting',
  'effect_style_two_handed_weapon': 'Great Weapon Fighting',
  'effect_hellish_resistance': 'Hellish Resistance',
  'fs_great_weapon': 'Fighting Style: Great Weapon Fighting',
  'fs_archery': 'Fighting Style: Archery',
  'fs_dueling': 'Fighting Style: Dueling',
  'EFF-feat-healer-reroll': 'Healer: Reroll Healing Die',
  'AUDIT-20260905-recharge': 'AUDIT-20260905 — Recharge Check',
  'raise_dead': 'Raise Dead',
  'PUG-SS01': 'Calloused Fists', 'PUG-F07': 'Pugilist Subclass',
  'PUG-F05': 'On a Roll', 'PUG-F15': 'Shake It Off',
  'EFFECT-0062': 'Superior Critical', 'EFFECT-0034': 'Battering Roots',
  'EFFECT-0011': 'Bonus Proficiencies', 'EFFECT-0014': 'Peerless Skill',
  'RE-sub-wings': 'Celestial Wings', 'RE-aasimar-2': 'Celestial Resistance',
  'asi_ability_choice': 'Ability Score Improvement — Rules',
  'EFF-feat-brawler-push': 'Push', 'RE-human-1': 'Resourceful',
  'tabaxi_unarmed_strike': "Cat's Claws",
};

const abilityEnglish = { Сила: 'Strength', Ловкость: 'Dexterity', Телосложение: 'Constitution',
  Интеллект: 'Intelligence', Мудрость: 'Wisdom', Харизма: 'Charisma' };
function translateSuffix(suffix) {
  const fixed = {
    'Длительный эффект': 'Ongoing Effect', 'Изменение скорости': 'Speed Change',
    'Дополнительный урон при попадании': 'Extra Damage on Hit',
    'Доступен особый срабатывающий эффект': 'Triggered Effect Available',
    'Иммунитет к состоянию': 'Condition Immunity',
    'Магическая связь': 'Magical Connection', 'Защита от падения': 'Fall Protection',
    'Отложенный урон': 'Delayed Damage', 'Скорость снижена на 10 футов': 'Speed Reduced by 10 Feet',
    'Нельзя восстанавливать хиты': 'Cannot Regain Hit Points',
    'Особый способ перемещения': 'Special Movement',
    'Защита от выбора целью': 'Targeting Protection',
    'Чувство: darkvision': 'Darkvision',
    'Установленное значение: ac_base': 'Fixed Armor Class',
  };
  if (fixed[suffix]) return fixed[suffix];
  const roll = '(?:спасброски|броски атаки|проверки характеристик)';
  const rollEnglish = { спасброски: 'Saving Throws', 'броски атаки': 'Attack Rolls',
    'проверки характеристик': 'Ability Checks' };
  let match = new RegExp(`^(Преимущество|Помеха): (${roll})(?: \\(([^)]*)\\))?$`).exec(suffix);
  if (match) {
    const ability = abilityEnglish[match[3]] || match[3];
    return `${match[1] === 'Преимущество' ? 'Advantage' : 'Disadvantage'} on ${ability ? `${ability} ` : ''}${rollEnglish[match[2]]}`;
  }
  match = /^([+−-]1к4): (спасброски|броски атаки|проверки характеристик)(?: \(([^)]+)\))?$/.exec(suffix);
  if (match) return `${match[1].replace('к', 'd')} to ${match[3] ? `${abilityEnglish[match[3]] || match[3]} ` : ''}${rollEnglish[match[2]]}`;
  match = /^Сопротивление урону: (.+)$/.exec(suffix);
  if (match) return `Resistance to ${match[1][0].toUpperCase()}${match[1].slice(1)} Damage`;
  match = /^Скорость: (.+)$/.exec(suffix);
  if (match) return `${match[1][0].toUpperCase()}${match[1].slice(1)} Speed`;
  return null;
}

function translatedCompositeName(kind, row) {
  if (row.card_number.startsWith('EFF-general-FEAT-')) {
    const feat = source.feats.find((item) => item.card_number === row.card_number.slice('EFF-general-'.length));
    if (feat) return `${originalEnglish('feats', feat)} — Rules`;
  }
  const caster = /^caster-(bard|cleric|druid|paladin|ranger|sorcerer|warlock)-(cantrips|spells)(?:-l(\d+)(-bonus)?)?$/.exec(row.card_number);
  if (caster) {
    const className = caster[1][0].toUpperCase() + caster[1].slice(1);
    const content = caster[2] === 'cantrips' ? 'Cantrips' : 'Spells';
    return `${className} ${content}${caster[3] ? `: Level ${caster[3]}${caster[4] ? ' Bonus Spell' : ' Spell'}` : ''}`;
  }
  if (/^pf_[2-7]$/.test(row.card_number)) return `Feat Choice — Slot ${row.card_number.slice(3)}`;
  const ready = /^Ускоренное заклинание: готово$/.exec(row.name);
  if (ready) return 'Quickened Spell: Ready';
  const transmuted = /^Преобразованное заклинание: (.+)$/.exec(row.name);
  if (transmuted) return `Transmuted Spell: ${transmuted[1][0].toUpperCase()}${transmuted[1].slice(1)}`;
  const parts = row.name.split(' — ');
  if (parts.length !== 2) return null;
  const base = exactEnglish[parts[0]] || reference[parts[0].toLocaleLowerCase('ru')]
    || source.spells.find((item) => item.name === parts[0])?.name_en;
  const suffix = translateSuffix(parts[1]);
  return base && suffix ? `${base} — ${suffix}` : null;
}

const actionDescriptions = {
  'ACT-general-defensive-duelist': ':reaction:**Защитный дуэлянт.** Когда по вам попадают атакой, добавьте бонус мастерства к КД против этой атаки и до начала вашего следующего хода.',
  'ACT-general-shield-master-push': '**Мастер щитов.** Раз за ход после попадания рукопашной атакой с щитом цель совершает спасбросок Силы. При провале оттолкните её на 5 футов.',
  'ACT-general-shield-master-prone': '**Мастер щитов.** Раз за ход после попадания рукопашной атакой с щитом цель совершает спасбросок Силы. При провале она получает состояние Опрокинутый.',
  'ACT-general-charger-damage': '**Натиск.** После подходящего перемещения и попадания атакой нанесите цели дополнительный урон 1к8. Доступно один раз за ход.',
  'ACT-general-charger-push': '**Натиск.** После подходящего перемещения и попадания атакой оттолкните цель на 10 футов, если она не более чем на один размер больше вас. Доступно один раз за ход.',
  'ACT-general-sentinel-stop': '**Страж.** При попадании провоцированной атакой скорость цели становится 0 до конца текущего хода.',
  'ACT-general-inspiring-leader': '**Воодушевляющее выступление.** После отдыха выберите до шести существ в пределах 30 футов. Они получают временные хиты в размере вашего уровня плюс модификатор заклинательной характеристики.',
  'ACT-general-poisoner': ':bonus_action:**Нанести яд.** Израсходуйте дозу яда, чтобы на 1 минуту получить эффект сильного яда.',
  'ACT-general-durable': ':bonus_action:**Быстрое восстановление.** Потратьте одну Кость хитов и восстановите хиты с учётом модификатора Телосложения.',
  'ACT-general-chef-treat': ':bonus_action:**Съесть угощение.** Потратьте приготовленное угощение и получите временные хиты в размере бонуса мастерства.',
  'ACT-general-crusher-push': '**Крушитель.** Раз за ход после попадания оружием с дробящим уроном передвиньте цель на 5 футов, если она не более чем на один размер больше вас.',
  'ACT-general-great-weapon-master-hew': ':bonus_action:**Добивание.** После выполнения условия черты «Мастер большого оружия» совершите дополнительную рукопашную атаку оружием.',
  'ACT-general-slasher-slow': '**Рубака.** Раз за ход после попадания оружием с рубящим уроном уменьшите скорость цели до начала вашего следующего хода.',
};

const effectDescriptions = {
  'EFF-invoc-ascendant-step': 'Вы можете накладывать «Левитацию» на себя без траты ячейки заклинания.',
  'EFF-invoc-eldritch-smite': 'При попадании договорным оружием можете потратить ячейку магии договора: цель получает дополнительный урон силовым полем, а существо размером не больше Огромного опрокидывается. Один раз за ход.',
  'EFF-invoc-eldritch-spear': 'Выберите заговор колдуна, который наносит урон и имеет дистанцию не меньше 10 футов. Его дистанция увеличивается на 30 футов за каждый уровень колдуна.',
  'EFF-invoc-gaze-two-minds': ':bonus_action:Коснитесь согласного союзника. До конца следующего хода вы можете воспринимать мир его чувствами и использовать его местоположение для сотворения заклинаний в пределах 60 футов; связь поддерживается бонусным действием.',
  'EFF-invoc-gift-depths': 'Вы получаете скорость плавания, равную вашей скорости, можете дышать под водой и раз за долгий отдых накладывать «Подводное дыхание» без траты ячейки.',
  'EFF-invoc-investment-chain': 'Ваш фамильяр договора цепи получает дополнительные преимущества: скорость полёта или плавания 40 футов, выбор типа урона, команды бонусным действием и защитную реакцию.',
  'EFF-invoc-lessons-first-ones': 'Выберите одну черту происхождения. Это воззвание можно выбирать повторно, каждый раз получая другую доступную черту.',
  'EFF-invoc-master-myriad-forms': 'Вы можете накладывать «Изменение облика» на себя без траты ячейки заклинания.',
  'EFF-invoc-misty-visions': 'Вы можете накладывать «Безмолвный образ» без траты ячейки заклинания.',
  'EFF-invoc-one-with-shadows': 'При тусклом свете или в темноте вы можете накладывать «Невидимость» на себя без траты ячейки заклинания.',
  'EFF-invoc-otherworldly-leap': 'Вы можете накладывать «Прыжок» на себя без траты ячейки заклинания.',
  'EFF-invoc-repelling-blast': 'Выберите наносящий урон заговор колдуна с броском атаки. После попадания этим заговором можете оттолкнуть существо размером не больше Большого на 10 футов.',
  'EFF-invoc-thirsting-blade': 'Когда вы совершаете действие Атака договорным оружием, можете атаковать им дважды вместо одного раза.',
  'caster-bard-spells-l5-bonus': 'При получении 5-го уровня выберите ещё одно доступное заклинание барда и подготовьте его.',
  'caster-cleric-spells-l5-bonus': 'При получении 5-го уровня выберите ещё одно доступное заклинание жреца и подготовьте его.',
  'caster-druid-spells-l5-bonus': 'При получении 5-го уровня выберите ещё одно доступное заклинание друида и подготовьте его.',
  'caster-sorcerer-spells-l4': 'При получении 4-го уровня выберите ещё одно доступное заклинание чародея.',
  'EFFECT-item-crowbar-check': 'Ломик даёт преимущество на следующую проверку Силы, если применим к задаче.',
  'EFFECT-item-ram-check': 'Портативный таран даёт +4 к следующей проверке Силы, связанной с его применением.',
  'EFFECT-item-magnifier-check': 'Увеличительное стекло даёт преимущество на следующую проверку Расследования, если помогает рассмотреть детали.',
  'EFFECT-item-map-check': 'Карта даёт +5 к следующей проверке Выживания, связанной с ориентированием.',
  'EFFECT-item-perfume-check': 'Духи дают преимущество на следующую проверку Убеждения, если их использование уместно.',
  'EFFECT-item-pole-check': 'Шест даёт преимущество на следующую проверку Атлетики, если помогает при движении.',
  'EFFECT-item-caltrops-speed': 'Наступившее на колючки существо имеет скорость 0 до начала своего следующего хода.',
  'EFFECT-item-hunting-trap-speed': 'Пойманное охотничьим капканом существо имеет скорость 0, пока удерживается ловушкой.',
};
for (let slot = 2; slot <= 7; slot++) {
  effectDescriptions[`pf_${slot}`] = 'Получите ещё одну черту из доступных черт происхождения или общих черт.';
}

const badPrefixes = {
  'Ведьмин снаряд': 'Луч потрескивающей энергии',
  'Защита от добра и зла': 'Пока заклинание активно',
  'Иллюзорные письмена': 'Вы пишете на пергаменте',
  'Опознание': 'Вы касаетесь объекта',
  'Цветной шарик': 'Вы бросаете энергетический шарик',
  'Вечный огонь': 'Из объекта, которого вы касаетесь',
  'Вызов Зверя': 'Вы призываете духа зверя',
  'Кислотная стрела Мельфа': 'К цели, находящейся в пределах дистанции',
  'Охраняющая связь': 'Вы касаетесь другого согласного существа',
};

// Short front-of-card summaries for spells whose opening sentence only names
// a target, material, or first item in a longer choice list.
const spellSummaries = {
  'Искусство друидов': 'Создайте один небольшой эффект природы: предскажите погоду, ускорьте цветение, вызовите безвредное ощущение или зажгите либо потушите небольшой огонь.',
  'Воплощение силы': 'До конца следующего хода выберите два усиления заклинаний: лучший результат урона, преимущество атак, помеху спасброскам целей или игнорирование сопротивления. После окончания возможны психический урон и истощение.',
  'Завеса стрел': 'Разместите до четырёх стрел или болтов. Когда другое существо входит в область рядом с ними или заканчивает там ход, один боеприпас вылетает: при провале спасброска Ловкости цель получает 2к4 колющего урона.',
  'Раскалённый металл': 'Раскалите видимый металлический предмет. Касающиеся его существа получают 2к8 огненного урона; пока заклинание активно, вы можете повторять урон бонусным действием.',
  'Замедление': 'До шести существ в области совершают спасбросок Мудрости. При провале их скорость уменьшается вдвое, КД и спасброски Ловкости получают штраф −2, реакции недоступны, а действия ограничены.',
  'Духовные стражи': 'Духи окружают вас в 15-футовой эманации. Выбранные вами существа не затрагиваются; остальные замедляются и при провале спасброска Мудрости получают 3к8 урона излучением или некротической энергией.',
  'Призрачный скакун': 'Создайте полуреального ездового скакуна для себя или другого существа. Его скорость — 100 футов; он исчезает после окончания заклинания или получения урона.',
  'Призыв Животных': 'Призовите стаю призрачных животных, которую можно перемещать в свой ход. Существа рядом со стаей совершают спасбросок Ловкости и при провале получают 3к10 рубящего урона.',
  'Призыв молнии': 'Создайте грозовое облако и поразите выбранную точку молнией: существа рядом совершают спасбросок Ловкости и получают 3к10 урона электричеством при провале, половину — при успехе. Пока заклинание активно, удар можно повторять действием.',
  'Призыв лесных обитателей': 'Духи природы окружают вас в 10-футовой эманации. Существа в ней могут получить 5к8 урона чистой силой при провале спасброска Мудрости. Пока заклинание активно, Отход доступен бонусным действием.',
  'Длань Бигби': 'Создайте большую магическую руку. При сотворении и бонусным действием перемещайте её и выбирайте эффект: удар, толчок, захват или укрытие.',
  'Распад': 'Цель совершает спасбросок Ловкости. При провале она получает 10к6 + 40 урона чистой силой; существо, чьи хиты упали до 0, превращается в прах. Заклинание также разрушает немагические предметы и творения магической силы.',
  'Запрет': 'Защитите большую область от телепортации и планарного перемещения. Выбранные типы существ, входящие в область или начинающие в ней ход, получают 5к10 урона излучением или некротической энергией.',
  'Знак': 'Нанесите магический знак с выбранным условием срабатывания. После срабатывания он воздействует на существ в области одним из эффектов: урон, страх, боль, сон, ошеломление или разногласие.',
  'Радужные брызги': 'Выпустите из себя восемь лучей по 60-футовому конусу. Каждое существо совершает спасбросок Ловкости; случайный луч определяет тип урона или другой эффект.',
  'Антипатия/симпатия': 'Выбранный тип существ при приближении к цели совершает спасбросок Мудрости. Антипатия пугает и отталкивает их от цели, симпатия очаровывает и притягивает к ней.',
  'Божественное слово': 'Выбранные существа совершают спасбросок Харизмы. При провале эффект зависит от их текущих хитов — от глухоты до смерти; определённые потусторонние существа также изгоняются на родной план.',
};

const terms = [
  ['temporary_hit_points', /временн(?:ые|ых|ыми|ым|ую|ой) хит(?:ы|ов|ами|ов)?/iu],
  ['death_saving_throw', /спасброс(?:ок|ка|ки|ков|ком) от смерти/iu],
  ['saving_throw_', /спасброс(?:ок|ка|ки|ков|ком)/iu],
  ['spell_attack', /(?:атак(?:а|у|ой|и) заклинанием|атакой заклинания)/iu],
  ['attack_roll', /брос(?:ок|ка|ки|ком) атаки/iu],
  ['ability_check', /проверк(?:а|у|ой|и) характеристик(?:и|у|ой)?/iu],
  ['concentration', /концентраци(?:я|и|ю|ей)/iu],
  ['long_rest', /долг(?:ий|ого|ом|им|ие|ого) отдых(?:а|е|ом)?/iu],
  ['short_rest', /коротк(?:ий|ого|ом|им|ие) отдых(?:а|е|ом)?/iu],
  ['advantage', /преимуществ(?:ами|ах|ом|а|о|у|е)(?![а-яё])/iu],
  ['disadvantage', /помех(?:ой|ами|ах|а|и|у|е)(?![а-яё])/iu],
  ['armor_class', /(?<![А-Яа-яЁё])К[ДЗ](?![А-Яа-яЁё])/u],
  ['prone', /(?:опрокинут(?:ый|ого|ым|ому|ые|ых)|сбит(?:ый|ого|ым) с ног)/iu],
  ['grappled', /схвачен(?:ный|ного|ным|ные|ных)/iu],
  ['restrained', /опутан(?:ный|ного|ным|ные|ных)/iu],
  ['charmed', /очарован(?:ный|ного|ным|ные|ных)/iu],
  ['frightened', /испуган(?:ный|ного|ным|ные|ных)/iu],
  ['invisible', /невидим(?:ый|ого|ым|ые|ых|ость|ости)/iu],
  ['poisoned', /отравлен(?:ный|ного|ным|ные|ных)/iu],
  ['stunned', /ошеломл[её]н(?:ный|ного|ным|ные|ных)/iu],
  ['paralyzed', /парализован(?:ный|ного|ным|ные|ных)/iu],
  ['incapacitated', /недееспособ(?:ный|ного|ным|ные|ных)/iu],
  ['difficult_terrain', /труднопроходим(?:ая|ой|ую|ой) местност(?:ь|и|ью)/iu],
  ['darkvision', /т[её]мн(?:ое|ого|ым|ым) зрени(?:е|я|ем)/iu],
  ['bright_light', /ярк(?:ий|ого|им|ом) свет(?:а|е|ом)?/iu],
  ['dim_light', /тускл(?:ый|ого|ым|ом) свет(?:а|е|ом)?/iu],
  ['cover', /укрыти(?:е|я|ем|ю)/iu],
  ['resistance', /сопротивлени(?:е|я|ем|ю)/iu],
  ['vulnerability', /уязвимост(?:ь|и|ью)/iu],
  ['immunity', /иммунитет(?:а|ом|у|е)?/iu],
  ['teleportation', /телепортаци(?:я|и|ю|ей)/iu],
  ['ritual', /ритуал(?:а|ом|у|е)?/iu],
  ['hit_points', /(?:хит(?:ы|ов|ами|ам)|очк(?:и|ов) здоровья)/iu],
];

const damageWords = [
  ['acid', /кислот(?:ой|ного|ный|ным|е|а|у|ные|ных)/giu],
  ['cold', /холод(?:ом|ного|ный|ным|а|у|е|ные|ных)/giu],
  ['fire', /огн(?:ём|ем|енного|енный|енным|я|ю|е|ь|енные|енных)/giu],
  ['force', /силов(?:ым|ого|ой|ые|ых|ому)/giu],
  ['lightning', /электричеств(?:ом|а|у|е)|молни(?:ей|и|ю|я)/giu],
  ['necrotic', /некротическ(?:им|ого|ий|им|ой|ому|ие|их)/giu],
  ['poison', /яд(?:ом|а|у|е)|ядовит(?:ым|ого|ый|ые|ых)/giu],
  ['psychic', /психическ(?:им|ого|ий|им|ой|ому|ие|их)/giu],
  ['radiant', /излучени(?:ем|я|е|ю)|лучист(?:ым|ого|ый|ые|ых)/giu],
  ['thunder', /громов(?:ым|ого|ой|ые|ых)|звуков(?:ым|ого|ой|ые|ых)/giu],
  ['bludgeoning', /дробящ(?:им|его|ий|ем|ему|ие|их)/giu],
  ['piercing', /колющ(?:им|его|ий|ем|ему|ие|их)/giu],
  ['slashing', /рубящ(?:им|его|ий|ем|ему|ие|их)/giu],
];

const protectedTokens = /\[\[[^\]]+\]\]|\[(?:acid|cold|fire|force|lightning|necrotic|poison|psychic|radiant|thunder|bludgeoning|piercing|slashing|healing)\][\s\S]*?\[\/(?:acid|cold|fire|force|lightning|necrotic|poison|psychic|radiant|thunder|bludgeoning|piercing|slashing|healing)\]|:[a-z_]+:/g;
function editPlain(text, transform) {
  const result = [];
  let cursor = 0;
  for (const token of text.matchAll(protectedTokens)) {
    result.push(transform(text.slice(cursor, token.index)), token[0]);
    cursor = token.index + token[0].length;
  }
  result.push(transform(text.slice(cursor)));
  return result.join('');
}

function paragraphize(input) {
  return input.split(/\n\s*\n/).map((paragraph) => {
    if (paragraph.length < 310 || /^\s*(?:[-•]|\d+[.)])\s/m.test(paragraph)) return paragraph;
    const sentences = paragraph.split(/(?<=[.!?])\s+(?=[А-ЯЁ«])/u);
    const groups = [];
    let group = '';
    for (const sentence of sentences) {
      const next = sentence.trim();
      if (!next) continue;
      if (group.length >= 220 && group.length + next.length > 350) {
        groups.push(group);
        group = next;
      } else group += `${group ? ' ' : ''}${next}`;
    }
    if (group) groups.push(group);
    return groups.join('\n\n');
  }).join('\n\n');
}

function summary(input, max = 350) {
  const plain = input
    .replace(/\[\[([^|]+)\|[^\]]+\]\]/g, '$1')
    .replace(/\[([a-z_]+)\]([\s\S]*?)\[\/\1\]/g, '$2')
    .replace(/:[a-z_]+:/g, '')
    .replace(/\*\*|__|\*/g, '')
    .replace(/\n+/g, ' ').trim();
  if (plain.length <= max) return plain;
  const sentences = plain.split(/(?<=[.!?])\s+(?=[А-ЯЁ«])/u);
  let result = '';
  for (const sentence of sentences) {
    const next = sentence.trim();
    if (!next) continue;
    if (result && result.length + next.length > max) break;
    if (next.length > max && !result) {
      const cut = Math.max(next.lastIndexOf(';', max), next.lastIndexOf(',', max));
      result = (cut >= 120 ? next.slice(0, cut) : next.slice(0, max).replace(/\s+\S*$/, '')).replace(/[,:;\s]+$/, '') + '.';
      break;
    }
    result += `${result ? ' ' : ''}${next}`;
    if (result.length >= 160) break;
  }
  return result || plain.slice(0, max).trim();
}

function formatText(raw) {
  if (raw == null) return null;
  let text = raw.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  text = text.replace(/(?<![А-Яа-яЁё])КЗ(?![А-Яа-яЁё])/g, 'КД');
  text = text.replace(/(^|\n\n)\*\*([^*\n]+?)\. +\*\*/g, '$1**$2.** ');
  text = paragraphize(text);
  text = text.replace(/(^|\n\n)(При попадании|При провале|При успехе|Провал|Успех|На высоких уровнях|Повышение характеристики|Ограничение)([.:])\s*/giu, (_m, br, label, p) => `${br}**${label}${p}** `);
  text = editPlain(text, (piece) => piece.replace(/(?<![А-Яа-яЁё])(Один раз за (?:ход|раунд|долгий отдых)|Раз за (?:ход|раунд))(?![А-Яа-яЁё])/giu, '__$1__'));
  // Add icons only to explicit action/reaction costs. Existing icons remain protected.
  let actionIconUsed = /:(?:action|bonus_action|reaction):/.test(text);
  text = editPlain(text, (piece) => piece.replace(/(?:бонусным действием|действием|реакцией|реакцию|действие Магия)/giu, (word) => {
    const lower = word.toLowerCase();
    const icon = lower.includes('бонусным') ? ':bonus_action:' : lower.includes('реакц') ? ':reaction:' : ':action:';
    if (actionIconUsed) return word;
    actionIconUsed = true;
    return icon + word;
  }));
  // Color just the damage type word, in a phrase about dealing damage.
  const damageIconUsed = new Set();
  text = editPlain(text, (piece) => {
    let result = piece;
    for (const [type, expression] of damageWords) {
      result = result.replace(expression, (word, index, full) => {
        const near = full.slice(Math.max(0, index - 45), Math.min(full.length, index + word.length + 25));
        if (!/(?:урон|нанос|получа|\d+[кd]\d+)/iu.test(near)) return word;
        const icon = damageIconUsed.has(type) ? '' : `:${type}:`;
        damageIconUsed.add(type);
        return `[${type}]${icon}${word}[/${type}]`;
      });
    }
    return result;
  });
  const used = new Set([...text.matchAll(/\[\[[^|]+\|concept:([^\]]+)\]\]/g)].map((m) => m[1]));
  // Resolve a small number of distinct, actually mentioned glossary terms per field.
  for (const [id, expression] of terms) {
    if (!conceptIDs.has(id) || used.has(id) || used.size >= 7) continue;
    let linked = false;
    text = editPlain(text, (piece) => linked ? piece : piece.replace(expression, (word) => {
      linked = true;
      return `[[${word}|concept:${id}]]`;
    }));
    if (linked) used.add(id);
  }
  return text.replace(/\n{3,}/g, '\n\n');
}

function originalEnglish(kind, row) {
  if (exactEnglishByNumber[row.card_number]) return exactEnglishByNumber[row.card_number];
  const exact = exactEnglish[row.name];
  if (exact) return exact;
  const composite = translatedCompositeName(kind, row);
  if (composite) return composite;
  if (row.name_en?.trim() && !/[А-Яа-яЁё]/.test(row.name_en)) return row.name_en.trim();
  const fromBook = reference[row.name.toLocaleLowerCase('ru')];
  if (fromBook) return fromBook;
  const sameName = ['spells', 'feats', 'actions', 'effects']
    .flatMap((catalog) => source[catalog]).find((item) => item.name === row.name && item.name_en);
  if (sameName) return sameName.name_en.trim();
  const translated = draft[row.name]?.trim();
  if (!translated) throw new Error(`Missing English title: ${kind}/${row.card_number}/${row.name}`);
  return translated.replace(/^The (?=[A-Z])/, '');
}

function originalSource(kind, row) {
  const number = row.card_number;
  if (kind === 'spells') return row.source ? "Player's Handbook" : 'Bag of Holding';
  if (kind === 'feats') return "Player's Handbook";
  if (/next\.dnd\.su\/class\/pugilist/i.test(row.source || '')) return 'Bag of Holding';
  if (/^RL-MA-|^MONSTER-ACTION-|^RL-ME-|^ACT-wild-shape-(?:rat|riding-horse|spider|wolf)-/.test(number)) return 'Monster Manual';
  if (/^AUDIT-|^ACTION-000[1-7]$|^tabaxi_unarmed_strike$|^EFF-tabaxi-|^EFF-warforged-|^VAR-|^pf_[1-7]$|^caster-.*-bonus$|^EFFECT-item-|^EFFECT-runtime-|^EFFECT-(?:zone-of-truth|calm-emotions|stinking-cloud|feign-death|hypnotic-pattern|wild-shape)-/.test(number)) return 'Bag of Holding';
  if (['EFFECT-0256', 'EFFECT-0258', 'EFFECT-0259'].includes(number)) return 'Bag of Holding';
  if (row.source?.startsWith('PHB') || row.source?.startsWith('Player’s Handbook')) return "Player's Handbook";
  if (row.source === 'SRD 5.2.1') return "Player's Handbook";
  return "Player's Handbook";
}

const patch = { schema_version: 1, snapshot: '2026-09-27', catalogs: {} };
const preview = { catalogs: {}, stats: {} };
for (const kind of ['spells', 'feats', 'actions', 'effects']) {
  patch.catalogs[kind] = [];
  preview.catalogs[kind] = [];
  let shortened = 0;
  for (const row of source[kind]) {
    let description = row.description || '';
    let detailed = row.detailed_description || null;
    if (kind === 'actions' && actionDescriptions[row.card_number]) description = actionDescriptions[row.card_number];
    if (kind === 'effects' && effectDescriptions[row.card_number]) description = effectDescriptions[row.card_number];
    if ((kind === 'actions' || kind === 'effects') && (!description || description.trim() === row.name.trim())) {
      throw new Error(`Name-only description was not enriched: ${kind}/${row.card_number}`);
    }
    if (kind === 'spells' && badPrefixes[row.name]) {
      const at = description.indexOf(badPrefixes[row.name]);
      if (at < 0) throw new Error(`Cannot remove truncated source header: ${row.name}`);
      description = description.slice(at);
    }
    const limit = kind === 'spells' || kind === 'feats' ? 400 : 620;
    if (description.length > limit) {
      if (!detailed) detailed = description;
      description = kind === 'spells' && spellSummaries[row.name]
        ? spellSummaries[row.name]
        : summary(description, kind === 'spells' ? 340 : 390);
      shortened++;
    }
    const updated = {
      description: formatText(description),
      detailed_description: formatText(detailed),
      name_en: originalEnglish(kind, row),
      source: originalSource(kind, row),
    };
    if (kind === 'spells') updated.upcast_description = formatText(row.upcast_description || null);
    const old = Object.fromEntries(Object.keys(updated).map((field) => [field, row[field] || null]));
    patch.catalogs[kind].push({ id: row.id, card_number: row.card_number, old, updated });
    preview.catalogs[kind].push({ card_number: row.card_number, name: row.name, ...updated });
  }
  preview.stats[kind] = { rows: source[kind].length, shortened };
}
if (process.argv[1]?.endsWith('build-readable-catalog.mjs')) {
  await fs.writeFile(path.join(root, 'backend/migrations/readable_catalog_270.json'), `${JSON.stringify(patch)}\n`);
  await fs.writeFile(path.join(out, 'preview.json'), `${JSON.stringify(preview, null, 2)}\n`);
  console.log(preview.stats);
}

export { formatText, summary };
