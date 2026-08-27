import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyMigrationBundle,
  assertDependencySafeInterruptionPrefixes,
  assertMigrationApiContract,
  buildMigrationOperations,
  createMigrationBundle,
  exactSupportRollbackRequest,
  migrationPlanHash,
  MIGRATION_WRITE_PROTOCOL,
  readMigrationBundle,
  rollbackMigrationBundle,
  validateContentPatchDeclaration,
  validateMechanicsTargets,
  verifyBackupMetadata,
  writeMigrationBundleAtomic,
} from './migrate-micro-mvp-l1-mechanics.mjs';
import { sha256Canonical } from './certification-hash.mjs';
import {
  readReviewedPreimageCatalogs,
  readReviewedPreimageFixture,
  REVIEWED_PREIMAGE_FIXTURE_SHA256,
} from './micro-mvp-reviewed-preimage-fixture.mjs';
import {
  INCOMPLETE_PHB_ITEM_KITS,
  reviewedMicroMvpEquipmentPlans,
  validateReviewedEquipmentPlans,
} from './seed-class-training.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('migration progress bundle uses a unique crash-durable atomic writer', () => {
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-durable-bundle-'));
  const bundlePath = join(directory, 'progress.json');
  const legacyTemporary = `${bundlePath}.tmp`;
  writeFileSync(legacyTemporary, 'do-not-touch');

  writeMigrationBundleAtomic(bundlePath, { revision: 1 });
  writeMigrationBundleAtomic(bundlePath, { revision: 2 });

  assert.deepEqual(readJson(bundlePath), { revision: 2 });
  if (process.platform !== 'win32') {
    assert.equal(statSync(bundlePath).mode & 0o777, 0o600);
  }
  assert.equal(readFileSync(legacyTemporary, 'utf8'), 'do-not-touch');
  assert.equal(
    readdirSync(directory).filter((name) => name !== 'progress.json.tmp' && name.endsWith('.tmp')).length,
    0,
  );
  assert.equal(existsSync(bundlePath), true);

  const source = writeMigrationBundleAtomic.toString();
  assert.match(source, /openSync\(temporary, 'wx', 0o600\)/);
  assert.match(source, /fsyncSync\(descriptor\)/);
  assert.match(source, /renameSync\(temporary, path\)/);
  assert.match(source, /fsyncSync\(directoryDescriptor\)/);
});

test('migration bundle reader and writer reject non-private or non-regular paths', () => {
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-private-migration-bundle-'));
  const bundlePath = join(directory, 'bundle.json');
  writeMigrationBundleAtomic(bundlePath, { revision: 1 });
  assert.deepEqual(readMigrationBundle(bundlePath), { revision: 1 });

  const directoryPath = join(directory, 'not-a-file');
  mkdirSync(directoryPath);
  assert.throws(() => readMigrationBundle(directoryPath), /must be a regular file/);
  assert.throws(
    () => writeMigrationBundleAtomic(directoryPath, { revision: 2 }),
    /must be a regular file/,
  );

  if (process.platform !== 'win32') {
    chmodSync(bundlePath, 0o644);
    assert.throws(() => readMigrationBundle(bundlePath), /group\/world access/);
    assert.throws(
      () => writeMigrationBundleAtomic(bundlePath, { revision: 2 }),
      /group\/world access/,
    );
    chmodSync(bundlePath, 0o600);

    const linkPath = join(directory, 'bundle-link.json');
    symlinkSync(bundlePath, linkPath);
    assert.throws(() => readMigrationBundle(linkPath), /must not be a symlink/);
    assert.throws(
      () => writeMigrationBundleAtomic(linkPath, { revision: 2 }),
      /must not be a symlink/,
    );
  }
});

function withoutUpdatedAt(value) {
  if (Array.isArray(value)) return value.map(withoutUpdatedAt);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'updated_at'));
}

function reviewedPreimageCatalogs() {
  return readReviewedPreimageCatalogs();
}

function catalogsWithDeployedEffectResponse() {
  const catalogs = reviewedPreimageCatalogs();
  for (const collection of Object.keys(catalogs)) {
    catalogs[collection] = catalogs[collection].map((entity) => ({
      ...entity,
      support: entity.support ?? null,
    }));
  }
  catalogs.effects = catalogs.effects.map((effect) => ({
    ...effect,
    author: effect.author ?? 'Admin',
    source: effect.source ?? null,
    related_cards: effect.related_cards ?? null,
    related_actions: effect.related_actions ?? null,
    related_effects: effect.related_effects ?? null,
  }));
  catalogs.actions = catalogs.actions.map((action) => ({
    ...action,
    author: action.author ?? 'Admin',
    source: action.source ?? null,
    related_cards: action.related_cards ?? null,
    related_actions: action.related_actions ?? null,
  }));
  return catalogs;
}

function reviewedPatch() {
  return readJson(join(
    REPO_ROOT,
    'frontend/src/canon/data/micro-mvp-l1-content-patch.v1.json',
  ));
}

function sourceSnapshotPatch() {
  const patch = clone(reviewedPatch());
  for (const declaration of [
    ...patch.mechanicsPatches.effects,
    ...(patch.mechanicsPatches.actions ?? []),
    ...patch.mechanicsPatches.spells,
  ]) delete declaration.productionExpectedBeforeMechanicsHash;
  for (const declaration of [
    ...patch.fieldPatches,
    ...patch.conditionPatches,
  ]) {
    delete declaration.productionExpectedBeforeFieldsHash;
    delete declaration.productionFieldOverrides;
    delete declaration.productionEntityReferences;
  }
  return patch;
}

function singleOperationPatch({ effectCardNumber, createIndex } = {}) {
  const patch = sourceSnapshotPatch();
  patch.mechanicsPatches.effects = effectCardNumber
    ? patch.mechanicsPatches.effects.filter((item) => item.cardNumber === effectCardNumber)
    : [];
  patch.mechanicsPatches.actions = [];
  patch.mechanicsPatches.spells = [];
  patch.fieldPatches = [];
  patch.conditionPatches = [];
  patch.createEntities = Number.isInteger(createIndex) ? [patch.createEntities[createIndex]] : [];
  return patch;
}

function writeVerifiedBackup(directory, {
  createdAt = new Date().toISOString(),
  restoreVerifiedAt = createdAt,
  rowCountsCapturedAt = restoreVerifiedAt,
  source = {},
  archiveMetadata = {},
  restoreVerification = {},
} = {}) {
  const archivePath = join(directory, 'before.dump');
  const metadataPath = join(directory, 'before.metadata.json');
  const archive = Buffer.from('PGDMP isolated test pg_dump archive');
  writeFileSync(archivePath, archive, { mode: 0o600 });
  writeFileSync(metadataPath, JSON.stringify({
    created_at_utc: createdAt,
    source: {
      provider: 'Railway',
      project_id: '3ec4e61c-9a4d-4b7b-99b8-ce2a560a8b55',
      environment_id: 'ef702856-4300-4476-852a-1d4cc23532d7',
      service_id: 'b008bd10-e7ad-41f6-97ad-1a8060a57110',
      database: 'railway',
      ...source,
    },
    archive: {
      file: 'before.dump',
      format: 'custom',
      size_bytes: archive.byteLength,
      sha256: createHash('sha256').update(archive).digest('hex'),
      toc_entries: 1,
      ...archiveMetadata,
    },
    restore_verification: {
      pg_restore_exit_on_error: true,
      verified_at_utc: restoreVerifiedAt,
      postgres: { major: 17, version: '17.10' },
      row_counts_captured_at_utc: rowCountsCapturedAt,
      row_counts: { effects: 506, schema_migrations: 93 },
      ...restoreVerification,
    },
  }), { mode: 0o600 });
  return { archivePath, metadataPath };
}

