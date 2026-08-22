/**
 * Exact PHB 2024 level-1 acceptance catalog for mini-MVP.
 *
 * This file is intentionally static. Production contents must conform to this
 * reviewed denominator; the denominator must never be inferred from whatever
 * rows happen to exist in the database.
 */

const entry = (key, label, cardNumber, expected = {}) => Object.freeze({
  key,
  label,
  selector: Object.freeze({ cardNumber }),
  expected: Object.freeze(expected),
});

const rows = (prefix, expected, values) => Object.freeze(values.map(([cardNumber, label, extra]) => (
  entry(`${prefix}.${cardNumber.toLowerCase()}`, label, cardNumber, { ...expected, ...(extra ?? {}) })
)));

export const MINI_MVP_MANIFEST_SCHEMA_VERSION = 1;

export const MINI_MVP_REQUIRED_COLLECTIONS = Object.freeze([
  'classes',
  'species',
  'backgrounds',
  'originFeats',
  'fightingStyles',
  'cantrips',
  'firstLevelSpells',
]);

export const MINI_MVP_COLLECTION_ENTITY_TYPES = Object.freeze({
  classes: 'class',
  species: 'race',
  backgrounds: 'background',
  originFeats: 'feat',
  fightingStyles: 'feat',
  cantrips: 'spell',
  firstLevelSpells: 'spell',
});

export const MINI_MVP_COLLECTION_SIZES = Object.freeze({
  classes: 12,
  species: 10,
  backgrounds: 16,
  originFeats: 10,
  fightingStyles: 10,
  cantrips: 34,
  firstLevelSpells: 64,
});

const PHB = Object.freeze({ source: 'PHB 2024' });

