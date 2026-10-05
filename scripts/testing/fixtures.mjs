import {readFile} from 'node:fs/promises';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import path from 'node:path';
import {repositoryRoot} from './runtime.mjs';

export const bootstrapSources = ['schema.sql', 'migration_auth.sql', 'migration_characters.sql', 'add_foreign_keys.sql', 'migration_images.sql', 'migration_is_extended.sql'];
export async function legacyBootstrapSQL() {
  const statements = [];
  for (const file of bootstrapSources) {
    let source = await readFile(path.join(repositoryRoot, 'database', file), 'utf8');
    // Old installer files explicitly reconnect to dnd_cards. Only their DDL is
    // reused, always through the already validated runner-owned connection.
    source = source.replace(/^\\c dnd_cards;\s*$/gm, '');
    if (file === 'schema.sql') source = source.split(/^INSERT INTO /m)[0];
    if (/^\s*\\/m.test(source)) throw new Error(`Unexpected psql command in bootstrap source ${file}`);
    statements.push(source);
  }
  const sql = statements.join('\n');
  return {sql, hash: createHash('sha256').update(sql).digest('hex'), sources: bootstrapSources};
}
export function newAccounts() {
  return Object.fromEntries(['player', 'peer', 'admin'].map(role => [role, {
    id: randomUUID(), username: `qa_${role}_${randomBytes(6).toString('hex')}`, password: randomBytes(24).toString('hex'),
  }]));
}
export async function seedAccounts(database, accounts) {
  await database.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  const extensionSchema = (await database.query("SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto';")).trim();
  if (!/^[a-z][a-z0-9_]*$/.test(extensionSchema)) throw new Error('Unsupported pgcrypto schema');
  // All interpolated values are generated UUIDs/hex strings, never user input.
  for (const [role, account] of Object.entries(accounts)) {
    await database.query(`INSERT INTO users (id, username, email, password_hash, display_name, is_admin, created_at, updated_at)
      VALUES ('${account.id}', '${account.username}', '${account.username}@example.invalid', ${extensionSchema}.crypt('${account.password}', ${extensionSchema}.gen_salt('bf')), 'Disposable ${role}', ${role === 'admin'}, NOW(), NOW());`, undefined, {sensitive: true});
  }
}

export async function insertFixtureRows(database, table, rows, {replace = false} = {}) {
  if (!/^[a-z][a-z0-9_]*$/.test(table)) throw new Error('Unsupported fixture table');
  const schema = JSON.parse((await database.query(`SELECT coalesce(json_agg(column_name), '[]'::json) FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}';`)).trim());
  const statements = ['BEGIN;'];
  for (const row of rows) {
    const columns = Object.keys(row).filter(key => schema.includes(key));
    if (!columns.includes('id') || columns.some(column => !/^[a-z][a-z0-9_]*$/.test(column))) throw new Error('Invalid fixture record identity/columns');
    const record = Object.fromEntries(columns.map(key => [key, row[key]]));
    const delimiter = `$fixture_${randomBytes(8).toString('hex')}$`;
    const update = replace ? `DO UPDATE SET ${columns.filter(key => key !== 'id').map(key => `"${key}"=EXCLUDED."${key}"`).join(',')}` : 'DO NOTHING';
    statements.push(`INSERT INTO ${table} (${columns.map(key => `"${key}"`).join(',')}) SELECT ${columns.map(key => `r."${key}"`).join(',')} FROM jsonb_populate_record(NULL::${table},${delimiter}${JSON.stringify(record)}${delimiter}::jsonb) AS r ON CONFLICT(id) ${update};`);
  }
  statements.push('COMMIT;');
  await database.query(statements.join('\n'));
}

export async function seedCanonicalTemplates(database) {
  const bytes = await readFile(path.join(repositoryRoot, 'backend/charactertemplates/presets.json'));
  const rows = JSON.parse(bytes);
  for (const row of rows) {
    if (['id', 'user_id', 'user', 'group_id', 'group', 'access_mode', 'current_encounter_id'].some(key => key in row.character)) throw new Error('Canonical preset contains personal state');
  }
  await insertFixtureRows(database, 'character_templates', rows);
  return {source: 'backend/charactertemplates/presets.json', rows: rows.length, sha256: createHash('sha256').update(bytes).digest('hex')};
}
