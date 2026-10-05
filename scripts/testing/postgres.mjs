import {randomBytes} from 'node:crypto';
import {mkdir, writeFile, rm, readFile} from 'node:fs/promises';
import path from 'node:path';
import {assertTestDsn, assertRealOwnedPath} from './guards.mjs';
import {cleanEnvironment, execute, resolveTool, writeRegistry} from './runtime.mjs';

export async function startNativePostgres(registry, {pgBin, signal} = {}) {
  const executable = name => resolveTool(name, pgBin ? path.join(pgBin, name + (process.platform === 'win32' ? '.exe' : '')) : undefined);
  const initdb = executable('initdb'), pgctl = executable('pg_ctl'), psql = executable('psql');
  const data = path.join(registry.directory, 'postgres');
  await mkdir(data);
  registry.database = {driver: 'native', data, pgctl, psql, version: (await execute(psql, ['--version'])).trim()};
  await writeRegistry(registry);
  const secret = randomBytes(32).toString('hex');
  const passwordFile = path.join(registry.directory, 'postgres-password.tmp');
  await writeFile(passwordFile, secret, {mode: 0o600});
  try {
    await execute(initdb, ['-D', data, '-U', 'test_runner', '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--encoding=UTF8', '--no-locale', `--pwfile=${passwordFile}`], {log: path.join(registry.directory, 'initdb.log'), signal});
  } finally { await rm(passwordFile, {force: true}); }
  const env = cleanEnvironment({PGPASSWORD: secret});
  await execute(pgctl, ['-D', data, '-l', path.join(registry.directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${registry.ports.database}`, '-w', '-t', '30', 'start'], {env, quiet: true, signal});
  const args = ['-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(registry.ports.database), '-U', 'test_runner'];
  const query = async (sql, database = registry.runId, {sensitive = false} = {}) => execute(psql, [...args, '-d', database, '-qAt'], {
    env, input: sensitive ? `SET log_min_error_statement = 'PANIC';\n${sql}` : sql,
    log: sensitive ? undefined : path.join(registry.directory, 'sql.log'), signal,
  });
  await query(`CREATE DATABASE ${registry.runId};`, 'postgres');
  // This marker proves ownership independently of the database name.
  await query(`CREATE TABLE test_run_ownership (run_id text PRIMARY KEY); INSERT INTO test_run_ownership VALUES ('${registry.runId}');`);
  const url = new URL(`postgres://test_runner@127.0.0.1:${registry.ports.database}/${registry.runId}?sslmode=disable`);
  url.password = secret;
  const dsn = assertTestDsn(url.href, registry);
  const owned = (await query('SELECT current_database() || \':\' || run_id FROM test_run_ownership;')).trim();
  if (owned !== `${registry.runId}:${registry.runId}`) throw new Error('Disposable database ownership marker did not match');
  return {dsn, query, env, psql};
}
export async function stopNativePostgres(registry) {
  if (!registry.database) return;
  let data;
  try { data = await assertRealOwnedPath(registry.directory, registry.database.data); }
  catch (error) {if (error.code === 'ENOENT') return; throw error;}
  const pidFile = path.join(data, 'postmaster.pid');
  let running = true;
  try {
    const pid = (await readFile(pidFile, 'utf8')).split(/\r?\n/);
    if (path.resolve(pid[1]) !== path.resolve(data) || Number(pid[3]) !== registry.ports.database) throw new Error('PostgreSQL process does not match run registry');
  } catch (error) { if (error.code === 'ENOENT') running = false; else throw error; }
  if (running) await execute(registry.database.pgctl, ['-D', data, '-w', '-t', '30', '-m', 'fast', 'stop'], {quiet: true});
  else {
    try {await execute(registry.database.pgctl, ['-D', data, 'status'], {quiet: true}); throw new Error('PostgreSQL is running without an ownership PID file');}
    catch (error) {if (![3, 4].includes(error.code)) throw error;}
  }
  await rm(data, {recursive: true});
}
