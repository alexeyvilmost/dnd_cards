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
  const artifact = `exports.initializeRoguelikeCombat = async () => ({status:'needs_content', needs:[], version:1}); exports.executeRoguelikeCampAction = async (input) => ({status:'ready', patch:{current_hp: input.character.current_hp + 1}, events:[{type:'healing',amount:1}]});`;
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
    const camp = await fetch(`${url}/camp-action`, {method:'POST', headers:{authorization:`Bearer ${token}`, 'Content-Type':'application/json'}, body:JSON.stringify({input:{character:{current_hp:4}}})});
    assert.equal(camp.status,200);
    assert.deepEqual(await camp.json(), {status:'ready',patch:{current_hp:5},events:[{type:'healing',amount:1}],artifactHash:oldHash});
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

test('transition diagnostics expose known rule codes without exception details', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'roguelike-worker-diagnostics-'));
  const artifactFile = path.join(directory, 'current.cjs');
  const artifact = `exports.stepRoguelikeCombat = (_envelope, intent) => {throw new Error(intent.message);};`;
  await writeFile(artifactFile, artifact);
  const server = await createRulesWorker({artifactFile, artifactsDirectory: path.join(directory, 'artifacts'), token});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const [message, expected] of [
      ['OutOfRange: target-private is outside 0 ft range; entropy-private', {rejectionCode: 'OutOfRange'}],
      ['InsufficientResources: Missing resources: slot_private; entropy-private', {rejectionCode: 'InsufficientResources'}],
      ['InvalidActionDefinition: private-snapshot-secret', {rejectionCode: 'InvalidActionDefinition'}],
      ['OutOfRangePrivate: entropy-private', {}],
      ['prefix OutOfRange: entropy-private', {}],
      ['private-snapshot-secret', {}],
      ['Прыжок превышает доступную дистанцию: entropy-private', {}],
      ['Каталог не содержит spell/test; entropy-private', {}],
      ['Карта столкновения отсутствует', {message: 'Карта столкновения отсутствует'}],
      ['Каталог не содержит spell/test_spell', {message: 'Каталог не содержит spell/test_spell'}],
    ]) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/transition`, {
        method: 'POST', headers: {authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({envelope: {entropy: {seed: 'request-private'}}, intent: {message}}),
      });
      assert.equal(response.status, 422);
      const diagnostic = await response.json();
      assert.deepEqual(diagnostic, {error: 'invalid_combat_command', ...expected});
      assert.ok(!JSON.stringify(diagnostic).includes('private'));
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('roguelike-worker-diagnostics-'));
    await rm(directory, {recursive: true, force: true});
  }
});
