import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, mkdir, rm, symlink, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {assertLocalOrigin, assertTestDsn, assertRunId, assertOwnedPath, assertRealOwnedPath, assertRequiredGoResults, localFetch} from './guards.mjs';
import {cleanEnvironment} from './runtime.mjs';
import {legacyBootstrapSQL} from './fixtures.mjs';
import {publicFixtureRow} from './integration-baseline.mjs';
import {waitReady} from './stack.mjs';
import {startTestUI} from './ui-server.mjs';

const registry = {runId: 'test_0123456789abcdef01234567', ports: {database: 54321}};
const dsn = `postgres://test_runner@127.0.0.1:54321/${registry.runId}?sslmode=disable`;
test('local target guard rejects production, credentials, paths and implicit ports before requesting', () => {
  assert.equal(assertLocalOrigin('http://127.0.0.1:12345'), 'http://127.0.0.1:12345');
  for (const origin of ['https://bagofholding.ru', 'http://localhost', 'http://127.0.0.1:1234/api', 'http://user@localhost:1234', 'http://localhost:1234/?target=prod', 'http://localhost.example:1234']) assert.throws(() => assertLocalOrigin(origin));
});
test('database guard requires exact runner ID, port, role, loopback and no connection overrides', () => {
  assert.equal(assertTestDsn(dsn, registry), dsn);
  for (const value of [undefined, dsn.replace(registry.runId, 'dnd_cards'), dsn.replace('54321', '5432'), dsn.replace('127.0.0.1', 'localhost'), dsn.replace('test_runner@', 'postgres@'), `${dsn}&host=remote`, `${dsn}&options=-csearch_path=public`, `${dsn}&sslmode=require`]) assert.throws(() => assertTestDsn(value, registry));
  for (const value of ['../../test', 'dnd_cards', 'test_abc', null]) assert.throws(() => assertRunId(value));
});
test('cleanup paths cannot escape owned root or delete the root itself', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'test-lifecycle-'));
  try {
    const child = path.join(root, 'child'); await mkdir(child);
    assert.equal(await assertRealOwnedPath(root, child), child);
    for (const target of [root, path.dirname(root), path.join(root, '../foreign')]) assert.throws(() => assertOwnedPath(root, target));
    const link = path.join(root, 'junction'); await symlink(tmpdir(), link, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(assertRealOwnedPath(root, link), /symlink/);
  } finally {assertOwnedPath(tmpdir(), root); await rm(root, {recursive: true, force: true});}
});
test('redirects cannot escape the pinned local origin', async () => {
  const server = createServer((_req, res) => {res.writeHead(302, {location: 'https://bagofholding.ru/api/health'}); res.end();});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    await assert.rejects(localFetch(origin, '/redirect'));
    await assert.rejects(localFetch(origin, 'https://bagofholding.ru/api/health'), /escaped/);
  } finally {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
});
test('missing, empty, failed or skipped required Go tests never pass', () => {
  const results = action => JSON.stringify({Action: action, Test: 'TestRequired'});
  assert.deepEqual(assertRequiredGoResults(results('pass'), ['TestRequired']), {required: 1, passed: 1});
  for (const output of ['', results('skip'), results('fail'), JSON.stringify({Action: 'pass', Package: 'backend'})]) assert.throws(() => assertRequiredGoResults(output, ['TestRequired']));
  assert.throws(() => assertRequiredGoResults(results('pass'), []));
});
test('child environment excludes inherited application credentials and proxies', () => {
  const prior = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'do-not-inherit';
  try {assert.equal(cleanEnvironment().DATABASE_URL, undefined); assert.equal(cleanEnvironment().OPENAI_API_KEY, undefined); assert.equal(cleanEnvironment().HTTPS_PROXY, undefined);}
  finally {if (prior === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prior;}
});
test('legacy bootstrap reuses DDL without reconnecting to the working database or seeding demo users', async () => {
  const {sql, hash} = await legacyBootstrapSQL();
  assert.doesNotMatch(sql, /^\s*\\/m);
  assert.doesNotMatch(sql, /INSERT INTO (?:cards|users|weapon_templates)/i);
  assert.match(sql, /CREATE TABLE users/);
  assert.match(hash, /^[a-f0-9]{64}$/);
});
test('portable fixtures reject owned records and never inherit manual verification or personal metadata', () => {
  for (const row of [{user_id: 'someone'}, {group_id: 'group'}, {user: {name: 'person'}}]) assert.throws(() => publicFixtureRow(row));
  const row = publicFixtureRow({id: 'entity', author: 'private', image_url: 'https://example.invalid/image', support: {status: 'verified'}});
  assert.equal(row.author, 'Local test fixture'); assert.deepEqual(row.support, {status: 'not_tested'}); assert.equal(row.image_url, undefined);
});
test('checked-in schema is hash-bound, contains no table data and explicitly does not certify historical migrations', async () => {
  const schema = (await readFile(new URL('./fixtures/schema.sql', import.meta.url), 'utf8')).replace(/\r+\n/g, '\n');
  const manifest = JSON.parse(await readFile(new URL('./fixtures/schema-manifest.json', import.meta.url), 'utf8'));
  assert.equal(createHash('sha256').update(schema).digest('hex'), manifest.schemaSha256);
  assert.equal(manifest.historicalChainVerified, false);
  assert.equal(manifest.migrationBaseline, manifest.migrations.at(-1).version);
  assert.doesNotMatch(schema, /^(?:COPY|INSERT INTO|\s*\\) /m);
});
test('readiness rejects a reachable worker serving a different artifact hash', async () => {
  const server = createServer((_req, res) => {res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({artifactHash: 'sha256:wrong'}));});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {await assert.rejects(waitReady(`http://127.0.0.1:${server.address().port}`, '/health', async response => (await response.json()).artifactHash === 'sha256:expected', 20), /readiness timeout/);}
  finally {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
});
test('UI proxy survives interrupted API streams and remains available for cleanup', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'test-ui-proxy-'));
  await writeFile(path.join(directory, 'index.html'), '<html>local</html>');
  const api = createServer((_req, res) => {res.writeHead(200, {'content-type': 'text/plain'}); res.write('partial'); setTimeout(() => res.destroy(), 10);});
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const ui = await startTestUI({root: directory, apiOrigin: `http://127.0.0.1:${api.address().port}`});
  try {
    await assert.rejects((async () => {const response = await fetch(`http://127.0.0.1:${ui.address().port}/api/stream`); await response.text();})());
    const page = await fetch(`http://127.0.0.1:${ui.address().port}/`); assert.equal(page.status, 200);
  } finally {
    for (const server of [ui, api]) {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
    assertOwnedPath(tmpdir(), directory); await rm(directory, {recursive: true});
  }
});
