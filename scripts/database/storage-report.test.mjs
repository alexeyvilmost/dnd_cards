import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boundedSampleSQL, reconcileSizes, collectStorageReport} from './storage-report.mjs';

test('column sampling is bounded, read only and never returns JSON contents', () => {
  const sql = boundedSampleSQL('roguelike_runs', 'combat_catalog', 20);
  assert.match(sql, /BEGIN READ ONLY/); assert.match(sql, /LIMIT 20/); assert.match(sql, /lock_timeout/);
  assert.match(sql, /octet_length/); assert.doesNotMatch(sql, /row_to_json/);
  for (const n of [0, 1001, -1, 1.5, NaN]) assert.throws(() => boundedSampleSQL('roguelike_runs', 'combat_catalog', n));
  assert.throws(() => boundedSampleSQL('users', 'password_hash'));
  assert.throws(() => boundedSampleSQL('roguelike_runs;DELETE', 'combat_catalog'));
});
test('table and TOAST size accounting does not double count TOAST', () => {
  const row = {name: 'runs', total_bytes: 100, table_bytes: 80, heap_main_bytes: 10, toast_with_index_bytes: 60, index_bytes: 20};
  const result = reconcileSizes({database_bytes: 140, relations: [row]});
  assert.equal(result.public_relations_bytes, 100); assert.equal(result.other_database_bytes, 40);
  assert.throws(() => reconcileSizes({database_bytes: 100, relations: [{...row, index_bytes: 25}]}));
});
test('missing, foreign and non-run DSNs are rejected before connecting', async () => {
  const registry = {runId: `test_${'a'.repeat(24)}`, ports: {database: 5000}};
  for (const dsn of [undefined, 'postgres://user@production:5432/db', 'postgres://test_runner@127.0.0.1:5000/working?sslmode=disable']) {
    await assert.rejects(() => collectStorageReport({dsn, registry}));
  }
});
