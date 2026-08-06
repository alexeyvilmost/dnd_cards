import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, sha256Canonical } from './certification-hash.mjs';
import { assertPrivateRegularFile } from './private-artifact.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '../..');
export const MICRO_MVP_RELEASE_EVIDENCE_SCHEMA_VERSION = 3;
export const MICRO_MVP_RELEASE_EVIDENCE_KIND = 'micro-mvp-release-gate-evidence';
export const MICRO_MVP_RELEASE_EVIDENCE_MAX_AGE_MS = 4 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const GIT_COMMIT = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const FRONTEND_MVP_ALLOWED_TODOS = Object.freeze([
  'НЕреализованные payload-ы исполнителя (roadmap до MVP) set_die: подмена кубика заранее (Предсказание)',
  'НЕреализованные payload-ы исполнителя (roadmap до MVP) grant_action во время исполнения (Хитрое действие → варианты бонусного действия)',
  'НЕреализованные payload-ы исполнителя (roadmap до MVP) movement: применяет фактическое перемещение цели, а не только лог',
]);

export const REQUIRED_RELEASE_GATES = Object.freeze([
  Object.freeze({
    id: 'backend_go_test',
    command: 'CANONICAL_RUNTIME_TEST_DSN=<configured> CONTENT_MIGRATION_TEST_DSN=<configured> go test -race -count=1 -p 1 -json ./...',
    tests: true,
  }),
  Object.freeze({ id: 'backend_go_vet', command: 'go vet ./...', tests: false }),
  Object.freeze({
    id: 'frontend_test',
    command: 'npm test -- --reporter=json --outputFile=<report>',
    tests: true,
  }),
  Object.freeze({
    id: 'frontend_mvp',
    command: 'MVP_CONTENT=1 VITE_API_URL=<apiBase> npm run test:mvp -- --reporter=json --outputFile=<report>',
    tests: true,
    allowedTodoTests: FRONTEND_MVP_ALLOWED_TODOS,
  }),
  Object.freeze({
    id: 'micro_manifest',
    command: 'NODE_OPTIONS="--test-reporter=tap --test-reporter-destination=<report>" npm run test:micro:manifest',
    tests: true,
  }),
  Object.freeze({
    id: 'micro_matrix',
    command: 'npm run test:micro:matrix -- --reporter=json --outputFile=<report>',
    tests: true,
  }),
  Object.freeze({
    id: 'rules_core_coverage',
    command: 'npm run test:rules:coverage -- --reporter=json --outputFile=<report>',
    tests: true,
  }),
  Object.freeze({
    id: 'rules_primitive_coverage',
    command: 'npm run test:rules:primitives -- --reporter=json --outputFile=<report>',
    tests: true,
  }),
  Object.freeze({ id: 'semantic_coverage', command: 'npm run test:micro:coverage', tests: true }),
  Object.freeze({
    id: 'live_matrix',
    command: 'MVP_CONTENT=1 VITE_API_URL=<apiBase> npm run test:micro:live-matrix -- --reporter=json',
    tests: true,
  }),
  Object.freeze({
    id: 'sheet_combat_certification',
    command: 'npm run sheet-combat-certification:check',
    tests: false,
  }),
  Object.freeze({ id: 'rules_lab_fixture', command: 'npm run rules-lab:check', tests: false }),
  Object.freeze({ id: 'build', command: 'VITE_API_URL=<apiBase> npm run build', tests: false }),
  Object.freeze({ id: 'lint', command: 'npm run lint', tests: false }),
  Object.freeze({ id: 'browser', command: 'CI=1 playwright test --reporter=json', tests: true }),
  // Keep this gate last: the artifact must attest the backend commit after
  // every potentially long-running local test/build/browser gate completes.
  Object.freeze({
    id: 'deployment_health',
    command: 'GET <apiBase>/api/health and <frontendBase>/build-info.json; require both source_commit=<expectedDeployedCommit>',
    tests: false,
  }),
]);

