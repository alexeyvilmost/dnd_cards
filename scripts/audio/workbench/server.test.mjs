import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createWorkbenchServer, loadElevenLabsKey } from './server.mjs';

const SECRET = 'test-secret-never-serialize-this';
const AUDIO = Buffer.from('ID3\u0004\u0000\u0000mock-mp3-audio');
const catalog = [
  { key: 'dice.roll', nameRu: 'Кубики', prompt: 'Dice land on wood.', durationSeconds: 0.25, pilot: true },
  { key: 'spell.frost', nameRu: 'Холод', prompt: 'A sharp frost impact.', durationSeconds: 30, pilot: false },
];
const goodResponse = () => new Response(AUDIO, { headers: { 'content-type': 'audio/mpeg', 'character-cost': '8' } });

async function fixture(t, fetchImpl = async () => goodResponse(), extra = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dnd-audio-workbench-test-'));
  const catalogPath = path.join(root, 'prompts.json');
  const dataDir = path.join(root, 'data');
  const downloadDir = path.join(root, 'downloads');
  await mkdir(downloadDir);
  await writeFile(catalogPath, JSON.stringify(catalog));
  let app = await createWorkbenchServer({ port: 0, catalogPath, dataDir, downloadDir, fetchImpl, apiKey: '', workflow: 'api', ...extra });
  t.after(async () => { if (app.server.listening) await app.close(); await rm(root, { recursive: true, force: true }); });
  return {
    get app() { return app; }, root, dataDir, downloadDir,
    async restart(options = {}) {
      await app.close();
      app = await createWorkbenchServer({ port: 0, catalogPath, dataDir, downloadDir, fetchImpl, apiKey: '', workflow: 'api', ...extra, ...options });
    },
    async state() { return (await fetch(`${app.address}/api/state`)).json(); },
    async mutate(route, body, options = {}) {
      const response = await fetch(`${app.address}${route}`, {
        method: options.method ?? 'POST', headers: { Origin: app.address, 'Content-Type': 'application/json', 'X-Workbench-Token': app.workbench.snapshot().csrfToken, ...options.headers }, body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    async connect(startScope = 'none') { return this.mutate('/api/connect', { apiKey: SECRET, startScope, requestId: `connect-${startScope}` }); },
  };
}

test('four sequential paid API calls; duration clamp, bytes, cost, indexed audio range', async (t) => {
  const calls = [];
  let active = 0, maxActive = 0;
  const f = await fixture(t, async (url, init) => {
    active += 1; maxActive = Math.max(maxActive, active);
    calls.push({ url, init, body: JSON.parse(init.body) });
    await delay(5); active -= 1;
    return goodResponse();
  }, { apiKey: SECRET });
  assert.equal((await f.state()).app, 'dnd-audio-workbench');
  assert.equal(calls.length, 0, 'startup with an environment-equivalent key must not generate');
  const request = { keys: ['dice.roll'], mode: 'missing', requestId: 'first-four' };
  assert.equal((await f.mutate('/api/generate', request)).status, 200);
  await f.app.workbench.waitForIdle();
  assert.equal(calls.length, 4);
  assert.equal(maxActive, 1);
  for (const call of calls) {
    assert.equal(call.url, 'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128');
    assert.equal(call.init.headers['xi-api-key'], SECRET);
    assert.deepEqual(call.body, { text: catalog[0].prompt, duration_seconds: 0.5, prompt_influence: 0.3, model_id: 'eleven_text_to_sound_v2', loop: false });
  }
  const state = await f.state();
  assert.equal(state.entries[0].batches[0].variants.length, 4);
  assert.equal(state.entries[0].batches[0].status, 'ready');
  assert.equal(state.totals.costCredits, 32);
  assert.equal(state.queue.queued, 0);
  const variant = state.entries[0].batches[0].variants[0];
  const response = await fetch(`${f.app.address}${variant.url}`, { headers: { Range: 'bytes=0-2' } });
  assert.equal(response.status, 206);
  assert.equal(await response.text(), 'ID3');
  assert.equal(response.headers.get('content-range'), `bytes 0-2/${AUDIO.length}`);
  const invalidRange = await fetch(`${f.app.address}${variant.url}`, { headers: { Range: 'bytes=500-900' } });
  assert.equal(invalidRange.status, 416);
  assert.equal((await readdir(path.join(f.dataDir, 'audio'))).length, 4);
});

test('idempotency persists across reload, active batches reject extra work, edited second cue clamps to thirty seconds', async (t) => {
  let releaseFirst;
  const first = new Promise((resolve) => { releaseFirst = resolve; });
  const calls = [];
  const f = await fixture(t, async (_url, init) => { calls.push(JSON.parse(init.body)); if (calls.length === 1) await first; return goodResponse(); });
  await f.connect();
  const request = { keys: ['spell.frost'], mode: 'missing', requestId: 'same-operation', prompt: 'Glasslike ice bursts.', durationSeconds: 30 };
  await f.mutate('/api/generate', request);
  assert.equal((await f.mutate('/api/generate', request)).status, 200);
  await f.mutate('/api/generate', { keys: ['spell.frost'], mode: 'regenerate', requestId: 'double-click-new-id' });
  assert.equal((await f.mutate('/api/generate', { ...request, keys: ['dice.roll'] })).status, 409);
  releaseFirst();
  await f.app.workbench.waitForIdle();
  assert.equal(calls.length, 4);
  assert.ok(calls.every((call) => call.duration_seconds === 30 && call.text === 'Glasslike ice bursts.'));
  await f.restart({ apiKey: SECRET });
  await f.mutate('/api/generate', request);
  await f.app.workbench.waitForIdle();
  assert.equal(calls.length, 4);
  assert.equal((await f.state()).entries[1].batches.length, 1);
});

test('selection, original prompt and historic batches survive regeneration and restart; credentials never persist', async (t) => {
  const f = await fixture(t);
  await f.connect('pilot');
  await f.app.workbench.waitForIdle();
  const original = (await f.state()).entries[0].batches[0];
  const chosenId = original.variants[2].id;
  await f.mutate('/api/select', { key: 'dice.roll', variantId: chosenId });
  await f.mutate('/api/generate', { keys: ['dice.roll'], mode: 'regenerate', requestId: 'regenerate-new-timbre', prompt: 'Heavy stone dice.', durationSeconds: 1.2 });
  await f.app.workbench.waitForIdle();
  let state = await f.state();
  assert.equal(state.entries[0].batches.length, 2);
  assert.equal(state.entries[0].selectedVariantId, chosenId);
  assert.equal(state.entries[0].batches[0].prompt, catalog[0].prompt);
  assert.equal(state.entries[0].batches[1].prompt, 'Heavy stone dice.');
  const disk = await readFile(path.join(f.dataDir, 'state.json'), 'utf8');
  assert.ok(!disk.includes(SECRET));
  assert.ok(!JSON.stringify(state).includes(SECRET));
  await f.restart();
  state = await f.state();
  assert.equal(state.connected, false);
  assert.equal(state.paused, true);
  assert.equal(state.entries[0].selectedVariantId, chosenId);
  const manifest = await (await fetch(`${f.app.address}/api/export`)).json();
  assert.equal(manifest.entries[0].variantId, chosenId);
  assert.equal(manifest.entries[0].prompt, catalog[0].prompt);
  assert.equal(manifest.entries[0].file, `audio/${chosenId}.mp3`);
  assert.match(manifest.entries[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal((await f.mutate('/api/select', { key: 'spell.frost', variantId: chosenId })).status, 400);
  assert.equal((await f.mutate('/api/select', { key: 'dice.roll', variantId: null })).status, 200);
});

test('failed paid request never automatically repeats; explicit retry is idempotent and recorded', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => { calls += 1; if (calls === 1) throw new Error(`Remote echo: ${SECRET}`); return goodResponse(); });
  await f.connect('pilot');
  await f.app.workbench.waitForIdle();
  let state = await f.state();
  assert.equal(calls, 1);
  assert.equal(state.paused, true);
  assert.equal(state.queue.queued, 3);
  assert.equal(state.entries[0].batches[0].variants[0].status, 'failed');
  assert.ok(!JSON.stringify(state).includes(SECRET));
  const variantId = state.entries[0].batches[0].variants[0].id;
  await f.mutate('/api/queue', { action: 'resume' });
  await f.app.workbench.waitForIdle();
  assert.equal(calls, 4, 'resume processes remaining slots, not the failed slot');
  await f.mutate('/api/generate', { keys: ['dice.roll'], mode: 'missing', requestId: 'missing-after-failure' });
  await f.app.workbench.waitForIdle();
  assert.equal(calls, 4);
  const retry = { variantId, requestId: 'explicit-retry-once' };
  await f.mutate('/api/retry', retry);
  await f.app.workbench.waitForIdle();
  await f.mutate('/api/retry', retry);
  await f.app.workbench.waitForIdle();
  assert.equal(calls, 5);
  state = await f.state();
  assert.equal(state.entries[0].batches[0].variants.length, 4);
  assert.equal(state.entries[0].batches[0].variants[0].attempt, 2);
  assert.equal(state.entries[0].batches[0].variants[0].attempts[0].status, 'failed');
  assert.ok(!(await readFile(path.join(f.dataDir, 'state.json'), 'utf8')).includes(SECRET));
});

test('auth, quota, rate limiting and unexpected non-audio responses stop the queue safely', async (t) => {
  for (const status of [401, 402, 429, 500, 200]) {
    await t.test(`HTTP ${status}`, async (subtest) => {
      let calls = 0;
      const f = await fixture(subtest, async () => { calls += 1; return new Response(JSON.stringify({ detail: `sensitive: ${SECRET}` }), { status, headers: { 'Content-Type': 'application/json' } }); });
      await f.connect('pilot');
      await f.app.workbench.waitForIdle();
      const state = await f.state();
      assert.equal(calls, 1);
      assert.equal(state.paused, true);
      assert.equal(state.queue.queued, 3);
      assert.ok(state.lastError.length > 10);
      assert.ok(!JSON.stringify(state).includes(SECRET));
      assert.ok(!(await readFile(path.join(f.dataDir, 'state.json'), 'utf8')).includes(SECRET));
    });
  }
});

test('pause lets the current response finish; clearing key pauses and never starts another request', async (t) => {
  let releaseFirst;
  const first = new Promise((resolve) => { releaseFirst = resolve; });
  let calls = 0;
  const f = await fixture(t, async () => { calls += 1; if (calls === 1) await first; return goodResponse(); });
  await f.connect('pilot');
  while (!calls) await delay(1);
  await f.mutate('/api/queue', { action: 'pause' });
  releaseFirst();
  await f.app.workbench.waitForIdle();
  assert.equal(calls, 1);
  assert.equal((await f.state()).queue.queued, 3);
  await f.mutate('/api/key', {}, { method: 'DELETE' });
  assert.equal((await f.state()).connected, false);
  assert.equal((await f.mutate('/api/queue', { action: 'resume' })).status, 400);
  assert.equal(calls, 1);
});

test('interrupted request is marked for explicit review on restart and queued work stays paused', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => { calls += 1; return goodResponse(); });
  await f.mutate('/api/generate', { keys: ['dice.roll'], mode: 'missing', requestId: 'queue-without-key' });
  assert.equal(calls, 0);
  const statePath = path.join(f.dataDir, 'state.json');
  // Simulate a process exit after its durable paid-request marker was written.
  await f.app.close();
  const stored = JSON.parse(await readFile(statePath, 'utf8'));
  stored.entries['dice.roll'].batches[0].variants[0].status = 'generating';
  await writeFile(statePath, JSON.stringify(stored));
  // restart() expects a live server, so create a replacement directly for this fixture.
  const restarted = await createWorkbenchServer({ port: 0, dataDir: f.dataDir, catalogPath: path.join(f.root, 'prompts.json'), apiKey: SECRET, fetchImpl: async () => { calls += 1; return goodResponse(); } });
  try {
    const state = restarted.workbench.snapshot();
    assert.equal(state.paused, true);
    assert.equal(state.entries[0].batches[0].variants[0].status, 'interrupted');
    assert.equal(state.queue.queued, 3);
    assert.equal(calls, 0);
  } finally { await restarted.close(); }
});

function rawRequest(address, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.get(new URL(address), { path: pathname, headers }, (response) => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject);
  });
}

