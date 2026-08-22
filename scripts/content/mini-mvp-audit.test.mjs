import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCertificationIndex, certificationHashes } from './certification-hash.mjs';
import {
  MINI_MVP_CERTIFICATION_VERSION,
  MINI_MVP_COVERAGE_SCOPE,
  assessMiniMvpCatalogs,
} from './mini-mvp-audit.mjs';
import {
  MINI_MVP_COLLECTION_ENTITY_TYPES,
  MINI_MVP_MANIFEST,
  flattenMiniMvpManifest,
  flattenMiniMvpSpeciesVariants,
} from './mini-mvp-manifest.mjs';

function supportFor(entity, type, index) {
  const hashes = certificationHashes(entity, type, index);
  return {
    status: 'verified_partial',
    certification_version: MINI_MVP_CERTIFICATION_VERSION,
    content_hash: hashes.contentHash,
    dependency_hash: hashes.dependencyHash,
    mechanics_locked: ['action', 'effect', 'spell'].includes(type) || undefined,
    test_coverage: {
      schema_version: 1,
      scope: MINI_MVP_COVERAGE_SCOPE,
      required: 1,
      passed: 1,
      percent: 100,
    },
  };
}

function validCatalogs() {
  const catalogs = {
    class: [], race: [], background: [], feat: [], spell: [],
    action: [], effect: [], card: [], resource: [], variable: [],
  };
  const sharedEffect = {
    id: 'shared-effect-id',
    card_number: 'EFFECT-mini-test-shared',
    name: 'Тестовый общий эффект',
    mechanics: { activation: { mode: 'passive' }, effects: [{ resolution: 'auto', result: [{ kind: 'narrative' }] }] },
  };
  catalogs.effect.push(sharedEffect);

  for (const entry of flattenMiniMvpManifest()) {
    const type = MINI_MVP_COLLECTION_ENTITY_TYPES[entry.collection];
    const entity = {
      id: `id-${entry.selector.cardNumber}`,
      card_number: entry.selector.cardNumber,
      name: entry.label,
      source: entry.expected.source,
    };
    if (entry.collection === 'classes') {
      Object.assign(entity, {
        hit_die: 'd8',
        saving_throws: ['str', 'dex'],
        skill_choices: { count: 2, options: ['athletics', 'acrobatics'] },
        level_progression: { 1: { actions: [], effects: [sharedEffect.id] } },
        equipment_options: { option_a: { items: [] }, option_b: { items: [] } },
      });
    } else if (entry.collection === 'species') {
      Object.assign(entity, {
        speed: 30,
        related_effects: [sharedEffect.id],
        lineages: (entry.expected.variantNames ?? []).map((name) => ({ name })),
      });
    } else if (entry.collection === 'backgrounds') {
      Object.assign(entity, {
        ability_scores: ['str', 'dex', 'con'],
        skill_proficiencies: ['athletics', 'acrobatics'],
        origin_feat: 'FEAT-0001',
        equipment_options: { option_a: { items: [] }, option_b: { items: [] } },
      });
    } else if (entry.collection === 'originFeats' || entry.collection === 'fightingStyles') {
      Object.assign(entity, { category: entry.expected.category, related_effects: [sharedEffect.id] });
    } else {
      Object.assign(entity, {
        level: entry.expected.level,
        mechanics: {
          activation: { mode: 'active' },
          effects: [{ resolution: 'auto', result: [{ kind: 'condition', condition: 'test' }] }],
        },
      });
    }
    catalogs[type].push(entity);
  }

  for (const entry of flattenMiniMvpSpeciesVariants()) {
    const parent = catalogs.race.find((entity) => (
      entity.card_number === entry.expected.parentCardNumber
    ));
    catalogs.race.push({
      id: `id-${entry.selector.cardNumber}`,
      card_number: entry.selector.cardNumber,
      name: entry.label,
      source: entry.expected.source,
      parent_race_id: parent.id,
      related_effects: [sharedEffect.id],
    });
  }

  const index = buildCertificationIndex(catalogs);
  for (const [type, entities] of Object.entries(catalogs)) {
    for (const entity of entities) entity.support = supportFor(entity, type, index);
  }
  return catalogs;
}

