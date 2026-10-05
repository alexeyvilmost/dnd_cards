#!/usr/bin/env node
// Explicit maintenance operation. Exports schema and migration identities only;
// never exports catalog data, accounts, sessions or gameplay rows from a dump.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {startTestStack} from './stack.mjs';
import {repositoryRoot, execute, resolveTool} from './runtime.mjs';

const snapshot = process.argv[2];
if (!snapshot || !path.isAbsolute(snapshot)) throw new Error('Usage: export-schema-baseline.mjs absolute-local-catalog.dump');
const stack = await startTestStack({catalogSnapshot: snapshot, reuseBuild: true});
try {
  const output = path.join(repositoryRoot, 'scripts/testing/fixtures');
  await mkdir(output, {recursive: true});
  const pgdump = resolveTool('pg_dump', path.join(path.dirname(stack.database.psql), `pg_dump${process.platform === 'win32' ? '.exe' : ''}`));
  let schema = await execute(pgdump, ['--schema-only', '--no-owner', '--no-privileges', '--no-comments', '--exclude-table=test_run_ownership', '-h', '127.0.0.1', '-p', String(stack.registry.ports.database), '-U', 'test_runner', '-d', stack.registry.runId], {env: stack.database.env});
  schema = schema.replace(/\r+\n/g, '\n').replace(/^\\(?:un)?restrict .*\n/gm, '').replace(/[ \t]+$/gm, '');
  if (/^\s*\\/m.test(schema) || /^(?:COPY|INSERT INTO) /m.test(schema)) throw new Error('Unexpected data or psql command in schema export');
  const history = JSON.parse((await stack.database.query("SELECT json_agg(json_build_object('version',version,'description',description) ORDER BY version) FROM schema_migrations;")).trim());
  const manifest = {format: 1, profile: 'integration-baseline', schema: 'schema.sql', schemaSha256: createHash('sha256').update(schema).digest('hex'),
    migrationBaseline: history.at(-1).version, historicalChainVerified: false,
    provenance: {kind: 'schema-only-from-disposable-local-catalog', sourceSha256: stack.registry.fixture.sha256, postgres: stack.registry.database.version}, migrations: history};
  await writeFile(path.join(output, 'schema.sql'), schema);
  await writeFile(path.join(output, 'schema-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Exported schema only (${Buffer.byteLength(schema)} bytes), explicit baseline ${manifest.migrationBaseline}. Historical migrations are not certified by this profile.`);
} finally {await stack.cleanup();}