export const MINI_MVP_MANIFEST = Object.freeze({
  schemaVersion: MINI_MVP_MANIFEST_SCHEMA_VERSION,
  manifestVersion: '1.1.0',
  release: 'mini-mvp',
  systemId: 'dnd5e-2024',
  rulesetVersion: '2024',
  characterLevel: 1,
  sourceTrack: 'phb-2024',
  productRules: Object.freeze(['free_origin_feat_choice_v1']),
  requiredCollections: MINI_MVP_REQUIRED_COLLECTIONS,
  collectionEntityTypes: MINI_MVP_COLLECTION_ENTITY_TYPES,
  collections: Object.freeze({
    classes: rows('class', PHB, [
      ['CLASS-barbarian', 'Варвар'],
      ['CLASS-bard', 'Бард'],
      ['CLASS-warrior', 'Воин'],
      ['CLASS-wizard', 'Волшебник'],
      ['CLASS-druid', 'Друид'],
      ['CLASS-cleric', 'Жрец'],
      ['CLASS-warlock', 'Колдун'],
      ['CLASS-monk', 'Монах'],
      ['CLASS-paladin', 'Паладин'],
      ['CLASS-rogue', 'Плут'],
      ['CLASS-ranger', 'Следопыт'],
      ['CLASS-sorcerer', 'Чародей'],
    ]),
    species: rows('species', PHB, [
      ['RACE-0010', 'Аасимар', { variantNames: [] }],
      ['RACE-0005', 'Гном', {
        variantNames: ['Лесной гном', 'Скальный гном'],
        variantSelectors: [
          { cardNumber: 'sub-forest', label: 'Лесной гном' },
          { cardNumber: 'sub-rock', label: 'Скальный гном' },
        ],
      }],
      ['RACE-0011', 'Голиаф', {
        variantNames: ['Облачный', 'Огненный', 'Морозный', 'Холмовой', 'Каменный', 'Штормовой'],
        variantSelectors: [
          { cardNumber: 'RACE-0011-cloud', label: 'Наследие облачного великана' },
          { cardNumber: 'RACE-0011-fire', label: 'Наследие огненного великана' },
          { cardNumber: 'RACE-0011-frost', label: 'Наследие ледяного великана' },
          { cardNumber: 'RACE-0011-hill', label: 'Наследие холмового великана' },
          { cardNumber: 'RACE-0011-stone', label: 'Наследие каменного великана' },
          { cardNumber: 'RACE-0011-storm', label: 'Наследие штормового великана' },
        ],
      }],
      ['RACE-0003', 'Дварф', { variantNames: [] }],
      ['RACE-0008', 'Драконорождённый', {
        variantNames: ['Чёрный', 'Синий', 'Латунный', 'Бронзовый', 'Медный', 'Золотой', 'Зелёный', 'Красный', 'Серебряный', 'Белый'],
        variantSelectors: [
          { cardNumber: 'sub-black', label: 'Чёрный' },
          { cardNumber: 'sub-blue', label: 'Синий' },
          { cardNumber: 'sub-brass', label: 'Латунный' },
          { cardNumber: 'sub-bronze', label: 'Бронзовый' },
          { cardNumber: 'sub-copper', label: 'Медный' },
          { cardNumber: 'sub-gold', label: 'Золотой' },
          { cardNumber: 'sub-green', label: 'Зелёный' },
          { cardNumber: 'sub-red', label: 'Красный' },
          { cardNumber: 'sub-silver', label: 'Серебряный' },
          { cardNumber: 'sub-white', label: 'Белый' },
        ],
      }],
      ['RACE-0007', 'Орк', { variantNames: [] }],
      ['RACE-0006', 'Полурослик', { variantNames: [] }],
      ['RACE-0009', 'Тифлинг', {
        variantNames: ['Бездны', 'Хтоническое', 'Преисподней'],
        variantSelectors: [
          { cardNumber: 'sub-abyssal', label: 'Бездны' },
          { cardNumber: 'sub-chthonic', label: 'Хтоническое' },
          { cardNumber: 'sub-infernal', label: 'Инфернальное' },
        ],
      }],
      ['RACE-0002', 'Человек', { variantNames: [] }],
      ['RACE-0004', 'Эльф', {
        variantNames: ['Дроу', 'Высший эльф', 'Лесной эльф'],
        variantSelectors: [
          { cardNumber: 'sub-drow', label: 'Дроу' },
          { cardNumber: 'sub-high_elf', label: 'Высший эльф' },
          { cardNumber: 'sub-wood_elf', label: 'Лесной эльф' },
        ],
      }],
    ]),
    backgrounds: rows('background', PHB, [
      ['BG-0001', 'Артист'],
      ['BG-0002', 'Благородный'],
      ['BG-0003', 'Бродяга'],
      ['BG-0004', 'Моряк'],
      ['BG-0005', 'Мудрец'],
      ['BG-0006', 'Отшельник'],
      ['BG-0007', 'Писарь'],
      ['BG-0008', 'Преступник'],
      ['BG-0009', 'Прислужник'],
      ['BG-0010', 'Проводник'],
      ['BG-0011', 'Ремесленник'],
      ['BG-0012', 'Солдат'],
      ['BG-0013', 'Стражник'],
      ['BG-0014', 'Торговец'],
      ['BG-0015', 'Фермер'],
      ['BG-0016', 'Шарлатан'],
    ]),
    originFeats: rows('origin-feat', { ...PHB, category: 'origin' }, [
      ['FEAT-0001', 'Бдительный'],
      ['FEAT-0002', 'Везунчик'],
      ['FEAT-0003', 'Дебошир'],
      ['FEAT-0004', 'Дикий атакующий'],
      ['FEAT-0005', 'Крепкий'],
      ['FEAT-0006', 'Лекарь'],
      ['FEAT-0007', 'Музыкант'],
      ['FEAT-0008', 'Одарённый'],
      ['FEAT-0009', 'Посвящённый в магию'],
      ['FEAT-0010', 'Самоделкин'],
    ]),
    fightingStyles: rows('fighting-style', { ...PHB, category: 'fighting_style' }, [
      ['FEAT-0054', 'Дуэлянт'],
      ['FEAT-0055', 'Защита'],
      ['FEAT-0056', 'Оборона'],
      ['FEAT-0057', 'Перехват'],
      ['FEAT-0058', 'Сражение без оружия'],
      ['FEAT-0059', 'Сражение большим оружием'],
      ['FEAT-0060', 'Сражение вслепую'],
      ['FEAT-0061', 'Сражение двумя оружиями'],
      ['FEAT-0062', 'Сражение метательным оружием'],
      ['FEAT-0063', 'Стрельба'],
    ]),
    cantrips: rows('spell', { ...PHB, level: 0 }, [
      ['SPELL-0166', 'Брызги кислоты'],
      ['SPELL-0173', 'Волшебная рука'],
      ['SPELL-0192', 'Дружба'],
      ['SPELL-0194', 'Дубинка'],
      ['SPELL-0202', 'Защита от оружия'],
      ['SPELL-0204', 'Звёздный светлячок'],
      ['SPELL-0205', 'Злая насмешка'],
      ['druidcraft', 'Искусство друидов'],
      ['chill_touch', 'Леденящее прикосновение'],
      ['SPELL-0218', 'Луч холода'],
      ['minor_illusion', 'Малая иллюзия'],
      ['SPELL-0224', 'Меткий удар'],
      ['SPELL-0226', 'Мистический заряд'],
      ['SPELL-0230', 'Наставление'],
      ['fire_bolt', 'Огненный снаряд'],
      ['dancing_lights', 'Пляшущие огоньки'],
      ['SPELL-0260', 'Погребальный звон'],
      ['mending', 'Починка'],
      ['SPELL-0280', 'Раскат грома'],
      ['SPELL-0281', 'Расщепление разума'],
      ['light', 'Свет'],
      ['SPELL-0286', 'Священное пламя'],
      ['SPELL-0291', 'Слово сияния'],
      ['SPELL-0294', 'Сообщение'],
      ['SPELL-0295', 'Сопротивление'],
      ['SPELL-0297', 'Сотворение пламени'],
      ['SPELL-0298', 'Стихийность'],
      ['SPELL-0300', 'Терновый кнут'],
      ['SPELL-0312', 'Уход за умирающим'],
      ['prestidigitation', 'Фокусы'],
      ['SPELL-0315', 'Чародейский выброс'],
      ['thaumaturgy', 'Чудотворство'],
      ['SPELL-0319', 'Электрошок'],
      ['poison_spray', 'Ядовитые брызги'],
    ]),
    firstLevelSpells: rows('spell', { ...PHB, level: 1 }, [
      ['hellish_rebuke', 'Адское возмездие'],
      ['SPELL-0161', 'Безмолвный образ'],
      ['SPELL-0163', 'Благословение'],
      ['SPELL-0164', 'Божественная кара'],
      ['SPELL-0165', 'Божественное благоволение'],
      ['SPELL-0167', 'Ведьмин снаряд'],
      ['SPELL-0171', 'Волна грома'],
      ['SPELL-0174', 'Волшебная стрела'],
      ['SPELL-0179', 'Вызов на дуэль'],
      ['SPELL-0181', 'Героизм'],
      ['SPELL-0183', 'Гневная кара'],
      ['SPELL-0185', 'Град шипов'],
      ['SPELL-0186', 'Громовая кара'],
      ['SPELL-0187', 'Диссонирующий шёпот'],
      ['SPELL-0188', 'Добряника'],
      ['SPELL-0189', 'Доспех Агатиса'],
      ['SPELL-0190', 'Доспехи мага'],
      ['SPELL-0193', 'Дружба с животными'],
      ['SPELL-0199', 'Жуткий смех Таши'],
      ['SPELL-0201', 'Защита от добра и зла'],
      ['SPELL-0206', 'Иллюзорные письмена'],
      ['SPELL-0212', 'Ледяной кинжал'],
      ['SPELL-0213', 'Лечащее слово'],
      ['SPELL-0214', 'Лечение ран'],
      ['ray_of_sickness', 'Луч болезни'],
      ['SPELL-0222', 'Маскировка'],
      ['SPELL-0223', 'Метка охотника'],
      ['SPELL-0228', 'Нанесение ран'],
      ['SPELL-0229', 'Направляющий снаряд'],
      ['SPELL-0232', 'Невидимый слуга'],
      ['SPELL-0236', 'Обнаружение болезней и яда'],
      ['SPELL-0237', 'Обнаружение добра и зла'],
      ['detect_magic', 'Обнаружение магии'],
      ['SPELL-0241', 'Обретение фамильяра'],
      ['SPELL-0242', 'Огненные ладони'],
      ['faerie_fire', 'Огонь фей'],
      ['SPELL-0245', 'Опознание'],
      ['SPELL-0246', 'Опутывание'],
      ['SPELL-0247', 'Опутывающий удар'],
      ['SPELL-0251', 'Очарование личности'],
      ['SPELL-0252', 'Очищение пищи и питья'],
      ['SPELL-0253', 'Падение пёрышком'],
      ['SPELL-0254', 'Палящая кара'],
      ['SPELL-0256', 'Парящий диск Тензера'],
      ['SPELL-0265', 'Понимание языков'],
      ['SPELL-0267', 'Порча'],
      ['SPELL-0269', 'Поспешное отступление'],
      ['SPELL-0272', 'Приказ'],
      ['SPELL-0274', 'Прыжок'],
      ['false_life', 'Псевдожизнь'],
      ['SPELL-0277', 'Разговор с животными'],
      ['SPELL-0283', 'Руки Хадара'],
      ['SPELL-0284', 'Сверкающие брызги'],
      ['SPELL-0287', 'Сглаз'],
      ['SPELL-0288', 'Сигнал тревоги'],
      ['longstrider', 'Скороход'],
      ['SPELL-0292', 'Смазка'],
      ['SPELL-0296', 'Сотворение или уничтожение воды'],
      ['SPELL-0303', 'Туманное облако'],
      ['SPELL-0306', 'Убежище'],
      ['SPELL-0311', 'Усыпление'],
      ['SPELL-0314', 'Цветной шарик'],
      ['SPELL-0317', 'Щит'],
      ['SPELL-0318', 'Щит веры'],
    ]),
  }),
});

