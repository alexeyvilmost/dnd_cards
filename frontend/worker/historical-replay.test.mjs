import {workerTestBuild} from '../../scripts/testing/worker-test-build.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile, writeFile, mkdtemp, mkdir, rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {gunzipSync} from 'node:zlib';
import {createRulesWorker, snapshotHash} from './server.mjs';
import {replayCombatRecords} from './replay.mjs';

const fixture = new URL('./fixtures/replay-v1/', import.meta.url);
const token = 'local-historical-replay-test-token-only';
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
async function readFixture() {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', fixture), 'utf8'));
  assert.equal(manifest.sourceCommit, '4549fb3c903659d3fe2beb272f7f903a731f7388');
  const packedArtifact = await readFile(new URL(manifest.artifactFile, fixture));
  assert.equal(hash(packedArtifact), manifest.compressedHash);
  const artifact = gunzipSync(packedArtifact);
  assert.equal(hash(artifact), manifest.artifactHash);
  const corpusManifest = JSON.parse(await readFile(new URL('corpus-manifest.json', fixture), 'utf8'));
  const packedCorpus = await readFile(new URL(corpusManifest.corpusFile, fixture));
  assert.equal(hash(packedCorpus), corpusManifest.compressedHash);
  const corpusBytes = gunzipSync(packedCorpus);
  assert.equal(hash(corpusBytes), corpusManifest.corpusHash);
  const corpus = JSON.parse(corpusBytes);
  assert.equal(corpus.artifactHash, manifest.artifactHash);
  assert.equal(corpus.sourceCommit, manifest.sourceCommit);
  assert.equal(corpus.fixtureKind, 'synthetic-local-only');
  assert.equal(corpus.cases.length, 9);
  for (const row of corpus.cases) assert.equal(snapshotHash(row.response), row.responseHash, `${row.name}: corrupted expected outcome`);
  return {manifest, artifact, corpus};
}
async function isolated(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'historical-replay-'));
  try {await run(directory);}
  finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('historical-replay-'));
    await rm(directory, {recursive: true, force: true});
  }
}
async function withCurrentServer(directory, work) {
  const server = await createRulesWorker({artifactFile: new URL('artifact.cjs', workerTestBuild()),
    artifactsDirectory: path.join(directory, 'artifacts'), token});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {await work(`http://127.0.0.1:${server.address().port}`);}
  finally {await new Promise(resolve => server.close(resolve));}
}
const post = (url, route, request) => fetch(url + route, {method: 'POST',
  headers: {authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify(request)});

test('original executable and saved corpus survive current worker restart without repinning outcomes or RNG', async () => {
  const {manifest, artifact, corpus} = await readFixture();
  await isolated(async directory => {
    await mkdir(path.join(directory, 'artifacts'));
    const retainedFile = path.join(directory, 'artifacts', `${manifest.artifactHash.slice(7)}.cjs`);
    await writeFile(retainedFile, artifact, {flag: 'wx'});
    const currentHash = hash(await readFile(new URL('artifact.cjs', workerTestBuild())));
    assert.notEqual(currentHash, manifest.artifactHash, 'Requires an actual different current executable');
    // Separate server/cache lifetimes model an update/restart. Replay uses only
    // the archived executable identified by each saved request, not defaults.
    for (let restart = 0; restart < 2; restart++) {
      await withCurrentServer(directory, async url => {
        assert.equal((await (await fetch(url + '/health')).json()).artifactHash, currentHash);
        for (const row of corpus.cases) {
          const request = {...row.request, artifactHash: manifest.artifactHash};
          for (let retry = 0; retry < 2; retry++) {
            const response = await post(url, row.route, request);
            assert.equal(response.status, 200, `${row.name}: HTTP ${response.status}`);
            assert.equal(snapshotHash(await response.json()), row.responseHash, `${row.name}: historical output/RNG/revision changed`);
          }
        }
      });
    }
    assert.equal(hash(await readFile(retainedFile)), manifest.artifactHash);
    const initialized = corpus.cases.find(row => row.name === 'combat-initialize').response;
    const transitions = corpus.cases.filter(row => row.route === '/transition');
    const records = [{schemaVersion: 1, type: 'initialize_combat', artifactHash: manifest.artifactHash,
      baseline: initialized.envelope, baselinePosition: 'after', ...initialized.trace},
    ...transitions.map(row => ({schemaVersion: 1, type: 'combat_intent', artifactHash: manifest.artifactHash,
      intent: row.request.intent, randomValues: row.response.randomValues, ...row.response.trace}))];
    const replay = replayCombatRecords(records, createRequire(import.meta.url)(retainedFile));
    assert.equal(replay.commands, 3);
    assert.equal(snapshotHash(replay.envelope), snapshotHash(transitions.at(-1).response.envelope));
    assert.ok(transitions.some(row => row.response.randomValues.length > 0), 'Corpus must exercise actual random consumption');
    const corrupt = structuredClone(records);
    corrupt[1].afterHash = `sha256:${'0'.repeat(64)}`;
    assert.throws(() => replayCombatRecords(corrupt, createRequire(import.meta.url)(retainedFile)), /diverged/);
  });
});

test('missing and corrupted historical executables fail closed instead of falling back to the current engine', async () => {
  const {manifest, corpus} = await readFixture();
  await isolated(async directory => {
    const row = corpus.cases.find(row => row.name === 'journey-str-resume');
    const request = {...row.request, artifactHash: manifest.artifactHash};
    await withCurrentServer(directory, async url => {
      const response = await post(url, row.route, request);
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error, 'artifact_unavailable');
    });
    await writeFile(path.join(directory, 'artifacts', `${manifest.artifactHash.slice(7)}.cjs`), 'throw Error("must never execute");');
    await withCurrentServer(directory, async url => {
      const response = await post(url, row.route, request);
      assert.equal(response.status, 422);
      assert.deepEqual(await response.json(), {error: 'invalid_combat_command'});
    });
  });
});