function inMemoryContentApi(initialCatalogs) {
  const catalogs = clone(initialCatalogs);
  let nextId = 1;
  let timestampTick = 0;
  const receipts = new Map();
  const tombstones = [];
  const mutationCounts = {
    atomicCreate: 0,
    exactUpdate: 0,
    ordinaryPut: 0,
    restoreSupport: 0,
    hardDelete: 0,
  };
  const protectedKey = 'test-certification-key';
  const requireProtectedHeaders = (init) => (
    init.headers?.Authorization === 'Bearer test-token'
      && init.headers?.['X-Content-Certification-Key'] === protectedKey
  );
  const nextTimestamp = () => {
    timestampTick += 1;
    return `2031-01-02T03:04:${String(timestampTick).padStart(2, '0')}.000Z`;
  };
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || 'GET';

    const atomicCreate = url.pathname.match(/^\/api\/content-migrations\/([^/]+)\/(effects|actions)$/);
    if (atomicCreate && method === 'POST') {
      mutationCounts.atomicCreate += 1;
      if (!requireProtectedHeaders(init)) return new Response('forbidden', { status: 403 });
      const body = JSON.parse(String(init.body));
      const receiptKey = `${atomicCreate[1]}:${body.plan_hash}:${body.operation_id}`;
      const existingReceipt = receipts.get(receiptKey);
      if (existingReceipt) {
        const existing = catalogs[atomicCreate[2]].find((row) => row.id === existingReceipt.entity_id);
        if (!existing || existingReceipt.status !== 'active') {
          return new Response('receipt conflict', { status: 409 });
        }
        return Response.json({ entity: existing, rollback: existingReceipt.response }, { status: 200 });
      }
      if (catalogs[atomicCreate[2]].some((row) => row.card_number === body.entity.card_number)) {
        return new Response('identity conflict', { status: 409 });
      }
      const suffix = String(nextId++).padStart(12, '0');
      const entity = {
        ...body.entity,
        id: `00000000-0000-4000-8000-${suffix}`,
        support: null,
        created_at: nextTimestamp(),
        updated_at: nextTimestamp(),
      };
      catalogs[atomicCreate[2]].push(entity);
      const response = {
        receipt_id: `10000000-0000-4000-8000-${suffix}`,
        bundle_id: atomicCreate[1],
        plan_hash: body.plan_hash,
        operation_id: body.operation_id,
        entity_id: entity.id,
        card_number: entity.card_number,
        postimage_hash: sha256Canonical({ rollbackSnapshotV1: entity }),
      };
      receipts.set(receiptKey, { ...response, response, status: 'active' });
      return Response.json({ entity, rollback: response }, { status: 201 });
    }

    const restoreSupport = url.pathname.match(
      /^\/api\/content-rollback\/(card|effect|action|spell|race|class)\/([^/]+)\/support$/,
    );
    if (restoreSupport && method === 'POST') {
      mutationCounts.restoreSupport += 1;
      if (!requireProtectedHeaders(init)) return new Response('forbidden', { status: 403 });
      const collection = `${restoreSupport[1]}s`.replace('classs', 'classes');
      const row = catalogs[collection].find((entity) => entity.id === restoreSupport[2]);
      if (!row) return new Response('not found', { status: 404 });
      const body = JSON.parse(String(init.body));
      if (JSON.stringify(row) !== JSON.stringify(body.expected_current)) {
        return new Response('current CAS conflict', { status: 409 });
      }
      row.support = clone(body.support);
      return Response.json({ support: row.support });
    }

    const hardDelete = url.pathname.match(
      /^\/api\/content-rollback\/(effect|action)\/([^/]+)\/hard-delete-created$/,
    );
    if (hardDelete && method === 'POST') {
      mutationCounts.hardDelete += 1;
      if (!requireProtectedHeaders(init)) return new Response('forbidden', { status: 403 });
      const body = JSON.parse(String(init.body));
      const receiptKey = `${body.bundle_id}:${body.plan_hash}:${body.operation_id}`;
      const receipt = receipts.get(receiptKey);
      const collection = hardDelete[1] === 'action' ? 'actions' : 'effects';
      const index = catalogs[collection].findIndex((row) => row.id === hardDelete[2]);
      if (receipt?.status === 'rolled_back' && index < 0) {
        return Response.json({ rolled_back: true, already_rolled_back: true });
      }
      if (!receipt
        || receipt.status !== 'active'
        || receipt.entity_id !== hardDelete[2]
        || receipt.card_number !== body.card_number
        || receipt.postimage_hash !== body.expected_current_hash
        || index < 0) {
        return new Response('ledger CAS conflict', { status: 409 });
      }
      // Simulate the backend transaction: soft-delete proof and physical
      // removal either both commit or neither leaves a tombstone.
      const [deleted] = catalogs[collection].splice(index, 1);
      if (!deleted) return new Response('delete conflict', { status: 409 });
      receipt.status = 'rolled_back';
      return Response.json({ rolled_back: true, already_rolled_back: false });
    }

    const exactUpdate = url.pathname.match(
      /^\/api\/content-migrations\/([^/]+)\/(card|effect|action|spell|race|class|feat|background)\/([^/]+)\/exact-update$/,
    );
    if (exactUpdate && method === 'POST') {
      if (!requireProtectedHeaders(init)) return new Response('forbidden', { status: 403 });
      const [, , entityType, entityId] = exactUpdate;
      const collection = `${entityType}s`.replace('classs', 'classes');
      const row = catalogs[collection]?.find((entity) => entity.id === entityId);
      if (!row) return new Response('not found', { status: 404 });
      const body = JSON.parse(String(init.body));
      const desired = {
        ...clone(body.expected_current),
        ...clone(body.fields),
        support: null,
      };
      const comparable = (value) => Object.fromEntries(
        Object.entries(value).filter(([key]) => key !== 'updated_at'),
      );
      let alreadyApplied = false;
      if (JSON.stringify(row) === JSON.stringify(body.expected_current)) {
        mutationCounts.exactUpdate += 1;
        Object.assign(row, clone(body.fields));
        row.support = null;
        row.updated_at = nextTimestamp();
      } else if (JSON.stringify(comparable(row)) === JSON.stringify(comparable(desired))) {
        alreadyApplied = true;
      } else {
        return new Response('current CAS conflict', { status: 409 });
      }
      return Response.json({
        schema_version: 1,
        entity_type: entityType,
        entity_id: row.id,
        card_number: row.card_number,
        entity: row,
        already_applied: alreadyApplied,
        cas: 'protected_exact_current_api_response_v1',
      });
    }

    const match = url.pathname.match(/^\/api\/(cards|effects|actions|spells|races|classes)(?:\/([^/]+))?$/);
    if (!match) return new Response('not found', { status: 404 });
    const [, collection, entityId] = match;
    if (method === 'GET') {
      const page = Number(url.searchParams.get('page') || '1');
      const limit = Number(url.searchParams.get('limit') || '100');
      const start = (page - 1) * limit;
      return Response.json({
        [collection]: catalogs[collection].slice(start, start + limit),
        page,
        total: catalogs[collection].length,
      });
    }
    const index = catalogs[collection].findIndex((row) => row.id === entityId);
    if (index < 0) return new Response('not found', { status: 404 });
    if (method === 'PUT') {
      mutationCounts.ordinaryPut += 1;
      return new Response('ordinary PUT forbidden for migration tests', { status: 405 });
    }
    if (method === 'DELETE') {
      const [row] = catalogs[collection].splice(index, 1);
      tombstones.push(row);
      return Response.json({ message: 'soft deleted' });
    }
    return new Response('method not allowed', { status: 405 });
  };
  return {
    catalogs,
    fetchImpl,
    receipts,
    tombstones,
    mutationCounts,
    rawCount: (collection) => catalogs[collection].length + (
      collection === 'effects' ? tombstones.length : 0
    ),
  };
}

function persistedApplyFixture(bundle, metadataPath, bundlePath, status) {
  bundle.status = status;
  bundle.backup = verifyBackupMetadata(metadataPath);
  bundle.applyStartedAt = '2026-08-05T00:00:00.000Z';
  if (status === 'partial') bundle.failure = 'simulated process interruption';
  writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
}

function migrationTestOptions({ baseUrl, bundlePath, metadataPath, api, patchDeclaration }) {
  return {
    baseUrl,
    bundlePath,
    backupMetadataPath: metadataPath,
    confirmApi: baseUrl,
    token: 'test-token',
    certificationKey: 'test-certification-key',
    fetchImpl: api.fetchImpl,
    patchDeclaration,
  };
}

async function simulateUpdateCommit(api, baseUrl, bundle, operation) {
  const entityType = {
    cards: 'card', effects: 'effect', actions: 'action', spells: 'spell',
    races: 'race', classes: 'class',
  }[operation.collection];
  const response = await api.fetchImpl(
    `${baseUrl}/api/content-migrations/${bundle.bundleId}/${entityType}`
      + `/${operation.entityId}/exact-update`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'X-Content-Certification-Key': 'test-certification-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schema_version: 1,
        plan_hash: bundle.planHash,
        operation_id: operation.id,
        card_number: operation.cardNumber,
        expected_current: operation.before,
        fields: operation.request,
      }),
    },
  );
  assert.equal(response.status, 200);
  return clone(api.catalogs[operation.collection].find(
    (row) => row.card_number === operation.cardNumber,
  ));
}

