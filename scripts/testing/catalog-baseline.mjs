import {readFile} from 'node:fs/promises';
import {createHash, randomBytes} from 'node:crypto';
import path from 'node:path';
import {repositoryRoot} from './runtime.mjs';

const collections = ['classes', 'races', 'effects', 'actions', 'spells', 'feats', 'backgrounds', 'cards', 'resources', 'variables'];
const privateFields = new Set(['user_id', 'group_id', 'user', 'group', 'author', 'support', 'created_at', 'updated_at', 'deleted_at']);
export async function seedPre083Catalog(database) {
  const boundary = (await database.query("SELECT max(version) FROM schema_migrations;")).trim();
  if (boundary !== '082_character_system_metadata') throw new Error('Public catalog bootstrap requires the exact pre-083 schema boundary');
  const manifest = [], statements = ['BEGIN;'];
  for (const table of collections) {
    const bytes = await readFile(path.join(repositoryRoot, 'officials/canon/prod-snapshot', `${table}.json`));
    const rows = JSON.parse(bytes);
    if (!Array.isArray(rows)) throw new Error(`Invalid checked-in ${table} catalog`);
    const schema = JSON.parse((await database.query(`SELECT coalesce(json_agg(column_name), '[]'::json) FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}';`)).trim());
    if (!schema.includes('id')) throw new Error(`Missing pre-083 catalog table ${table}`);
    for (const row of rows) {
      const columns = Object.keys(row).filter(key => schema.includes(key) && !privateFields.has(key));
      if (columns.some(column => !/^[a-z][a-z0-9_]*$/.test(column))) throw new Error('Unsupported catalog column');
      const record = Object.fromEntries(columns.map(key => [key, row[key]]));
      const delimiter = `$fixture_${randomBytes(8).toString('hex')}$`;
      const value = `${delimiter}${JSON.stringify(record)}${delimiter}::jsonb`;
      // Seed only missing public catalog identities. Existing migration-owned
      // rows keep their contents; no users or gameplay history are imported.
      statements.push(`INSERT INTO ${table} (${columns.map(column => `"${column}"`).join(',')}) SELECT ${columns.map(column => `r."${column}"`).join(',')} FROM jsonb_populate_record(NULL::${table},${value}) AS r ON CONFLICT DO NOTHING;`);
    }
    manifest.push({table, rows: rows.length, sha256: createHash('sha256').update(bytes).digest('hex')});
  }
  statements.push('COMMIT;');
  await database.query(statements.join('\n'));
  return manifest;
}
