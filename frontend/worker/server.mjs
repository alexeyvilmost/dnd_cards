import {createServer} from 'node:http';
import {createHash, timingSafeEqual, randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {compactWorkerMirrors,MIRROR_WIRE} from './mirrors.mjs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const hashOf = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const require = createRequire(import.meta.url);

// Archived combat artifacts throw `${CommandRejectionCode}: ${details}`. Only
// the code crosses the diagnostic boundary; details can contain private state.
const commandRejectionCodes = new Set([
  'ActorNotFound', 'ActorDead', 'WorldObjectNotFound', 'CardNotFound', 'ItemNotOwned', 'NotArmor',
  'ActionNotGranted', 'FeatureNotGranted', 'ActionNotFound', 'InvalidActionDefinition',
  'HazardNotFound', 'InvalidHazardDefinition', 'HideNotEligible', 'InvalidFacts', 'CapabilityDenied',
  'InvalidSpellDeclaration', 'DuplicateCommand', 'InsufficientResources', 'InvalidDecision',
  'InvalidCommandId', 'InvalidActionTiming', 'InvalidInitiative', 'InvalidTargets', 'TargetNotWilling',
  'TargetArmored', 'InvalidEquipmentState', 'AttackActionNotFound', 'AttackActionClosed',
  'AttackActionBlocked', 'WeaponNotEquipped', 'NotWeapon', 'GrappleNotFound', 'NoFreeGraspingPart',
  'TargetTooLarge', 'MissingSpatialFacts', 'OutOfRange', 'LineOfSightBlocked', 'IllegalRelation',
  'NotActorsTurn', 'NoPendingResolution', 'ResolutionInProgress', 'StaleDecision',
  'TurnAlreadyStarted', 'TurnNotStarted', 'RulesetMismatch', 'StaleRevision',
]);

function commandRejectionCode(error) {
  if (typeof error?.message !== 'string') return undefined;
  const code = /^([A-Za-z]+): /.exec(error.message)?.[1];
  return commandRejectionCodes.has(code) ? code : undefined;
}

// Compatibility with errors predating structured rule codes. This mirrors the
// API's bounded legacy allowlist; unknown exception messages stay private here
// as well as at the public API boundary.
const legacyPlayerErrors = new Set([
  'Неизвестная команда боя', 'Карта столкновения отсутствует',
  'Нет карты, вмещающей всех участников и их размеры', 'Некорректное зерно карты',
  'Некорректный состав столкновения', 'Некорректный участник столкновения', 'Некорректная группа',
  'Слишком много противников', 'Несовместимая версия каталога', 'Несовместимая версия каталога боя',
  'Несовместимая версия правил боя', 'Некорректная ревизия персонажа', 'Чужой персонаж в снимке боя',
  'Повреждён поток случайности боя', 'Неполный каталог искусностей оружия',
  'Каталог требует явный тип эффекта', 'Сначала завершите текущее решение или дождитесь своего хода',
  'Сначала завершите текущее решение', 'Бой уже завершён', 'Цель вне дальности',
  'Недостаточно перемещения', 'До клетки нет доступного маршрута с оставшимся перемещением',
  'Прыжок превышает доступную дистанцию', 'Для прыжка нужно встать',
  'Способность доступна только после соответствующего события', 'Сейчас ход другого участника',
  'Выберите свободную клетку', 'Выберите клетку на поле', 'Центр области вне дальности',
  'Центр области закрыт полным укрытием', 'Сначала завершите открытую реакцию на бросок к20',
  'Сначала завершите дополнительное перемещение', 'Ресурсы для этой реакции больше недоступны',
  'Укажите действие влияния на бросок', 'Выбранное влияние больше недоступно',
  'Проверка уже завершена', 'Воздействие недоступно', 'Нет ожидающей проверки', 'Событие требует решения',
]);
const legacyCatalogError = /^(Каталог не содержит |Неоднозначная ссылка каталога: )(race|class|background|feat|effect|action|spell|card|resource)\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

function legacyPlayerError(error) {
  const message = error?.message;
  return typeof message === 'string' && (legacyPlayerErrors.has(message) || legacyCatalogError.test(message))
    ? message : undefined;
}

// Independent of executable artifact versions, so archived workers also get a
// verifiable journal. Normalize objects while preserving array order.
export function snapshotHash(value) {
  const normalize = item => Array.isArray(item) ? item.map(normalize)
    : item && typeof item === 'object'
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, normalize(item[key])])) : item;
  return hashOf(JSON.stringify(normalize(value)));
}

export async function loadWorkerBuildIdentity(file) {
  try {return JSON.parse(await readFile(file, 'utf8'));}
  catch (error) {if (error.code === 'ENOENT') return undefined; throw error;}
}