async function simulateAtomicCreateCommit(api, baseUrl, bundle, operation) {
  const response = await api.fetchImpl(
    `${baseUrl}/api/content-migrations/${bundle.bundleId}/${operation.collection}`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'X-Content-Certification-Key': 'test-certification-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schema_version: 1,
        plan_hash: bundle.planHash,
        operation_id: operation.id,
        entity: operation.request,
      }),
    },
  );
  assert.ok([200, 201].includes(response.status));
  return response.json();
}

test('reviewed preimage fixture is schema-validated, hash-pinned and patch-closed', () => {
  const fixture = readReviewedPreimageFixture();
  assert.equal(
    REVIEWED_PREIMAGE_FIXTURE_SHA256,
    'sha256:ac2fa254a8bc8170d881a3f073e1fd77228e42b59a415b7a989e022ba80ca1b9',
  );
  assert.equal(fixture.fixtureId, 'dnd5e-2024.micro-mvp-l1.reviewed-source-preimage.v1');
  assert.equal(fixture.patch.canonicalHash, sha256Canonical(reviewedPatch()));
  assert.deepEqual(fixture.selection.counts, {
    effects: 49,
    actions: 9,
    spells: 26,
    races: 2,
    classes: 7,
    cards: 28,
  });
  assert.equal(fixture.selection.total, 121);
});

test('plan covers the complete reviewed migration and stores full API preimages', () => {
  const patch = sourceSnapshotPatch();
  const operations = buildMigrationOperations(reviewedPreimageCatalogs(), patch);
  assert.equal(patch.mechanicsPatches.effects.length, 36);
  assert.equal(patch.mechanicsPatches.actions.length, 9);
  assert.equal(patch.mechanicsPatches.spells.length, 26);
  assert.equal(operations.length, 111);
  assert.deepEqual(
    Object.fromEntries(['cards', 'effects', 'actions', 'spells', 'races', 'classes'].map((collection) => [
      collection,
      operations.filter((operation) => operation.collection === collection).length,
    ])),
    { cards: 12, effects: 54, actions: 10, spells: 26, races: 2, classes: 7 },
  );

  for (const operation of operations) {
    assert.equal(operation.state, 'planned');
    assert.equal(operation.desiredProjectionHash, sha256Canonical(operation.desiredProjection));
    if (operation.operation === 'update') {
      assert.ok(operation.before && typeof operation.before === 'object', operation.id);
      assert.equal(operation.beforeHash, sha256Canonical(operation.before), operation.id);
      assert.equal(operation.entityId, operation.before.id, operation.id);
    } else {
      assert.equal(operation.before, null, operation.id);
      assert.equal(operation.beforeHash, null, operation.id);
      assert.equal(operation.entityId, null, operation.id);
    }
    assert.ok(Array.isArray(operation.providerOperationIds), operation.id);
  }
  const createCount = operations.filter((operation) => operation.operation === 'create').length;
  assert.ok(operations.slice(0, createCount).every((operation) => operation.operation === 'create'));
  assert.ok(operations.slice(createCount).every((operation) => operation.operation === 'update'));
});

test('every apply and reverse-rollback interruption prefix preserves provider dependencies', () => {
  const operations = buildMigrationOperations(reviewedPreimageCatalogs(), sourceSnapshotPatch());
  const provider = operations.find((operation) => operation.cardNumber === 'EFF-rogue-thieves-cant');
  const consumer = operations.find((operation) => operation.cardNumber === 'CLASS-rogue');
  assert.equal(provider?.operation, 'create');
  assert.ok(consumer?.providerOperationIds.includes(provider.id));
  assert.doesNotThrow(() => assertDependencySafeInterruptionPrefixes(operations));

  const indexByID = new Map(operations.map((operation, index) => [operation.id, index]));
  for (let prefix = 0; prefix <= operations.length; prefix += 1) {
    for (const operation of operations.slice(0, prefix)) {
      for (const providerID of operation.providerOperationIds) {
        assert.ok(indexByID.get(providerID) < prefix, `apply prefix ${prefix}: ${operation.id}`);
      }
    }
  }
  const rollbackOrder = [...operations].reverse();
  for (let prefix = 0; prefix <= rollbackOrder.length; prefix += 1) {
    const rolledBack = new Set(rollbackOrder.slice(0, prefix).map((operation) => operation.id));
    for (const operation of operations.filter((item) => !rolledBack.has(item.id))) {
      for (const providerID of operation.providerOperationIds) {
        assert.equal(rolledBack.has(providerID), false, `rollback prefix ${prefix}: ${operation.id}`);
      }
    }
  }

  const unsafe = [clone(consumer), clone(provider)];
  assert.throws(
    () => assertDependencySafeInterruptionPrefixes(unsafe),
    /must precede its consumer|dangling/,
  );
});

test('subsequent plans compare created-provider relationships by stable card number', () => {
  const catalogs = reviewedPreimageCatalogs();
  const patch = sourceSnapshotPatch();
  const provider = patch.createEntities.find((declaration) => (
    declaration.collection === 'effects'
      && declaration.entity.card_number === 'EFF-rogue-thieves-cant'
  ));
  const roguePatch = patch.fieldPatches.find((declaration) => (
    declaration.collection === 'classes' && declaration.cardNumber === 'CLASS-rogue'
  ));
  assert.ok(provider);
  assert.ok(roguePatch);

  const serverAssignedProviderId = '112c7397-1f14-4899-92a6-479845c07db1';
  catalogs.effects.push({
    ...clone(provider.entity),
    id: serverAssignedProviderId,
  });
  const rogue = catalogs.classes.find((entity) => entity.card_number === 'CLASS-rogue');
  assert.ok(rogue);
  Object.assign(rogue, clone(roguePatch.fields));
  rogue.level_progression['1'].effects = rogue.level_progression['1'].effects.map((reference) => (
    reference === provider.entity.card_number ? serverAssignedProviderId : reference
  ));

  patch.mechanicsPatches = { effects: [], actions: [], spells: [] };
  patch.fieldPatches = [roguePatch];
  patch.createEntities = [provider];
  patch.conditionPatches = [];
  assert.deepEqual(buildMigrationOperations(catalogs, patch), []);

  rogue.level_progression['1'].effects = rogue.level_progression['1'].effects.map((reference) => (
    reference === serverAssignedProviderId
      ? '00000000-0000-4000-8000-000000000099'
      : reference
  ));
  assert.throws(
    () => buildMigrationOperations(catalogs, patch),
    /classes:CLASS-rogue: reviewed production before fields hash/,
  );
});

test('starting equipment and javelin corrections are stable-reference data and fail closed', () => {
  const patch = sourceSnapshotPatch();
  const catalogs = reviewedPreimageCatalogs();
  const correctedClassCards = [
    'CLASS-warrior',
    'CLASS-rogue',
    'CLASS-cleric',
    'CLASS-sorcerer',
    'CLASS-druid',
  ];

  for (const cardNumber of correctedClassCards) {
    const declaration = patch.fieldPatches.find((item) => item.cardNumber === cardNumber);
    assert.ok(declaration, cardNumber);
    assert.ok(declaration.fields.equipment_options, cardNumber);
    const referencedIds = new Set(declaration.entityReferences.map((item) => item.entityId));
    const itemIds = new Set(Object.values(declaration.fields.equipment_options)
      .flatMap((option) => option?.items ?? [])
      .map((item) => item.card_id));
    assert.deepEqual(referencedIds, itemIds, cardNumber);
    for (const reference of declaration.entityReferences) {
      const card = catalogs.cards.find((item) => item.card_number === reference.cardNumber);
      assert.equal(card?.id, reference.entityId, `${cardNumber}:${reference.cardNumber}`);
    }
  }
  for (const [cardNumber, gold] of [['CLASS-wizard', 55], ['CLASS-warlock', 100]]) {
    const declaration = patch.fieldPatches.find((item) => item.cardNumber === cardNumber);
    assert.deepEqual(declaration?.fields.equipment_options, {
      option_b: { items: [], gold },
    });
  }

  const operations = buildMigrationOperations(catalogs, patch);
  const javelin = operations.find((operation) => operation.cardNumber === 'CARD-0301');
  const javelinDeclaration = patch.fieldPatches.find((item) => item.cardNumber === 'CARD-0301');
  assert.deepEqual(javelin?.desiredProjection, javelinDeclaration?.fields);
  assert.deepEqual({
    weapon_type: javelin?.desiredProjection.weapon_type,
    mastery: javelin?.desiredProjection.mastery,
    range: javelin?.desiredProjection.range,
  }, {
    weapon_type: 'javelin',
    mastery: 'c7d07a67-374c-49f6-b34b-40e85c26674e',
    range: '30/120',
  });
  assert.equal(
    javelin?.desiredProjection.mechanics?.weapon_profile?.mastery_effect_id,
    'c7d07a67-374c-49f6-b34b-40e85c26674e',
  );

  const uncovered = clone(patch);
  uncovered.fieldPatches.find((item) => item.cardNumber === 'CLASS-cleric')
    .entityReferences = [];
  assert.throws(
    () => validateContentPatchDeclaration(uncovered),
    /card_id references lack stable cards cardNumber\/UUID assertions/,
  );

  const splitIdentityCatalogs = reviewedPreimageCatalogs();
  splitIdentityCatalogs.cards.find((item) => item.card_number === 'CARD-0283').card_number =
    'CARD-drifted-chain-mail';
  assert.throws(
    () => buildMigrationOperations(splitIdentityCatalogs, patch),
    /cards:CARD-0283.*identity is missing, duplicated, or split/,
  );
});

