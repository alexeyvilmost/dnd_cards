#!/usr/bin/env node
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertTestDsn, assertRealOwnedPath} from '../testing/guards.mjs';
import {cleanEnvironment, execute, readRegistry, runsRoot} from '../testing/runtime.mjs';

export const sampleColumns = Object.freeze({
  roguelike_runs: ['combat_envelope', 'combat_catalog', 'checkpoint', 'journey', 'journey_private', 'party'],
  roguelike_command_receipts: ['response', 'request'],
  roguelike_combat_events: ['record'],
  character_runtime_commands: ['response', 'ruleset_ref'],
  frozen_combat_catalogs: ['payload'],
  characters_v3: ['resources', 'max_resources', 'inventory_items', 'equipment', 'turn_state', 'active_effects'],
  game_sessions: ['current_snapshot'], game_session_actors: ['build_snapshot', 'state_projection'],
  game_commands: ['canonical_body', 'execution_input'], game_events: ['payload'],
  session_snapshots: ['snapshot'], decision_requests: ['request_body'], transactional_outbox: ['payload'],
});
const identifier = value => {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw Error('Invalid inventory identifier');
  return `"${value}"`;
};
export function boundedSampleSQL(table, column, limit = 1000) {
  if (!sampleColumns[table]?.includes(column)) throw Error('Column is not in the storage inventory allowlist');
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw Error('Sample limit must be between 1 and 1000');
  return `BEGIN READ ONLY; SET LOCAL statement_timeout = '5s'; SET LOCAL lock_timeout = '250ms';
    SELECT json_build_object('relation','${table}','column','${column}','sample_rows',count(*),
      'null_rows',count(*) FILTER (WHERE stored_bytes IS NULL),
      'stored_mean_bytes',avg(stored_bytes),'stored_p50_bytes',percentile_cont(0.5) WITHIN GROUP (ORDER BY stored_bytes),
      'stored_p95_bytes',percentile_cont(0.95) WITHIN GROUP (ORDER BY stored_bytes),
      'stored_max_bytes',max(stored_bytes),'logical_json_mean_bytes',avg(logical_bytes))
    FROM (SELECT pg_column_size(${identifier(column)}) AS stored_bytes, octet_length(${identifier(column)}::text) AS logical_bytes
      FROM public.${identifier(table)} LIMIT ${limit}) sample; ROLLBACK;`;
}
export function reconcileSizes(report) {
  const relations = report.relations ?? [];
  for (const row of relations) {
    if (row.total_bytes !== row.table_bytes + row.index_bytes) throw Error(`Size accounting mismatch for ${row.name}`);
  }
  const publicRelationsBytes = relations.reduce((sum, row) => sum + row.total_bytes, 0);
  return {public_relations_bytes: publicRelationsBytes, database_bytes: report.database_bytes,
    other_database_bytes: report.database_bytes - publicRelationsBytes,
    top_five: relations.toSorted((a, b) => b.total_bytes - a.total_bytes).slice(0, 5).map(row => ({name: row.name, bytes: row.total_bytes})),
    note: 'table_bytes includes TOAST and its index; index_bytes excludes TOAST index. Column samples overlap physical storage and must not be added to relation totals.'};
}
export function boundedRunActivitySQL(limit = 1000) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw Error('Sample limit must be between 1 and 1000');
  return `BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='250ms';
    WITH sampled AS MATERIALIZED (SELECT id,status,phase FROM public.roguelike_runs ORDER BY id LIMIT ${limit}),
    counts AS (SELECT s.status,s.phase,(SELECT count(*) FROM public.roguelike_command_receipts c WHERE c.run_id=s.id) AS commands FROM sampled s)
    SELECT coalesce(json_agg(row_to_json(r)),'[]'::json) FROM (
      SELECT status,phase,count(*) AS sampled_runs,sum(commands) AS commands,
        avg(commands) AS commands_mean,percentile_cont(.95) WITHIN GROUP (ORDER BY commands) AS commands_p95
      FROM counts GROUP BY status,phase ORDER BY status,phase
    ) r; ROLLBACK;`;
}
export async function collectStorageReport({dsn, registry, sampleLimit = 1000}) {
  if (!Number.isInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > 1000) throw Error('Sample limit must be between 1 and 1000');
  assertTestDsn(dsn, registry);
  await assertRealOwnedPath(runsRoot, registry.directory);
  if (registry.status !== 'ready' || registry.database?.driver !== 'native') throw Error('A ready runner-owned native PostgreSQL instance is required');
  const url = new URL(dsn);
  // Credentials never appear in process arguments, registry or generated report.
  const env = cleanEnvironment({PGHOST: url.hostname, PGPORT: url.port, PGDATABASE: url.pathname.slice(1), PGUSER: url.username,
    PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '5', PGAPPNAME: 'local-storage-inventory'});
  const query = sql => execute(registry.database.psql, ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {env, input: sql, timeout: 15_000});
  if ((await query('BEGIN READ ONLY; SET LOCAL statement_timeout=\'5s\'; SELECT run_id FROM public.test_run_ownership; ROLLBACK;')).trim() !== registry.runId) throw Error('Database ownership marker does not match this run');
  const inventory = JSON.parse((await query(await readFile(new URL('./storage-inventory.sql', import.meta.url), 'utf8'))).trim());
  const columns = JSON.parse((await query(`BEGIN READ ONLY; SET LOCAL statement_timeout='5s';
    SELECT coalesce(json_agg(json_build_object('table',table_name,'column',column_name)), '[]'::json)
    FROM information_schema.columns WHERE table_schema='public'; ROLLBACK;`)).trim());
  const available = new Set(columns.map(row => `${row.table}.${row.column}`));
  const runColumns = ['roguelike_runs.id', 'roguelike_runs.status', 'roguelike_runs.phase', 'roguelike_command_receipts.run_id'];
  const runActivity = runColumns.every(column => available.has(column))
    ? {groups: JSON.parse((await query(boundedRunActivitySQL(sampleLimit))).trim()), limit: sampleLimit,
      population: 'explicit runner-owned local fixture; QA provenance is the registry, not a username heuristic',
      method: 'bounded runs ordered by id; indexed receipt count per sampled run; statuses preserved as stored'}
    : {groups: [], omitted: 'required run/receipt columns absent'};
  const samples = [], omitted = [];
  for (const [table, names] of Object.entries(sampleColumns)) {
    for (const column of names) {
      if (!available.has(`${table}.${column}`)) {omitted.push({table, column, reason: 'column_absent'}); continue;}
      samples.push(JSON.parse((await query(boundedSampleSQL(table, column, sampleLimit))).trim()));
    }
  }
  const wal = JSON.parse((await query(`BEGIN READ ONLY; SET LOCAL statement_timeout='5s';
    SELECT json_build_object('records',wal_records,'bytes',wal_bytes,'stats_reset',stats_reset) FROM pg_stat_wal; ROLLBACK;`)).trim());
  const receiptStorage=[];
  for(const table of ['roguelike_command_receipts','character_runtime_commands']) {
    if(!available.has(`${table}.response_version`))continue;
    const rows=JSON.parse((await query(`BEGIN READ ONLY;SET LOCAL statement_timeout='5s';SELECT coalesce(json_agg(row_to_json(r)),'[]'::json) FROM (SELECT response_version,count(*) AS rows,sum(octet_length(response_payload)) AS encoded_bytes,sum(response_length) AS exact_json_bytes FROM public.${identifier(table)} GROUP BY response_version) r;ROLLBACK;`)).trim());
    receiptStorage.push({relation:table,versions:rows});
  }
  return {schema_version: 1, scope: 'local-disposable-database', run_id: registry.runId,
    fixture: registry.fixture, artifact_hash: registry.artifactHash ?? null, inventory, accounting: reconcileSizes(inventory),
    samples: {method: 'first bounded physical rows; not a random or representative production sample', limit: sampleLimit, columns: samples, omitted},
    cluster_wal_counters: wal, receipt_storage:receiptStorage, run_activity:runActivity,
    limitations: ['No production connection or workload history was observed.', 'PostgreSQL statistics are estimates/cumulative since stats_reset; zero scans alone do not justify dropping an index.',
      'Database, cluster directory, WAL files, dumps, Docker images and repository files are different storage scopes.',
      'WAL counters cover the whole disposable cluster. They are not attributed to a single database.',
      'The bounded inventory uses separate read-only transactions; concurrent writers may change values between samples.']};
}
async function main() {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--run-directory', '--output', '--sample-limit'].includes(args[i]) || !args[i + 1] || Object.hasOwn(options, args[i])) throw Error('Usage: storage-report.mjs --run-directory <owned run> --output <report.json> [--sample-limit 1000]');
    options[args[i]] = args[i + 1];
  }
  if (!options['--run-directory'] || !options['--output']) throw Error('Explicit run directory and output path are required');
  const registry = await readRegistry(path.resolve(options['--run-directory']));
  const report = await collectStorageReport({dsn: process.env.TEST_DATABASE_URL, registry, sampleLimit: options['--sample-limit'] ? Number(options['--sample-limit']) : 1000});
  const output = path.resolve(options['--output']); await mkdir(path.dirname(output), {recursive: true});
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write('Local storage inventory saved.\n');
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main().catch(() => {
  // psql failures can contain arbitrary connection details; keep them out of logs.
  process.stderr.write('Storage inventory failed: verify the explicit owned test run, local DSN and required read permissions.\n'); process.exitCode = 1;
});