// One wrapper owns these references. The injected reader permits a deterministic
// shutdown-during-I/O test; production always uses the filesystem reader.
export function createArtifactCache({artifactsDirectory, maxCachedArtifacts = 4, read = readFile}) {
  if (!Number.isSafeInteger(maxCachedArtifacts) || maxCachedArtifacts < 1 || maxCachedArtifacts > 64) throw Error('Invalid worker artifact cache limit');
  const cache = new Map();
  const loading = new Map();
  let closed = false;
  const artifactPath = hash => path.join(artifactsDirectory, `${hash.slice(7)}.cjs`);
  function forget(hash) {
    const file = artifactPath(hash), loaded = require.cache[file];
    cache.delete(hash);
    // These are self-contained CJS bundles. Both Node's cache and its parent
    // module retain exports. An in-flight executor keeps its own reference.
    if (loaded?.parent) loaded.parent.children = loaded.parent.children.filter(child => child !== loaded);
    delete require.cache[file];
  }
  async function load(hash) {
    if (closed) throw Error('Worker cache is closed');
    if (!/^sha256:[a-f0-9]{64}$/.test(hash)) throw Error('Invalid artifact hash');
    if (!cache.has(hash)) {
      if (!loading.has(hash)) {
        const pending = (async () => {
          const file = artifactPath(hash), bytes = await read(file);
          // close may run while the asynchronous filesystem read is pending.
          if (closed) throw Error('Worker cache is closed');
          if (hashOf(bytes) !== hash) throw Error('Artifact hash mismatch');
          const artifact = require(file);
          cache.set(hash, artifact);
          return artifact;
        })().finally(() => loading.delete(hash));
        loading.set(hash, pending);
      }
      const artifact = await loading.get(hash);
      // Other artifact loads may evict this pin while a caller resumes. Its
      // local reference remains valid; reinsertion obeys the same LRU bound.
      if (closed) throw Error('Worker cache is closed');
      cache.set(hash, artifact);
    }
    const artifact = cache.get(hash);
    cache.delete(hash); cache.set(hash, artifact);
    while (cache.size > maxCachedArtifacts) forget(cache.keys().next().value);
    return artifact;
  }
  return {load, has: hash => cache.has(hash), close() {closed = true; for (const hash of cache.keys()) forget(hash);}};
}