export function flattenMiniMvpManifest(manifest = MINI_MVP_MANIFEST) {
  return Object.entries(manifest.collections ?? {}).flatMap(([collection, values]) => (
    (Array.isArray(values) ? values : []).map((value) => ({ ...value, collection }))
  ));
}

/** Stable child-race denominator used by Forge, audit and support tooling. */
export function flattenMiniMvpSpeciesVariants(manifest = MINI_MVP_MANIFEST) {
  return (manifest.collections?.species ?? []).flatMap((parent) => (
    (parent.expected?.variantSelectors ?? []).map((selector, index) => ({
      key: `${parent.key}.variant.${selector.cardNumber.toLowerCase()}`,
      label: selector.label,
      selector: { cardNumber: selector.cardNumber },
      expected: {
        source: parent.expected?.source,
        parentCardNumber: parent.selector.cardNumber,
        parentVariantName: parent.expected?.variantNames?.[index],
      },
      collection: 'speciesLineages',
    }))
  ));
}

export function validateMiniMvpManifest(manifest = MINI_MVP_MANIFEST) {
  const issues = [];
  if (manifest?.schemaVersion !== MINI_MVP_MANIFEST_SCHEMA_VERSION) {
    issues.push(`schemaVersion: expected ${MINI_MVP_MANIFEST_SCHEMA_VERSION}`);
  }
  if (manifest?.release !== 'mini-mvp') issues.push('release must be mini-mvp');
  if (manifest?.characterLevel !== 1) issues.push('characterLevel must be 1');

  for (const [collection, size] of Object.entries(MINI_MVP_COLLECTION_SIZES)) {
    const values = manifest?.collections?.[collection];
    if (!Array.isArray(values) || values.length !== size) {
      issues.push(`${collection}: expected ${size}, got ${values?.length ?? 0}`);
    }
    if (!manifest?.requiredCollections?.includes?.(collection)) {
      issues.push(`${collection}: missing from requiredCollections`);
    }
    if (!manifest?.collectionEntityTypes?.[collection]) {
      issues.push(`${collection}: missing entity type`);
    }
  }

  const entries = flattenMiniMvpManifest(manifest);
  for (const field of ['key', 'selector']) {
    const identities = entries.map((value) => (
      field === 'key' ? value.key : value.selector?.cardNumber
    ));
    if (identities.some((value) => typeof value !== 'string' || !value.trim())) {
      issues.push(`${field}: empty stable identity`);
    }
    if (new Set(identities).size !== identities.length) issues.push(`${field}: duplicate identity`);
  }
  const variants = flattenMiniMvpSpeciesVariants(manifest);
  const variantCardNumbers = variants.map((value) => value.selector.cardNumber);
  if (new Set(variantCardNumbers).size !== variantCardNumbers.length) {
    issues.push('species variants: duplicate cardNumber');
  }
  for (const species of manifest?.collections?.species ?? []) {
    const names = species.expected?.variantNames ?? [];
    const selectors = species.expected?.variantSelectors ?? [];
    if (names.length !== selectors.length) {
      issues.push(`${species.key}: variantNames and variantSelectors differ in length`);
    }
    if (selectors.some((selector) => (
      typeof selector?.cardNumber !== 'string' || !selector.cardNumber.trim()
      || typeof selector?.label !== 'string' || !selector.label.trim()
    ))) {
      issues.push(`${species.key}: invalid variant selector`);
    }
  }
  return issues;
}
