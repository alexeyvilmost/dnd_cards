#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {createWriteStream, existsSync} from 'node:fs';
import {mkdir, readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {randomBytes, createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertRunId, assertLocalOrigin, assertTestDsn, assertOwnedPath, assertRealOwnedPath, localFetch} from './guards.mjs';
import {repositoryRoot, runsRoot, cleanEnvironment, execute, resolveTool, freePort, writeRegistry, readRegistry} from './runtime.mjs';
import {startNativePostgres, stopNativePostgres} from './postgres.mjs';
import {legacyBootstrapSQL, newAccounts, seedAccounts, seedCanonicalTemplates} from './fixtures.mjs';
import {startTestUI} from './ui-server.mjs';
import {snapshotTestUI} from './ui-snapshot.mjs';
import {seedPre083Catalog} from './catalog-baseline.mjs';
import {restoreCatalogSnapshot} from './catalog-snapshot.mjs';
import {restoreIntegrationBaseline} from './integration-baseline.mjs';
import {restoreOwnedSnapshot} from '../release/native-backup.mjs';

export async function waitReady(origin, resource, validate = () => true, timeout = 90_000, alive = () => true) {
  assertLocalOrigin(origin);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!alive()) throw new Error('Local service exited before readiness; inspect its run log');
    try {
      const response = await localFetch(origin, resource, {signal: AbortSignal.timeout(1000)});
      if (response.ok && await validate(response)) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Local readiness timeout: ${resource}`);
}
export async function startTestStack({dbOnly = false, pgBin = process.env.TEST_PG_BIN, go = process.env.TEST_GO, reuseBuild = false, isolatedBuild = false, reactProfile = false, catalogSnapshot, recoverySnapshot, recoveryWorkerArtifact, profile = 'fresh', performance: performanceEnabled = false, catalogBatch = false, catalogPrefetch = false, equipmentIntent = false, initiativeOptions = false, workerMirrors = false, preparationCache = false, compactReceipts = false, frozenCatalogs = false} = {}) {
  if (!['fresh', 'integration'].includes(profile) || catalogSnapshot && profile !== 'fresh') throw new Error('Choose fresh, integration, or one explicit catalog snapshot; profiles cannot be combined');
  if (recoverySnapshot && (catalogSnapshot || profile !== 'fresh' || dbOnly) || recoveryWorkerArtifact && !recoverySnapshot) throw Error('Owned recovery cannot be combined with another bootstrap profile');
  const runId = assertRunId(`test_${randomBytes(12).toString('hex')}`);
  const registry = {version: 1, runId, directory: assertOwnedPath(runsRoot, path.join(runsRoot, runId)), status: 'starting',
    createdAt: new Date().toISOString(), performanceEnabled: Boolean(performanceEnabled), ports: {}, processes: [], fixture: null};
  await mkdir(registry.directory, {recursive: true});
  const children = [], servers = [];
  let database, cleanupPromise;
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error('Local test stack interrupted'));
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const cleanup = () => cleanupPromise ??= (async () => {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    controller.abort();
    const errors = [];
    for (const server of servers.reverse()) {server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve));}
    for (const child of children.reverse()) {
      if (child.exitCode !== null) continue;
      const stopped = new Promise(resolve => child.once('close', resolve));
      child.kill();
      await Promise.race([stopped, new Promise(resolve => setTimeout(resolve, 5000))]);
      if (child.exitCode === null && child.signalCode === null) errors.push('A local service did not terminate');
    }
    try { await stopNativePostgres(registry); } catch (error) {errors.push(error.message);}
    registry.status = errors.length ? 'cleanup_failed' : 'stopped'; registry.stoppedAt = new Date().toISOString(); registry.cleanupErrors = errors;
    await writeRegistry(registry);
    if (errors.length) throw new Error(errors.join('; '));
  })();
  const startProcess = async (name, executable, args, env) => {
    const log = createWriteStream(path.join(registry.directory, `${name}.log`));
    const child = spawn(executable, args, {cwd: registry.directory, env, windowsHide: true, signal: controller.signal, stdio: ['ignore', 'pipe', 'pipe']});
    child.stdout.pipe(log); child.stderr.pipe(log); child.on('close', () => log.end());
    await new Promise((resolve, reject) => {child.once('spawn', resolve); child.once('error', reject);});
    children.push(child); registry.processes.push({name, pid: child.pid}); await writeRegistry(registry); return child;
  };
  try {
    registry.ports.database = await freePort();
    await writeRegistry(registry);
    database = await startNativePostgres(registry, {pgBin, signal: controller.signal});
    const env = cleanEnvironment({CANONICAL_RUNTIME_TEST_DSN: database.dsn, CONTENT_MIGRATION_TEST_DSN: database.dsn,
      TEST_RUN_ID: runId, TEST_RUN_DIRECTORY: registry.directory, TEST_DATABASE_URL: database.dsn});
    if (dbOnly) {
      registry.status = 'ready'; await writeRegistry(registry);
      return {registry, env, database, cleanup, signal: controller.signal};
    }
    if (recoverySnapshot) registry.fixture = await restoreOwnedSnapshot(database, registry, recoverySnapshot);
    else if (catalogSnapshot) registry.fixture = await restoreCatalogSnapshot(database, registry, catalogSnapshot);
    else if (profile === 'integration') registry.fixture = await restoreIntegrationBaseline(database, registry);
    else {
      const bootstrap = await legacyBootstrapSQL();
      await database.query(bootstrap.sql);
      registry.fixture = {profile: 'fresh-legacy-bootstrap', hash: bootstrap.hash, sources: bootstrap.sources};
    }
    const frontend = path.join(repositoryRoot, 'frontend');
    const backendBinary = path.join(registry.directory, process.platform === 'win32' ? 'backend.exe' : 'backend');
    await execute(resolveTool('go', go), ['build', '-o', backendBinary, '.'], {cwd: path.join(repositoryRoot, 'backend'), log: path.join(registry.directory, 'build-backend.log'), signal: controller.signal});
    const workerOutput = isolatedBuild ? path.join(registry.directory, 'worker-build') : path.join(frontend, 'worker/dist');
    await execute(process.execPath, ['worker/build.mjs', ...(isolatedBuild ? ['--out-dir', workerOutput] : [])], {cwd: frontend, log: path.join(registry.directory, 'build-worker.log'), signal: controller.signal});
    const index = path.join(frontend, 'dist/index.html');
    let uiSource = isolatedBuild ? path.join(registry.directory, 'ui-build') : path.join(frontend, 'dist');
    if (isolatedBuild) {
      // Each shard writes only below its registry, including TypeScript's cache.
      await execute(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], {cwd: frontend, log: path.join(registry.directory, 'build-ui.log'), signal: controller.signal});
      await execute(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.node.json', '--noEmit', '--composite', 'false'], {cwd: frontend, log: path.join(registry.directory, 'build-ui.log'), signal: controller.signal});
      await execute(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.config.ts', '--outDir', uiSource], {cwd: frontend, log: path.join(registry.directory, 'build-ui.log'), signal: controller.signal});
    } else if (!reuseBuild || !existsSync(index)) {
      await execute(process.execPath, ['node_modules/typescript/bin/tsc', '-b'], {cwd: frontend, log: path.join(registry.directory, 'build-ui.log'), signal: controller.signal});
      await execute(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {cwd: frontend, log: path.join(registry.directory, 'build-ui.log'), signal: controller.signal});
    }
    if (reactProfile) {
      uiSource = path.join(registry.directory, 'profiling-build');
      await execute(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.performance.config.ts', '--outDir', uiSource],
        {cwd: frontend, log: path.join(registry.directory, 'build-ui-profile.log'), signal: controller.signal});
    }
    registry.uiBuild = {reused: reuseBuild && !isolatedBuild && !reactProfile, isolatedBuild, reactProfile, ...await snapshotTestUI(uiSource, registry)};
    const workerToken = randomBytes(32).toString('hex'), jwtSecret = randomBytes(32).toString('hex');
    const accounts = newAccounts();
    for (const service of ['worker', 'api', 'ui', 'outbound']) registry.ports[service] = await freePort();
    registry.origins = Object.fromEntries(['worker', 'api', 'ui', 'outbound'].map(name => [name, `http://127.0.0.1:${registry.ports[name]}`]));
    // This proxy rejects external HTTP/HTTPS without contacting the target.
    const deny = createServer((_req, res) => {res.writeHead(503); res.end('External calls are disabled in local tests');});
    deny.on('connect', (_req, socket) => socket.end('HTTP/1.1 503 Local test egress disabled\r\n\r\n'));
    await new Promise(resolve => deny.listen(registry.ports.outbound, '127.0.0.1', resolve)); servers.push(deny);
    const artifactFile = recoveryWorkerArtifact ? await assertRealOwnedPath(runsRoot, recoveryWorkerArtifact) : path.join(workerOutput, 'artifact.cjs');
    const artifactHash = `sha256:${createHash('sha256').update(await readFile(artifactFile)).digest('hex')}`;
    const worker = await startProcess('worker', process.execPath, [path.join(frontend, 'worker/server.mjs')], cleanEnvironment({PORT: String(registry.ports.worker), LISTEN_HOST: '127.0.0.1', RULES_WORKER_TOKEN: workerToken, RULES_ARTIFACT_FILE: artifactFile, RULES_ARTIFACTS_DIR: path.join(registry.directory, 'rules-artifacts'), SOURCE_COMMIT: 'local-test', ...(performanceEnabled ? {RULES_PERFORMANCE_ENABLED: '1'} : {})}));
    await waitReady(registry.origins.worker, '/health', async response => (await response.json()).artifactHash === artifactHash, 30_000, () => worker.exitCode === null);
    registry.artifactHash = artifactHash;
    const backendEnv = cleanEnvironment({DATABASE_URL: database.dsn, PORT: String(registry.ports.api), LISTEN_HOST: '127.0.0.1', JWT_SECRET: jwtSecret, DB_COMPACT_RECEIPTS: compactReceipts ? '1' : '0', DB_FROZEN_CATALOGS: frozenCatalogs ? '1' : '0',
      RULES_WORKER_URL: registry.origins.worker, RULES_WORKER_TOKEN: workerToken, CONTENT_ADMIN_USER_IDS: accounts.admin.id,
      CORS_ALLOWED_ORIGINS: registry.origins.ui, OPENAI_API_KEY: '', OPENAI_BASE_URL: `${registry.origins.outbound}/v1`, HTTPS_PROXY: registry.origins.outbound, HTTP_PROXY: registry.origins.outbound,
      NO_PROXY: '127.0.0.1,localhost,::1', SOURCE_COMMIT: 'local-test', GIN_MODE: 'release', RULES_CATALOG_BATCH_ENABLED: catalogBatch ? '1' : '0', RULES_CATALOG_PREFETCH_ENABLED: catalogPrefetch ? '1' : '0', RULES_EQUIPMENT_INTENT_ENABLED: equipmentIntent ? '1' : '0', RULES_INITIATIVE_OPTIONS_ENABLED: initiativeOptions ? '1' : '0', RULES_WORKER_MIRRORS_ENABLED: workerMirrors ? '1' : '0', RULES_PREPARATION_CACHE_ENABLED: preparationCache ? '1' : '0', ...(performanceEnabled ? {RULES_PERFORMANCE_ENABLED: '1'} : {})});
    let api = await startProcess('backend-schema', backendBinary, [], backendEnv);
    try {
      await waitReady(registry.origins.api, '/api/health', async response => (await response.json()).status === 'ok', 120_000, () => api.exitCode === null);
    } catch (error) {
      const log = await readFile(path.join(registry.directory, 'backend-schema.log'), 'utf8');
      if (profile !== 'fresh' || catalogSnapshot || recoverySnapshot || api.exitCode === null || !log.includes('failed to run migration 083_certify_micro_micro_content: expected one classes:CLASS-warrior row, updated 0')) throw error;
      registry.fixture.catalogBaseline = await seedPre083Catalog(database);
      await writeRegistry(registry);
      api = await startProcess('backend', backendBinary, [], backendEnv);
      await waitReady(registry.origins.api, '/api/health', async response => (await response.json()).status === 'ok', 120_000, () => api.exitCode === null);
    }
    if (!recoverySnapshot) registry.fixture.templates = await seedCanonicalTemplates(database);
    await seedAccounts(database, accounts);
    // Bulk-restored fixtures need planner statistics before any scenario.
    // Waiting for autovacuum made equivalent fresh runs take different plans.
    await database.query('ANALYZE;');
    registry.fixture.statistics = 'analyzed-after-seed';
    registry.accounts = Object.fromEntries(Object.entries(accounts).map(([role, account]) => [role, {id: account.id}]));
    for (const account of Object.values(accounts)) {
      const response = await localFetch(registry.origins.api, '/api/auth/login', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({username: account.username, password: account.password})});
      if (!response.ok) throw new Error('Seeded local test account cannot log in');
    }
    const ui = await startTestUI({root: registry.uiBuild.directory, apiOrigin: registry.origins.api, port: registry.ports.ui, cacheAssets: performanceEnabled}); servers.push(ui);
    await waitReady(registry.origins.ui, '/', async response => (await response.text()).includes('<html'));
    await waitReady(registry.origins.ui, '/api/health');
    Object.assign(env, {TEST_API_ORIGIN: registry.origins.api, TEST_UI_ORIGIN: registry.origins.ui, TEST_WORKER_ORIGIN: registry.origins.worker, TEST_WORKER_TOKEN: workerToken,
      ...(isolatedBuild ? {TEST_WORKER_BUILD_DIRECTORY: workerOutput} : {}),
      TEST_USERNAME: accounts.player.username, TEST_PASSWORD: accounts.player.password, TEST_ADMIN_USERNAME: accounts.admin.username, TEST_ADMIN_PASSWORD: accounts.admin.password,
      TEST_PEER_USERNAME: accounts.peer.username, TEST_PEER_PASSWORD: accounts.peer.password});
    registry.status = 'ready'; await writeRegistry(registry);
    return {registry, env, database, accounts, cleanup, signal: controller.signal};
  } catch (error) {
    registry.failure = error.message;
    try {await cleanup();} catch (cleanupError) {error.message += `; ${cleanupError.message}`;}
    throw Object.assign(error, {runDirectory: registry.directory});
  }
}