const SOURCE_DIRECTORIES = Object.freeze([
  ['backend', /\.(?:go)$/],
  ['frontend/e2e', /\.(?:ts|tsx)$/],
  ['frontend/e2e-live', /\.(?:ts|tsx)$/],
  // These directories are Vite/Docker inputs outside frontend/src.  Keeping
  // them in the Git binding prevents a locally tested dictionary or resource
  // catalog from differing from the tree Railway builds.
  ['frontend/charges', /.+/],
  ['frontend/public', /.+/],
  ['frontend/scripts', /\.(?:mjs)$/],
  // Vite imports CSS, Markdown and HTML fixtures as well as TS/JSON.  Include
  // every regular source file so UI styling and raw documentation cannot fall
  // outside the source/deployment attestation.
  ['frontend/src', /.+/],
  ['frontend/utils', /.+/],
  // The canonical compiler and several mandatory gates read these files
  // directly.  They are release inputs even though Railway assigns no meaning
  // to their database surrogate IDs.
  ['officials/canon/prod-snapshot', /.+/],
  ['scripts/content', /\.(?:mjs|json|sql)$/],
]);
const SOURCE_FILES = Object.freeze([
  '.github/workflows/ci.yml',
  'backend/Dockerfile',
  'backend/go.mod',
  'backend/go.sum',
  'frontend/.dockerignore',
  'frontend/Dockerfile',
  'frontend/.eslintrc.cjs',
  'frontend/index.html',
  'frontend/liveCanaryTargets.ts',
  'frontend/micro-mvp-evidence.config.json',
  'frontend/nginx.conf.template',
  'frontend/package.json',
  'frontend/package-lock.json',
  'frontend/playwright.config.ts',
  'frontend/playwright.live.config.ts',
  'frontend/postcss.config.js',
  'frontend/tailwind.config.js',
  'frontend/tsconfig.json',
  'frontend/tsconfig.live.json',
  'frontend/tsconfig.node.json',
  'frontend/vite.config.ts',
  'frontend/vitest.live-matrix.config.ts',
  'frontend/vitest.matrix.config.ts',
  'frontend/vitest.micro-coverage.config.ts',
  'frontend/vitest.micro-coverage.gate.config.ts',
  'frontend/vitest.mvp.config.ts',
  'frontend/vitest.rules-core.config.ts',
  'frontend/vitest.rules-primitives.config.ts',
  'frontend/vitest.config.ts',
  'frontend/railway.json',
  'frontend/start.sh',
  // These files are executable release/gate inputs outside the directories
  // above and must be byte-identical to the supplied Git commit too.
  'docs/mechanics.schema.json',
  'docs/product-rules/free_origin_feat_choice_v1.json',
  "officials/Player's Handbook 2024.txt",
  'officials/Книга игрока 2024.txt',
  'railway.json',
  'railway-backend.json',
  'railway-frontend.json',
]);

function git(args, options = {}) {
  try {
    return execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: Object.hasOwn(options, 'encoding') ? options.encoding : 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail = Buffer.isBuffer(error?.stderr)
      ? error.stderr.toString('utf8').trim()
      : String(error?.stderr ?? '').trim();
    throw new Error(`cannot resolve release source commit${detail ? `: ${detail}` : ''}`);
  }
}

function portable(path) {
  return relative(REPO_ROOT, path).split(sep).join('/');
}

export function releaseSourceFilesIn(directory, pattern, output = []) {
  if (!existsSync(directory)) {
    throw new Error(`release evidence source directory is missing: ${portable(directory)}`);
  }
  const root = lstatSync(directory);
  if (root.isSymbolicLink()) {
    throw new Error(`source evidence refuses symlink: ${portable(directory)}`);
  }
  if (!root.isDirectory()) {
    throw new Error(`release evidence source directory is not a directory: ${portable(directory)}`);
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`source evidence refuses symlink: ${portable(path)}`);
    if (entry.isDirectory()) {
      releaseSourceFilesIn(path, pattern, output);
    } else if (entry.isFile() && pattern.test(entry.name)) {
      output.push(path);
    }
  }
  return output;
}

