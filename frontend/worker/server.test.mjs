import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createRulesWorker} from './server.mjs';

const token = 'local-test-worker-token-with-32-characters';
test('internal worker authenticates requests and retains exact executable artifacts across restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'roguelike-worker-'));
  const artifactFile = path.join(directory, 'current.cjs');
  const artifactsDirectory = path.join(directory, 'artifacts');
  const artifact = `exports.initializeRoguelikeCombat = async () => ({status:'needs_content', needs:[], version:1});`;
  await writeFile(artifactFile, artifact);
  const oldHash = `sha256:${createHash('sha256').update(artifact).digest('hex')}`;
  let server;
  async function start() {
    server = await createRulesWorker({artifactFile, artifactsDirectory, token});
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {await new Promise(resolve => server.close(resolve));}
  const post = (url, body, authorization = `Bearer ${token}`) => fetch(`${url}/initialize`, {
    method: 'POST', headers: {authorization, 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  try {
    let url = await start();
    assert.equal((await post(url, {}, 'Bearer wrong')).status, 401);
    assert.equal((await (await fetch(`${url}/health`)).json()).artifactHash, oldHash);
    assert.equal((await (await post(url, {})).json()).version, 1);
    await stop();
    await writeFile(artifactFile, artifact.replace('version:1', 'version:2'));
    url = await start();
    assert.equal((await (await post(url, {})).json()).version, 2);
    assert.equal((await (await post(url, {artifactHash: oldHash})).json()).version, 1);
    assert.equal((await post(url, {artifactHash: '../current.cjs'})).status, 422);
    assert.equal((await post(url, {artifactHash: `sha256:${'0'.repeat(64)}`})).status, 409);
    assert.equal(await readFile(path.join(artifactsDirectory, `${oldHash.slice(7)}.cjs`), 'utf8'), artifact);
  } finally {
    if (server?.listening) await stop();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('roguelike-worker-'));
    await rm(directory, {recursive: true, force: true});
  }
});
