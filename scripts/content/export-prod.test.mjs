import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  PROD_SNAPSHOT_ENTITIES,
  REQUIRED_CONDITION_CARD_NUMBERS,
  exportProductionSnapshot,
  requiredConditionCardNumbers,
} from './export-prod.mjs';

const response = (body) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

function onePageCatalogFetch({
  breakCollection,
  conditionCardNumbers = REQUIRED_CONDITION_CARD_NUMBERS,
} = {}) {
  return async (input) => {
    const url = new URL(input);
    const descriptor = PROD_SNAPSHOT_ENTITIES.find(([, path]) => path === url.pathname);
    if (!descriptor) throw new Error(`Unexpected endpoint ${url.pathname}`);
    const [name, , key] = descriptor;
    if (name === breakCollection) return response({ total: 1, page: 1, limit: 100 });
    const items = name === 'effects'
      ? conditionCardNumbers.map((cardNumber, index) => ({
        id: `effect-${index}`,
        card_number: cardNumber,
        name: cardNumber,
        effect_type: 'condition',
      }))
      : [{ id: `${name}-id`, card_number: `${name}-card`, name }];
    return response({
      [key]: items,
      total: items.length,
      page: 1,
      limit: 100,
    });
  };
}

test('production export fails closed before mutating the reviewed snapshot', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dnd-export-fail-'));
  const outDir = join(root, 'prod-snapshot');
  mkdirSync(outDir);
  writeFileSync(join(outDir, 'sentinel.txt'), 'reviewed\n');
  try {
    await assert.rejects(exportProductionSnapshot({
      baseUrl: 'https://catalog.example.test',
      outDir,
      fetchImpl: onePageCatalogFetch({ breakCollection: 'variables' }),
      log: () => {},
    }), /required collection "variables" is missing/);
    assert.deepEqual(readdirSync(outDir), ['sentinel.txt']);
    assert.equal(readFileSync(join(outDir, 'sentinel.txt'), 'utf8'), 'reviewed\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('production export requires every unique condition through the authoritative Effect catalog', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dnd-export-condition-fail-'));
  const outDir = join(root, 'prod-snapshot');
  mkdirSync(outDir);
  writeFileSync(join(outDir, 'sentinel.txt'), 'reviewed\n');
  try {
    for (const [name, conditionCardNumbers] of [
      ['missing', REQUIRED_CONDITION_CARD_NUMBERS.slice(1)],
      ['duplicate', [...REQUIRED_CONDITION_CARD_NUMBERS, REQUIRED_CONDITION_CARD_NUMBERS[0]]],
    ]) {
      await t.test(name, async () => {
        await assert.rejects(exportProductionSnapshot({
          baseUrl: 'https://catalog.example.test',
          outDir,
          fetchImpl: onePageCatalogFetch({ conditionCardNumbers }),
          log: () => {},
        }), /required condition Effect identities must be unique/);
        assert.deepEqual(readdirSync(outDir), ['sentinel.txt']);
      });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('production export pins the complete condition declaration set independently of API data', () => {
  const patchUrl = new URL(
    '../../frontend/src/canon/data/micro-mvp-l1-content-patch.v1.json',
    import.meta.url,
  );
  const patch = JSON.parse(readFileSync(patchUrl, 'utf8'));
  assert.equal(requiredConditionCardNumbers(patch).length, 15);

  const truncated = structuredClone(patch);
  truncated.conditionPatches.pop();
  assert.throws(
    () => requiredConditionCardNumbers(truncated),
    /requires exactly 15 condition card numbers/,
  );

  const duplicate = structuredClone(patch);
  duplicate.conditionPatches[1].cardNumber = duplicate.conditionPatches[0].cardNumber;
  assert.throws(
    () => requiredConditionCardNumbers(duplicate),
    /condition card numbers must be unique/,
  );

  const drifted = structuredClone(patch);
  drifted.conditionPatches[0].fields.name = 'drifted';
  assert.throws(
    () => requiredConditionCardNumbers(drifted),
    /content patch hash mismatch/,
  );
});

test('production export atomically publishes every authoritative collection and index', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dnd-export-success-'));
  const outDir = join(root, 'prod-snapshot');
  mkdirSync(outDir);
  writeFileSync(join(outDir, 'sentinel.txt'), 'old\n');
  try {
    const index = await exportProductionSnapshot({
      baseUrl: 'https://catalog.example.test',
      outDir,
      fetchImpl: onePageCatalogFetch(),
      log: () => {},
    });
    const expectedCollections = PROD_SNAPSHOT_ENTITIES.map(([name]) => name).sort();
    assert.equal(expectedCollections.includes('conditions'), false);
    assert.equal(expectedCollections.includes('concepts'), true);
    assert.deepEqual(Object.keys(index.entities).sort(), expectedCollections);
    assert.deepEqual(readdirSync(outDir).sort(), [
      ...expectedCollections.map((name) => `${name}.json`),
      'index.json',
    ].sort());
    const persistedIndex = JSON.parse(readFileSync(join(outDir, 'index.json'), 'utf8'));
    assert.equal(persistedIndex.source, 'https://catalog.example.test');
    assert.deepEqual(Object.keys(persistedIndex.entities).sort(), expectedCollections);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
