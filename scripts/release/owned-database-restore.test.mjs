import test from 'node:test';
import assert from 'node:assert/strict';
import {availableRestoreBytes, restoreDiskReserve, restoreOwnedDatabase} from './owned-database-restore.mjs';

function fixture({free = [8 * 1024 ** 3], failRestore = false, mutateOwner = false} = {}) {
  const owner = 'rehearsal_' + 'a'.repeat(24);
  const names = {postgres: owner + '_db', network: owner + '_net', pgVolume: owner + '_pgdata'};
  const calls = []; let reads = 0, rejectRestore;
  const command = async args => {
    calls.push(args);
    if (args[0] === 'network') return JSON.stringify([{Internal: true, Labels: {'bagofholding.rehearsal': owner}}]);
    if (args[0] === 'volume') return JSON.stringify([{Labels: {'bagofholding.rehearsal': owner}}]);
    if (args[0] === 'container') return JSON.stringify([{Config: {Labels: {'bagofholding.rehearsal': mutateOwner ? 'foreign' : owner}},
      State: {Running: true}, NetworkSettings: {Networks: {[names.network]: {}}, Ports: {}},
      Mounts: [{Type: 'volume', Name: names.pgVolume, Destination: '/var/lib/postgresql/data'}]}]);
    if (args.includes('df')) return `Filesystem 1024-blocks Used Available Capacity Mounted on\nunit 99999999 1 ${free[Math.min(reads++, free.length - 1)] / 1024} 1% /data`;
    if (args.includes('pg_restore')) {
      assert.ok(args.includes('--single-transaction'));
      if (failRestore) throw Error('restore failure');
      if (free.length === 1) return '';
      return new Promise((resolve, reject) => { rejectRestore = reject; });
    }
    if (args.at(-1).includes('pg_terminate_backend')) { rejectRestore(Error('cancelled owned target')); return 't'; }
    assert.ok(args.at(-1).includes('current_setting')); return 'minimal:0:off';
  };
  return {calls, options: {command, names, owner, database: 'writer_restore_3', inputFile: '/owned/archive.dump',
    dumpBytes: 1024 ** 3, sourceBytes: 2 * 1024 ** 3, pollMilliseconds: 1}};
}

test('restore uses a single transaction, measured source size and retains disk reserve', async () => {
  const f = fixture(); await restoreOwnedDatabase(f.options);
  assert.equal(f.calls.filter(args => args.includes('pg_restore')).length, 1);
  assert.ok(!f.calls.some(args => args.at(-1).includes('pg_terminate_backend')));
});

test('compressed archive cannot authorize restoration without reserve and source-size allowance', async () => {
  for (const sourceBytes of [0, 3 * 1024 ** 3]) {
    const f = fixture({free: [restoreDiskReserve + 1024 ** 3]}); f.options.sourceBytes = sourceBytes;
    await assert.rejects(restoreOwnedDatabase(f.options), /Insufficient/);
    assert.ok(!f.calls.some(args => args.includes('pg_restore')));
  }
});

test('falling free space cancels only the verified owned target restore', async () => {
  const f = fixture({free: [8 * 1024 ** 3, restoreDiskReserve - 1024]});
  await assert.rejects(restoreOwnedDatabase(f.options), /disk reserve/);
  const cancel = f.calls.find(args => args.at(-1).includes('pg_terminate_backend'));
  assert.ok(cancel.at(-1).includes("datname='writer_restore_3' AND application_name='pg_restore'"));
  assert.ok(!f.calls.some(args => args.includes('stop') || args.includes('rm')));
});

test('restore error is preserved and storage monitor does not outlive it', async () => {
  const f = fixture({failRestore: true}); await assert.rejects(restoreOwnedDatabase(f.options), /restore failure/);
  assert.equal(f.calls.filter(args => args.includes('df')).length, 1);
});

test('foreign ownership, external network and arbitrary database names refuse before restore', async () => {
  const foreign = fixture({mutateOwner: true}); await assert.rejects(restoreOwnedDatabase(foreign.options));
  assert.ok(!foreign.calls.some(args => args.includes('pg_restore')));
  for (const database of ['production', "writer_restore_3';SELECT 1", 'writer_restore_0']) {
    const f = fixture(); await assert.rejects(restoreOwnedDatabase({...f.options, database})); assert.equal(f.calls.length, 0);
  }
  const f = fixture(), command = f.options.command;
  f.options.command = args => args[0] === 'network' ? JSON.stringify([{Internal: false}]) : command(args);
  await assert.rejects(restoreOwnedDatabase(f.options)); assert.ok(!f.calls.some(args => args.includes('pg_restore')));
});

test('malformed disk observations are refused instead of bypassing reserve', () => {
  for (const text of ['', 'unit 1 2 NaN 1% /data', 'unit 1 2 -1 1% /data', 'unit 1 2 Infinity 1% /data']) assert.throws(() => availableRestoreBytes(text));
});