function currentMicroMvpSourceFiles() {
  const files = SOURCE_DIRECTORIES.flatMap(([directory, pattern]) => (
    releaseSourceFilesIn(resolve(REPO_ROOT, directory), pattern)
  ));
  for (const relativePath of SOURCE_FILES) {
    const path = resolve(REPO_ROOT, relativePath);
    if (!existsSync(path)) throw new Error(`release evidence source file is missing: ${relativePath}`);
    files.push(path);
  }
  return [...new Set(files.map((path) => resolve(path)))].sort((left, right) => (
    portable(left).localeCompare(portable(right))
  ));
}

export function currentMicroMvpSourcePaths() {
  return currentMicroMvpSourceFiles().map(portable);
}

export function currentMicroMvpSourceFingerprint() {
  const unique = currentMicroMvpSourceFiles();
  const hasher = createHash('sha256');
  for (const path of unique) {
    const bytes = readFileSync(path);
    const relativePath = portable(path);
    hasher.update(relativePath).update('\0').update(String(bytes.byteLength)).update('\0').update(bytes);
  }
  return {
    hash: `sha256:${hasher.digest('hex')}`,
    fileCount: unique.length,
  };
}

export function currentMicroMvpSourceCommit() {
  const commit = String(git(['rev-parse', '--verify', 'HEAD^{commit}'])).trim().toLowerCase();
  if (!GIT_COMMIT.test(commit)) throw new Error('current source commit is not a full 40-hex Git object ID');
  return commit;
}

/** Pure byte/path comparison used by the Git wrapper below and by regression
 * tests.  Supplying both complete path sets is important: byte comparison alone
 * would miss an untracked release input or a committed input deleted locally. */
export function assertMicroMvpSourceTreeMatchesCommit({
  sourceCommit,
  currentPaths,
  committedPaths,
  readCurrentBytes,
  readCommittedBytes,
}) {
  if (!GIT_COMMIT.test(sourceCommit ?? '')) {
    throw new Error('--source-commit must be a full lowercase 40-hex Git object ID');
  }
  if (canonicalJson(currentPaths) !== canonicalJson(committedPaths)) {
    throw new Error('release source files differ from --source-commit; commit the exact release tree first');
  }
  for (const relativePath of currentPaths) {
    const committedBytes = Buffer.from(readCommittedBytes(relativePath));
    const currentBytes = Buffer.from(readCurrentBytes(relativePath));
    if (!committedBytes.equals(currentBytes)) {
      throw new Error(`release source file differs from --source-commit: ${relativePath}`);
    }
  }
  return sourceCommit;
}

/**
 * Proves that every file covered by sourceHash is byte-for-byte present in the
 * supplied commit and that the commit contains no additional covered file.
 * This binds sourceHash to Git; it deliberately does not query a deployment
 * provider and therefore cannot prove what Railway (or another host) runs.
 */
export function assertCurrentMicroMvpSourceMatchesCommit(sourceCommit) {
  if (!GIT_COMMIT.test(sourceCommit ?? '')) {
    throw new Error('--source-commit must be a full lowercase 40-hex Git object ID');
  }
  const resolvedCommit = String(git([
    'rev-parse', '--verify', `${sourceCommit}^{commit}`,
  ])).trim().toLowerCase();
  if (resolvedCommit !== sourceCommit) throw new Error('--source-commit is not the exact resolved commit');

  const currentFiles = currentMicroMvpSourceFiles();
  const currentPaths = currentFiles.map(portable);
  const committedOutput = git([
    'ls-tree', '-r', '--name-only', '-z', sourceCommit, '--',
    ...SOURCE_DIRECTORIES.map(([directory]) => directory),
    ...SOURCE_FILES,
  ], { encoding: null });
  const committedCandidates = Buffer.from(committedOutput).toString('utf8').split('\0').filter(Boolean);
  const directoryPatterns = new Map(SOURCE_DIRECTORIES);
  const committedPaths = [...new Set(committedCandidates.filter((relativePath) => {
    if (SOURCE_FILES.includes(relativePath)) return true;
    for (const [directory, pattern] of directoryPatterns) {
      if (relativePath.startsWith(`${directory}/`) && pattern.test(relativePath.split('/').at(-1))) {
        return true;
      }
    }
    return false;
  }))].sort((left, right) => left.localeCompare(right));
  const currentByPath = new Map(currentFiles.map((path) => [portable(path), path]));
  return assertMicroMvpSourceTreeMatchesCommit({
    sourceCommit,
    currentPaths,
    committedPaths,
    readCurrentBytes: (relativePath) => readFileSync(currentByPath.get(relativePath)),
    readCommittedBytes: (relativePath) => git(
      ['show', `${sourceCommit}:${relativePath}`],
      { encoding: null },
    ),
  });
}

