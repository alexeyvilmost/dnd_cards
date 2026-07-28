import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MICRO_MICRO_COLLECTION_SIZES,
  MICRO_MICRO_MANIFEST,
  flattenMicroMicroManifest,
  validateMicroMicroManifest,
} from './micro-micro-manifest.mjs';
import { assessMicroMicroContent, resolveManifestEntry } from './micro-micro-gate.mjs';
import {
  buildCertificationIndex,
  certificationHashes,
  contentHash,
} from './certification-hash.mjs';
import { prepareCertification } from './certify-content.mjs';

test('manifest contains the approved number of entities in every collection', () => {
  assert.deepEqual(validateMicroMicroManifest(), []);
  for (const [collection, size] of Object.entries(MICRO_MICRO_COLLECTION_SIZES)) {
    assert.equal(MICRO_MICRO_MANIFEST.collections[collection].length, size);
  }
  assert.equal(flattenMicroMicroManifest().length, 37);
});

test('stable selector plus visible verified status is ready', () => {
  const item = MICRO_MICRO_MANIFEST.collections.classes[0];
  const result = resolveManifestEntry(item, [{
    id: 'class-1',
    card_number: 'CLASS-warrior',
    support: {
      status: 'verified_partial',
      certification_version: 'micro-micro-v1',
      content_hash: 'content-v1',
      dependency_hash: 'deps-v1',
      limitations: ['Только первый уровень'],
    },
  }]);
  assert.equal(result.status, 'ready');
});

test('canonical content hash ignores support and timestamps but detects content edits', () => {
  const entity = {
    id: 'entity-1',
    name: 'До',
    support: { status: 'verified_mechanical' },
    created_at: '2026-01-01',
    updated_at: '2026-01-02',
  };
  const before = contentHash(entity);
  assert.equal(contentHash({
    ...entity,
    support: { status: 'known_mismatch' },
    updated_at: '2026-07-28',
  }), before);
  assert.notEqual(contentHash({ ...entity, name: 'После' }), before);
});

test('gate invalidates certification when a transitive dependency changes', () => {
  const effect = { id: 'effect-1', card_number: 'EFFECT-1', description: 'До' };
  const action = {
    id: 'action-1',
    card_number: 'ACTION-1',
    related_effects: [effect.id],
  };
  const fighter = {
    id: 'class-1',
    card_number: 'CLASS-warrior',
    related_actions: [action.id],
  };
  const groups = {
    class: [fighter],
    action: [action],
    effect: [effect],
  };
  const index = buildCertificationIndex(groups);
  const hashes = certificationHashes(fighter, 'class', index);
  fighter.support = {
    status: 'verified_mechanical',
    certification_version: 'micro-micro-v1',
    content_hash: hashes.contentHash,
    dependency_hash: hashes.dependencyHash,
  };
  const item = MICRO_MICRO_MANIFEST.collections.classes[0];

  assert.equal(
    resolveManifestEntry(item, [fighter], { entityType: 'class', index }).status,
    'ready',
  );

  effect.description = 'После';
  const stale = resolveManifestEntry(item, [fighter], { entityType: 'class', index });
  assert.equal(stale.status, 'stale_certification');
  assert.deepEqual(stale.staleFields, ['dependency_hash']);
});

test('gate invalidates certification when the entity content changes', () => {
  const fighter = {
    id: 'class-1',
    card_number: 'CLASS-warrior',
    description: 'До',
  };
  const index = buildCertificationIndex({ class: [fighter] });
  const hashes = certificationHashes(fighter, 'class', index);
  fighter.support = {
    status: 'verified_mechanical',
    certification_version: 'micro-micro-v1',
    content_hash: hashes.contentHash,
    dependency_hash: hashes.dependencyHash,
  };
  fighter.description = 'После';

  const result = resolveManifestEntry(
    MICRO_MICRO_MANIFEST.collections.classes[0],
    [fighter],
    { entityType: 'class', index },
  );
  assert.equal(result.status, 'stale_certification');
  assert.deepEqual(result.staleFields, ['content_hash']);
});

test('certification preparation computes hashes without writing', async () => {
  const fixtureByKey = {
    classes: [{
      id: 'class-1',
      card_number: 'CLASS-warrior',
      related_actions: ['action-1'],
    }],
    actions: [{
      id: 'action-1',
      card_number: 'ACTION-1',
      description: 'Second Wind',
    }],
  };
  const prepared = await prepareCertification({
    entityType: 'class',
    cardNumber: 'CLASS-warrior',
    status: 'verified_partial',
    limitations: ['Только первый уровень'],
    fetcher: async (_path, key) => fixtureByKey[key] ?? [],
  });

  assert.match(prepared.payload.content_hash, /^sha256:[a-f0-9]{64}$/);
  assert.match(prepared.payload.dependency_hash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(prepared.dependencies.length, 1);
  assert.equal(prepared.dependencies[0].identity, 'action:action-1');
});

test('name-only identity can be found but cannot be certified as ready', () => {
  const item = {
    key: 'background.example',
    label: 'Example',
    selector: { nameEn: 'Soldier' },
    expected: {},
  };
  const result = resolveManifestEntry(item, [{
    id: 'background-1',
    name_en: 'Soldier',
    support: { status: 'verified_mechanical' },
  }]);
  assert.equal(result.status, 'unstable_identity');
});

test('unsupported or absent support status never passes the release gate', () => {
  const item = MICRO_MICRO_MANIFEST.collections.classes[0];
  assert.equal(
    resolveManifestEntry(item, [{ card_number: 'CLASS-warrior' }]).status,
    'not_certified',
  );
  assert.equal(
    resolveManifestEntry(item, [{
      card_number: 'CLASS-warrior',
      support: { status: 'known_mismatch' },
    }]).status,
    'not_certified',
  );
});

test('extra catalog records cannot mask a missing required entity', () => {
  const report = assessMicroMicroContent({
    classes: Array.from({ length: 20 }, (_, index) => ({
      card_number: `CLASS-extra-${index}`,
      support: { status: 'verified_mechanical' },
    })),
  });
  assert.equal(report.ready, false);
  assert.equal(report.results.find((item) => item.key === 'class.fighter')?.status, 'missing');
});