test('weapon profile mastery UUID requires an exact stable effect reference', () => {
  const masteryUncovered = sourceSnapshotPatch();
  const profiledWeapon = masteryUncovered.fieldPatches
    .find((item) => item.cardNumber === 'CARD-0294');
  profiledWeapon.entityReferences = profiledWeapon.entityReferences
    .filter((reference) => reference.collection !== 'effects');
  assert.throws(
    () => validateContentPatchDeclaration(masteryUncovered),
    /mastery_effect_id references lack stable effects cardNumber\/UUID assertions/,
  );
});

test('legacy class-training seed consumes the reviewed stable plans and reports incomplete kits', () => {
  const catalogs = reviewedPreimageCatalogs();
  const plans = reviewedMicroMvpEquipmentPlans(sourceSnapshotPatch());
  assert.equal(plans.size, 7);
  assert.deepEqual(validateReviewedEquipmentPlans(plans, catalogs.classes, catalogs.cards), []);
  assert.deepEqual(Object.keys(INCOMPLETE_PHB_ITEM_KITS).sort(), [
    'CLASS-warlock',
    'CLASS-wizard',
  ]);
  for (const cardNumber of Object.keys(INCOMPLETE_PHB_ITEM_KITS)) {
    assert.equal('option_a' in plans.get(cardNumber).fields.equipment_options, false);
    assert.ok(plans.get(cardNumber).fields.equipment_options.option_b.gold > 0);
  }

  const missingCardCatalog = catalogs.cards.filter((card) => card.card_number !== 'CARD-0283');
  assert.match(
    validateReviewedEquipmentPlans(plans, catalogs.classes, missingCardCatalog).join('\n'),
    /equipment card CARD-0283.*missing, duplicated, or split/,
  );
});

test('reviewed-before drift is fail-closed', () => {
  const catalogs = reviewedPreimageCatalogs();
  catalogs.effects.find((row) => row.card_number === 'EFF-alert').mechanics = {
    activation: { mode: 'passive' },
    effects: [],
    unreviewed: true,
  };
  assert.throws(
    () => buildMigrationOperations(catalogs, sourceSnapshotPatch()),
    /effects:EFF-alert: reviewed production before mechanics hash/,
  );
});

test('source and production CAS hashes are independent contracts', () => {
  const catalogs = reviewedPreimageCatalogs();
  const patch = sourceSnapshotPatch();
  assert.doesNotThrow(() => buildMigrationOperations(catalogs, patch));
  patch.mechanicsPatches.effects[0].productionExpectedBeforeMechanicsHash =
    sha256Canonical({ reviewedProductionState: 'different-from-source-snapshot' });
  assert.throws(
    () => buildMigrationOperations(catalogs, patch),
    /reviewed production before mechanics hash/,
  );
});

test('content patch shape is schema-validated before planning', () => {
  const patch = sourceSnapshotPatch();
  assert.doesNotThrow(() => validateContentPatchDeclaration(patch));
  patch.mechanicsPatches.effects[0].unreviewedField = true;
  assert.throws(
    () => validateContentPatchDeclaration(patch),
    /Content patch schema validation failed/,
  );

  const duplicated = sourceSnapshotPatch();
  duplicated.mechanicsPatches.effects.push(clone(duplicated.mechanicsPatches.effects[0]));
  assert.throws(
    () => validateContentPatchDeclaration(duplicated),
    /duplicate entity declarations/,
  );
});

test('schema and interpreter allowlists accept weapon primitives and reject unknown primitives', () => {
  const actionPatches = sourceSnapshotPatch().mechanicsPatches.actions.filter((item) => (
    item.mechanics?.primitive?.type === 'weapon_attack'
      || item.mechanics?.primitive?.type === 'light_weapon_extra_attack'
  ));
  assert.deepEqual(
    actionPatches.map((item) => item.mechanics.primitive.type).sort(),
    ['light_weapon_extra_attack', 'weapon_attack'],
  );
  assert.doesNotThrow(() => validateMechanicsTargets(actionPatches.map((item) => ({
    label: `action:${item.cardNumber}`,
    cardNumber: item.cardNumber,
    name: item.cardNumber,
    kind: 'action',
    mechanics: item.mechanics,
  }))));
  assert.throws(
    () => validateMechanicsTargets([{
      label: 'effect:test',
      cardNumber: 'TEST-001',
      name: 'Unknown primitive',
      kind: 'passive_effect',
      mechanics: {
        activation: { mode: 'passive' },
        effects: [],
        primitive: { type: 'entity_specific_magic' },
      },
    }]),
    /unsupported type entity_specific_magic|must be equal to one of the allowed values/,
  );
});

test('migration schema accepts declarative replacement/rest/sight/condition policies and rejects drift', () => {
  const patch = sourceSnapshotPatch();
  assert.doesNotThrow(() => buildMigrationOperations(reviewedPreimageCatalogs(), patch));

  const invalidReplacement = clone(patch);
  invalidReplacement.mechanicsPatches.actions.find((item) => (
    item.cardNumber === 'ACT-breath-fire'
  )).mechanics.attack_replacement.replaces_attacks = 2;
  assert.throws(
    () => buildMigrationOperations(reviewedPreimageCatalogs(), invalidReplacement),
    /Mechanics validation failed/,
  );

  const invalidRest = clone(patch);
  invalidRest.mechanicsPatches.actions.find((item) => (
    item.cardNumber === 'ACTION-0001'
  )).mechanics.rest_decision.slot_resource.maximum_level = 0;
  assert.throws(
    () => buildMigrationOperations(reviewedPreimageCatalogs(), invalidRest),
    /Mechanics validation failed/,
  );

  const invalidCondition = clone(patch);
  invalidCondition.conditionPatches[0].fields.mechanics.condition.id = 'Blinded';
  assert.throws(
    () => buildMigrationOperations(reviewedPreimageCatalogs(), invalidCondition),
    /Mechanics validation failed/,
  );
});

test('backup guard verifies format, restore proof, size and archive SHA-256', () => {
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-migration-'));
  const { archivePath, metadataPath } = writeVerifiedBackup(directory);

  const verified = verifyBackupMetadata(metadataPath);
  assert.equal(verified.archivePath, archivePath);
  assert.equal(verified.tocEntries, 1);
  assert.deepEqual(verified.restoredPostgres, { major: 17, version: '17.10' });
  assert.deepEqual(verified.rowCounts, { effects: 506, schema_migrations: 93 });

  writeFileSync(archivePath, Buffer.alloc(statSync(archivePath).size, 'x'));
  assert.throws(() => verifyBackupMetadata(metadataPath), /custom-format signature/);

  writeFileSync(archivePath, Buffer.from('tampered'));
  assert.throws(() => verifyBackupMetadata(metadataPath), /size differs from metadata/);
});

