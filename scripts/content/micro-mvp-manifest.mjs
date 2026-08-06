/**
 * Canonical, versioned acceptance catalog for the micro-MVP.
 *
 * `key` is the product-level stable identity. `selector.cardNumber` is the
 * database identity pinned by `contentSnapshot`. Source and product-rule
 * metadata are immutable release inputs: callers must not infer them from the
 * current database contents.
 */

const entry = (key, label, selector, expected = {}) => ({
  key,
  label,
  selector,
  expected,
});

export const MICRO_MVP_MANIFEST_SCHEMA_VERSION = 2;

export const MICRO_MVP_REQUIRED_COLLECTIONS = Object.freeze([
  'classes',
  'species',
  'backgrounds',
  'originFeats',
  'cantrips',
  'firstLevelSpells',
  'fightingStyles',
]);

export const MICRO_MVP_COLLECTION_ENTITY_TYPES = Object.freeze({
  classes: 'class',
  species: 'race',
  backgrounds: 'background',
  originFeats: 'feat',
  cantrips: 'spell',
  firstLevelSpells: 'spell',
  fightingStyles: 'feat',
});

export const MICRO_MVP_COLLECTION_SIZES = Object.freeze({
  classes: 7,
  species: 4,
  backgrounds: 4,
  originFeats: 4,
  cantrips: 12,
  firstLevelSpells: 14,
  fightingStyles: 4,
});

export const MICRO_MVP_SOURCE_CORPUS = Object.freeze([
  Object.freeze({
    id: 'phb-2024',
    title: "Player's Handbook 2024",
    edition: '2024',
    rulesLine: 'dnd-2024',
    revision: 'initial-2024-release',
    role: 'normative',
    required: true,
    errataIds: ['phb-2024-errata-v1'],
    localArtifacts: [
      "officials/Player's Handbook 2024. RU.pdf",
      "officials/Player's Handbook 2024.txt",
      'officials/PlayersHandbook2024 EN.pdf',
    ],
  }),
  Object.freeze({
    id: 'dmg-2024',
    title: "Dungeon Master's Guide 2024",
    edition: '2024',
    rulesLine: 'dnd-2024',
    revision: 'initial-2024-release',
    role: 'normative',
    required: true,
    errataIds: [],
    localArtifacts: [],
  }),
  Object.freeze({
    id: 'mm-2024',
    title: 'Monster Manual 2024',
    edition: '2024',
    rulesLine: 'dnd-2024',
    revision: 'initial-2024-release',
    role: 'normative',
    required: true,
    errataIds: [],
    localArtifacts: [],
  }),
  Object.freeze({
    id: 'srd-5.2.1',
    title: 'Systems Reference Document 5.2.1',
    edition: '5.2.1',
    rulesLine: 'dnd-2024',
    revision: '5.2.1',
    role: 'supplementary',
    required: false,
    errataIds: [],
    locator: 'https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf',
    localArtifacts: [],
  }),
]);

export const MICRO_MVP_ERRATA = Object.freeze([
  Object.freeze({
    id: 'phb-2024-errata-v1',
    sourceId: 'phb-2024',
    version: 'v1',
    status: 'pinned',
    locator: 'https://media.dndbeyond.com/compendium-images/errata/PHB-24/PHB-2024_v1.pdf',
  }),
]);

export const FREE_ORIGIN_FEAT_CHOICE_V1 = Object.freeze({
  id: 'free_origin_feat_choice_v1',
  version: 1,
  provenance: 'product_rule',
  status: 'active',
  selection: Object.freeze({
    collection: 'originFeats',
    count: 1,
    independentOf: 'background',
  }),
  replaces: Object.freeze({
    grant: 'official_background_origin_feat',
    count: 1,
    mode: 'replace_not_add',
  }),
});

