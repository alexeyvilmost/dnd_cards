/**
 * Exact PHB 2024 level-3 expansion denominator.
 *
 * Keep this list independent from the database. Production is audited against
 * the reviewed catalog instead of treating whichever rows happen to exist as
 * the definition of done.
 */

const entity = (cardNumber, label, expected = {}) => Object.freeze({
  key: cardNumber.toLowerCase(),
  label,
  selector: Object.freeze({ cardNumber }),
  expected: Object.freeze(expected),
});

const rows = (values, expected = {}) => Object.freeze(values.map(([cardNumber, label, extra]) => (
  entity(cardNumber, label, { ...expected, ...(extra ?? {}) })
)));

export const LEVEL3_MINI_MVP_MANIFEST_SCHEMA_VERSION = 1;

export const LEVEL3_MINI_MVP_COLLECTION_SIZES = Object.freeze({
  baseClasses: 12,
  subclasses: 48,
  speciesUnlocks: 7,
  secondLevelSpells: 64,
});

const PHB = Object.freeze({ source: 'PHB 2024' });

const subclassRows = (parentCardNumber, values) => rows(values, {
  ...PHB,
  level: 3,
  parentCardNumber,
});

export const LEVEL3_MINI_MVP_MANIFEST = Object.freeze({
  schemaVersion: LEVEL3_MINI_MVP_MANIFEST_SCHEMA_VERSION,
  manifestVersion: 'level3-mini-mvp-v1',
  release: 'mini-mvp-level3',
  systemId: 'dnd5e-2024',
  characterLevel: 3,
  collections: Object.freeze({
    baseClasses: rows([
      ['CLASS-barbarian', 'Варвар'], ['CLASS-bard', 'Бард'],
      ['CLASS-cleric', 'Жрец'], ['CLASS-druid', 'Друид'],
      ['CLASS-warrior', 'Воин'], ['CLASS-monk', 'Монах'],
      ['CLASS-paladin', 'Паладин'], ['CLASS-ranger', 'Следопыт'],
      ['CLASS-rogue', 'Плут'], ['CLASS-sorcerer', 'Чародей'],
      ['CLASS-warlock', 'Колдун'], ['CLASS-wizard', 'Волшебник'],
    ], { ...PHB, level: 3 }),
    subclasses: Object.freeze([
      ...subclassRows('CLASS-barbarian', [
        ['barbarian_berserker', 'Путь берсерка'],
        ['barbarian_wild_heart', 'Путь дикого сердца'],
        ['barbarian_world_tree', 'Путь Мирового Древа'],
        ['barbarian_zealot', 'Путь фанатика'],
      ]),
      ...subclassRows('CLASS-bard', [
        ['bard_dance', 'Коллегия танца'], ['bard_glamour', 'Коллегия очарования'],
        ['bard_lore', 'Коллегия знаний'], ['bard_valor', 'Коллегия доблести'],
      ]),
      ...subclassRows('CLASS-cleric', [
        ['cleric_life_domain', 'Домен жизни'], ['cleric_light_domain', 'Домен света'],
        ['cleric_trickery_domain', 'Домен обмана'], ['cleric_war_domain', 'Домен войны'],
      ]),
      ...subclassRows('CLASS-druid', [
        ['druid_circle_of_land', 'Круг земли'], ['druid_circle_of_moon', 'Круг луны'],
        ['druid_circle_of_sea', 'Круг моря'], ['druid_circle_of_stars', 'Круг звёзд'],
      ]),
      ...subclassRows('CLASS-warrior', [
        ['fighter_battle_master', 'Мастер боя'], ['fighter_champion', 'Чемпион'],
        ['fighter_eldritch_knight', 'Мистический рыцарь'], ['fighter_psi_warrior', 'Пси-воин'],
      ]),
      ...subclassRows('CLASS-monk', [
        ['monk_elements', 'Воин стихий'], ['monk_mercy', 'Воин милосердия'],
        ['monk_open_hand', 'Воин открытой ладони'], ['monk_shadow', 'Воин тени'],
      ]),
      ...subclassRows('CLASS-paladin', [
        ['paladin_oath_ancients', 'Клятва древних'], ['paladin_oath_devotion', 'Клятва преданности'],
        ['paladin_oath_glory', 'Клятва славы'], ['paladin_oath_vengeance', 'Клятва возмездия'],
      ]),
      ...subclassRows('CLASS-ranger', [
        ['ranger_beast_master', 'Повелитель зверей'], ['ranger_fey_wanderer', 'Странник фей'],
        ['ranger_gloom_stalker', 'Сумрачный охотник'], ['ranger_hunter', 'Охотник'],
      ]),
      ...subclassRows('CLASS-rogue', [
        ['rogue_arcane_trickster', 'Мистический ловкач'], ['rogue_assassin', 'Убийца'],
        ['rogue_soulknife', 'Клинок душ'], ['rogue_thief', 'Вор'],
      ]),
      ...subclassRows('CLASS-sorcerer', [
        ['sorcerer_aberrant', 'Аберрантное чародейство'], ['sorcerer_clockwork', 'Заводное чародейство'],
        ['sorcerer_draconic', 'Драконье чародейство'], ['sorcerer_wild_magic', 'Чародейство дикой магии'],
      ]),
      ...subclassRows('CLASS-warlock', [
        ['warlock_archfey', 'Покровительство Архифеи'], ['warlock_celestial', 'Покровительство Небожителя'],
        ['warlock_fiend', 'Покровительство Исчадия'], ['warlock_great_old_one', 'Покровительство Великого Древнего'],
      ]),
      ...subclassRows('CLASS-wizard', [
        ['wizard_abjurer', 'Оградитель'], ['wizard_diviner', 'Прорицатель'],
        ['wizard_evoker', 'Воплотитель'], ['wizard_illusionist', 'Иллюзионист'],
      ]),
    ]),
    speciesUnlocks: rows([
      ['RACE-0010', 'Аасимар: Небесное откровение', { featureCardNumber: 'ACT-aasimar-revelation' }],
      ['sub-drow', 'Дроу: Огонь фей', { spellCardNumber: 'faerie_fire' }],
      ['sub-high_elf', 'Высший эльф: Обнаружение магии', { spellCardNumber: 'detect_magic' }],
      ['sub-wood_elf', 'Лесной эльф: Скороход', { spellCardNumber: 'longstrider' }],
      ['sub-abyssal', 'Тифлинг Бездны: Луч болезни', { spellCardNumber: 'ray_of_sickness' }],
      ['sub-chthonic', 'Хтонический тифлинг: Псевдожизнь', { spellCardNumber: 'false_life' }],
      ['sub-infernal', 'Инфернальный тифлинг: Адское возмездие', { spellCardNumber: 'hellish_rebuke' }],
    ], { ...PHB, level: 3 }),
    secondLevelSpells: rows([
      ['SPELL-0261', 'Подмога'], ['SPELL-0293', 'Смена обличья'],
      ['SPELL-0271', 'Почтовое животное'], ['SPELL-0176', 'Волшебный замок'],
      ['SPELL-0225', 'Мистическая бодрость'], ['SPELL-0180', 'Гадание'],
      ['SPELL-0195', 'Дубовая кожа'], ['SPELL-0198', 'Животные чувства'],
      ['SPELL-0182', 'Глухота/Слепота'], ['SPELL-0278', 'Размытый образ'],
      ['SPELL-0310', 'Умиротворение'], ['SPELL-0234', 'Облако кинжалов'],
      ['SPELL-0168', 'Вечный огонь'], ['SPELL-0200', 'Завеса стрел'],
      ['SPELL-0209', 'Корона безумия'], ['darkness', 'Тьма'],
      ['SPELL-0299', 'Тёмное зрение'], ['SPELL-0239', 'Обнаружение мыслей'],
      ['SPELL-0197', 'Дыхание дракона'], ['SPELL-0309', 'Улучшение характеристики'],
      ['SPELL-0307', 'Увеличение/уменьшение'], ['SPELL-0282', 'Речь златоуста'],
      ['SPELL-0240', 'Обретение скакуна'], ['SPELL-0263', 'Поиск ловушек'],
      ['SPELL-0184', 'Горящий клинок'], ['SPELL-0276', 'Пылающий шар'],
      ['SPELL-0233', 'Нетленные останки'], ['SPELL-0268', 'Порыв ветра'],
      ['SPELL-0279', 'Раскалённый металл'], ['hold_person', 'Удержание личности'],
      ['SPELL-0231', 'Невидимость'], ['SPELL-0248', 'Открывание'],
      ['SPELL-0221', 'Малое восстановление'], ['SPELL-0210', 'Левитация'],
      ['SPELL-0262', 'Поиск животных или растений'], ['SPELL-0264', 'Поиск объекта'],
      ['SPELL-0175', 'Волшебные уста'], ['SPELL-0219', 'Магическое оружие'],
      ['SPELL-0208', 'Кислотная стрела Мельфа'], ['SPELL-0273', 'Пронзание разума'],
      ['SPELL-0249', 'Отражения'], ['misty_step', 'Туманный шаг'],
      ['SPELL-0215', 'Лунный луч'], ['SPELL-0172', 'Волшебная аура Нистула'],
      ['pass_without_trace', 'Бесследное передвижение'], ['SPELL-0177', 'Воображаемая сила'],
      ['SPELL-0227', 'Молебен лечения'], ['SPELL-0203', 'Защита от яда'],
      ['ray_of_enfeeblement', 'Луч слабости'], ['SPELL-0302', 'Трюк с верёвкой'],
      ['SPELL-0255', 'Палящий луч'], ['SPELL-0169', 'Видение невидимого'],
      ['SPELL-0191', 'Дребезги'], ['SPELL-0289', 'Сияющая кара'],
      ['SPELL-0301', 'Тишина'], ['SPELL-0258', 'Паучье лазание'],
      ['SPELL-0266', 'Поросль шипов'], ['SPELL-0196', 'Духовное оружие'],
      ['SPELL-0170', 'Внушение'], ['SPELL-0250', 'Охраняющая связь'],
      ['SPELL-0257', 'Паутина'], ['SPELL-0483', 'Воплощение силы'],
      ['SPELL-0178', 'Вызов Зверя'], ['SPELL-0235', 'Область истины'],
    ], { ...PHB, level: 2 }),
  }),
});