test('backup guard requires TOC, restored PostgreSQL identity, and post-restore row counts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-backup-proof-'));
  const { metadataPath } = writeVerifiedBackup(directory, {
    createdAt: '2026-08-05T10:00:00Z',
    restoreVerifiedAt: '2026-08-05T10:01:00Z',
    rowCountsCapturedAt: '2026-08-05T10:02:00Z',
  });
  const original = readJson(metadataPath);
  const persist = (metadata) => writeFileSync(
    metadataPath,
    JSON.stringify(metadata),
    { mode: 0o600 },
  );

  const noToc = clone(original);
  noToc.archive.toc_entries = 0;
  persist(noToc);
  assert.throws(() => verifyBackupMetadata(metadataPath), /positive pg_restore TOC/);

  const wrongPostgres = clone(original);
  wrongPostgres.restore_verification.postgres = { major: 16, version: '16.9' };
  persist(wrongPostgres);
  assert.throws(() => verifyBackupMetadata(metadataPath), /PostgreSQL major 17/);

  const mismatchedVersion = clone(original);
  mismatchedVersion.restore_verification.postgres.version = '16.9';
  persist(mismatchedVersion);
  assert.throws(() => verifyBackupMetadata(metadataPath), /explicit matching version/);

  const majorOnlyVersion = clone(original);
  majorOnlyVersion.restore_verification.postgres.version = '17';
  persist(majorOnlyVersion);
  assert.throws(() => verifyBackupMetadata(metadataPath), /explicit matching version/);

  const noRows = clone(original);
  noRows.restore_verification.row_counts = {};
  persist(noRows);
  assert.throws(() => verifyBackupMetadata(metadataPath), /non-empty control row counts/);

  const rowsBeforeRestore = clone(original);
  rowsBeforeRestore.restore_verification.row_counts_captured_at_utc = '2026-08-05T10:00:59Z';
  persist(rowsBeforeRestore);
  assert.throws(() => verifyBackupMetadata(metadataPath), /temporally inconsistent/);
});

test('backup guard rejects public, symlinked, and non-regular metadata or archives', () => {
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-private-backup-'));
  const { archivePath, metadataPath } = writeVerifiedBackup(directory);

  const metadataDirectory = join(directory, 'metadata-directory');
  mkdirSync(metadataDirectory);
  assert.throws(() => verifyBackupMetadata(metadataDirectory), /must be a regular file/);

  const archiveDirectory = join(directory, 'archive-directory');
  mkdirSync(archiveDirectory);
  const metadataWithDirectory = readJson(metadataPath);
  metadataWithDirectory.archive.file = 'archive-directory';
  writeFileSync(metadataPath, JSON.stringify(metadataWithDirectory), { mode: 0o600 });
  assert.throws(() => verifyBackupMetadata(metadataPath), /backup archive must be a regular file/);

  const valid = writeVerifiedBackup(directory);
  if (process.platform !== 'win32') {
    chmodSync(valid.metadataPath, 0o644);
    assert.throws(() => verifyBackupMetadata(valid.metadataPath), /group\/world access/);
    chmodSync(valid.metadataPath, 0o600);

    chmodSync(valid.archivePath, 0o644);
    assert.throws(() => verifyBackupMetadata(valid.metadataPath), /group\/world access/);
    chmodSync(valid.archivePath, 0o600);

    const metadataLink = join(directory, 'metadata-link.json');
    symlinkSync(valid.metadataPath, metadataLink);
    assert.throws(() => verifyBackupMetadata(metadataLink), /must not be a symlink/);

    const archiveLink = join(directory, 'archive-link.dump');
    symlinkSync(archivePath, archiveLink);
    const linkedArchiveMetadata = readJson(valid.metadataPath);
    linkedArchiveMetadata.archive.file = 'archive-link.dump';
    writeFileSync(valid.metadataPath, JSON.stringify(linkedArchiveMetadata), { mode: 0o600 });
    assert.throws(() => verifyBackupMetadata(valid.metadataPath), /must not be a symlink/);
  }
});

test('backup guard pins the exact Railway production source identity', () => {
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-backup-source-'));
  const { metadataPath } = writeVerifiedBackup(directory, {
    source: { service_id: '00000000-0000-4000-8000-000000000099' },
  });

  assert.throws(
    () => verifyBackupMetadata(metadataPath),
    /Railway source identity mismatch for service_id/,
  );
});

test('fresh apply backup has a bounded age while resume and rollback retain the pinned archive', () => {
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-backup-age-'));
  const { metadataPath } = writeVerifiedBackup(directory, {
    createdAt: '2026-08-05T10:00:00Z',
    restoreVerifiedAt: '2026-08-05T10:05:00Z',
  });
  const now = new Date('2026-08-05T12:00:01Z');

  assert.throws(
    () => verifyBackupMetadata(metadataPath, { now }),
    /Backup is stale for a new apply/,
  );
  assert.doesNotThrow(() => verifyBackupMetadata(metadataPath, {
    now,
    requireRecent: false,
  }));
});

test('backup and restore proof timestamps must form one bounded sequence', () => {
  const beforeDirectory = mkdtempSync(join(tmpdir(), 'micro-mvp-backup-before-'));
  const { metadataPath: beforeMetadata } = writeVerifiedBackup(beforeDirectory, {
    createdAt: '2026-08-05T10:00:00Z',
    restoreVerifiedAt: '2026-08-05T09:59:59Z',
  });
  assert.throws(
    () => verifyBackupMetadata(beforeMetadata, { now: new Date('2026-08-05T10:10:00Z') }),
    /temporally inconsistent/,
  );

  const lateDirectory = mkdtempSync(join(tmpdir(), 'micro-mvp-backup-late-'));
  const { metadataPath: lateMetadata } = writeVerifiedBackup(lateDirectory, {
    createdAt: '2026-08-05T10:00:00Z',
    restoreVerifiedAt: '2026-08-05T10:30:01Z',
  });
  assert.throws(
    () => verifyBackupMetadata(lateMetadata, { now: new Date('2026-08-05T10:35:00Z') }),
    /temporally inconsistent/,
  );
});

test('rollback refuses a bundle whose original apply backup binding is absent', async () => {
  const original = catalogsWithDeployedEffectResponse();
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-rollback-backup-binding-'));
  const { metadataPath } = writeVerifiedBackup(directory);
  const patchDeclaration = singleOperationPatch({ effectCardNumber: 'EFF-alert' });
  const bundle = await createMigrationBundle({
    baseUrl: 'https://production.test',
    catalogs: clone(original),
    patchDeclaration,
  });
  bundle.status = 'applied';
  bundle.operations[0].state = 'applied';
  bundle.backup = null;

  await assert.rejects(
    rollbackMigrationBundle(bundle, {
      baseUrl: bundle.apiBase,
      bundlePath: join(directory, 'bundle.json'),
      backupMetadataPath: metadataPath,
      confirmApi: bundle.apiBase,
      token: 'test-token',
      certificationKey: 'test-certification-key',
      patchDeclaration,
      fetchImpl: async () => {
        throw new Error('network must not be reached before backup binding validation');
      },
    }),
    /missing the original apply backup binding/,
  );
});

test('exact support rollback preserves arbitrary safe legacy JSON fields', () => {
  const support = {
    status: 'verified_partial',
    content_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    dependency_hash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    certification_version: 'preimage-v1',
    certified_at: '2026-08-01T00:00:00Z',
    limitations: ['Known limitation'],
    note: 'Exact fixture',
    legacy_field: {
      nested: ['kept', 42, true, null],
    },
  };
  assert.deepEqual(exactSupportRollbackRequest(support), support);
  assert.throws(
    () => exactSupportRollbackRequest(['support-must-be-an-object']),
    /must be an object/,
  );
  assert.throws(
    () => exactSupportRollbackRequest({ ...support, score: Number.POSITIVE_INFINITY }),
    /number must be finite/,
  );
  assert.throws(
    () => exactSupportRollbackRequest(JSON.parse('{"legacy":{"__proto__":true}}')),
    /unsafe JSON object key/,
  );
});

test('apply validates every non-null support preimage before network or mutation', async () => {
  const catalogs = catalogsWithDeployedEffectResponse();
  catalogs.effects.find((effect) => effect.card_number === 'EFF-alert').support = JSON.parse(
    '{"status":"legacy","legacy":{"__proto__":true}}',
  );
  const patchDeclaration = singleOperationPatch({ effectCardNumber: 'EFF-alert' });
  const bundle = await createMigrationBundle({
    baseUrl: 'https://production.invalid',
    catalogs,
    patchDeclaration,
  });
  let requestCount = 0;
  await assert.rejects(
    applyMigrationBundle(bundle, {
      baseUrl: bundle.apiBase,
      bundlePath: '/tmp/micro-mvp-must-not-be-written.json',
      backupMetadataPath: '/tmp/missing-backup-metadata.json',
      confirmApi: bundle.apiBase,
      token: 'test-token',
      certificationKey: 'test-certification-key',
      patchDeclaration,
      fetchImpl: async () => {
        requestCount += 1;
        throw new Error('network must not be reached');
      },
    }),
    /unsafe JSON object key/,
  );
  assert.equal(requestCount, 0);
  assert.equal(bundle.status, 'planned');
});

