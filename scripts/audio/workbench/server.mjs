import http from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, rename, stat, open, unlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODEL = 'eleven_text_to_sound_v2';
const OUTPUT_FORMAT = 'mp3_44100_128';
const UPSTREAM = `https://api.elevenlabs.io/v1/sound-generation?output_format=${OUTPUT_FORMAT}`;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const MAX_BODY_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const STATIC = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const copy = (value) => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
export const clampDuration = (value) => Math.max(0.5, Math.min(30, value));
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Reads only supported credential names; never exports .env values into the process. */
export async function loadElevenLabsKey({ apiKey, envPath = path.resolve(HERE, '../../../.env'), environment = process.env } = {}) {
  if (apiKey !== undefined) return apiKey;
  if (environment.ELEVENLABS_TOKEN) return environment.ELEVENLABS_TOKEN.trim();
  if (environment.ELEVENLABS_API_KEY) return environment.ELEVENLABS_API_KEY.trim();
  let contents;
  try { contents = await readFile(envPath, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw new Error('Не удалось прочитать локальный файл .env.'); }
  const values = {};
  for (const line of contents.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?(ELEVENLABS_TOKEN|ELEVENLABS_API_KEY)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0], end = value.indexOf(quote, 1);
      if (end < 1) continue;
      value = value.slice(1, end);
    } else value = value.replace(/\s+#.*$/, '').trim();
    values[match[1]] = value;
  }
  return values.ELEVENLABS_TOKEN || values.ELEVENLABS_API_KEY || '';
}

async function atomicJson(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filename);
}

function batchStatus(batch) {
  const statuses = batch.variants.map((variant) => variant.status);
  if (statuses.includes('generating')) return 'generating';
  if (statuses.includes('queued')) return 'queued';
  if (statuses.every((status) => status === 'ready')) return 'ready';
  if (statuses.includes('ready')) return 'partial';
  if (statuses.includes('interrupted')) return 'interrupted';
  return 'failed';
}

function validateDuration(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 30) {
    throw new UserError('Длительность должна быть числом больше нуля и не больше 30 секунд.');
  }
  return value;
}

function validatePrompt(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) {
    throw new UserError('Промпт должен содержать от 1 до 2000 символов.');
  }
  return value.trim();
}

function validateRequestId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.:-]{8,128}$/.test(value)) {
    throw new UserError('Нужен уникальный requestId длиной 8–128 символов.');
  }
  return value;
}

function safeKey(key) {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
}

async function acquireDirectoryLock(dataDir) {
  const filename = path.join(dataDir, '.workbench-lock.json');
  const identity = { pid: process.pid, id: randomUUID(), createdAt: now() };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const file = await open(filename, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(identity)); }
      finally { await file.close(); }
      return async () => {
        try {
          const current = JSON.parse(await readFile(filename, 'utf8'));
          if (current.id === identity.id) await unlink(filename);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let existing;
      try { existing = JSON.parse(await readFile(filename, 'utf8')); }
      catch { throw new Error('Папка данных заблокирована. Проверьте, что другой сервер галереи не запущен.'); }
      if (!Number.isSafeInteger(existing.pid) || existing.pid < 1) throw new Error('Повреждён файл блокировки папки данных.');
      try { process.kill(existing.pid, 0); throw new Error('Эта папка данных уже используется другим сервером галереи.'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
      const current = JSON.parse(await readFile(filename, 'utf8'));
      if (current.id === existing.id) await unlink(filename);
    }
  }
  throw new Error('Не удалось заблокировать папку данных.');
}

async function readAudio(response) {
  const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!['audio/mpeg', 'audio/mp3'].includes(type)) {
    await response.body?.cancel().catch(() => {});
    throw new UserError('ElevenLabs вернул неожиданный формат вместо MP3. Очередь приостановлена; автоматического повтора нет.');
  }
  const declaredSize = Number(response.headers.get('content-length'));
  if (declaredSize > MAX_AUDIO_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new UserError('Аудиофайл превышает допустимый размер 20 МБ. Очередь приостановлена.');
  }
  const chunks = [];
  let size = 0;
  if (!response.body) throw new UserError('ElevenLabs вернул пустой аудиофайл. Автоматического повтора нет.');
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_AUDIO_BYTES) {
        await reader.cancel();
        throw new UserError('Аудиофайл превышает допустимый размер 20 МБ. Очередь приостановлена.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  const audio = Buffer.concat(chunks);
  const mp3 = audio.length >= 3 && (audio.subarray(0, 3).toString('ascii') === 'ID3' || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0));
  if (!mp3) throw new UserError('ElevenLabs вернул пустой или неподдерживаемый MP3. Очередь приостановлена; автоматического повтора нет.');
  return audio;
}