function requiredSha(value, label) {
  if (!SHA256.test(value ?? '')) throw new Error(`${label} must be sha256:<64 lowercase hex>`);
  return value;
}

export function currentMicroMvpReleaseIdentity() {
  const fixture = JSON.parse(readFileSync(resolve(
    REPO_ROOT,
    'frontend/src/pages/rulesLabFixture.generated.json',
  ), 'utf8'));
  const patch = JSON.parse(readFileSync(resolve(
    REPO_ROOT,
    'frontend/src/canon/data/micro-mvp-l1-content-patch.v1.json',
  ), 'utf8'));
  const release = fixture?.source?.release;
  const ruleset = fixture?.source?.ruleset;
  if (!release || !ruleset || release.id !== ruleset.releaseId
    || release.contentHash !== ruleset.contentHash) {
    throw new Error('Rules Lab fixture does not expose one coherent current release identity');
  }
  const source = currentMicroMvpSourceFingerprint();
  return {
    sourceHash: requiredSha(source.hash, 'sourceHash'),
    sourceFileCount: source.fileCount,
    sourceContentHash: requiredSha(release.sourceContentHash, 'sourceContentHash'),
    rulesHash: requiredSha(release.overlayHash, 'rulesHash'),
    contentHash: requiredSha(release.contentHash, 'contentHash'),
    releaseHash: requiredSha(release.releaseHash, 'releaseHash'),
    patchHash: sha256Canonical(patch),
    releaseId: release.id,
  };
}

function sortedCatalog(catalogs) {
  return Object.fromEntries(Object.keys(catalogs).sort().map((collection) => {
    if (!Array.isArray(catalogs[collection])) throw new Error(`catalog ${collection} must be an array`);
    const rows = [...catalogs[collection]].sort((left, right) => (
      String(left?.card_number ?? '').localeCompare(String(right?.card_number ?? ''))
      || String(left?.id ?? '').localeCompare(String(right?.id ?? ''))
    ));
    return [collection, rows];
  }));
}

export function microMvpCatalogFingerprint(catalogs) {
  const sorted = sortedCatalog(catalogs);
  return {
    hash: sha256Canonical(sorted),
    counts: Object.fromEntries(Object.entries(sorted).map(([collection, rows]) => (
      [collection, rows.length]
    ))),
  };
}

function parseUtc(value, label) {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) {
    throw new Error(`${label} must be an explicit UTC RFC3339 timestamp`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is not a valid timestamp`);
  return parsed;
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

/**
 * Release origins are identity-bearing values, not navigational URLs. Reject
 * credentials, paths and non-canonical spellings so a persisted evidence
 * binding has exactly one byte representation.
 */
export function assertExactHttpOrigin(value, label = 'origin') {
  let parsed;
  try {
    if (typeof value !== 'string' || value === '') throw new Error('missing origin');
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an exact credential-free HTTP(S) origin without trailing slash`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)
    || parsed.username || parsed.password
    || parsed.search || parsed.hash || parsed.pathname !== '/'
    || parsed.origin !== value) {
    throw new Error(`${label} must be an exact credential-free HTTP(S) origin without trailing slash`);
  }
  return value;
}