test('apply preflight rejects legacy effect/action responses that cannot form full preimages', () => {
  assert.throws(
    () => assertMigrationApiContract(reviewedPreimageCatalogs()),
    /Effects API response is not rollback-complete/,
  );
  const deployed = catalogsWithDeployedEffectResponse();
  assert.doesNotThrow(() => assertMigrationApiContract(deployed));
  delete deployed.actions[0].author;
  assert.throws(
    () => assertMigrationApiContract(deployed),
    /Actions API response is not rollback-complete/,
  );
});

test('apply requires a token or explicit content-admin login after local guards', async () => {
  const patchDeclaration = sourceSnapshotPatch();
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-auth-guard-'));
  const { metadataPath } = writeVerifiedBackup(directory, {
    createdAt: '2026-08-05T10:00:00Z',
    restoreVerifiedAt: '2026-08-05T10:01:00Z',
  });
  const bundle = await createMigrationBundle({
    baseUrl: 'https://production.invalid',
    catalogs: reviewedPreimageCatalogs(),
    patchDeclaration,
    createdAt: '2026-08-05T10:02:00Z',
  });
  assert.equal(bundle.schemaVersion, 4);
  assert.deepEqual(bundle.writeProtocol, MIGRATION_WRITE_PROTOCOL);
  assert.match(bundle.bundleId, /^[0-9a-f-]{36}$/);
  assert.equal(bundle.planHash, migrationPlanHash(bundle));
  await assert.rejects(
    applyMigrationBundle(bundle, {
      baseUrl: bundle.apiBase,
      bundlePath: join(directory, 'bundle.json'),
      backupMetadataPath: metadataPath,
      confirmApi: bundle.apiBase,
      token: '',
      certificationKey: 'test-certification-key',
      patchDeclaration,
      now: new Date('2026-08-05T10:03:00Z'),
    }),
    /API_TOKEN or explicit content-admin credentials are required for apply/,
  );
  assert.equal(bundle.status, 'planned');
});

test('edited preimage bundle is rejected before authentication or network access', async () => {
  const patchDeclaration = sourceSnapshotPatch();
  const bundle = await createMigrationBundle({
    baseUrl: 'https://production.invalid',
    catalogs: reviewedPreimageCatalogs(),
    patchDeclaration,
  });
  bundle.operations[0].request.mechanics = { activation: { mode: 'passive' }, effects: [] };
  await assert.rejects(
    applyMigrationBundle(bundle, {
      baseUrl: bundle.apiBase,
      bundlePath: '/tmp/micro-mvp-must-not-be-written.json',
      backupMetadataPath: '/tmp/missing-backup-metadata.json',
      confirmApi: bundle.apiBase,
      token: '',
      patchDeclaration,
    }),
    /plan integrity hash is missing or invalid/,
  );
});

test('content-admin login fallback runs only after integrity and backup validation', async () => {
  const original = catalogsWithDeployedEffectResponse();
  const api = inMemoryContentApi(original);
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-login-fallback-'));
  const { metadataPath } = writeVerifiedBackup(directory, {
    createdAt: '2026-08-05T10:00:00Z',
    restoreVerifiedAt: '2026-08-05T10:01:00Z',
  });
  const baseUrl = 'https://production.test';
  const patchDeclaration = singleOperationPatch({ effectCardNumber: 'EFF-alert' });
  const bundle = await createMigrationBundle({
    baseUrl, catalogs: clone(original), patchDeclaration,
    createdAt: '2026-08-05T10:02:00Z',
  });
  let loginCalls = 0;
  const options = {
    ...migrationTestOptions({
      baseUrl,
      bundlePath: join(directory, 'bundle.json'),
      metadataPath,
      api,
      patchDeclaration,
    }),
    token: '',
    now: new Date('2026-08-05T10:03:00Z'),
    loginProvider: async () => {
      loginCalls += 1;
      return 'test-token';
    },
  };
  await applyMigrationBundle(bundle, options);
  assert.equal(loginCalls, 1);
  assert.equal(bundle.status, 'applied');

  const edited = await createMigrationBundle({
    baseUrl, catalogs: clone(original), patchDeclaration,
    createdAt: '2026-08-05T10:02:00Z',
  });
  edited.operations[0].request.mechanics = { unreviewed: true };
  loginCalls = 0;
  await assert.rejects(
    applyMigrationBundle(edited, options),
    /plan integrity hash is missing or invalid/,
  );
  assert.equal(loginCalls, 0, 'integrity failure must precede login');
});

test('new apply rejects unrelated full-catalog drift before the first content mutation', async () => {
  const original = catalogsWithDeployedEffectResponse();
  const api = inMemoryContentApi(original);
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-catalog-drift-'));
  const { metadataPath } = writeVerifiedBackup(directory);
  const bundlePath = join(directory, 'preimage.json');
  const baseUrl = 'https://production.test';
  const patchDeclaration = singleOperationPatch({ effectCardNumber: 'EFF-alert' });
  const bundle = await createMigrationBundle({
    baseUrl,
    catalogs: clone(original),
    patchDeclaration,
  });

  // This row is outside the selected one-operation patch. Operation-level
  // preimage CAS alone would miss it; the release-level catalog pin must not.
  api.catalogs.classes[0].description = 'unreviewed concurrent catalog change';

  await assert.rejects(
    applyMigrationBundle(bundle, migrationTestOptions({
      baseUrl, bundlePath, metadataPath, api, patchDeclaration,
    })),
    /Full catalog fingerprint changed/,
  );
  assert.deepEqual(api.mutationCounts, {
    atomicCreate: 0,
    exactUpdate: 0,
    ordinaryPut: 0,
    restoreSupport: 0,
    hardDelete: 0,
  });
  assert.equal(bundle.status, 'planned');
});

test('exact-current endpoint closes selected-row TOCTOU after catalog preflight', async () => {
  const original = catalogsWithDeployedEffectResponse();
  const api = inMemoryContentApi(original);
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-selected-row-toctou-'));
  const { metadataPath } = writeVerifiedBackup(directory);
  const bundlePath = join(directory, 'preimage.json');
  const baseUrl = 'https://production.test';
  const patchDeclaration = singleOperationPatch({ effectCardNumber: 'EFF-alert' });
  const bundle = await createMigrationBundle({
    baseUrl, catalogs: clone(original), patchDeclaration,
  });
  let injectDrift = true;
  const fetchImpl = async (input, init = {}) => {
    if (injectDrift && String(input).endsWith('/exact-update')) {
      injectDrift = false;
      api.catalogs.effects.find((row) => row.card_number === 'EFF-alert').description =
        'concurrent edit after full-catalog preflight';
    }
    return api.fetchImpl(input, init);
  };

  await assert.rejects(
    applyMigrationBundle(bundle, {
      ...migrationTestOptions({
        baseUrl, bundlePath, metadataPath, api, patchDeclaration,
      }),
      fetchImpl,
    }),
    /409 current CAS conflict/,
  );
  assert.equal(api.mutationCounts.exactUpdate, 0);
  assert.equal(
    api.catalogs.effects.find((row) => row.card_number === 'EFF-alert').description,
    'concurrent edit after full-catalog preflight',
  );
  assert.equal(bundle.status, 'partial');
  assert.equal(bundle.operations[0].state, 'write-outcome-unknown');
});

test('apply requires the restore-checked backup to predate the reviewed plan', async () => {
  const original = catalogsWithDeployedEffectResponse();
  const api = inMemoryContentApi(original);
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-backup-plan-order-'));
  const { metadataPath } = writeVerifiedBackup(directory, {
    createdAt: '2026-08-05T10:00:00Z',
    restoreVerifiedAt: '2026-08-05T10:05:00Z',
  });
  const baseUrl = 'https://production.test';
  const patchDeclaration = singleOperationPatch({ effectCardNumber: 'EFF-alert' });
  const bundle = await createMigrationBundle({
    baseUrl,
    catalogs: clone(original),
    patchDeclaration,
    createdAt: '2026-08-05T10:04:59Z',
  });

  await assert.rejects(
    applyMigrationBundle(bundle, {
      ...migrationTestOptions({
        baseUrl,
        bundlePath: join(directory, 'preimage.json'),
        metadataPath,
        api,
        patchDeclaration,
      }),
      now: new Date('2026-08-05T10:10:00Z'),
    }),
    /Backup restore proof must predate/,
  );
  assert.equal(api.mutationCounts.exactUpdate, 0);
  assert.equal(api.mutationCounts.ordinaryPut, 0);
});