test('strict audit accepts only the exact fully certified mini-MVP denominator', () => {
  const report = assessMiniMvpCatalogs(validCatalogs());
  assert.equal(report.summary.required, 180);
  assert.equal(report.summary.ready, 180);
  assert.equal(report.summary.issueCount, 0);
});

test('audit rejects legacy species variants even when an old certificate says 100%', () => {
  const catalogs = validCatalogs();
  const dwarf = catalogs.race.find((entity) => entity.card_number === 'RACE-0003');
  dwarf.name = 'Дворф';
  dwarf.lineages = [{ name: 'Горный дворф' }, { name: 'Холмовой дворф' }];
  const report = assessMiniMvpCatalogs(catalogs);
  const record = report.records.find((item) => item.cardNumber === 'RACE-0003');
  assert.equal(record.ready, false);
  assert.ok(record.issues.some((item) => item.code === 'name_mismatch'));
  assert.ok(record.issues.some((item) => item.code === 'species_variants_mismatch'));
  assert.ok(record.issues.some((item) => item.code === 'content_hash_stale'));
});

test('audit rejects micro-MVP coverage and an unlocked canonical spell', () => {
  const catalogs = validCatalogs();
  const spell = catalogs.spell.find((entity) => entity.card_number === 'SPELL-0171');
  spell.support.certification_version = 'micro-mvp-l1-rules-core-v4';
  spell.support.test_coverage.scope = 'micro-mvp-l1';
  spell.support.mechanics_locked = false;
  const report = assessMiniMvpCatalogs(catalogs);
  const record = report.records.find((item) => item.cardNumber === 'SPELL-0171');
  assert.equal(record.ready, false);
  assert.ok(record.issues.some((item) => item.code === 'certification_version_mismatch'));
  assert.ok(record.issues.some((item) => item.code === 'coverage_incomplete'));
  assert.ok(record.issues.some((item) => item.code === 'mechanics_unlocked'));
});

test('audit accepts triggered spells and specialized primitives as executable mechanics', () => {
  const catalogs = validCatalogs();
  const spell = catalogs.spell.find((entity) => entity.card_number === 'SPELL-0174');
  spell.mechanics = {
    activation: { mode: 'triggered' },
    primitive: { type: 'multi_projectile_auto_hit' },
  };
  const index = buildCertificationIndex(catalogs);
  spell.support = supportFor(spell, 'spell', index);
  const report = assessMiniMvpCatalogs(catalogs);
  const record = report.records.find((item) => item.cardNumber === 'SPELL-0174');
  assert.equal(record.ready, true);
});

test('audit refuses to call narrative-only spell data mechanically covered', () => {
  const catalogs = validCatalogs();
  const spell = catalogs.spell.find((entity) => entity.card_number === 'SPELL-0161');
  spell.mechanics.effects = [{ resolution: 'auto', result: [{ kind: 'narrative', description: 'illusion' }] }];
  const index = buildCertificationIndex(catalogs);
  spell.support = supportFor(spell, 'spell', index);
  const report = assessMiniMvpCatalogs(catalogs);
  const record = report.records.find((item) => item.cardNumber === 'SPELL-0161');
  assert.equal(record.ready, false);
  assert.ok(record.issues.some((item) => item.code === 'spell_narrative_only'));
});

test('audit rejects dangling data-driven references', () => {
  const catalogs = validCatalogs();
  const feat = catalogs.feat.find((entity) => entity.card_number === 'FEAT-0001');
  feat.related_effects = ['missing-effect'];
  const index = buildCertificationIndex(catalogs);
  feat.support = supportFor(feat, 'feat', index);
  const report = assessMiniMvpCatalogs(catalogs);
  const record = report.records.find((item) => item.cardNumber === 'FEAT-0001');
  assert.equal(record.ready, false);
  assert.ok(record.issues.some((item) => item.code === 'reference_unresolved'));
});