export function flattenLevel3MiniMvpManifest(manifest = LEVEL3_MINI_MVP_MANIFEST) {
  return Object.entries(manifest.collections).flatMap(([collection, values]) => (
    values.map((value) => ({ ...value, collection }))
  ));
}

export function validateLevel3MiniMvpManifest(manifest = LEVEL3_MINI_MVP_MANIFEST) {
  const issues = [];
  if (manifest.schemaVersion !== LEVEL3_MINI_MVP_MANIFEST_SCHEMA_VERSION) issues.push('schemaVersion');
  if (manifest.release !== 'mini-mvp-level3') issues.push('release');
  if (manifest.systemId !== 'dnd5e-2024') issues.push('systemId');
  if (manifest.characterLevel !== 3) issues.push('characterLevel');
  for (const [collection, size] of Object.entries(LEVEL3_MINI_MVP_COLLECTION_SIZES)) {
    if (manifest.collections?.[collection]?.length !== size) {
      issues.push(`${collection}: expected ${size}, got ${manifest.collections?.[collection]?.length ?? 0}`);
    }
  }
  const entries = flattenLevel3MiniMvpManifest(manifest);
  const identities = entries.map((value) => `${value.collection}:${value.selector.cardNumber}`);
  if (new Set(identities).size !== identities.length) issues.push('duplicate collection identity');
  const subclassCards = manifest.collections.subclasses.map((value) => value.selector.cardNumber);
  if (new Set(subclassCards).size !== subclassCards.length) issues.push('duplicate subclass card number');
  const spellCards = manifest.collections.secondLevelSpells.map((value) => value.selector.cardNumber);
  if (new Set(spellCards).size !== spellCards.length) issues.push('duplicate second-level spell card number');
  return issues;
}