test('integration: exact plan applies, records postimages and rolls back to every preimage', async () => {
  const original = catalogsWithDeployedEffectResponse();
  original.effects.find((effect) => effect.card_number === 'EFF-alert').support = {
    status: 'verified_partial',
    content_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    dependency_hash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    certification_version: 'preimage-v1',
    certified_at: '2026-08-01T00:00:00Z',
    limitations: ['Exact preimage fixture'],
    note: 'Trigger-like invalidation must be reversed through protected support API.',
    legacy_field: {
      schema: 'pre-certification-v0',
      nested: ['must', 'round-trip', 2024],
    },
  };
  const api = inMemoryContentApi(original);
  const originalEffectsRawCount = api.rawCount('effects');
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-roundtrip-'));
  const { metadataPath } = writeVerifiedBackup(directory);
  const bundlePath = join(directory, 'preimage.json');
  const baseUrl = 'https://production.test';
  const patchDeclaration = sourceSnapshotPatch();
  const bundle = await createMigrationBundle({
    baseUrl,
    catalogs: clone(original),
    patchDeclaration,
  });
  const options = {
    baseUrl,
    bundlePath,
    backupMetadataPath: metadataPath,
    confirmApi: baseUrl,
    token: 'test-token',
    certificationKey: 'test-certification-key',
    fetchImpl: api.fetchImpl,
    patchDeclaration,
  };

  await applyMigrationBundle(bundle, options);
  assert.equal(bundle.status, 'applied');
  assert.ok(bundle.operations.every((operation) => (
    operation.state === 'applied'
      && typeof operation.afterHash === 'string'
      && operation.afterHash === sha256Canonical(operation.after)
  )));
  const appliedJavelin = api.catalogs.cards.find((card) => card.card_number === 'CARD-0301');
  assert.equal(appliedJavelin?.range, '30/120');
  assert.equal(
    buildMigrationOperations(api.catalogs, patchDeclaration).length,
    0,
    'repeating the reviewed patch after apply must be a no-op',
  );

  await assert.rejects(
    rollbackMigrationBundle(bundle, { ...options, certificationKey: '' }),
    /CONTENT_CERTIFICATION_KEY is required/,
  );
  assert.equal(bundle.status, 'applied');
  assert.equal(api.rawCount('effects'), originalEffectsRawCount + (
    bundle.operations.filter((operation) => (
      operation.operation === 'create' && operation.collection === 'effects'
    )).length
  ));

  await rollbackMigrationBundle(bundle, options);
  assert.equal(bundle.status, 'rolled-back');
  assert.ok(bundle.operations.every((operation) => operation.state === 'rolled-back'));
  for (const collection of ['cards', 'effects', 'actions', 'spells', 'races', 'classes']) {
    assert.deepEqual(
      withoutUpdatedAt(api.catalogs[collection]),
      withoutUpdatedAt(original[collection]),
      collection,
    );
  }
  const rolledBackJavelin = api.catalogs.cards.find((card) => card.card_number === 'CARD-0301');
  assert.equal(rolledBackJavelin?.range, null, 'rollback restores the nullable range preimage');
  assert.equal(api.rawCount('effects'), originalEffectsRawCount, 'physical row count');
  assert.equal(api.tombstones.length, 0, 'atomic ledger rollback leaves no tombstones');
  assert.equal(
    [...api.receipts.values()].filter((receipt) => receipt.status === 'rolled_back').length,
    bundle.operations.filter((operation) => operation.operation === 'create').length,
    'every server-issued create receipt remains as rolled-back audit evidence',
  );
});

test('apply resumes every persisted update phase without a duplicate exact-CAS write', async (t) => {
  const phases = [
    { name: 'bundle-applying-operation-planned', state: 'planned', live: 'before' },
    { name: 'writing-before-request', state: 'writing', live: 'before' },
    { name: 'not-applied-probe', state: 'not-applied', live: 'before', status: 'partial' },
    {
      name: 'unknown-before-request', state: 'write-outcome-unknown', live: 'before',
      status: 'partial',
    },
    { name: 'writing-after-commit', state: 'writing', live: 'after' },
    {
      name: 'unknown-after-commit', state: 'write-outcome-unknown', live: 'after',
      status: 'partial',
    },
    { name: 'applied-unverified', state: 'applied-unverified', live: 'captured' },
    { name: 'applied-before-bundle-finalize', state: 'applied', live: 'captured' },
  ];
  for (const phase of phases) {
    await t.test(phase.name, async () => {
      const original = catalogsWithDeployedEffectResponse();
      const api = inMemoryContentApi(original);
      const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-apply-update-resume-'));
      const { metadataPath } = writeVerifiedBackup(directory);
      const bundlePath = join(directory, 'preimage.json');
      const baseUrl = 'https://production.test';
      const patchDeclaration = singleOperationPatch({ effectCardNumber: 'EFF-alert' });
      const bundle = await createMigrationBundle({
        baseUrl, catalogs: clone(original), patchDeclaration,
      });
      assert.equal(bundle.operations.length, 1);
      const operation = bundle.operations[0];
      let committed = null;
      if (phase.live !== 'before') {
        committed = await simulateUpdateCommit(api, baseUrl, bundle, operation);
      }
      operation.state = phase.state;
      if (phase.live === 'captured') {
        operation.after = clone(committed);
        operation.afterHash = sha256Canonical(committed);
      }
      persistedApplyFixture(
        bundle,
        metadataPath,
        bundlePath,
        phase.status ?? 'applying',
      );

      await applyMigrationBundle(bundle, migrationTestOptions({
        baseUrl, bundlePath, metadataPath, api, patchDeclaration,
      }));

      assert.equal(bundle.status, 'applied');
      assert.equal(operation.state, 'applied');
      assert.equal(bundle.applyResumeCount, 1);
      assert.equal(api.mutationCounts.exactUpdate, 1, 'the exact-CAS content write must commit once');
      assert.equal(api.mutationCounts.ordinaryPut, 0, 'migration must never use ordinary PUT');
      const current = api.catalogs.effects.find((row) => row.card_number === 'EFF-alert');
      assert.equal(operation.afterHash, sha256Canonical(current));
    });
  }
});

test('apply resumes every persisted atomic-create phase without duplicate rows or receipts', async (t) => {
  const phases = [
    { name: 'bundle-applying-operation-planned', state: 'planned', live: 'before' },
    { name: 'writing-before-request', state: 'writing', live: 'before' },
    { name: 'not-applied-probe', state: 'not-applied', live: 'before', status: 'partial' },
    {
      name: 'unknown-before-request', state: 'write-outcome-unknown', live: 'before',
      status: 'partial',
    },
    { name: 'writing-after-commit-before-receipt-persist', state: 'writing', live: 'after' },
    {
      name: 'unknown-after-commit', state: 'write-outcome-unknown', live: 'after',
      status: 'partial',
    },
    { name: 'applied-unverified', state: 'applied-unverified', live: 'captured' },
    { name: 'applied-before-bundle-finalize', state: 'applied', live: 'captured' },
  ];
  for (const phase of phases) {
    await t.test(phase.name, async () => {
      const original = catalogsWithDeployedEffectResponse();
      const api = inMemoryContentApi(original);
      const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-apply-create-resume-'));
      const { metadataPath } = writeVerifiedBackup(directory);
      const bundlePath = join(directory, 'preimage.json');
      const baseUrl = 'https://production.test';
      const patchDeclaration = singleOperationPatch({ createIndex: 0 });
      const bundle = await createMigrationBundle({
        baseUrl, catalogs: clone(original), patchDeclaration,
      });
      assert.equal(bundle.operations.length, 1);
      const operation = bundle.operations[0];
      const initialOperationRows = api.rawCount(operation.collection);
      let committed = null;
      if (phase.live !== 'before') {
        committed = await simulateAtomicCreateCommit(api, baseUrl, bundle, operation);
      }
      operation.state = phase.state;
      if (phase.live === 'captured') {
        operation.entityId = committed.entity.id;
        operation.createReceipt = clone(committed.rollback);
        operation.after = clone(committed.entity);
        operation.afterHash = sha256Canonical(committed.entity);
      }
      persistedApplyFixture(
        bundle,
        metadataPath,
        bundlePath,
        phase.status ?? 'applying',
      );

      await applyMigrationBundle(bundle, migrationTestOptions({
        baseUrl, bundlePath, metadataPath, api, patchDeclaration,
      }));

      assert.equal(bundle.status, 'applied');
      assert.equal(operation.state, 'applied');
      assert.equal(bundle.applyResumeCount, 1);
      assert.equal(
        api.rawCount(operation.collection),
        initialOperationRows + 1,
        `one physical ${operation.collection} row`,
      );
      assert.equal(api.receipts.size, 1, 'one server receipt');
      assert.equal(
        api.catalogs[operation.collection]
          .filter((row) => row.card_number === operation.cardNumber).length,
        1,
      );
      assert.equal(operation.createReceipt.entity_id, operation.entityId);
    });
  }
});

