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
  exportProductionSnapshot,
} from './export-prod.mjs';

const response = (body) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

function onePageCatalogFetch({ breakCollection } = {}) {
  return async (input) => {
    const url = new URL(input);
    const descriptor = PROD_SNAPSHOT_ENTITIES.find(([, path]) => path === url.pathname);
    if (!descriptor) throw new Error(`Unexpected endpoint ${url.pathname}`);
    const [name, , key] = descriptor;
    if (name === breakCollection) return response({ total: 1, page: 1, limit: 100 });
    return response({
      [key]: [{ id: `${name}-id`, card_number: `${name}-card`, name }],
      total: 1,
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
      fetchImpl: onePageCatalogFetch({ breakCollection: 'conditions' }),
      log: () => {},
    }), /required collection "conditions" is missing/);
    assert.deepEqual(readdirSync(outDir), ['sentinel.txt']);
    assert.equal(readFileSync(join(outDir, 'sentinel.txt'), 'utf8'), 'reviewed\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('production export atomically publishes all eleven required collections and index', async () => {
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
