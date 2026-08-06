import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  FREE_ORIGIN_FEAT_CHOICE_V1,
  MICRO_MVP_COLLECTION_SIZES,
  MICRO_MVP_MANIFEST,
  MICRO_MVP_MANIFEST_SCHEMA_VERSION,
  flattenMicroMvpManifest,
  validateMicroMvpManifest,
} from './micro-mvp-manifest.mjs';
import {
  MICRO_MICRO_COLLECTION_SIZES,
  MICRO_MICRO_MANIFEST,
  flattenMicroMicroManifest,
  validateMicroMicroManifest,
} from './micro-micro-manifest.mjs';
import {
  MICRO_MVP_CONDITION_FIELDS,
  MICRO_MVP_CONDITION_TARGETS,
  MICRO_MVP_CERTIFICATION_VERSION,
  prepareMicroMvpCertifications,
} from './micro-mvp-certifications.mjs';
import {
  MICRO_MICRO_CERTIFICATION_VERSION,
  prepareMicroMicroCertifications,
} from './micro-micro-certifications.mjs';

test('canonical micro-MVP schema v2 contains the 7 x 4 x 4 x 4 root scope', () => {
  assert.equal(MICRO_MVP_MANIFEST.schemaVersion, MICRO_MVP_MANIFEST_SCHEMA_VERSION);
  assert.deepEqual(validateMicroMvpManifest(), []);
  assert.deepEqual(MICRO_MVP_COLLECTION_SIZES, {
    classes: 7,
    species: 4,
    backgrounds: 4,
    originFeats: 4,
    cantrips: 12,
    firstLevelSpells: 14,
    fightingStyles: 4,
  });
  assert.equal(flattenMicroMvpManifest().length, 49);
  assert.equal(
    MICRO_MVP_MANIFEST.collections.classes.length
      * MICRO_MVP_MANIFEST.collections.species.length
      * MICRO_MVP_MANIFEST.collections.backgrounds.length
      * MICRO_MVP_MANIFEST.collections.originFeats.length,
    448,
  );
});

test('class selectors are pinned to the repository production snapshot identities', async () => {
  const expectedCardNumbers = [
    'CLASS-warrior',
    'CLASS-wizard',
    'CLASS-rogue',
    'CLASS-cleric',
    'CLASS-sorcerer',
    'CLASS-warlock',
    'CLASS-druid',
  ];
  assert.deepEqual(
    MICRO_MVP_MANIFEST.collections.classes.map((item) => item.selector.cardNumber),
    expectedCardNumbers,
  );
  assert.equal(MICRO_MVP_MANIFEST.contentSnapshot.path, 'officials/canon/prod-snapshot');

  const snapshot = JSON.parse(await readFile(
    new URL('../../officials/canon/prod-snapshot/classes.json', import.meta.url),
    'utf8',
  ));
  const snapshotCardNumbers = new Set(snapshot.map((item) => item.card_number));
  for (const cardNumber of expectedCardNumbers) assert.ok(snapshotCardNumbers.has(cardNumber));
});

test('spell selectors explicitly close every spell required by the level-1 build graph', async () => {
  const expectedCantrips = [
    'fire_bolt', 'SPELL-0286', 'SPELL-0230', 'minor_illusion', 'SPELL-0218',
    'chill_touch', 'light', 'dancing_lights', 'druidcraft', 'mending',
    'poison_spray', 'prestidigitation',
  ];
  const expectedLevelOne = [
    'SPELL-0174', 'SPELL-0242', 'SPELL-0214', 'SPELL-0317', 'SPELL-0190',
    'SPELL-0171', 'false_life', 'detect_magic', 'SPELL-0163', 'SPELL-0229',
    'SPELL-0189', 'SPELL-0236', 'SPELL-0241', 'SPELL-0252',
  ];
  assert.deepEqual(
    MICRO_MVP_MANIFEST.collections.cantrips.map((item) => item.selector.cardNumber),
    expectedCantrips,
  );
  assert.deepEqual(
    MICRO_MVP_MANIFEST.collections.firstLevelSpells.map((item) => item.selector.cardNumber),
    expectedLevelOne,
  );

  const snapshot = JSON.parse(await readFile(
    new URL('../../officials/canon/prod-snapshot/spells.json', import.meta.url),
    'utf8',
  ));
  const byCardNumber = new Map(snapshot.map((spell) => [spell.card_number, spell]));
  for (const [cardNumber, level] of [
    ...expectedCantrips.map((cardNumber) => [cardNumber, 0]),
    ...expectedLevelOne.map((cardNumber) => [cardNumber, 1]),
  ]) {
    assert.equal(byCardNumber.get(cardNumber)?.level, level, `${cardNumber} level`);
  }
});