export const MICRO_MVP_MANIFEST = {
  schemaVersion: MICRO_MVP_MANIFEST_SCHEMA_VERSION,
  manifestVersion: '2.1.0',
  release: 'micro-mvp',
  systemId: 'dnd5e-2024',
  rulesetVersion: '2024',
  characterLevel: 1,
  sourceTrack: 'dnd-2024-core',
  errataVersion: 'phb-2024-errata-v1',
  contentSnapshot: {
    id: 'prod-snapshot',
    path: 'officials/canon/prod-snapshot',
    identityField: 'card_number',
  },
  sourceCorpus: MICRO_MVP_SOURCE_CORPUS,
  errata: MICRO_MVP_ERRATA,
  productRules: [FREE_ORIGIN_FEAT_CHOICE_V1],
  requiredCollections: MICRO_MVP_REQUIRED_COLLECTIONS,
  collectionEntityTypes: MICRO_MVP_COLLECTION_ENTITY_TYPES,
  defaultVisibleStatuses: [
    'verified_mechanical',
    'verified_partial',
    'verified_narrative',
  ],
  collections: {
    classes: [
      entry('class.fighter', 'Воин', { cardNumber: 'CLASS-warrior' }),
      entry('class.wizard', 'Волшебник', { cardNumber: 'CLASS-wizard' }),
      entry('class.rogue', 'Плут', { cardNumber: 'CLASS-rogue' }),
      entry('class.cleric', 'Жрец', { cardNumber: 'CLASS-cleric' }),
      entry('class.sorcerer', 'Чародей', { cardNumber: 'CLASS-sorcerer' }),
      entry('class.warlock', 'Колдун', { cardNumber: 'CLASS-warlock' }),
      entry('class.druid', 'Друид', { cardNumber: 'CLASS-druid' }),
    ],
    species: [
      entry('species.human', 'Человек', { cardNumber: 'RACE-0002' }),
      entry('species.elf', 'Эльф', { cardNumber: 'RACE-0004' }),
      entry('species.dwarf', 'Дварф', { cardNumber: 'RACE-0003' }),
      entry('species.dragonborn', 'Драконорождённый', { cardNumber: 'RACE-0008' }),
    ],
    backgrounds: [
      entry('background.soldier', 'Солдат', { cardNumber: 'BG-0012' }),
      entry('background.sage', 'Мудрец', { cardNumber: 'BG-0005' }),
      entry('background.criminal', 'Преступник', { cardNumber: 'BG-0008' }),
      entry(
        'background.acolyte',
        'Прислужник',
        { cardNumber: 'BG-0009' },
        { aliases: ['Послушник'] },
      ),
    ],
    originFeats: [
      entry('feat.alert', 'Бдительный', { cardNumber: 'FEAT-0001' }),
      entry('feat.magic-initiate', 'Посвящённый в магию', { cardNumber: 'FEAT-0009' }),
      entry('feat.skilled', 'Одарённый', { cardNumber: 'FEAT-0008' }),
      entry('feat.tough', 'Крепкий', { cardNumber: 'FEAT-0005' }),
    ],
    cantrips: [
      entry('spell.fire-bolt', 'Огненный снаряд', { cardNumber: 'fire_bolt' }, { level: 0 }),
      entry('spell.sacred-flame', 'Священное пламя', { cardNumber: 'SPELL-0286' }, { level: 0 }),
      entry(
        'spell.guidance',
        'Наставление',
        { cardNumber: 'SPELL-0230' },
        { level: 0, aliases: ['Указание'] },
      ),
      entry('spell.minor-illusion', 'Малая иллюзия', { cardNumber: 'minor_illusion' }, { level: 0 }),
      entry('spell.ray-of-frost', 'Луч холода', { cardNumber: 'SPELL-0218' }, { level: 0 }),
      entry('spell.chill-touch', 'Леденящее прикосновение', { cardNumber: 'chill_touch' }, { level: 0 }),
      entry('spell.light', 'Свет', { cardNumber: 'light' }, { level: 0 }),
      entry('spell.dancing-lights', 'Пляшущие огоньки', { cardNumber: 'dancing_lights' }, { level: 0 }),
      entry('spell.druidcraft', 'Искусство друидов', { cardNumber: 'druidcraft' }, { level: 0 }),
      entry('spell.mending', 'Починка', { cardNumber: 'mending' }, { level: 0 }),
      entry('spell.poison-spray', 'Ядовитые брызги', { cardNumber: 'poison_spray' }, { level: 0 }),
      entry('spell.prestidigitation', 'Фокусы', { cardNumber: 'prestidigitation' }, { level: 0 }),
    ],
    firstLevelSpells: [
      entry('spell.magic-missile', 'Волшебная стрела', { cardNumber: 'SPELL-0174' }, { level: 1 }),
      entry('spell.burning-hands', 'Огненные ладони', { cardNumber: 'SPELL-0242' }, { level: 1 }),
      entry('spell.cure-wounds', 'Лечение ран', { cardNumber: 'SPELL-0214' }, { level: 1 }),
      entry('spell.shield', 'Щит', { cardNumber: 'SPELL-0317' }, { level: 1 }),
      entry('spell.mage-armor', 'Доспехи мага', { cardNumber: 'SPELL-0190' }, { level: 1 }),
      entry('spell.thunderwave', 'Волна грома', { cardNumber: 'SPELL-0171' }, { level: 1 }),
      entry('spell.false-life', 'Псевдожизнь', { cardNumber: 'false_life' }, { level: 1 }),
      entry('spell.detect-magic', 'Обнаружение магии', { cardNumber: 'detect_magic' }, { level: 1 }),
      entry('spell.bless', 'Благословение', { cardNumber: 'SPELL-0163' }, { level: 1 }),
      entry('spell.guiding-bolt', 'Направляющий снаряд', { cardNumber: 'SPELL-0229' }, { level: 1 }),
      entry('spell.armor-of-agathys', 'Доспех Агатиса', { cardNumber: 'SPELL-0189' }, { level: 1 }),
      entry(
        'spell.detect-poison-and-disease',
        'Обнаружение болезней и яда',
        { cardNumber: 'SPELL-0236' },
        { level: 1 },
      ),
      entry('spell.find-familiar', 'Обретение фамильяра', { cardNumber: 'SPELL-0241' }, { level: 1 }),
      entry(
        'spell.purify-food-and-drink',
        'Очищение пищи и питья',
        { cardNumber: 'SPELL-0252' },
        { level: 1 },
      ),
    ],
    fightingStyles: [
      entry('fighting-style.archery', 'Стрельба', { cardNumber: 'FEAT-0063' }, { category: 'fighting_style' }),
      entry('fighting-style.defense', 'Оборона', { cardNumber: 'FEAT-0056' }, { category: 'fighting_style' }),
      entry(
        'fighting-style.two-weapon-fighting',
        'Сражение двумя оружиями',
        { cardNumber: 'FEAT-0061' },
        { category: 'fighting_style' },
      ),
      entry('fighting-style.protection', 'Защита', { cardNumber: 'FEAT-0055' }, { category: 'fighting_style' }),
    ],
  },
};

