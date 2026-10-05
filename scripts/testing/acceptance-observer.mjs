import {assertTestDsn} from './guards.mjs';
import {cleanEnvironment, execute, resolveTool} from './runtime.mjs';

// Read-only, bounded evidence from the same disposable database. Private
// envelopes/RNG seeds and response bodies never leave SQL; only hashes/counts.
export async function readRunInvariant(local, runId, commandId, env = process.env) {
  for (const id of [runId, commandId].filter(Boolean)) if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid local observation identity');
  const dsn = new URL(assertTestDsn(env.TEST_DATABASE_URL, local.registry));
  const psql = resolveTool('psql', local.registry.database.psql);
  const sql = `BEGIN READ ONLY;
    SELECT CASE WHEN run_id='${local.registry.runId}' THEN run_id ELSE 'invalid' END FROM test_run_ownership;
    SELECT json_build_object('revision', revision, 'envelope_hash', md5(combat_envelope::text),
      'catalog_hash', md5(combat_catalog::text), 'entropy_cursor', combat_envelope->'entropy'->'cursor',
      'receipts', (SELECT count(*) FROM roguelike_command_receipts WHERE run_id=r.id),
      'journal', (SELECT count(*) FROM roguelike_combat_events WHERE run_id=r.id),
      'command_receipts', (SELECT count(*) FROM roguelike_command_receipts WHERE run_id=r.id${commandId ? ` AND command_id='${commandId}'` : ''}))
      FROM roguelike_runs r WHERE id='${runId}';
    ROLLBACK;`;
  const output = await execute(psql, ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', dsn.hostname, '-p', dsn.port, '-U', dsn.username, '-d', local.registry.runId], {
    env: cleanEnvironment({PGPASSWORD: decodeURIComponent(dsn.password), PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=5000'}), input: sql,
  });
  const lines = output.trim().split(/\r?\n/);
  if (lines.length !== 2 || lines[0] !== local.registry.runId) throw new Error('Local observation ownership or run does not match');
  return JSON.parse(lines[1]);
}