export function validateMicroMvpReleaseEvidenceArtifact(artifact, {
  apiBase,
  frontendBase,
  catalogs,
  now = new Date(),
  requireRecent = true,
  sourceCommit = currentMicroMvpSourceCommit(),
} = {}) {
  if (artifact?.schemaVersion !== MICRO_MVP_RELEASE_EVIDENCE_SCHEMA_VERSION
    || artifact?.kind !== MICRO_MVP_RELEASE_EVIDENCE_KIND
    || !UUID.test(artifact?.evidenceId ?? '')) {
    throw new Error('invalid micro-MVP release evidence artifact format');
  }
  if (typeof apiBase !== 'string' || apiBase === '' || artifact.apiBase !== apiBase) {
    throw new Error('release evidence apiBase must exactly equal the certification API base');
  }
  assertExactHttpOrigin(artifact.frontendBase, 'release evidence frontendBase');
  if (frontendBase !== undefined && artifact.frontendBase !== frontendBase) {
    throw new Error('release evidence frontendBase must exactly equal the expected frontend origin');
  }
  const startedAt = parseUtc(artifact.startedAt, 'evidence startedAt');
  const completedAt = parseUtc(artifact.completedAt, 'evidence completedAt');
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) throw new Error('release evidence validation clock is invalid');
  if (completedAt < startedAt) throw new Error('release evidence completed before it started');
  if (completedAt - startedAt > MICRO_MVP_RELEASE_EVIDENCE_MAX_AGE_MS) {
    throw new Error('release evidence gate execution exceeded the maximum four-hour window');
  }
  if (completedAt > nowMs + MAX_FUTURE_SKEW_MS) throw new Error('release evidence completion is in the future');
  if (requireRecent && nowMs - completedAt > MICRO_MVP_RELEASE_EVIDENCE_MAX_AGE_MS) {
    throw new Error('release evidence is stale; rerun all release gates');
  }
  if (artifact.status !== 'passed' || artifact.failedTests !== 0) {
    throw new Error('release evidence must record a passed execution with zero failed tests');
  }
  const deployment = artifact.deploymentAttestation;
  if (!deployment || !GIT_COMMIT.test(deployment.sourceCommit ?? '')
    || !GIT_COMMIT.test(deployment.expectedDeployedCommit ?? '')
    || deployment.sourceCommit !== deployment.expectedDeployedCommit
    || deployment.sourceCommit !== sourceCommit
    || deployment.basis !== 'operator-supplied-commit-identity'
    || deployment.externalVerificationRequired !== true) {
    throw new Error(
      'release evidence must bind local HEAD to one operator-supplied expected deployed commit that requires external verification',
    );
  }

  const expectedGates = new Map(REQUIRED_RELEASE_GATES.map((gate) => [gate.id, gate]));
  if (!Array.isArray(artifact.gates) || artifact.gates.length !== expectedGates.size) {
    throw new Error(`release evidence must contain exactly ${expectedGates.size} required gates`);
  }
  const seen = new Set();
  const aggregate = { total: 0, passed: 0, failed: 0, skipped: 0, todo: 0 };
  let previousGateCompletedAt = startedAt;
  for (let gateIndex = 0; gateIndex < artifact.gates.length; gateIndex += 1) {
    const gate = artifact.gates[gateIndex];
    const requiredGate = REQUIRED_RELEASE_GATES[gateIndex];
    const expected = expectedGates.get(gate?.id);
    if (!expected || gate.id !== requiredGate.id
      || seen.has(gate.id) || gate.command !== expected.command) {
      throw new Error(`release evidence has an unknown, duplicate, or altered gate ${String(gate?.id)}`);
    }
    seen.add(gate.id);
    const gateStartedAt = parseUtc(gate.startedAt, `${gate.id}.startedAt`);
    const gateCompletedAt = parseUtc(gate.completedAt, `${gate.id}.completedAt`);
    if (gateStartedAt < previousGateCompletedAt || gateCompletedAt > completedAt
      || gateCompletedAt < gateStartedAt) {
      throw new Error(`${gate.id} timestamps fall outside the evidence execution`);
    }
    previousGateCompletedAt = gateCompletedAt;
    if (gate.status !== 'passed' || gate.exitCode !== 0 || !SHA256.test(gate.outputHash ?? '')
      || !Number.isSafeInteger(gate.outputBytes) || gate.outputBytes < 0) {
      throw new Error(`${gate.id} did not record a successful executed command`);
    }
    if (expected.tests) {
      const summary = gate.testSummary;
      if (!summary || !Number.isSafeInteger(summary.total) || summary.total < 1
        || !Number.isSafeInteger(summary.passed)
        || !Number.isSafeInteger(summary.failed)
        || !Number.isSafeInteger(summary.skipped)
        || !Number.isSafeInteger(summary.todo)
        || summary.passed < 0 || summary.failed < 0 || summary.skipped < 0 || summary.todo < 0
        || summary.failed !== 0
        || summary.passed + summary.skipped + summary.todo !== summary.total
        || summary.skipped !== (expected.allowedSkippedTests?.length ?? 0)
        || summary.todo !== (expected.allowedTodoTests?.length ?? 0)
        || !SHA256.test(gate.reportHash ?? '')) {
        throw new Error(
          `${gate.id} must record a complete non-empty test execution within its skip/todo policy`,
        );
      }
      for (const key of Object.keys(aggregate)) aggregate[key] += summary[key];
    } else if (gate.testSummary !== null || gate.reportHash !== null) {
      throw new Error(`${gate.id} must not claim a test summary/report`);
    }
  }
  if (!Number.isSafeInteger(artifact.totalTests) || !Number.isSafeInteger(artifact.passedTests)
    || !Number.isSafeInteger(artifact.skippedTests) || !Number.isSafeInteger(artifact.failedTests)
    || !Number.isSafeInteger(artifact.todoTests)
    || !same({
      total: artifact.totalTests,
      passed: artifact.passedTests,
      failed: artifact.failedTests,
      skipped: artifact.skippedTests,
      todo: artifact.todoTests,
    }, aggregate)) {
    throw new Error('release evidence aggregate test totals differ from mandatory gate reports');
  }

  const currentRelease = currentMicroMvpReleaseIdentity();
  if (!same(artifact.release, currentRelease)) {
    throw new Error('release evidence source/release/content/patch identity is stale');
  }
  if (!artifact.catalog || !SHA256.test(artifact.catalog.hash ?? '')
    || !artifact.catalog.counts || typeof artifact.catalog.counts !== 'object'
    || Array.isArray(artifact.catalog.counts)
    || Object.values(artifact.catalog.counts).some((count) => (
      !Number.isSafeInteger(count) || count < 0
    ))) {
    throw new Error('release evidence catalog fingerprint is missing');
  }
  if (catalogs && !same(artifact.catalog, microMvpCatalogFingerprint(catalogs))) {
    throw new Error('live catalog changed after release gates');
  }
  return artifact;
}

