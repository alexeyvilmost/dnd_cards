/**
 * Versioned acceptance catalog for the micro-micro-MVP.
 *
 * `key` is the product-level stable identity. `selector.cardNumber` is the
 * preferred database identity. A `nameEn` selector remains supported as an
 * explicit migration-debt state: the live gate can find such an entity, but
 * cannot certify it as ready until a stable database slug is recorded here.
 */

const entry = (key, label, selector, expected = {}) => ({
  key,
  label,
  selector,
  expected,
});

export const MICRO_MICRO_MANIFEST = {
  schemaVersion: 1,
  release: 'micro-micro-mvp',
  systemId: 'dnd5e-2024',
  rulesetVersion: '2024',
  characterLevel: 1,
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

export const MICRO_MICRO_COLLECTION_SIZES = Object.freeze({
  classes: 4,
  species: 4,
  backgrounds: 4,
  originFeats: 4,
  cantrips: 7,
  firstLevelSpells: 10,
  fightingStyles: 4,
});

export function flattenMicroMicroManifest(manifest = MICRO_MICRO_MANIFEST) {
  return Object.entries(manifest.collections).flatMap(([collection, entries]) =>
    entries.map((item) => ({ ...item, collection })),
  );
}

export function validateMicroMicroManifest(manifest = MICRO_MICRO_MANIFEST) {
  const issues = [];
  const entries = flattenMicroMicroManifest(manifest);
  const keys = new Set();

  for (const [collection, expectedSize] of Object.entries(MICRO_MICRO_COLLECTION_SIZES)) {
    const actual = manifest.collections[collection]?.length ?? 0;
    if (actual !== expectedSize) {
      issues.push(`${collection}: expected ${expectedSize} entries, got ${actual}`);
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
    }
  }

  return issues;
}