export async function createRulesWorker({artifactFile, artifactsDirectory, token, buildIdentity,
  releaseCommit = '', releaseId = '', performanceEnabled = false, maxCachedArtifacts = 4}) {
  if (typeof token !== 'string' || token.length < 32) throw Error('Worker token must contain at least 32 characters');
  if (!Number.isSafeInteger(maxCachedArtifacts) || maxCachedArtifacts < 1 || maxCachedArtifacts > 64) throw Error('Invalid worker artifact cache limit');
  const current = await readFile(artifactFile);
  const artifactHash = hashOf(current);
  const identity = {identitySchemaVersion: 1, component: 'rulesWorker', provenance: 'unverified', sourceCommit: null,
    source_commit: null, inputFingerprint: null, apiProtocolVersion: 1, workerProtocolVersion: 1,
    supportedWorldSchemaVersions: [5], capabilities: ['pinned-artifact-routing', 'pending-decision-pass-through'],
    workerRuntime: {name: 'node', version: process.versions.node}};
  if (buildIdentity) {
    for (const field of ['identitySchemaVersion', 'component', 'apiProtocolVersion', 'workerProtocolVersion',
      'supportedWorldSchemaVersions', 'capabilities', 'workerRuntime']) {
      if (JSON.stringify(buildIdentity[field]) !== JSON.stringify(identity[field])) throw Error(`Invalid worker build identity: ${field}`);
    }
    if (buildIdentity.artifactHash !== artifactHash) throw Error('Worker build artifact identity mismatch');
    if (buildIdentity.provenance === 'baked') {
      if (!/^[a-f0-9]{40}$/.test(buildIdentity.sourceCommit) || !/^sha256:[a-f0-9]{64}$/.test(buildIdentity.inputFingerprint)
        || buildIdentity.source_commit !== buildIdentity.sourceCommit) throw Error('Invalid worker baked provenance');
      Object.assign(identity, {provenance: 'baked', sourceCommit: buildIdentity.sourceCommit,
        source_commit: buildIdentity.sourceCommit, inputFingerprint: buildIdentity.inputFingerprint});
    } else if (buildIdentity.provenance !== 'unverified' || buildIdentity.sourceCommit !== null
      || buildIdentity.source_commit !== null || buildIdentity.inputFingerprint !== null) throw Error('Invalid worker provenance');
  }
  Object.assign(identity, {artifactHash,
    releaseCommit: /^[a-f0-9]{40}$/.test(releaseCommit) ? releaseCommit : '',
    releaseId: /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(releaseId) ? releaseId : ''});
  await mkdir(artifactsDirectory, {recursive: true});
  const artifactPath = hash => path.join(artifactsDirectory, `${hash.slice(7)}.cjs`);
  try {await writeFile(artifactPath(artifactHash), current, {flag: 'wx', mode: 0o600});}
  catch (error) {if (error.code !== 'EEXIST') throw error;}
  if (hashOf(await readFile(artifactPath(artifactHash))) !== artifactHash) throw Error('Existing artifact is corrupt');
  const cache = createArtifactCache({artifactsDirectory, maxCachedArtifacts});
  const expectedAuth = Buffer.from(`Bearer ${token}`);
  const server = createServer(async (request, response) => {
    // Timings begin when Node invokes this callback. They cannot measure time
    // waiting for this process's event loop before the callback was scheduled.
    const requestId = /^[A-Za-z0-9_.-]{1,128}$/.test(request.headers['x-request-id'] || '')
      ? request.headers['x-request-id'] : randomUUID();
    const measured = performanceEnabled && request.headers['x-performance-trace'] === '1';
    const started = measured ? performance.now() : 0;
    const cpuStarted = measured ? process.cpuUsage() : undefined;
    const metrics = {};
    const record = (name, start) => {if (measured) metrics[name] = (metrics[name] ?? 0) + performance.now() - start;};
    const timed = (name, work) => {
      if (!measured) return work();
      const start = performance.now();
      try {return work();} finally {record(name, start);}
    };
    const timedAsync = async (name, work) => {
      if (!measured) return work();
      const start = performance.now();
      try {return await work();} finally {record(name, start);}
    };
    const send = (status, value) => {
      if(status===200&&request.headers['x-rules-wire']===MIRROR_WIRE){
        value=timed('worker_mirror_compact_ms',()=>compactWorkerMirrors(value));
      }
      const serialized = timed('worker_stringify_ms', () => JSON.stringify(value));
      const headers = {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Request-ID': requestId};
      if (measured) {
        metrics.worker_callback_to_send_ms = performance.now() - started;
        const cpu = process.cpuUsage(cpuStarted);
        // Process-wide CPU delta may include overlapping work; never label it
        // exclusive request CPU, remote queue time, or network round trip.
        metrics.worker_process_cpu_ms = (cpu.user + cpu.system) / 1000;
        metrics.worker_response_bytes = Buffer.byteLength(serialized);
        headers['X-Rules-Performance'] = JSON.stringify(Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, Math.round(value * 1000) / 1000])));
      }
      response.writeHead(status, headers); response.end(serialized);
    };
    if (request.method === 'GET' && request.url === '/health') return send(200, {status: 'ok', ...identity});
    const suppliedAuth = Buffer.from(request.headers.authorization || '');
    if (suppliedAuth.length !== expectedAuth.length || !timingSafeEqual(suppliedAuth, expectedAuth)) return send(401, {error: 'unauthorized'});
    if (request.method !== 'POST' || !['/initialize', '/transition', '/upgrade', '/rest', '/camp-action', '/camp-inventory', '/equipment', '/initiative-options', '/journey-check', '/journey-effect'].includes(request.url)) return send(404, {error: 'not_found'});
    try {
      let size = 0;
      const chunks = [];
      const readStarted = measured ? performance.now() : 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 16 * 1024 * 1024) {send(413, {error: 'request_too_large'}); return;}
        chunks.push(chunk);
      }
      record('worker_body_read_ms', readStarted);
      if (measured) metrics.worker_request_bytes = size;
      const body = timed('worker_parse_ms', () => JSON.parse(Buffer.concat(chunks).toString('utf8')));
      const hash = body.artifactHash || artifactHash;
      if (measured) metrics.worker_artifact_cache_hit = Number(cache.has(hash));
      const artifact = await timedAsync('worker_artifact_load_ms', () => cache.load(hash));
      if (request.url === '/upgrade') {
        // Retain and verify the old executable too. The caller cannot choose a
        // target version: only this server's verified current artifact is used.
        if (body.envelope?.artifactHash !== hash) throw new Error('Несовместимая версия правил боя');
        if (hash === artifactHash) return send(409, {error: 'rules_already_current'});
        const current = await timedAsync('worker_artifact_load_ms', () => cache.load(artifactHash));
        if (typeof current.upgradeRoguelikeCombatRules !== 'function') return send(409, {error: 'upgrade_unavailable'});
        const result = timed('worker_execute_ms', () => current.upgradeRoguelikeCombatRules(body.envelope, artifactHash));
        return send(200, {...result, artifactHash,
          trace: {beforeHash: snapshotHash(body.envelope), afterHash: snapshotHash(result.envelope), runtimeRevision: body.envelope.state.runtimeRevision}});
      }
      if (request.url === '/initiative-options') {
        if (typeof artifact.prepareInitiativeOptions !== 'function') return send(409, {error: 'initiative_options_unavailable'});
        const result = await timedAsync('worker_execute_ms', () => artifact.prepareInitiativeOptions(body.input));
        return send(200, {...result, artifactHash: hash});
      }
      if (request.url === '/equipment') {
        if (typeof artifact.executeEquipmentIntent !== 'function') return send(409, {error: 'equipment_intent_unavailable'});
        const result = await timedAsync('worker_execute_ms', () => artifact.executeEquipmentIntent(body.input));
        return send(200, {...result, artifactHash: hash});
      }
      if (request.url === '/journey-check' || request.url === '/journey-effect') {
        const result=await timedAsync('worker_execute_ms', () => artifact[request.url==='/journey-check'?'executeJourneyCheck':'executeJourneyEffect'](body.input));
        return send(200,{...result,artifactHash:hash});
      }
      if (request.url === '/camp-action') {
        const result = await timedAsync('worker_execute_ms', () => artifact.executeRoguelikeCampAction(body.input));
        return send(200, {...result, artifactHash: hash});
      }
      if (request.url === '/camp-inventory') {
        const result = await timedAsync('worker_execute_ms', () => artifact.projectRoguelikeCampInventory(body.input));
        return send(200, {...result, artifactHash: hash});
      }
      if (request.url === '/rest') {
        const result = await timedAsync('worker_execute_ms', () => artifact.executeRoguelikeCampRest(body.input));
        return send(200, {...result, artifactHash: hash});
      }
      if (request.url === '/initialize') {
        const result = await timedAsync('worker_execute_ms', () => artifact.initializeRoguelikeCombat(body.input, hash));
        if (result.status !== 'ready') return send(200, result);
        const projected = timed('worker_project_ms', () => body.input.characters?.length > 1
          ? artifact.projectRoguelikePartyCombatPatch(result.envelope, body.input.characters)
          : artifact.projectRoguelikeCombatPatch(result.envelope, body.input.character));
        return send(200, {...result, ...projected,
          trace: {beforeHash: '', afterHash: timed('worker_snapshot_hash_ms', () => snapshotHash(projected.envelope)), runtimeRevision: projected.patch.runtime_revision}});
      }
      const result = timed('worker_execute_ms', () => artifact.stepRoguelikeCombat(body.envelope, body.intent, hash));
      const projected = timed('worker_project_ms', () => body.characters?.length > 1
        ? artifact.projectRoguelikePartyCombatPatch(result.envelope, body.characters)
        : artifact.projectRoguelikeCombatPatch(result.envelope, body.character));
      return send(200, {...result, ...projected,
        trace: {beforeHash: timed('worker_snapshot_hash_ms', () => snapshotHash(body.envelope)), afterHash: timed('worker_snapshot_hash_ms', () => snapshotHash(projected.envelope)), runtimeRevision: projected.patch.runtime_revision}});
    } catch (error) {
      // No request or snapshot logging: the envelope contains private entropy.
      const missing = error.code === 'ENOENT';
      const rejectionCode = missing ? undefined : commandRejectionCode(error);
      send(missing ? 409 : 422, {error: missing ? 'artifact_unavailable' : 'invalid_combat_command',
        ...(rejectionCode ? {rejectionCode} : {message: missing ? 'Pinned rules artifact unavailable' : legacyPlayerError(error)})});
    }
  });
  server.once('close', () => cache.close());
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createRulesWorker({
    artifactFile: process.env.RULES_ARTIFACT_FILE || new URL('./artifact.cjs', import.meta.url),
    artifactsDirectory: process.env.RULES_ARTIFACTS_DIR || '/artifacts',
    token: process.env.RULES_WORKER_TOKEN,
    buildIdentity: await loadWorkerBuildIdentity(new URL('./component-identity.json', import.meta.url)),
    releaseCommit: process.env.RELEASE_COMMIT, releaseId: process.env.RELEASE_ID,
    performanceEnabled: process.env.RULES_PERFORMANCE_ENABLED === '1',
    maxCachedArtifacts: Number(process.env.RULES_WORKER_MAX_CACHED_ARTIFACTS || 4),
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.listen(Number(process.env.PORT || 8090), process.env.LISTEN_HOST || '0.0.0.0');
}