test('resumed apply rejects unreviewed write-outcome drift before another mutation', async () => {
  const original = catalogsWithDeployedEffectResponse();
  const api = inMemoryContentApi(original);
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-apply-drift-resume-'));
  const { metadataPath } = writeVerifiedBackup(directory);
  const bundlePath = join(directory, 'preimage.json');
  const baseUrl = 'https://production.test';
  const patchDeclaration = singleOperationPatch({ effectCardNumber: 'EFF-alert' });
  const bundle = await createMigrationBundle({
    baseUrl, catalogs: clone(original), patchDeclaration,
  });
  const operation = bundle.operations[0];
  const current = api.catalogs.effects.find((row) => row.card_number === operation.cardNumber);
  Object.assign(current, operation.request, {
    support: null,
    description: 'unreviewed concurrent drift',
    updated_at: '2031-01-02T03:04:59.000Z',
  });
  operation.state = 'write-outcome-unknown';
  persistedApplyFixture(bundle, metadataPath, bundlePath, 'partial');

  await assert.rejects(
    applyMigrationBundle(bundle, migrationTestOptions({
      baseUrl, bundlePath, metadataPath, api, patchDeclaration,
    })),
    /unknown persisted update outcome has unreviewed drift/,
  );
  assert.equal(api.mutationCounts.exactUpdate, 0);
  assert.equal(api.mutationCounts.ordinaryPut, 0);
  assert.equal(bundle.status, 'partial');
});

test('partial apply captures an unverified postimage that can be CAS-rolled back', async () => {
  const original = catalogsWithDeployedEffectResponse();
  const api = inMemoryContentApi(original);
  let sabotageNextWrite = true;
  const fetchImpl = async (input, init = {}) => {
    if (sabotageNextWrite
      && init.method === 'POST'
      && String(input).endsWith('/exact-update')) {
      sabotageNextWrite = false;
      const body = JSON.parse(String(init.body));
      return api.fetchImpl(input, {
        ...init,
        body: JSON.stringify({
          ...body,
          fields: {
            ...body.fields,
            mechanics: { activation: { mode: 'passive' }, effects: [], serverDrift: true },
          },
        }),
      });
    }
    return api.fetchImpl(input, init);
  };
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-partial-'));
  const { metadataPath } = writeVerifiedBackup(directory);
  const baseUrl = 'https://production.test';
  const patchDeclaration = sourceSnapshotPatch();
  const bundle = await createMigrationBundle({
    baseUrl,
    catalogs: clone(original),
    patchDeclaration,
  });
  const options = {
    baseUrl,
    bundlePath: join(directory, 'preimage.json'),
    backupMetadataPath: metadataPath,
    confirmApi: baseUrl,
    token: 'test-token',
    certificationKey: 'test-certification-key',
    fetchImpl,
    patchDeclaration,
  };

  await assert.rejects(applyMigrationBundle(bundle, options), /post-apply projection/);
  assert.equal(bundle.status, 'partial');
  const unverified = bundle.operations.find((operation) => operation.state === 'applied-unverified');
  assert.ok(unverified, 'the sabotaged exact update must retain its captured postimage');
  assert.equal(unverified.afterHash, sha256Canonical(unverified.after));

  await rollbackMigrationBundle(bundle, options);
  assert.equal(bundle.status, 'rolled-back');
  assert.deepEqual(withoutUpdatedAt(api.catalogs.effects), withoutUpdatedAt(original.effects));
});

test('rollback resumes after a lost exact-support response without replaying content CAS', async () => {
  const original = catalogsWithDeployedEffectResponse();
  const certified = original.effects.find((effect) => effect.card_number === 'EFF-alert');
  certified.support = {
    status: 'verified_partial',
    content_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    dependency_hash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    certification_version: 'resume-v1',
    certified_at: '2026-08-01T00:00:00Z',
    limitations: ['Resume fixture'],
  };
  const api = inMemoryContentApi(original);
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-support-resume-'));
  const { metadataPath } = writeVerifiedBackup(directory);
  const baseUrl = 'https://production.test';
  const patchDeclaration = singleOperationPatch({ effectCardNumber: 'EFF-alert' });
  const bundle = await createMigrationBundle({
    baseUrl, catalogs: clone(original), patchDeclaration,
  });
  assert.equal(bundle.operations.length, 1);
  let loseSupportResponse = true;
  const fetchImpl = async (input, init = {}) => {
    if (loseSupportResponse && String(input).endsWith(`/support`) && init.method === 'POST') {
      loseSupportResponse = false;
      await api.fetchImpl(input, init);
      throw new Error('simulated lost support response');
    }
    return api.fetchImpl(input, init);
  };
  const options = {
    baseUrl,
    bundlePath: join(directory, 'preimage.json'),
    backupMetadataPath: metadataPath,
    confirmApi: baseUrl,
    token: 'test-token',
    certificationKey: 'test-certification-key',
    fetchImpl,
    patchDeclaration,
  };
  await applyMigrationBundle(bundle, options);
  await assert.rejects(rollbackMigrationBundle(bundle, options), /lost support response/);
  assert.equal(bundle.status, 'rollback-partial');
  assert.equal(bundle.operations[0].state, 'rollback-support-writing');

  await rollbackMigrationBundle(bundle, options);
  assert.equal(bundle.status, 'rolled-back');
  assert.equal(bundle.operations[0].state, 'rolled-back');
  assert.deepEqual(
    withoutUpdatedAt(api.catalogs.effects.find((row) => row.card_number === 'EFF-alert')),
    withoutUpdatedAt(certified),
  );
});

test('rollback resumes idempotently after a lost server-receipt hard-delete response', async () => {
  const original = catalogsWithDeployedEffectResponse();
  const api = inMemoryContentApi(original);
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-delete-resume-'));
  const { metadataPath } = writeVerifiedBackup(directory);
  const baseUrl = 'https://production.test';
  const patchDeclaration = singleOperationPatch({ createIndex: 0 });
  const bundle = await createMigrationBundle({
    baseUrl, catalogs: clone(original), patchDeclaration,
  });
  assert.equal(bundle.operations.length, 1);
  let loseDeleteResponse = true;
  const fetchImpl = async (input, init = {}) => {
    if (loseDeleteResponse && String(input).endsWith('/hard-delete-created') && init.method === 'POST') {
      loseDeleteResponse = false;
      await api.fetchImpl(input, init);
      throw new Error('simulated lost hard-delete response');
    }
    return api.fetchImpl(input, init);
  };
  const options = {
    baseUrl,
    bundlePath: join(directory, 'preimage.json'),
    backupMetadataPath: metadataPath,
    confirmApi: baseUrl,
    token: 'test-token',
    certificationKey: 'test-certification-key',
    fetchImpl,
    patchDeclaration,
  };
  await applyMigrationBundle(bundle, options);
  await assert.rejects(rollbackMigrationBundle(bundle, options), /lost hard-delete response/);
  assert.equal(bundle.status, 'rollback-partial');
  assert.equal(bundle.operations[0].state, 'rollback-hard-delete-writing');

  await rollbackMigrationBundle(bundle, options);
  assert.equal(bundle.status, 'rolled-back');
  assert.equal(bundle.operations[0].state, 'rolled-back');
  assert.equal(api.rawCount('effects'), original.effects.length);
  assert.equal(api.tombstones.length, 0);
});