test('loopback Host, matching Origin, session CSRF and JSON are required; traversal is not served', async (t) => {
  const f = await fixture(t);
  const body = { keys: ['dice.roll'], mode: 'missing', requestId: 'security-no-side-effect' };
  assert.equal((await f.mutate('/api/generate', body, { headers: { 'X-Workbench-Token': '' } })).status, 403);
  assert.equal((await f.mutate('/api/generate', body, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
  assert.equal((await f.mutate('/api/generate', body, { headers: { Origin: '' } })).status, 403);
  assert.equal((await f.mutate('/api/generate', body, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal(await rawRequest(f.app.address, '/api/state', { Host: 'evil.example' }), 403);
  assert.equal(await rawRequest(f.app.address, '/api/state', { Origin: 'https://untrusted.example' }), 403);
  assert.equal(await rawRequest(f.app.address, '/audio/../state.json'), 400);
  assert.equal(await rawRequest(f.app.address, '/audio/%2e%2e/state.json'), 400);
  assert.equal(await rawRequest(f.app.address, '/state.json'), 404);
  assert.equal(await rawRequest(f.app.address, '/audio/not-indexed.mp3'), 404);
  assert.equal((await f.state()).queue.queued, 0);
});

test('browser jobs and four-file imports persist, deduplicate and keep selections through regeneration', async (t) => {
  let apiCalls = 0;
  const f = await fixture(t, async () => { apiCalls += 1; return goodResponse(); }, { workflow: 'browser', apiKey: SECRET });
  assert.equal((await f.state()).workflow, 'browser');
  assert.equal((await f.connect('pilot')).status, 400);
  const jobRequest = { keys: ['dice.roll'], requestId: 'browser-request-01', prompt: 'Dice roll gently.', durationSeconds: 1.5 };
  await f.mutate('/api/browser-request', jobRequest);
  await f.mutate('/api/browser-request', jobRequest);
  await f.mutate('/api/browser-request', { ...jobRequest, requestId: 'browser-another-click' });
  let state = await f.state();
  assert.equal(state.browserJobs.length, 1);
  const files = [];
  for (let index = 0; index < 4; index += 1) {
    const filename = path.join(f.downloadDir, `download-${index}.mp3`);
    await writeFile(filename, AUDIO);
    files.push(filename);
  }
  const imported = { key: 'dice.roll', requestId: 'import-browser-01', files, jobId: state.browserJobs[0].id };
  assert.equal((await f.mutate('/api/import-batch', imported)).status, 200);
  assert.equal((await f.mutate('/api/import-batch', imported)).status, 200);
  state = await f.state();
  assert.equal(state.browserJobs[0].status, 'complete');
  assert.equal(state.entries[0].batches.length, 1);
  assert.equal(state.entries[0].batches[0].variants.length, 4);
  assert.equal(state.entries[0].batches[0].prompt, 'Dice roll gently.');
  assert.equal(state.entries[0].batches[0].source, 'browser');
  assert.equal(state.totals.costCredits, null);
  assert.equal(state.totals.unknownCostCount, 4);
  const selectedVariantId = state.entries[0].batches[0].variants[1].id;
  await f.mutate('/api/select', { key: 'dice.roll', variantId: selectedVariantId });
  await f.mutate('/api/browser-request', { keys: ['dice.roll'], requestId: 'browser-request-02', prompt: 'Heavy dice roll.', durationSeconds: 1 });
  const pending = (await (await fetch(`${f.app.address}/api/browser-jobs`)).json()).jobs;
  assert.equal(pending.length, 1);
  assert.equal((await f.mutate('/api/import-batch', { ...imported, requestId: 'import-wrong-prompt', jobId: pending[0].id, prompt: 'Wrong version' })).status, 400);
  await f.mutate('/api/import-batch', { ...imported, requestId: 'import-browser-02', jobId: pending[0].id });
  await f.restart();
  state = await f.state();
  assert.equal(state.entries[0].batches.length, 2);
  assert.equal(state.entries[0].selectedVariantId, selectedVariantId);
  assert.equal(state.entries[0].batches[0].prompt, 'Dice roll gently.');
  assert.equal(state.entries[0].batches[1].prompt, 'Heavy dice roll.');
  assert.equal(apiCalls, 0, 'browser workflow must never charge through API');
});

test('browser import rejects outside paths, repeated files and non-MP3 content', async (t) => {
  const f = await fixture(t, undefined, { workflow: 'browser' });
  const files = [];
  for (let index = 0; index < 4; index += 1) {
    const filename = path.join(f.downloadDir, `safe-${index}.mp3`);
    await writeFile(filename, AUDIO);
    files.push(filename);
  }
  const outside = path.join(f.root, 'private.mp3');
  await writeFile(outside, AUDIO);
  const imported = { key: 'dice.roll', requestId: 'safe-import-validation', files };
  assert.equal((await f.mutate('/api/import-batch', { ...imported, files: [outside, ...files.slice(1)] })).status, 403);
  assert.equal((await f.mutate('/api/import-batch', { ...imported, files: Array(4).fill(files[0]) })).status, 400);
  await writeFile(files[0], 'private file, not audio');
  assert.equal((await f.mutate('/api/import-batch', imported)).status, 400);
  assert.equal((await f.state()).entries[0].batches.length, 0);
});

test('same data directory cannot be served twice, and excessive duration is rejected', async (t) => {
  const f = await fixture(t);
  await assert.rejects(() => createWorkbenchServer({ port: 0, dataDir: f.dataDir, catalogPath: path.join(f.root, 'prompts.json') }), /уже используется/);
  assert.equal((await f.mutate('/api/generate', { keys: ['dice.roll'], requestId: 'excess-duration-01', mode: 'missing', durationSeconds: 31 })).status, 400);
  assert.equal((await f.state()).queue.queued, 0);
});

test('project .env token alias loads without exporting or serializing unrelated secrets', async (t) => {
  const f = await fixture(t);
  const envPath = path.join(f.root, '.env');
  await writeFile(envPath, `UNRELATED_SECRET=not-for-this-tool\nELEVENLABS_API_KEY=legacy-key\nexport ELEVENLABS_TOKEN="${SECRET}" # token comment\n`);
  assert.equal(await loadElevenLabsKey({ envPath, environment: {} }), SECRET);
  assert.equal(await loadElevenLabsKey({ envPath, environment: { ELEVENLABS_TOKEN: 'environment-token' } }), 'environment-token');
  assert.equal(await loadElevenLabsKey({ envPath, environment: { ELEVENLABS_API_KEY: 'environment-legacy' } }), 'environment-legacy');
  assert.equal(await loadElevenLabsKey({ apiKey: '', envPath, environment: {} }), '');
  await writeFile(envPath, "ELEVENLABS_API_KEY = 'legacy-only'\n");
  assert.equal(await loadElevenLabsKey({ envPath, environment: {} }), 'legacy-only');
  await writeFile(envPath, `ELEVENLABS_TOKEN=${SECRET} # local comment\n`);
  assert.equal(await loadElevenLabsKey({ envPath, environment: {} }), SECRET);
  assert.equal(await loadElevenLabsKey({ envPath: path.join(f.root, 'missing.env'), environment: {} }), '');
  assert.ok(!(await readFile(path.join(f.dataDir, 'state.json'), 'utf8')).includes(SECRET));
});

test('browser prompt rejects website limit overflow without recording unusable jobs', async (t) => {
  const f = await fixture(t, undefined, { workflow: 'browser' });
  const response = await f.mutate('/api/browser-request', { keys: ['dice.roll'], requestId: 'long-browser-prompt', prompt: 'a'.repeat(451) });
  assert.equal(response.status, 400);
  assert.equal((await f.state()).browserJobs.length, 0);
});

test('two workers never exceed two requests and generate exactly four unique slots per cue', async (t) => {
  let calls = 0, active = 0, maxActive = 0;
  let announcePairStarted, releasePair;
  const pairStarted = new Promise((resolve) => { announcePairStarted = resolve; });
  const pairReleased = new Promise((resolve) => { releasePair = resolve; });
  const prompts = [];
  const f = await fixture(t, async (_url, init) => {
    const ordinal = ++calls;
    active += 1; maxActive = Math.max(maxActive, active);
    prompts.push(JSON.parse(init.body).text);
    // Persisting the second request intent can take longer than any short sleep.
    // Keep both requests in flight until the test observes their actual start.
    if (ordinal <= 2) {
      if (ordinal === 2) announcePairStarted();
      await pairReleased;
    }
    active -= 1;
    return goodResponse();
  }, { concurrency: 2 });
  assert.equal((await f.state()).concurrency, 2);
  let watchdog;
  try {
    await f.connect('all');
    await Promise.race([pairStarted, new Promise((_, reject) => {
      watchdog = setTimeout(() => reject(new Error('Two queue workers did not start their requests')), 10_000);
    })]);
    assert.equal(calls, 2);
    assert.equal(active, 2);
    assert.equal(f.app.workbench.snapshot().queue.running, 2);
  } finally {
    clearTimeout(watchdog);
    releasePair(); // A failed assertion must not leave cleanup waiting on fetch.
  }
  await f.app.workbench.waitForIdle();
  const state = await f.state();
  assert.equal(calls, 8);
  assert.equal(maxActive, 2);
  assert.equal(state.totals.ready, 8);
  assert.equal(prompts.filter((prompt) => prompt === catalog[0].prompt).length, 4);
  assert.equal(prompts.filter((prompt) => prompt === catalog[1].prompt).length, 4);
  const ids = state.entries.flatMap((entry) => entry.batches.flatMap((batch) => batch.variants.map((variant) => variant.id)));
  assert.equal(new Set(ids).size, 8);
  assert.deepEqual(state.queue, { queued: 0, running: 0 });
});

test('an error with two workers pauses new requests and preserves the other in-flight result', async (t) => {
  let secondStarted, finishSecond;
  const started = new Promise((resolve) => { secondStarted = resolve; });
  const finish = new Promise((resolve) => { finishSecond = resolve; });
  let calls = 0;
  const f = await fixture(t, async () => {
    calls += 1;
    if (calls === 1) { await started; return new Response('quota', { status: 429 }); }
    secondStarted();
    await finish;
    return goodResponse();
  }, { concurrency: 2 });
  await f.connect('all');
  while (!f.app.workbench.snapshot().paused) await delay(1);
  assert.equal(f.app.workbench.snapshot().queue.running, 1);
  assert.equal(calls, 2);
  finishSecond();
  await f.app.workbench.waitForIdle();
  const state = await f.state();
  assert.equal(calls, 2);
  assert.equal(state.paused, true);
  assert.equal(state.totals.ready, 1);
  assert.deepEqual(state.queue, { queued: 6, running: 0 });
  assert.equal(state.entries[0].batches[0].variants[0].status, 'failed');
  assert.equal(state.entries[0].batches[0].variants[1].status, 'ready');
});