export async function recoverDatabase(directory) {
  await assertRealOwnedPath(runsRoot, directory);
  const registry = await readRegistry(directory); assertRunId(registry.runId);
  if (path.basename(directory) !== registry.runId || path.resolve(registry.directory) !== path.resolve(directory)) throw new Error('Registry ownership mismatch');
  // Never terminate saved arbitrary PIDs: after a crash they may have been reused.
  await stopNativePostgres(registry);
  registry.status = 'database_recovered'; await writeRegistry(registry);
}
async function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'recover-db') {await recoverDatabase(path.resolve(args[1])); return;}
  const separator = args.indexOf('--');
  const options = separator < 0 ? args : args.slice(0, separator);
  const snapshotIndex = options.indexOf('--catalog-snapshot');
  const catalogSnapshot = snapshotIndex < 0 ? undefined : options[snapshotIndex + 1];
  if (snapshotIndex >= 0 && !catalogSnapshot) throw new Error('--catalog-snapshot requires an absolute local dump path');
  const profileIndex = options.indexOf('--profile');
  const profile = profileIndex < 0 ? 'fresh' : options[profileIndex + 1];
  const flags = options.filter((_, index) => !(snapshotIndex >= 0 && [snapshotIndex, snapshotIndex + 1].includes(index)) && !(profileIndex >= 0 && [profileIndex, profileIndex + 1].includes(index)));
  if (flags.some(option => !['--db-only', '--reuse-ui-build', '--performance'].includes(option))) throw new Error('Usage: stack.mjs [--db-only] [--profile fresh|integration] [--reuse-ui-build] [--performance] [--catalog-snapshot absolute.dump] [-- executable args...]');
  const stack = await startTestStack({dbOnly: options.includes('--db-only'), reuseBuild: options.includes('--reuse-ui-build'), catalogSnapshot, profile, performance: options.includes('--performance')});
  const onSignal = async () => {try {await stack.cleanup();} finally {process.exitCode = 130;}};
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  try {
    process.stdout.write(`Local test stack ready: ${stack.registry.directory}\n`);
    if (separator >= 0) {
      const [command, ...commandArgs] = args.slice(separator + 1);
      if (!command) throw new Error('Expected a command after --');
      await execute(command, commandArgs, {env: stack.env, log: path.join(stack.registry.directory, 'command.log'), timeout: 3_600_000, signal: stack.signal});
    } else {
      assertTestDsn(stack.env.TEST_DATABASE_URL, stack.registry);
      await stack.database.query('SELECT current_database(), version();');
    }
  } finally {await stack.cleanup(); process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);}
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main().catch(error => {
  process.stderr.write(`${error.message}${error.runDirectory ? `; run ${error.runDirectory}` : ''}\n`); process.exitCode = 1;
});
