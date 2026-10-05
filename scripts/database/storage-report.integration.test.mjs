import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectStorageReport} from './storage-report.mjs';
import {startTestStack} from '../testing/stack.mjs';

test('real isolated PostgreSQL inventory measures bytes without returning data or changing rows', {timeout: 90_000}, async () => {
  const stack = await startTestStack({dbOnly: true});
  try {
    await stack.database.query(`CREATE TABLE roguelike_runs (id integer PRIMARY KEY, combat_catalog jsonb, combat_envelope jsonb, status text, phase text);
      CREATE TABLE roguelike_command_receipts (id integer PRIMARY KEY, response jsonb, request jsonb, run_id integer);
      INSERT INTO roguelike_runs SELECT n, jsonb_build_object('private',repeat('private-fixture-value',1000)), '{}'::jsonb,
        CASE WHEN n=1 THEN 'victory' WHEN n=2 THEN 'defeat' ELSE 'active' END, CASE WHEN n<=2 THEN 'ended' ELSE 'camp' END FROM generate_series(1,12) n;
      INSERT INTO roguelike_command_receipts VALUES (1,'{"private":"private-fixture-value"}','{}',1); ANALYZE;`);
    const before = await stack.database.query('SELECT count(*) FROM roguelike_runs;');
    const report = await collectStorageReport({dsn: stack.database.dsn, registry: stack.registry, sampleLimit: 10});
    assert.equal(report.scope, 'local-disposable-database');
    assert.ok(report.inventory.database_bytes > 0);
    assert.equal(report.samples.columns.find(row => row.relation === 'roguelike_runs' && row.column === 'combat_catalog').sample_rows, 10);
    assert.equal(report.samples.columns.find(row => row.relation === 'roguelike_command_receipts' && row.column === 'response').sample_rows, 1);
    assert.ok(report.accounting.public_relations_bytes > 0);
    assert.ok(report.accounting.other_database_bytes >= 0);
    assert.ok(report.samples.omitted.some(row => row.table === 'game_sessions'));
    assert.deepEqual(report.run_activity.groups.map(row => [row.status,row.phase,row.sampled_runs,row.commands]),
      [['active','camp',8,0],['defeat','ended',1,0],['victory','ended',1,1]]);
    assert.equal(await stack.database.query('SELECT count(*) FROM roguelike_runs;'), before);
    const serialized = JSON.stringify(report);
    assert.ok(!serialized.includes('private-fixture-value'));
    assert.ok(!serialized.includes(new URL(stack.database.dsn).password));
    await stack.database.query('DELETE FROM test_run_ownership;');
    await assert.rejects(() => collectStorageReport({dsn: stack.database.dsn, registry: stack.registry}), /ownership marker/);
  } finally {await stack.cleanup();}
});
