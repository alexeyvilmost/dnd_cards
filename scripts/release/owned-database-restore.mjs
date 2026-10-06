// Restore only the collector's disposable database. Production settings and
// backups are never changed. Keep a disk reserve while the archive expands.
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';

export const restoreDiskReserve = 1024 ** 3;
export const disposablePostgresOptions = Object.freeze([
  '-c', 'wal_level=minimal', '-c', 'max_wal_senders=0', '-c', 'archive_mode=off',
]);

export function availableRestoreBytes(output) {
  const fields = output.trim().split(/\r?\n/).at(-1).trim().split(/\s+/);
  const value = Number(fields[3]) * 1024;
  assert.ok(fields.length >= 6 && Number.isSafeInteger(value) && value >= 0,
    'Disposable storage observation invalid');
  return value;
}

export async function restoreOwnedDatabase({command, names, owner, database,
  inputFile, dumpBytes, sourceBytes = 0, pollMilliseconds = 3000}) {
  assert.match(owner, /^rehearsal_[a-f0-9]{24}$/);
  assert.equal(names.postgres, owner + '_db');
  assert.equal(names.network, owner + '_net');
  assert.equal(names.pgVolume, owner + '_pgdata');
  assert.match(database, /^(?:rehearsal|writer_restore_[1-9][0-9]*)$/);
  for (const value of [dumpBytes, sourceBytes]) assert.ok(Number.isSafeInteger(value) && value >= 0);
  assert.ok(dumpBytes > 0 && Number.isSafeInteger(pollMilliseconds) && pollMilliseconds > 0);
  async function owned() {
    const network = JSON.parse(await command(['network', 'inspect', names.network], {timeout: 10000}))[0];
    assert.equal(network.Internal, true);
    assert.equal(network.Labels?.['bagofholding.rehearsal'], owner);
    const pg = JSON.parse(await command(['container', 'inspect', names.postgres], {timeout: 10000}))[0];
    assert.equal(pg.Config.Labels?.['bagofholding.rehearsal'], owner);
    assert.equal(pg.State.Running, true);
    assert.deepEqual(Object.keys(pg.NetworkSettings.Networks), [names.network]);
    assert.ok(!Object.values(pg.NetworkSettings.Ports ?? {}).some(ports => ports?.length));
    assert.ok(pg.Mounts.some(m => m.Type === 'volume' && m.Name === names.pgVolume && m.Destination === '/var/lib/postgresql/data'));
    const volume = JSON.parse(await command(['volume', 'inspect', names.pgVolume], {timeout: 10000}))[0];
    assert.equal(volume.Labels?.['bagofholding.rehearsal'], owner);
    const settings = await command(['exec', names.postgres, 'psql', '-X', '-qAt', '-U', 'rehearsal', '-d', 'postgres', '-c',
      "SELECT current_setting('wal_level')||':'||current_setting('max_wal_senders')||':'||current_setting('archive_mode');"], {timeout: 10000});
    assert.equal(settings.trim(), 'minimal:0:off');
  }
  const space = async () => availableRestoreBytes(await command(['exec', names.postgres, 'df', '-Pk', '/var/lib/postgresql/data'], {timeout: 10000}));
  await owned();
  // The second restore uses the measured source size; the initial archive has
  // only a conservative compressed-size estimate. Both remain monitored.
  const required = restoreDiskReserve + (sourceBytes ? Math.ceil(sourceBytes * 1.25) : dumpBytes * 4);
  assert.ok(Number.isSafeInteger(required) && await space() >= required,
    'Insufficient disposable storage including live-server reserve');
  const stop = new AbortController();
  let guardFailure;
  const restoring = command(['exec', '-i', names.postgres, 'pg_restore', '--single-transaction',
    '--exit-on-error', '--no-owner', '--no-privileges', '-U', 'rehearsal', '-d', database],
    {inputFile, timeout: 300000});
  const monitoring = (async () => {
    while (!stop.signal.aborted) {
      try { await delay(pollMilliseconds, undefined, {signal: stop.signal}); }
      catch { break; }
      if (stop.signal.aborted) break;
      try {
        await owned();
        assert.ok(await space() >= restoreDiskReserve, 'Disposable restore exhausted disk reserve');
      } catch (error) {
        guardFailure = error;
        // Recheck isolation before cancelling only this target's pg_restore.
        // Never terminate another database or stop an application container.
        try {
          await owned();
          await command(['exec', names.postgres, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'rehearsal', '-d', 'postgres', '-c',
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${database}' AND application_name='pg_restore' AND pid<>pg_backend_pid();`], {timeout: 10000});
        } catch { /* The canonical collector still owns mandatory cleanup. */ }
        break;
      }
    }
  })();
  let restoreFailure;
  try { await restoring; } catch (error) { restoreFailure = error; }
  finally { stop.abort(); await monitoring; }
  if (guardFailure) throw guardFailure;
  if (restoreFailure) throw restoreFailure;
}
