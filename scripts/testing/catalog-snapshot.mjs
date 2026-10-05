import {stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {assertTestDsn} from './guards.mjs';
import {execute, resolveTool} from './runtime.mjs';

// Never import users, characters, templates containing personal snapshots,
// sessions, command receipts, history, inventories, OAuth, images or audit rows.
export const catalogTables = Object.freeze(['schema_migrations', 'actions', 'backgrounds', 'cards', 'classes', 'concepts', 'effects', 'feats', 'monsters', 'races', 'resources', 'spells', 'variables', 'content_choice_recommendations', 'audio_cues', 'entity_audio_bindings', 'entity_tag_assignments', 'entity_tag_definitions', 'passive_presentations', 'roguelike_item_rules', 'roguelike_shop_settings', 'ruleset_releases']);
export async function restoreCatalogSnapshot(database, registry, snapshot) {
  assertTestDsn(database.dsn, registry);
  const file = path.resolve(snapshot);
  if (!path.isAbsolute(snapshot) || !(await stat(file)).isFile() || !/\.(dump|backup)$/i.test(file)) throw new Error('An explicit absolute local PostgreSQL dump file is required');
  const marker = (await database.query('SELECT run_id FROM test_run_ownership;')).trim();
  if (marker !== registry.runId) throw new Error('Snapshot target is not runner-owned');
  const pgrestore = resolveTool('pg_restore', path.join(path.dirname(database.psql), `pg_restore${process.platform === 'win32' ? '.exe' : ''}`));
  const args = ['--no-owner', '--no-privileges', '--exit-on-error', '-h', '127.0.0.1', '-p', String(registry.ports.database), '-U', 'test_runner', '-d', registry.runId];
  const options = {env: database.env, log: path.join(registry.directory, 'catalog-restore.log'), timeout: 300_000};
  await execute(pgrestore, [...args, '--schema-only', file], options);
  const tableArgs = catalogTables.flatMap(table => ['--table', table]);
  await execute(pgrestore, [...args, '--data-only', '--disable-triggers', ...tableArgs, file], options);
  // Strip ownership and author metadata while no API process is running.
  // Restrict dynamically generated identifiers to names returned by PostgreSQL.
  const sanitize = ['BEGIN;'];
  for (const table of catalogTables.filter(name => name !== 'schema_migrations')) {
    const columns = JSON.parse((await database.query(`SELECT coalesce(json_agg(json_build_object('name',column_name,'nullable',is_nullable)), '[]'::json) FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}';`)).trim());
    const changes = columns.flatMap(column => {
      if (!/^[a-z][a-z0-9_]*$/.test(column.name)) throw new Error('Unsupported snapshot column');
      if (['user_id', 'group_id', 'created_by_user_id', 'updated_by_user_id', 'created_by', 'updated_by'].includes(column.name)) {
        if (column.nullable !== 'YES') throw new Error(`Cannot anonymize required ownership column ${table}.${column.name}`);
        return [`"${column.name}"=NULL`];
      }
      return column.name === 'author' ? ['"author"=\'Local catalog fixture\''] : [];
    });
    if (changes.length) sanitize.push(`ALTER TABLE ${table} DISABLE TRIGGER ALL; UPDATE ${table} SET ${changes.join(',')}; ALTER TABLE ${table} ENABLE TRIGGER ALL;`);
  }
  sanitize.push('COMMIT;'); await database.query(sanitize.join('\n'));
  const privateCount = (await database.query('SELECT (SELECT count(*) FROM users)+(SELECT count(*) FROM characters_v3)+(SELECT count(*) FROM roguelike_runs)+(SELECT count(*) FROM paper_documents);')).trim();
  if (privateCount !== '0') throw new Error('Private gameplay rows unexpectedly appeared in catalog fixture');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return {profile: 'local-catalog-snapshot', snapshotName: path.basename(file), sha256: hash.digest('hex'), tables: catalogTables,
    migrationBaseline: (await database.query('SELECT max(version) FROM schema_migrations;')).trim(), privateRows: 0};
}