function upstreamError(status) {
  if (status === 401 || status === 403) return 'ElevenLabs отклонил ключ или доступ к Sound Effects. Проверьте ключ и его разрешения. Очередь приостановлена.';
  if (status === 402) return 'ElevenLabs сообщил о недостаточном балансе или ограничении тарифа. Очередь приостановлена.';
  if (status === 429) return 'ElevenLabs ограничил частоту запросов или доступную квоту. Очередь приостановлена; возобновление вручную.';
  if (status >= 500) return 'Сбой ElevenLabs: результат и списание могут быть неизвестны. Очередь приостановлена; автоматического повтора нет.';
  return `ElevenLabs отклонил запрос (HTTP ${status}). Проверьте промпт, длительность и квоту. Очередь приостановлена.`;
}

/** Starts a loopback-only gallery. Returns {server, workbench, address, close}. */
export async function createWorkbenchServer(options = {}) {
  const dataDir = path.resolve(options.dataDir ?? 'outputs/audio-workbench');
  const catalogPath = path.resolve(options.catalogPath ?? path.join(HERE, 'prompts.json'));
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const workflow = options.workflow ?? 'browser';
  if (!['api', 'browser'].includes(workflow)) throw new Error('Допустимые workflow: browser, api.');
  const concurrency = options.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) throw new Error('Параллельность должна быть равна 1 или 2.');
  const downloadDir = options.downloadDir ? await realpath(path.resolve(options.downloadDir)) : null;
  const rawCatalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const catalog = Array.isArray(rawCatalog) ? rawCatalog : rawCatalog.entries;
  if (!Array.isArray(catalog) || !catalog.length) throw new Error('Каталог промптов пуст или повреждён.');
  const sources = new Map();
  for (const source of catalog) {
    if (typeof source.key !== 'string' || !source.key || sources.has(source.key)) throw new Error('Ключи каталога должны быть уникальными.');
    validatePrompt(source.prompt);
    validateDuration(source.durationSeconds);
    sources.set(source.key, copy(source));
  }
  await mkdir(path.join(dataDir, 'audio'), { recursive: true });
  const releaseLock = await acquireDirectoryLock(dataDir);
  try {
  const statePath = path.join(dataDir, 'state.json');
  let stored;
  try { stored = JSON.parse(await readFile(statePath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Не удалось прочитать state.json. Сохраните файл и устраните повреждение перед запуском.'); }
  if (stored && stored.version !== 1) throw new Error('Неподдерживаемая версия state.json.');
  const state = stored ?? { version: 1, paused: true, entries: {}, requests: {}, lastError: null };
  state.paused = true;
  state.requests ??= {};
  state.browserJobs ??= [];
  for (const [key, source] of sources) state.entries[key] ??= { key, prompt: source.prompt, durationSeconds: source.durationSeconds, selectedVariantId: null, batches: [] };
  // Historical cues remain in the state file if the catalog changes.
  for (const entry of Object.values(state.entries)) {
    for (const batch of entry.batches) {
      for (const variant of batch.variants) {
        if (variant.status === 'generating') {
          variant.status = 'interrupted';
          variant.error = 'Работа прервана. Запрос мог быть оплачен; автоматического повтора нет. Проверьте историю ElevenLabs перед повтором.';
          variant.completedAt = now();
          state.lastError = variant.error;
        }
      }
    }
  }
  let apiKey = await loadElevenLabsKey({ apiKey: options.apiKey, envPath: options.envPath });
  const csrfToken = randomBytes(32).toString('hex');
  let mutex = Promise.resolve();
  let worker = null;
  let closing = false;
  const exclusive = (fn) => {
    const result = mutex.then(fn);
    mutex = result.catch(() => {});
    return result;
  };
  const save = () => atomicJson(statePath, state);
  await save();

  function allVariants() {
    return Object.values(state.entries).flatMap((entry) => entry.batches.flatMap((batch) => batch.variants.map((variant) => ({ entry, batch, variant }))));
  }
  function findVariant(id) { return allVariants().find(({ variant }) => variant.id === id); }
  function snapshot() {
    const variants = allVariants();
    const attempts = variants.flatMap(({ variant }) => [...(variant.attempts ?? []), ...(variant.attempt > 0 && variant.status !== 'queued' ? [variant] : [])]);
    const reportedCosts = attempts.filter((attempt) => typeof attempt.costCredits === 'number');
    return {
      app: 'dnd-audio-workbench', workflow, concurrency, connected: Boolean(apiKey), paused: state.paused, csrfToken,
      entries: [...sources].map(([key, source]) => {
        const entry = state.entries[key];
        return { ...copy(source), ...copy(entry), generationDurationSeconds: clampDuration(entry.durationSeconds), batches: entry.batches.map((batch) => ({
          ...copy(batch), status: batchStatus(batch), generationDurationSeconds: clampDuration(batch.durationSeconds),
          variants: batch.variants.map((variant) => ({ ...copy(variant), ...(variant.status === 'ready' ? { url: `/audio/${variant.id}.mp3` } : {}) })),
        })) };
      }),
      queue: { queued: variants.filter(({ variant }) => variant.status === 'queued').length, running: variants.filter(({ variant }) => variant.status === 'generating').length },
      totals: { ready: variants.filter(({ variant }) => variant.status === 'ready').length, selected: Object.values(state.entries).filter((entry) => entry.selectedVariantId).length, costCredits: reportedCosts.length ? reportedCosts.reduce((sum, attempt) => sum + attempt.costCredits, 0) : null, reportedCostCount: reportedCosts.length, unknownCostCount: attempts.length - reportedCosts.length },
      browserJobs: copy(state.browserJobs), lastError: state.lastError, dataDir, downloadDir,
    };
  }
  function exportManifest() {
    return {
      version: 1, generatedAt: now(), service: 'ElevenLabs Sound Effects', modelId: MODEL, outputFormat: OUTPUT_FORMAT,
      entries: Object.values(state.entries).filter((entry) => entry.selectedVariantId).flatMap((entry) => {
        const found = findVariant(entry.selectedVariantId);
        if (!found || found.variant.status !== 'ready') return [];
        const { batch, variant } = found;
        return [{ key: entry.key, nameRu: sources.get(entry.key)?.nameRu, filename: variant.filename, file: `audio/${variant.id}.mp3`, url: `/audio/${variant.id}.mp3`, variantId: variant.id, batchId: batch.id, prompt: batch.prompt, targetDurationSeconds: batch.durationSeconds, generationDurationSeconds: clampDuration(batch.durationSeconds), promptInfluence: 0.3, modelId: MODEL, outputFormat: OUTPUT_FORMAT, generatedAt: variant.completedAt, costCredits: variant.costCredits ?? null, sha256: variant.sha256 }];
      }),
    };
  }

  async function rememberRequest(requestId, payload, perform) {
    validateRequestId(requestId);
    const hash = fingerprint(payload);
    const previous = state.requests[requestId];
    if (previous) {
      if (previous.fingerprint !== hash) throw new UserError('Этот requestId уже использован для другой команды.', 409);
      return false;
    }
    await perform();
    state.requests[requestId] = { fingerprint: hash, createdAt: now() };
    return true;
  }
  function queueEntries(keys, mode, edits = {}) {
    if (!Array.isArray(keys) || !keys.length || keys.length > sources.size || keys.some((key) => !sources.has(key))) throw new UserError('Нужно выбрать существующие звуки из каталога.');
    if (!['missing', 'regenerate'].includes(mode)) throw new UserError('Неизвестный режим генерации.');
    if ((edits.prompt !== undefined || edits.durationSeconds !== undefined) && keys.length !== 1) throw new UserError('Редактирование промпта и длительности доступно для одного звука.');
    const editedPrompt = edits.prompt === undefined ? undefined : validatePrompt(edits.prompt);
    const editedDuration = edits.durationSeconds === undefined ? undefined : validateDuration(edits.durationSeconds);
    for (const key of new Set(keys)) {
      const entry = state.entries[key];
      const active = entry.batches.some((batch) => batch.variants.some((variant) => ['queued', 'generating'].includes(variant.status)));
      if (active || (mode === 'missing' && entry.batches.some((batch) => batch.variants.some((variant) => variant.status === 'ready')))) continue;
      // A failed/interrupted request is never silently reissued by "missing".
      if (mode === 'missing' && entry.batches.length) continue;
      entry.prompt = editedPrompt ?? entry.prompt;
      entry.durationSeconds = editedDuration ?? entry.durationSeconds;
      const batchId = randomUUID();
      entry.batches.push({ id: batchId, source: 'api', createdAt: now(), prompt: entry.prompt, durationSeconds: entry.durationSeconds,
        variants: Array.from({ length: 4 }, (_, index) => ({ id: randomUUID(), index: index + 1, status: 'queued', attempt: 0, filename: `${safeKey(key)}_${batchId.slice(0, 8)}_${index + 1}.mp3` })),
      });
    }
  }

  function requestBrowserJobs(body) {
    if (!Array.isArray(body.keys) || !body.keys.length || body.keys.length > sources.size || body.keys.some((key) => !sources.has(key))) throw new UserError('Нужно выбрать существующие звуки из каталога.');
    if ((body.prompt !== undefined || body.durationSeconds !== undefined) && body.keys.length !== 1) throw new UserError('Редактирование промпта и длительности доступно для одного звука.');
    const editedPrompt = body.prompt === undefined ? undefined : validatePrompt(body.prompt);
    const editedDuration = body.durationSeconds === undefined ? undefined : validateDuration(body.durationSeconds);
    if (body.keys.some((key) => (editedPrompt ?? state.entries[key].prompt).length > 450)) throw new UserError('Промпт для сайта ElevenLabs должен быть не длиннее 450 символов.');
    for (const key of new Set(body.keys)) {
      if (state.browserJobs.some((job) => job.key === key && job.status === 'pending')) continue;
      const entry = state.entries[key];
      entry.prompt = editedPrompt ?? entry.prompt;
      entry.durationSeconds = editedDuration ?? entry.durationSeconds;
      state.browserJobs.push({ id: randomUUID(), key, prompt: entry.prompt, durationSeconds: entry.durationSeconds, status: 'pending', createdAt: now() });
    }
  }

  async function importBrowserBatch(body) {
    if (!downloadDir) throw new UserError('Для импорта запустите сервер с --download-dir и путём к папке скачанных аудиофайлов.');
    if (!sources.has(body.key)) throw new UserError('Звук не найден в каталоге.');
    if (!Array.isArray(body.files) || body.files.length !== 4 || body.files.some((file) => typeof file !== 'string' || !path.isAbsolute(file))) throw new UserError('Для импорта нужны четыре абсолютных пути к локальным MP3-файлам.');
    const job = body.jobId ? state.browserJobs.find((item) => item.id === body.jobId && item.key === body.key) : state.browserJobs.find((item) => item.key === body.key && item.status === 'pending');
    if (body.jobId && (!job || job.status !== 'pending')) throw new UserError('Задание браузера не найдено или уже завершено.');
    const entry = state.entries[body.key];
    const prompt = body.prompt === undefined ? (job?.prompt ?? entry.prompt) : validatePrompt(body.prompt);
    if (prompt.length > 450) throw new UserError('Промпт для сайта ElevenLabs должен быть не длиннее 450 символов.');
    const durationSeconds = body.durationSeconds === undefined ? (job?.durationSeconds ?? entry.durationSeconds) : validateDuration(body.durationSeconds);
    if (job && (job.prompt !== prompt || job.durationSeconds !== durationSeconds)) throw new UserError('Промпт или длительность не совпадают с сохранённым заданием браузера.');
    const files = [];
    const seenPaths = new Set();
    for (const sourcePath of body.files) {
      const resolved = await realpath(sourcePath);
      const relative = path.relative(downloadDir, resolved);
      if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new UserError('Импорт разрешён только из настроенной папки скачивания.', 403);
      const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
      if (seenPaths.has(normalized)) throw new UserError('Нужны четыре разных скачанных файла.');
      seenPaths.add(normalized);
      const info = await stat(resolved);
      if (!info.isFile() || info.size < 3 || info.size > MAX_AUDIO_BYTES) throw new UserError('Каждый файл должен быть непустым MP3 размером не более 20 МБ.');
      const audio = await readFile(resolved);
      if (audio.length > MAX_AUDIO_BYTES || !(audio.subarray(0, 3).toString('ascii') === 'ID3' || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0))) throw new UserError('Файл не похож на MP3. Скачайте отдельные MP3-варианты из ElevenLabs.');
      files.push(audio);
    }
    const batchId = randomUUID();
    const batch = { id: batchId, source: 'browser', createdAt: now(), prompt, durationSeconds, variants: [] };
    for (let index = 0; index < files.length; index += 1) {
      const id = randomUUID(), audio = files[index];
      const temporary = path.join(dataDir, 'audio', `${id}.tmp`);
      await writeFile(temporary, audio);
      await rename(temporary, path.join(dataDir, 'audio', `${id}.mp3`));
      batch.variants.push({ id, index: index + 1, status: 'ready', attempt: 1, source: 'browser', completedAt: now(), filename: `${safeKey(body.key)}_${batchId.slice(0, 8)}_${index + 1}.mp3`, byteLength: audio.length, sha256: createHash('sha256').update(audio).digest('hex') });
    }
    entry.batches.push(batch);
    entry.prompt = prompt;
    entry.durationSeconds = durationSeconds;
    if (job) { job.status = 'complete'; job.completedAt = now(); job.batchId = batchId; }
  }

  async function runQueue() {
    while (true) {
      const job = await exclusive(async () => {
        if (closing || workflow !== 'api' || state.paused || !apiKey) return null;
        const next = allVariants().find(({ variant }) => variant.status === 'queued');
        if (!next) return null;
        next.variant.status = 'generating';
        next.variant.startedAt = now();
        next.variant.attempt += 1;
        delete next.variant.error;
        await save(); // Persist the paid request intent before making the request.
        return { ...next, credential: apiKey };
      });
      if (!job) return;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS);
      let result;
      let chargedCredits;
      try {
        const response = await fetchImpl(UPSTREAM, { method: 'POST', headers: { 'xi-api-key': job.credential, 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify({ text: job.batch.prompt, duration_seconds: clampDuration(job.batch.durationSeconds), prompt_influence: 0.3, model_id: MODEL, loop: false }), signal: controller.signal });
        const credits = Number(response.headers.get('character-cost'));
        if (response.headers.has('character-cost') && Number.isFinite(credits) && credits >= 0) chargedCredits = credits;
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          throw new UserError(upstreamError(response.status));
        }
        const audio = await readAudio(response);
        const temporary = path.join(dataDir, 'audio', `${job.variant.id}.tmp`);
        await writeFile(temporary, audio);
        await rename(temporary, path.join(dataDir, 'audio', `${job.variant.id}.mp3`));
        result = { status: 'ready', completedAt: now(), byteLength: audio.length, sha256: createHash('sha256').update(audio).digest('hex') };
      } catch (error) {
        result = { status: 'failed', completedAt: now(), error: error instanceof UserError ? error.message : 'Не удалось завершить запрос или сохранить файл. Результат и списание могут быть неизвестны; очередь приостановлена, автоматического повтора нет.' };
      } finally { clearTimeout(timer); job.credential = ''; }
      if (chargedCredits !== undefined) result.costCredits = chargedCredits;
      await exclusive(async () => {
        Object.assign(job.variant, result);
        if (result.status !== 'ready') { state.paused = true; state.lastError = result.error; }
        await save();
      });
    }
  }
  function kick() {
    if (worker || closing || workflow !== 'api' || state.paused || !apiKey) return;
    worker = Promise.all(Array.from({ length: concurrency }, () => runQueue().catch(async () => {
      await exclusive(async () => {
        state.paused = true;
        state.lastError = 'Не удалось сохранить состояние. Очередь остановлена; перезапустите галерею после проверки диска.';
        await save().catch(() => {});
      });
    }))).finally(() => { worker = null; if (!closing && !state.paused && apiKey && allVariants().some(({ variant }) => variant.status === 'queued')) kick(); });
  }

  async function mutate(route, body) {
    await exclusive(async () => {
      if (closing) throw new UserError('Галерея завершает работу.', 503);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new UserError('Тело запроса должно быть JSON-объектом.');
      if (workflow !== 'api' && ['POST /api/connect', 'POST /api/generate', 'POST /api/retry', 'POST /api/queue'].includes(route)) throw new UserError('Сейчас включён браузерный режим. Для API запустите сервер с --workflow api.');
      if (route === 'POST /api/connect') {
        if (typeof body.apiKey !== 'string' || body.apiKey.length < 8 || body.apiKey.length > 512 || /\s/.test(body.apiKey)) throw new UserError('Введите корректный ключ API ElevenLabs.');
        if (!['none', 'pilot', 'all'].includes(body.startScope)) throw new UserError('Неизвестный объём генерации.');
        await rememberRequest(body.requestId, { route, startScope: body.startScope }, () => {
          if (body.startScope !== 'none') queueEntries([...sources].filter(([, source]) => body.startScope === 'all' || source.pilot).map(([key]) => key), 'missing');
          if (body.startScope !== 'none') state.paused = false;
        });
        apiKey = body.apiKey;
      } else if (route === 'DELETE /api/key') {
        apiKey = ''; state.paused = true;
      } else if (route === 'POST /api/generate') {
        await rememberRequest(body.requestId, { route, keys: body.keys, mode: body.mode, prompt: body.prompt, durationSeconds: body.durationSeconds }, () => {
          queueEntries(body.keys, body.mode, body);
          if (apiKey) { state.paused = false; state.lastError = null; }
        });
      } else if (route === 'POST /api/retry') {
        await rememberRequest(body.requestId, { route, variantId: body.variantId }, () => {
          const found = findVariant(body.variantId);
          if (!found || !['failed', 'interrupted'].includes(found.variant.status)) throw new UserError('Повтор доступен только для неудавшегося или прерванного варианта.');
          const variant = found.variant;
          variant.attempts ??= [];
          variant.attempts.push({ attempt: variant.attempt, status: variant.status, startedAt: variant.startedAt, completedAt: variant.completedAt, error: variant.error, ...(variant.costCredits === undefined ? {} : { costCredits: variant.costCredits }) });
          variant.status = 'queued';
          delete variant.error; delete variant.completedAt; delete variant.costCredits;
          if (apiKey) { state.paused = false; state.lastError = null; }
        });
      } else if (route === 'POST /api/browser-request') {
        await rememberRequest(body.requestId, { route, keys: body.keys, prompt: body.prompt, durationSeconds: body.durationSeconds }, () => requestBrowserJobs(body));
      } else if (route === 'POST /api/import-batch') {
        await rememberRequest(body.requestId, { route, key: body.key, files: body.files, jobId: body.jobId, prompt: body.prompt, durationSeconds: body.durationSeconds }, () => importBrowserBatch(body));
      } else if (route === 'POST /api/queue') {
        if (!['pause', 'resume'].includes(body.action)) throw new UserError('Неизвестное действие с очередью.');
        if (body.action === 'resume' && !apiKey) throw new UserError('Сначала подключите ключ API ElevenLabs.');
        state.paused = body.action === 'pause';
        if (!state.paused) state.lastError = null;
      } else if (route === 'POST /api/select') {
        const entry = state.entries[body.key];
        if (!entry || !sources.has(body.key)) throw new UserError('Звук не найден.');
        if (body.variantId !== null) {
          const found = findVariant(body.variantId);
          if (!found || found.entry !== entry || found.variant.status !== 'ready') throw new UserError('Можно выбрать только готовый вариант этого звука.');
        }
        entry.selectedVariantId = body.variantId;
      } else throw new UserError('Маршрут не найден.', 404);
      await save();
    });
    kick();
    return snapshot();
  }

  const server = http.createServer(async (request, response) => {
    const json = (status, value, extra = {}) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
      response.end(JSON.stringify(value));
    };
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const port = server.address()?.port;
      const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!allowedHosts.includes(request.headers.host)) throw new UserError('Разрешено только локальное подключение.', 403);
      const origin = `http://${request.headers.host}`;
      if (request.headers.origin && request.headers.origin !== origin) throw new UserError('Запрос с другого сайта запрещён.', 403);
      const url = new URL(request.url, origin);
      if (url.origin !== origin || /%(?:2e|2f|5c)/i.test(request.url) || request.url.includes('..') || request.url.includes('\\')) throw new UserError('Некорректный путь.', 400);
      if (['POST', 'DELETE'].includes(request.method)) {
        if (request.headers.origin !== origin) throw new UserError('Для изменения данных нужен локальный Origin.', 403);
        const receivedToken = request.headers['x-workbench-token'];
        if (typeof receivedToken !== 'string' || receivedToken.length !== csrfToken.length || !timingSafeEqual(Buffer.from(receivedToken), Buffer.from(csrfToken))) throw new UserError('Обновите страницу: токен сессии отсутствует или устарел.', 403);
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) throw new UserError('Нужен Content-Type: application/json.', 415);
        let size = 0;
        const chunks = [];
        for await (const chunk of request) {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) throw new UserError('Слишком большой запрос.', 413);
          chunks.push(chunk);
        }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw new UserError('Некорректный JSON.'); }
        json(200, await mutate(`${request.method} ${url.pathname}`, body));
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw new UserError('Метод не поддерживается.', 405);
      if (url.pathname === '/api/state') { json(200, snapshot()); return; }
      if (url.pathname === '/api/browser-jobs') { json(200, { jobs: copy(state.browserJobs.filter((job) => job.status === 'pending')) }); return; }
      if (url.pathname === '/api/export') {
        json(200, exportManifest(), { 'Content-Disposition': 'attachment; filename="selected-audio.json"' }); return;
      }
      const audioMatch = /^\/audio\/([a-f0-9-]+)\.mp3$/.exec(url.pathname);
      if (audioMatch && UUID.test(audioMatch[1])) {
        const found = findVariant(audioMatch[1]);
        if (!found || found.variant.status !== 'ready') throw new UserError('Аудиофайл не найден.', 404);
        const filename = path.join(dataDir, 'audio', `${found.variant.id}.mp3`);
        const { size } = await stat(filename);
        let start = 0, end = size - 1, status = 200;
        const headers = { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': `inline; filename="${found.variant.filename}"` };
        if (request.headers.range) {
          const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
          if (!range || (!range[1] && !range[2])) { json(416, { error: 'Некорректный диапазон.' }, { 'Content-Range': `bytes */${size}` }); return; }
          if (!range[1]) start = Math.max(0, size - Number(range[2]));
          else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
          if (start > end || start >= size || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) { json(416, { error: 'Диапазон вне файла.' }, { 'Content-Range': `bytes */${size}` }); return; }
          status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
        }
        headers['Content-Length'] = end - start + 1;
        response.writeHead(status, headers);
        if (request.method === 'HEAD') response.end();
        else createReadStream(filename, { start, end }).on('error', () => response.destroy()).pipe(response);
        return;
      }
      const asset = STATIC.get(url.pathname);
      if (!asset) throw new UserError('Страница не найдена.', 404);
      const content = await readFile(path.join(HERE, 'public', asset[0]));
      response.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-cache', 'Content-Length': content.length });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!response.headersSent) json(error instanceof UserError ? error.status : 500, { error: error instanceof UserError ? error.message : 'Локальная ошибка чтения или сохранения. Проверьте доступность папки галереи.' });
      else response.destroy();
    }
  });
  server.requestTimeout = 15_000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 4317, '127.0.0.1', resolve); });
  const address = `http://127.0.0.1:${server.address().port}`;
  return {
    server, address,
    workbench: { snapshot, exportManifest, async waitForIdle() { while (worker) await worker; await mutex; } },
    async close() {
      closing = true;
      await exclusive(async () => { state.paused = true; await save(); });
      if (worker) await worker;
      apiKey = '';
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await releaseLock();
    },
  };
  } catch (error) { await releaseLock(); throw error; }
}