export function flattenMicroMvpManifest(manifest = MICRO_MVP_MANIFEST) {
  return Object.entries(manifest.collections ?? {}).flatMap(([collection, entries]) =>
    (Array.isArray(entries) ? entries : []).map((item) => ({ ...item, collection })),
  );
}

export function validateMicroMvpManifest(manifest = MICRO_MVP_MANIFEST) {
  const issues = [];
  const entries = flattenMicroMvpManifest(manifest);
  const keys = new Set();
  const stableSelectors = new Set();

  if (manifest?.schemaVersion !== MICRO_MVP_MANIFEST_SCHEMA_VERSION) {
    issues.push(
      `schemaVersion: expected ${MICRO_MVP_MANIFEST_SCHEMA_VERSION}, got ${String(manifest?.schemaVersion)}`,
    );
  }

  if (manifest?.release !== 'micro-mvp') {
    issues.push(`release: expected micro-mvp, got ${String(manifest?.release)}`);
  }

  for (const [collection, expectedSize] of Object.entries(MICRO_MVP_COLLECTION_SIZES)) {
    const actual = manifest?.collections?.[collection]?.length ?? 0;
    if (actual !== expectedSize) {
      issues.push(`${collection}: expected ${expectedSize} entries, got ${actual}`);
    }
    if (!manifest?.requiredCollections?.includes?.(collection)) {
      issues.push(`${collection}: missing from requiredCollections`);
    }
    if (!manifest?.collectionEntityTypes?.[collection]) {
      issues.push(`${collection}: missing entity type mapping`);
    }
  }

  const sourceIds = new Set(
    (Array.isArray(manifest?.sourceCorpus) ? manifest.sourceCorpus : [])
      .map((source) => source?.id)
      .filter(Boolean),
  );
  for (const sourceId of ['phb-2024', 'dmg-2024', 'mm-2024']) {
    if (!sourceIds.has(sourceId)) issues.push(`sourceCorpus: missing required source ${sourceId}`);
  }
  for (const pin of Array.isArray(manifest?.errata) ? manifest.errata : []) {
    if (!pin?.id || !pin?.version) issues.push('errata: each pin requires id and version');
    if (pin?.sourceId && !sourceIds.has(pin.sourceId)) {
      issues.push(`${pin.id ?? '<unknown errata>'}: unknown source ${pin.sourceId}`);
    }
  }

  const originFeatRule = (Array.isArray(manifest?.productRules) ? manifest.productRules : [])
    .find((rule) => rule?.id === FREE_ORIGIN_FEAT_CHOICE_V1.id);
  if (!originFeatRule) {
    issues.push(`productRules: missing ${FREE_ORIGIN_FEAT_CHOICE_V1.id}`);
  } else {
    if (originFeatRule.provenance !== 'product_rule') {
      issues.push(`${originFeatRule.id}: provenance must be product_rule`);
    }
    if (originFeatRule.selection?.collection !== 'originFeats'
      || originFeatRule.selection?.count !== 1
      || originFeatRule.selection?.independentOf !== 'background') {
      issues.push(`${originFeatRule.id}: must select exactly one origin feat independently of background`);
    }
    if (originFeatRule.replaces?.grant !== 'official_background_origin_feat'
      || originFeatRule.replaces?.count !== 1
      || originFeatRule.replaces?.mode !== 'replace_not_add') {
      issues.push(`${originFeatRule.id}: must replace, not add to, the official background feat grant`);
    }
  }

  for (const item of entries) {
    if (keys.has(item.key)) issues.push(`${item.key}: duplicate manifest key`);
    keys.add(item.key);

    const selectors = ['id', 'cardNumber', 'nameEn'].filter(
      (field) => typeof item.selector?.[field] === 'string' && item.selector[field].trim(),
    );
    if (selectors.length !== 1) {
      issues.push(`${item.key}: exactly one selector is required`);
      continue;
    }

    const selectorField = selectors[0];
    if (selectorField === 'id' || selectorField === 'cardNumber') {
      const entityType = manifest?.collectionEntityTypes?.[item.collection] ?? item.collection;
      const identity = `${entityType}:${selectorField}:${item.selector[selectorField]}`;
      if (stableSelectors.has(identity)) issues.push(`${item.key}: duplicate stable selector ${identity}`);
      stableSelectors.add(identity);
    }
  }

  return issues;
}