test('source corpus, errata, and the free origin feat product rule are explicit', () => {
  const sources = new Map(MICRO_MVP_MANIFEST.sourceCorpus.map((source) => [source.id, source]));
  for (const sourceId of ['phb-2024', 'dmg-2024', 'mm-2024']) {
    assert.equal(sources.get(sourceId)?.required, true);
    assert.equal(sources.get(sourceId)?.role, 'normative');
    assert.ok(sources.get(sourceId)?.revision);
  }

  const errata = MICRO_MVP_MANIFEST.errata.find((pin) => pin.id === 'phb-2024-errata-v1');
  assert.deepEqual(
    { sourceId: errata?.sourceId, version: errata?.version, status: errata?.status },
    { sourceId: 'phb-2024', version: 'v1', status: 'pinned' },
  );

  const rule = MICRO_MVP_MANIFEST.productRules.find(
    (candidate) => candidate.id === 'free_origin_feat_choice_v1',
  );
  assert.equal(rule, FREE_ORIGIN_FEAT_CHOICE_V1);
  assert.deepEqual(rule.selection, {
    collection: 'originFeats',
    count: 1,
    independentOf: 'background',
  });
  assert.deepEqual(rule.replaces, {
    grant: 'official_background_origin_feat',
    count: 1,
    mode: 'replace_not_add',
  });
  assert.equal(rule.provenance, 'product_rule');
});

test('legacy micro-micro exports are aliases of the canonical schema v2 API', () => {
  assert.equal(MICRO_MICRO_MANIFEST, MICRO_MVP_MANIFEST);
  assert.equal(MICRO_MICRO_COLLECTION_SIZES, MICRO_MVP_COLLECTION_SIZES);
  assert.equal(flattenMicroMicroManifest, flattenMicroMvpManifest);
  assert.equal(validateMicroMicroManifest, validateMicroMvpManifest);
  assert.equal(prepareMicroMicroCertifications, prepareMicroMvpCertifications);
  assert.equal(MICRO_MICRO_CERTIFICATION_VERSION, MICRO_MVP_CERTIFICATION_VERSION);
});

test('canonical certification consumer covers 49 manifest entries plus all 15 conditions offline', () => {
  const entityGroups = {
    class: [],
    race: [],
    background: [],
    feat: [],
    spell: [],
    effect: [],
  };
  for (const item of flattenMicroMvpManifest()) {
    const entityType = MICRO_MVP_MANIFEST.collectionEntityTypes[item.collection];
    entityGroups[entityType].push({
      id: `${entityType}:${item.key}`,
      card_number: item.selector.cardNumber,
      name: item.label,
      ...(item.expected.level === undefined ? {} : { level: item.expected.level }),
      ...(item.expected.category ? { category: item.expected.category } : {}),
    });
  }
  let conditionSequence = 1;
  for (const target of MICRO_MVP_CONDITION_TARGETS) {
    entityGroups.effect.push({
      id: `00000000-0000-4000-8000-${String(conditionSequence++).padStart(12, '0')}`,
      card_number: target.cardNumber,
      ...JSON.parse(JSON.stringify(MICRO_MVP_CONDITION_FIELDS[target.id])),
    });
  }

  const certifications = prepareMicroMvpCertifications(entityGroups, {
    certifiedAt: '2026-08-04T00:00:00Z',
  });
  assert.equal(certifications.length, 64);
  assert.equal(new Set(certifications.map((item) => item.key)).size, 64);
  assert.ok(certifications.every((item) => item.support.note.includes('micro-MVP')));
  assert.equal(MICRO_MVP_CERTIFICATION_VERSION, 'micro-mvp-l1-rules-core-v3');
  assert.ok(certifications.every((item) => (
    item.support.certification_version === MICRO_MVP_CERTIFICATION_VERSION
      && (item.collection === 'conditions'
        ? item.support.status === 'verified_mechanical' && item.support.limitations.length === 0
        : item.support.status === 'verified_partial'
          && item.support.limitations.length > 0
          && item.support.limitations.every((limitation) => !/пока|не покрыт|не реализован/i.test(limitation)))
  )));
});

test('schema validation reports absent required collections and release inputs', () => {
  const invalid = {
    ...MICRO_MVP_MANIFEST,
    sourceCorpus: [],
    productRules: [],
    collections: {
      ...MICRO_MVP_MANIFEST.collections,
      classes: [],
    },
  };
  const issues = validateMicroMvpManifest(invalid);
  assert.ok(issues.some((issue) => issue.includes('classes: expected 7 entries')));
  assert.ok(issues.some((issue) => issue.includes('missing required source phb-2024')));
  assert.ok(issues.some((issue) => issue.includes('missing free_origin_feat_choice_v1')));
});