async function main() {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!value || !['--port', '--data-dir', '--catalog', '--workflow', '--download-dir', '--concurrency'].includes(flag)) throw new Error('Параметры: --port 4317 --data-dir outputs/audio-workbench --catalog путь/к/prompts.json --workflow browser|api --download-dir папка --concurrency 1|2');
    if (flag === '--port') { options.port = Number(value); if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('Некорректный порт.'); }
    if (flag === '--data-dir') options.dataDir = value;
    if (flag === '--catalog') options.catalogPath = value;
    if (flag === '--workflow') options.workflow = value;
    if (flag === '--download-dir') options.downloadDir = value;
    if (flag === '--concurrency') options.concurrency = Number(value);
  }
  const app = await createWorkbenchServer(options);
  console.log(`Аудиогалерея: ${app.address}`);
  console.log(`Файлы и выбор: ${path.resolve(options.dataDir ?? 'outputs/audio-workbench')}`);
  console.log(options.workflow === 'api' ? 'Очередь на паузе. Подключите ключ в галерее и выберите звуки для генерации.' : 'Браузерный режим: задания сохраняются для выполнения через открытую сессию ElevenLabs.');
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; console.log('Завершение текущего запроса и сохранение очереди…'); await app.close(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Не удалось запустить аудиогалерею. Проверьте каталог, порт и доступ к папке данных.'); process.exitCode = 1; });
}