export function writeMicroMvpReleaseEvidenceAtomic(path, artifact, { refuseOverwrite = true } = {}) {
  const destination = resolve(path);
  const existing = assertPrivateRegularFile(destination, 'release evidence', { allowMissing: true });
  if (refuseOverwrite && existing.exists) {
    throw new Error(`refusing to overwrite existing release evidence: ${destination}`);
  }
  const directory = dirname(destination);
  mkdirSync(directory, { recursive: true });
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor = null;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, destination);
    const directoryDescriptor = openSync(directory, 'r');
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  assertPrivateRegularFile(destination, 'release evidence');
  return destination;
}

function sha256Bytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function readMicroMvpReleaseEvidence(path, options = {}) {
  if (!path) throw new Error('--evidence must point to an existing gate artifact');
  const { path: resolved } = assertPrivateRegularFile(path, 'release evidence');
  const bytes = readFileSync(resolved);
  let artifact;
  try {
    artifact = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`release evidence is not valid JSON: ${error.message}`);
  }
  validateMicroMvpReleaseEvidenceArtifact(artifact, options);
  return {
    artifact,
    path: resolved,
    sha256: sha256Bytes(bytes),
  };
}

export function microMvpReleaseEvidenceBinding(readEvidence) {
  const { artifact, sha256 } = readEvidence;
  return {
    schemaVersion: artifact.schemaVersion,
    evidenceId: artifact.evidenceId,
    sha256,
    apiBase: artifact.apiBase,
    frontendBase: artifact.frontendBase,
    startedAt: artifact.startedAt,
    completedAt: artifact.completedAt,
    deploymentAttestation: artifact.deploymentAttestation,
    release: artifact.release,
    catalog: artifact.catalog,
    gateIds: artifact.gates.map((gate) => gate.id),
  };
}
