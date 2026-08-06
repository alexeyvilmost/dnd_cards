import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Canonical } from './certification-hash.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const FIXTURE_PATH = join(
  HERE,
  'testdata/micro-mvp-l1-reviewed-preimage.v1.json',
);
const SCHEMA_PATH = join(HERE, 'micro-mvp-reviewed-preimage-fixture.schema.json');
const PATCH_PATH = join(
  REPO_ROOT,
  'frontend/src/canon/data/micro-mvp-l1-content-patch.v1.json',
);
const require = createRequire(import.meta.url);
const Ajv = require(join(REPO_ROOT, 'frontend/node_modules/ajv/dist/ajv.js')).default;

export const REVIEWED_PREIMAGE_FIXTURE_SHA256 =
  'sha256:196a83c0f0055d31ae5f70adc95491685f5ad0b2b5c5ac5c7c267aa34bc9fa4d';

const COLLECTIONS = Object.freeze([
  'effects', 'actions', 'spells', 'races', 'classes', 'cards',
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function rawSha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function expectedIdentities(patch) {
  const result = Object.fromEntries(COLLECTIONS.map((collection) => [collection, new Set()]));
  const add = (collection, entityId, cardNumber) => {
    result[collection].add(`${entityId}\0${cardNumber}`);
  };
  for (const [collection, declarations] of Object.entries(patch.mechanicsPatches)) {
    for (const declaration of declarations) {
      add(collection, declaration.entityId, declaration.cardNumber);
    }
  }
  for (const declaration of patch.fieldPatches) {
    add(declaration.collection, declaration.entityId, declaration.cardNumber);
    for (const reference of declaration.entityReferences ?? []) {
      add(reference.collection, reference.entityId, reference.cardNumber);
    }
  }
  for (const declaration of patch.conditionPatches) {
    if (declaration.entityId) {
      add('effects', declaration.entityId, declaration.cardNumber);
    }
  }
  return result;
}

function validateFixture(fixture, rawBytes) {
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validate = ajv.compile(readJson(SCHEMA_PATH));
  if (!validate(fixture)) {
    throw new Error(`Reviewed preimage fixture schema validation failed: ${JSON.stringify(validate.errors)}`);
  }
  const actualFixtureHash = rawSha256(rawBytes);
  if (actualFixtureHash !== REVIEWED_PREIMAGE_FIXTURE_SHA256) {
    throw new Error(
      `Reviewed preimage fixture hash mismatch: ${REVIEWED_PREIMAGE_FIXTURE_SHA256} -> ${actualFixtureHash}`,
    );
  }

  const patch = readJson(PATCH_PATH);
  const actualPatchHash = sha256Canonical(patch);
  if (fixture.patch.id !== patch.patchId
    || fixture.patch.version !== patch.patchVersion
    || fixture.patch.sourceReleaseId !== patch.sourceReleaseId
    || fixture.patch.canonicalHash !== actualPatchHash) {
    throw new Error('Reviewed preimage fixture is not bound to the current immutable content patch');
  }

  const expected = expectedIdentities(patch);
  let actualTotal = 0;
  for (const collection of COLLECTIONS) {
    const rows = fixture.catalogs[collection];
    const identities = rows.map((row) => `${row.id}\0${row.card_number}`);
    const unique = new Set(identities);
    if (unique.size !== identities.length) {
      throw new Error(`Reviewed preimage fixture has duplicate ${collection} identities`);
    }
    const expectedSorted = [...expected[collection]].sort();
    const actualSorted = [...unique].sort();
    if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
      throw new Error(`Reviewed preimage fixture ${collection} does not equal the patch identity closure`);
    }
    if (fixture.selection.counts[collection] !== rows.length) {
      throw new Error(`Reviewed preimage fixture ${collection} count is not exact`);
    }
    actualTotal += rows.length;
  }
  if (fixture.selection.total !== actualTotal) {
    throw new Error('Reviewed preimage fixture total is not exact');
  }
  return fixture;
}

let cachedFixture;

export function readReviewedPreimageFixture() {
  if (!cachedFixture) {
    const rawBytes = readFileSync(FIXTURE_PATH);
    cachedFixture = validateFixture(JSON.parse(rawBytes.toString('utf8')), rawBytes);
  }
  return JSON.parse(JSON.stringify(cachedFixture));
}

export function readReviewedPreimageCatalogs() {
  return readReviewedPreimageFixture().catalogs;
}
