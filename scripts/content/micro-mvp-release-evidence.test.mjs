import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  executeMicroMvpReleaseGate,
  generateMicroMvpReleaseEvidence,
  releaseInvocation,
  vitestGateInvocation,
} from './generate-micro-mvp-release-evidence.mjs';
import {
  REQUIRED_RELEASE_GATES,
  MICRO_MVP_RELEASE_EVIDENCE_SCHEMA_VERSION,
  assertMicroMvpSourceTreeMatchesCommit,
  currentMicroMvpReleaseIdentity,
  currentMicroMvpSourceCommit,
  currentMicroMvpSourcePaths,
  microMvpCatalogFingerprint,
  readMicroMvpReleaseEvidence,
  releaseSourceFilesIn,
  validateMicroMvpReleaseEvidenceArtifact,
  writeMicroMvpReleaseEvidenceAtomic,
} from './micro-mvp-release-evidence.mjs';

const clone = (value) => JSON.parse(JSON.stringify(value));
const API_BASE = 'https://api.example.test';
const FRONTEND_BASE = 'https://frontend.example.test';
const CURRENT_RELEASE_IDENTITY = currentMicroMvpReleaseIdentity();
const CURRENT_COMMIT = currentMicroMvpSourceCommit();

test('release gate runs npm through its JavaScript CLI on Windows', () => {
  const args = ['run', 'test'];
  assert.deepEqual(releaseInvocation('npm', args, {
    platform: 'win32',
    nodeExecutable: 'C:\\node\\node.exe',
    npmExecPath: 'C:\\node\\node_modules\\npm\\bin\\npm-cli.js',
  }), {
    command: 'C:\\node\\node.exe',
    args: ['C:\\node\\node_modules\\npm\\bin\\npm-cli.js', ...args],
  });
  assert.deepEqual(releaseInvocation('npm.cmd', args, {
    platform: 'win32',
    nodeExecutable: 'C:\\node\\node.exe',
    npmExecPath: 'C:\\node\\npm.cmd',
  }), {
    command: 'C:\\node\\node.exe',
    args: ['C:\\node\\node_modules\\npm\\bin\\npm-cli.js', ...args],
  });
  assert.deepEqual(releaseInvocation('npm', args, { platform: 'linux' }), {
    command: 'npm',
    args,
  });
});

test('all Vitest release gates bypass the npm lifecycle wrapper', () => {
  assert.deepEqual(vitestGateInvocation({
    npmTest: true,
    reportPath: 'C:\\temp\\frontend.json',
    nodeExecutable: 'C:\\node\\node.exe',
    vitestCli: 'C:\\repo\\frontend\\node_modules\\vitest\\vitest.mjs',
  }), {
    command: 'C:\\node\\node.exe',
    args: [
      'C:\\repo\\frontend\\node_modules\\vitest\\vitest.mjs',
      'run',
      '--reporter=json',
      '--outputFile=C:\\temp\\frontend.json',
    ],
  });
  const scripts = [
    ['test:mvp', ['--config', 'vitest.mvp.config.ts']],
    ['test:micro:matrix', ['--config', 'vitest.matrix.config.ts']],
    ['test:rules:coverage', ['--config', 'vitest.rules-core.config.ts']],
    ['test:rules:primitives', ['--config', 'vitest.rules-primitives.config.ts', '--coverage']],
    ['test:micro:live-matrix', ['--config', 'vitest.live-matrix.config.ts']],
  ];
  for (const [script, scriptArgs] of scripts) {
    assert.deepEqual(vitestGateInvocation({
      script,
      npmTest: false,
      reportPath: '/tmp/report.json',
      nodeExecutable: '/node',
      vitestCli: '/repo/frontend/node_modules/vitest/vitest.mjs',
    }), {
      command: '/node',
      args: [
        '/repo/frontend/node_modules/vitest/vitest.mjs',
        'run',
        ...scriptArgs,
        '--reporter=json',
        '--outputFile=/tmp/report.json',
      ],
    });
  }
  assert.throws(() => vitestGateInvocation({
    script: 'test:unknown',
    npmTest: false,
    reportPath: '/tmp/report.json',
  }), /unsupported direct Vitest release script/);
});

function completeTestCoverage() {
  const entities = Object.fromEntries(Array.from({ length: 64 }, (_, index) => [
    `entity.${String(index + 1).padStart(2, '0')}`,
    { schema_version: 1, scope: 'micro-mvp-l1', required: 2, passed: 2, percent: 100 },
  ]));
  return {
    schemaVersion: 1,
    scope: 'micro-mvp-l1',
    rulesHash: CURRENT_RELEASE_IDENTITY.rulesHash,
    contentHash: CURRENT_RELEASE_IDENTITY.contentHash,
    required: 128,
    passed: 128,
    percent: 100,
    entities,
  };
}

test('release source fingerprint covers canonical data and every non-TypeScript Vite/Docker input', () => {
  const paths = new Set(currentMicroMvpSourcePaths());
  const requiredInputs = [
    'officials/canon/prod-snapshot/index.json',
    'frontend/src/pages/CharacterForge.css',
    'frontend/src/content/engine-guide.md',
    'frontend/src/docs/mechanics-guide.md',
    'frontend/src/utils/fixtures/ttg-skeleton.html',
    'frontend/nginx.conf.template',
    'frontend/start.sh',
    'frontend/charges/charges.json',
    'frontend/utils/weapon_types.json',
    'frontend/liveCanaryTargets.ts',
    'frontend/.npmrc',
    'frontend/public/assets/dice-box/ammo/ammo.wasm.wasm',
    'docs/mechanics.schema.json',
    'docs/product-rules/free_origin_feat_choice_v1.json',
  ];
  for (const relativePath of requiredInputs) {
    assert.equal(paths.has(relativePath), true, `source fingerprint omits ${relativePath}`);
  }

  assert.equal(paths.has('frontend/dist/index.html'), false);
  assert.equal(paths.has('frontend/node_modules/.package-lock.json'), false);
  assert.equal(paths.has('frontend/tsconfig.tsbuildinfo'), false);
  assert.equal(paths.has('frontend/vite.config.js'), false);
  assert.equal(paths.has('officials/canon/phb2024/class-barbarian.json'), false);
  assert.match(
    readFileSync(new URL('../../frontend/.dockerignore', import.meta.url), 'utf8'),
    /^vite\.config\.js$/m,
    'generated Vite config must not enter the Railway Docker context',
  );
});

test('release source collection fails closed when a required directory is absent', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-missing-source-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.throws(
    () => releaseSourceFilesIn(join(directory, 'prod-snapshot'), /.+/),
    /release evidence source directory is missing/,
  );
});

test('source-to-commit binding rejects both path omissions and byte drift', () => {
  const sourceCommit = 'a'.repeat(40);
  const current = new Map([
    ['frontend/src/App.tsx', Buffer.from('app')],
    ['officials/canon/prod-snapshot/index.json', Buffer.from('{}')],
  ]);
  const committed = new Map([...current].map(([path, bytes]) => [path, Buffer.from(bytes)]));
  const verify = (currentPaths = [...current.keys()], committedPaths = [...committed.keys()]) => (
    assertMicroMvpSourceTreeMatchesCommit({
      sourceCommit,
      currentPaths,
      committedPaths,
      readCurrentBytes: (path) => current.get(path),
      readCommittedBytes: (path) => committed.get(path),
    })
  );

  assert.equal(verify(), sourceCommit);

  committed.set('frontend/src/App.tsx', Buffer.from('different'));
  assert.throws(() => verify(), /release source file differs.*frontend\/src\/App\.tsx/);
  committed.set('frontend/src/App.tsx', Buffer.from('app'));

  assert.throws(
    () => verify([...current.keys(), 'frontend/src/pages/release.css']),
    /release source files differ from --source-commit/,
  );
  assert.throws(
    () => verify([...current.keys()].slice(0, 1)),
    /release source files differ from --source-commit/,
  );
});

const EXPECTED_GATES = [
  ['backend_go_test', 'CANONICAL_RUNTIME_TEST_DSN=<configured> CONTENT_MIGRATION_TEST_DSN=<configured> go test -race -count=1 -p 1 -json ./...'],
  ['backend_go_vet', 'go vet ./...'],
  ['frontend_test', 'node node_modules/vitest/vitest.mjs run --reporter=json --outputFile=<report>'],
  ['frontend_mvp', 'API_URL=<apiBase> MVP_CONTENT=1 VITE_API_URL=<apiBase> node node_modules/vitest/vitest.mjs run --config vitest.mvp.config.ts --reporter=json --outputFile=<report>'],
  ['micro_manifest', 'NODE_OPTIONS="--test-reporter=tap --test-reporter-destination=<report>" npm run test:micro:manifest'],
  ['micro_matrix', 'node node_modules/vitest/vitest.mjs run --config vitest.matrix.config.ts --reporter=json --outputFile=<report>'],
  ['rules_core_coverage', 'node node_modules/vitest/vitest.mjs run --config vitest.rules-core.config.ts --reporter=json --outputFile=<report>'],
  ['rules_primitive_coverage', 'node node_modules/vitest/vitest.mjs run --config vitest.rules-primitives.config.ts --coverage --reporter=json --outputFile=<report>'],
  ['semantic_coverage', 'npm run test:micro:coverage'],
  ['live_matrix', 'API_URL=<apiBase> MVP_CONTENT=1 VITE_API_URL=<apiBase> node node_modules/vitest/vitest.mjs run --config vitest.live-matrix.config.ts --reporter=json --outputFile=<report>'],
  ['sheet_combat_certification', 'npm run sheet-combat-certification:check'],
  ['rules_lab_fixture', 'npm run rules-lab:check'],
  ['build', 'VITE_API_URL=<apiBase> npm run build'],
  ['lint', 'npm run lint'],
  ['browser', 'CI=1 playwright test --reporter=json'],
  ['deployment_health', 'GET <apiBase>/api/health and <frontendBase>/build-info.json; require both source_commit=<expectedDeployedCommit>'],
];

function catalogs() {
  return {
    effect: [{ id: 'effect-1', card_number: 'COND-blinded', support: null }],
    spell: [{ id: 'spell-1', card_number: 'SPELL-1', support: null }],
  };
}

function artifactFor(inputCatalogs = catalogs(), completed = new Date('2026-08-05T18:00:00Z')) {
  const completedAt = completed.toISOString();
  const startedAt = new Date(completed.getTime() - 60_000).toISOString();
  const gates = REQUIRED_RELEASE_GATES.map((gate, index) => ({
    id: gate.id,
    command: gate.command,
    startedAt: new Date(Date.parse(startedAt) + index * 3_000).toISOString(),
    completedAt: new Date(Date.parse(startedAt) + (index + 1) * 3_000).toISOString(),
    status: 'passed',
    exitCode: 0,
    outputHash: `sha256:${'a'.repeat(64)}`,
    outputBytes: 10,
    reportHash: gate.tests ? `sha256:${'b'.repeat(64)}` : null,
    testSummary: gate.tests
      ? { total: 2, passed: 2, failed: 0, skipped: 0, todo: 0 }
      : null,
    ...(gate.id === 'semantic_coverage' ? { testCoverage: completeTestCoverage() } : {}),
  }));
  const aggregate = gates.reduce((totals, gate) => {
    for (const key of Object.keys(totals)) totals[key] += gate.testSummary?.[key] ?? 0;
    return totals;
  }, { total: 0, passed: 0, failed: 0, skipped: 0, todo: 0 });
  return {
    schemaVersion: MICRO_MVP_RELEASE_EVIDENCE_SCHEMA_VERSION,
    kind: 'micro-mvp-release-gate-evidence',
    evidenceId: '00000000-0000-4000-8000-000000000001',
    apiBase: API_BASE,
    frontendBase: FRONTEND_BASE,
    startedAt,
    completedAt,
    status: 'passed',
    totalTests: aggregate.total,
    passedTests: aggregate.passed,
    skippedTests: aggregate.skipped,
    failedTests: aggregate.failed,
    todoTests: aggregate.todo,
    deploymentAttestation: {
      sourceCommit: CURRENT_COMMIT,
      expectedDeployedCommit: CURRENT_COMMIT,
      basis: 'operator-supplied-commit-identity',
      externalVerificationRequired: true,
    },
    release: clone(CURRENT_RELEASE_IDENTITY),
    catalog: microMvpCatalogFingerprint(inputCatalogs),
    gates,
  };
}

function refreshAggregate(artifact) {
  const aggregate = artifact.gates.reduce((totals, gate) => {
    for (const key of Object.keys(totals)) totals[key] += gate.testSummary?.[key] ?? 0;
    return totals;
  }, { total: 0, passed: 0, failed: 0, skipped: 0, todo: 0 });
  artifact.totalTests = aggregate.total;
  artifact.passedTests = aggregate.passed;
  artifact.failedTests = aggregate.failed;
  artifact.skippedTests = aggregate.skipped;
  artifact.todoTests = aggregate.todo;
}

test('release evidence writer is atomic 0600 and the artifact binds current source and catalog', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-release-evidence-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'evidence.json');
  const inputCatalogs = catalogs();
  const artifact = artifactFor(inputCatalogs);
  writeMicroMvpReleaseEvidenceAtomic(path, artifact);

  if (process.platform !== 'win32') {
    assert.equal(statSync(path).mode & 0o777, 0o600);
  }
  const result = readMicroMvpReleaseEvidence(path, {
    apiBase: API_BASE,
    catalogs: inputCatalogs,
    now: new Date('2026-08-05T18:01:00Z'),
  });
  assert.deepEqual(result.artifact, artifact);
  assert.match(result.sha256, /^sha256:[0-9a-f]{64}$/);
  assert.match(readFileSync(path, 'utf8'), /"backend_go_test"/);

  const source = writeMicroMvpReleaseEvidenceAtomic.toString();
  assert.match(source, /openSync\(temporary, 'wx', 0o600\)/);
  assert.match(source, /fsyncSync\(descriptor\)/);
  assert.match(source, /fsyncSync\(directoryDescriptor\)/);
});

test('release evidence reader and writer require a private regular file', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-private-evidence-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const inputCatalogs = catalogs();
  const artifact = artifactFor(inputCatalogs);
  const options = {
    apiBase: API_BASE,
    catalogs: inputCatalogs,
    now: new Date('2026-08-05T18:01:00Z'),
  };
  const path = join(directory, 'evidence.json');
  writeMicroMvpReleaseEvidenceAtomic(path, artifact);
  assert.equal(readMicroMvpReleaseEvidence(path, options).artifact.evidenceId, artifact.evidenceId);

  const directoryPath = join(directory, 'not-a-file');
  mkdirSync(directoryPath);
  assert.throws(() => readMicroMvpReleaseEvidence(directoryPath, options), /must be a regular file/);
  assert.throws(
    () => writeMicroMvpReleaseEvidenceAtomic(directoryPath, artifact, { refuseOverwrite: false }),
    /must be a regular file/,
  );

  if (process.platform !== 'win32') {
    chmodSync(path, 0o644);
    assert.throws(() => readMicroMvpReleaseEvidence(path, options), /group\/world access/);
    assert.throws(
      () => writeMicroMvpReleaseEvidenceAtomic(path, artifact, { refuseOverwrite: false }),
      /group\/world access/,
    );
    chmodSync(path, 0o600);

    const linkPath = join(directory, 'evidence-link.json');
    symlinkSync(path, linkPath);
    assert.throws(() => readMicroMvpReleaseEvidence(linkPath, options), /must not be a symlink/);
    assert.throws(
      () => writeMicroMvpReleaseEvidenceAtomic(linkPath, artifact, { refuseOverwrite: false }),
      /must not be a symlink/,
    );
  }
});

test('release evidence has the complete exact command contract and strict gates reject skips', () => {
  assert.deepEqual(
    REQUIRED_RELEASE_GATES.map(({ id, command }) => [id, command]),
    EXPECTED_GATES,
  );
  assert.equal(REQUIRED_RELEASE_GATES.length, 16);
  assert.equal(
    REQUIRED_RELEASE_GATES.at(-1)?.id,
    'deployment_health',
    'deployment identity must be checked after every local release gate',
  );

  const inputCatalogs = catalogs();
  const artifact = artifactFor(inputCatalogs);
  assert.doesNotThrow(() => validateMicroMvpReleaseEvidenceArtifact(artifact, {
    apiBase: API_BASE, catalogs: inputCatalogs, now: new Date('2026-08-05T18:01:00Z'),
  }));
  assert.equal(artifact.skippedTests, 0, 'release gates must not contain anonymous skips');
  assert.equal(artifact.todoTests, 0, 'release gates must not contain TODO tests');

  const hiddenSkip = clone(artifact);
  hiddenSkip.skippedTests = 1;
  assert.throws(
    () => validateMicroMvpReleaseEvidenceArtifact(hiddenSkip, {
      apiBase: API_BASE, catalogs: inputCatalogs, now: new Date('2026-08-05T18:01:00Z'),
    }),
    /aggregate test totals differ/,
  );

  const alteredCommand = clone(artifact);
  alteredCommand.gates[0].command = 'go test ./...';
  assert.throws(
    () => validateMicroMvpReleaseEvidenceArtifact(alteredCommand, {
      apiBase: API_BASE, catalogs: inputCatalogs, now: new Date('2026-08-05T18:01:00Z'),
    }),
    /altered gate backend_go_test/,
  );

  const strictSkip = clone(artifact);
  const semantic = strictSkip.gates.find((gate) => gate.id === 'semantic_coverage');
  semantic.testSummary = { total: 2, passed: 1, failed: 0, skipped: 1, todo: 0 };
  refreshAggregate(strictSkip);
  assert.throws(
    () => validateMicroMvpReleaseEvidenceArtifact(strictSkip, {
      apiBase: API_BASE, catalogs: inputCatalogs, now: new Date('2026-08-05T18:01:00Z'),
    }),
    /semantic_coverage.*skip\/todo policy/,
  );
});

test('backend integration evidence refuses to run when either disposable PostgreSQL DSN is absent', async () => {
  const previousCanonical = process.env.CANONICAL_RUNTIME_TEST_DSN;
  const previousMigration = process.env.CONTENT_MIGRATION_TEST_DSN;
  const previousBootstrap = process.env.CONTENT_MIGRATION_TEST_BOOTSTRAP;
  try {
    delete process.env.CANONICAL_RUNTIME_TEST_DSN;
    delete process.env.CONTENT_MIGRATION_TEST_DSN;
    delete process.env.CONTENT_MIGRATION_TEST_BOOTSTRAP;
    await assert.rejects(
      executeMicroMvpReleaseGate(REQUIRED_RELEASE_GATES[0], {
        apiBase: API_BASE,
        temporaryDirectory: '/tmp',
      }),
      /requires CANONICAL_RUNTIME_TEST_DSN; integration skips are forbidden/,
    );
    process.env.CANONICAL_RUNTIME_TEST_DSN = 'postgres://isolated-test.invalid/canonical';
    await assert.rejects(
      executeMicroMvpReleaseGate(REQUIRED_RELEASE_GATES[0], {
        apiBase: API_BASE,
        temporaryDirectory: '/tmp',
      }),
      /requires CONTENT_MIGRATION_TEST_DSN; integration skips are forbidden/,
    );

    process.env.CANONICAL_RUNTIME_TEST_DSN = 'not-a-url-with-sensitive-material';
    process.env.CONTENT_MIGRATION_TEST_DSN = 'postgres://isolated-test.invalid/content';
    await assert.rejects(
      executeMicroMvpReleaseGate(REQUIRED_RELEASE_GATES[0], {
        apiBase: API_BASE,
        temporaryDirectory: '/tmp',
      }),
      (error) => error instanceof Error
        && error.message === 'CANONICAL_RUNTIME_TEST_DSN must be a PostgreSQL URL'
        && !error.message.includes('sensitive-material'),
    );

    process.env.CANONICAL_RUNTIME_TEST_DSN = 'postgres://isolated-test.invalid/canonical';
    process.env.CONTENT_MIGRATION_TEST_DSN = 'postgres://isolated-test.invalid/canonical?sslmode=disable';
    await assert.rejects(
      executeMicroMvpReleaseGate(REQUIRED_RELEASE_GATES[0], {
        apiBase: API_BASE,
        temporaryDirectory: '/tmp',
      }),
      /requires distinct canonical-runtime and restored content PostgreSQL databases/,
    );

    process.env.CONTENT_MIGRATION_TEST_DSN = 'postgres://isolated-test.invalid/content';
    process.env.CONTENT_MIGRATION_TEST_BOOTSTRAP = '1';
    await assert.rejects(
      executeMicroMvpReleaseGate(REQUIRED_RELEASE_GATES[0], {
        apiBase: API_BASE,
        temporaryDirectory: '/tmp',
      }),
      /forbids CONTENT_MIGRATION_TEST_BOOTSTRAP/,
    );
  } finally {
    if (previousCanonical === undefined) delete process.env.CANONICAL_RUNTIME_TEST_DSN;
    else process.env.CANONICAL_RUNTIME_TEST_DSN = previousCanonical;
    if (previousMigration === undefined) delete process.env.CONTENT_MIGRATION_TEST_DSN;
    else process.env.CONTENT_MIGRATION_TEST_DSN = previousMigration;
    if (previousBootstrap === undefined) delete process.env.CONTENT_MIGRATION_TEST_BOOTSTRAP;
    else process.env.CONTENT_MIGRATION_TEST_BOOTSTRAP = previousBootstrap;
  }
});

test('final deployment health gate independently proves the exact backend and frontend commit', async (t) => {
  let backendCommit = CURRENT_COMMIT;
  let frontendCommit = CURRENT_COMMIT;
  let frontendMode = 'valid';
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url, cacheControl: request.headers['cache-control'] });
    if (request.url === '/api/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', source_commit: backendCommit }));
      return;
    }
    if (request.url === '/build-info.json') {
      if (frontendMode === 'missing') {
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end('{}');
        return;
      }
      if (frontendMode === 'redirect') {
        response.writeHead(302, { Location: '/api/health' });
        response.end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(frontendMode === 'malformed'
        ? '{not-json'
        : JSON.stringify({ source_commit: frontendCommit }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const definition = REQUIRED_RELEASE_GATES.find((gate) => gate.id === 'deployment_health');
  assert.ok(definition);
  const options = {
    apiBase: `http://127.0.0.1:${address.port}`,
    frontendBase: `http://127.0.0.1:${address.port}`,
    temporaryDirectory: '/tmp',
    expectedDeployedCommit: CURRENT_COMMIT,
  };
  const accepted = await executeMicroMvpReleaseGate(definition, options);
  assert.equal(accepted.status, 'passed');
  assert.deepEqual(requests.map(({ url }) => url).sort(), ['/api/health', '/build-info.json']);
  assert.equal(
    requests.find(({ url }) => url === '/build-info.json')?.cacheControl,
    'no-cache',
  );

  // Backend remains exact: a separately deployed or stale frontend must still
  // fail the final gate.
  frontendCommit = 'f'.repeat(40);
  await assert.rejects(
    executeMicroMvpReleaseGate(definition, options),
    /deployment_health failed with exit code 1/,
  );

  frontendCommit = CURRENT_COMMIT;
  frontendMode = 'malformed';
  await assert.rejects(
    executeMicroMvpReleaseGate(definition, options),
    /deployment_health failed with exit code 1/,
  );

  frontendMode = 'missing';
  await assert.rejects(
    executeMicroMvpReleaseGate(definition, options),
    /deployment_health failed with exit code 1/,
  );

  frontendMode = 'redirect';
  await assert.rejects(
    executeMicroMvpReleaseGate(definition, options),
    /deployment_health failed with exit code 1/,
  );

  frontendMode = 'valid';
  backendCommit = 'f'.repeat(40);
  await assert.rejects(
    executeMicroMvpReleaseGate(definition, options),
    /deployment_health failed with exit code 1/,
  );
});

test('schema-v3 evidence and generator reject missing or malformed frontend origins', async () => {
  const inputCatalogs = catalogs();
  const validate = (artifact, frontendBase) => validateMicroMvpReleaseEvidenceArtifact(artifact, {
    apiBase: API_BASE,
    ...(frontendBase === undefined ? {} : { frontendBase }),
    catalogs: inputCatalogs,
    now: new Date('2026-08-05T18:01:00Z'),
  });
  const invalidOrigins = [
    undefined,
    '',
    'not-a-url',
    'ftp://frontend.example.test',
    'https://user:pass@frontend.example.test',
    'https://frontend.example.test/path',
    'https://frontend.example.test/',
    'HTTPS://frontend.example.test',
  ];
  for (const invalid of invalidOrigins) {
    const artifact = artifactFor(inputCatalogs);
    if (invalid === undefined) delete artifact.frontendBase;
    else artifact.frontendBase = invalid;
    assert.throws(
      () => validate(artifact),
      /frontendBase must be an exact credential-free HTTP\(S\) origin/,
      `unexpectedly accepted frontendBase=${String(invalid)}`,
    );
  }

  assert.throws(
    () => validate(artifactFor(inputCatalogs), 'https://other-frontend.example.test'),
    /frontendBase must exactly equal the expected frontend origin/,
  );

  let executions = 0;
  const generate = (frontendBase) => generateMicroMvpReleaseEvidence({
    apiBase: API_BASE,
    frontendBase,
    artifactPath: '/does/not/matter.json',
    sourceCommit: CURRENT_COMMIT,
    expectedDeployedCommit: CURRENT_COMMIT,
    sourceCommitVerifier: () => CURRENT_COMMIT,
    gateExecutor: async () => { executions += 1; },
    environment: {},
  });
  await assert.rejects(generate(undefined), /--api, --frontend, --artifact/);
  await assert.rejects(generate('https://frontend.example.test/'), /--frontend must be an exact/);
  assert.equal(executions, 0, 'invalid frontend identity must fail before any gate executes');
});

test('frontend image publishes an atomic no-cache build-info endpoint contract', () => {
  const start = readFileSync(new URL('../../frontend/start.sh', import.meta.url), 'utf8');
  const nginx = readFileSync(new URL('../../frontend/nginx.conf.template', import.meta.url), 'utf8');
  const dockerfile = readFileSync(new URL('../../frontend/Dockerfile', import.meta.url), 'utf8');

  assert.match(start, /^set -eu$/m);
  assert.match(start, /SOURCE_COMMIT="\$\{SOURCE_COMMIT:-\$\{RAILWAY_GIT_COMMIT_SHA:-\}\}"/);
  assert.match(start, /grep -Eq '\^\[0-9A-Fa-f\]\{40\}\$'/);
  assert.match(start, /printf '\{"source_commit":"%s"\}\\n'/);
  assert.match(start, /printf '\{"source_commit":null\}\\n'/);
  const temporaryWrite = start.indexOf('> "$BUILD_INFO_TMP"');
  const atomicRename = start.indexOf('mv "$BUILD_INFO_TMP" "$BUILD_INFO_PATH"');
  const nginxStart = start.indexOf("exec nginx -g 'daemon off;'");
  assert.ok(temporaryWrite >= 0 && atomicRename > temporaryWrite && nginxStart > atomicRename);

  for (const source of [nginx, start]) {
    assert.match(source, /location = \/build-info\.json \{/);
    assert.match(source, /try_files \$uri =404;/);
    assert.match(source, /add_header Cache-Control "no-cache, no-store, must-revalidate" always;/);
  }
  assert.match(dockerfile, /COPY start\.sh \/start\.sh/);
  assert.match(dockerfile, /CMD \["\/start\.sh"\]/);
});

test('release evidence fails closed on failures, stale time, source drift, API mismatch, and catalog drift', () => {
  const inputCatalogs = catalogs();
  const base = artifactFor(inputCatalogs);

  const failed = clone(base);
  failed.gates[0].testSummary = {
    total: 2, passed: 1, failed: 1, skipped: 0, todo: 0,
  };
  refreshAggregate(failed);
  assert.throws(
    () => validateMicroMvpReleaseEvidenceArtifact(failed, {
      apiBase: API_BASE, catalogs: inputCatalogs, now: new Date('2026-08-05T18:01:00Z'),
    }),
    /zero failed tests/,
  );

  assert.throws(
    () => validateMicroMvpReleaseEvidenceArtifact(base, {
      apiBase: API_BASE, catalogs: inputCatalogs, now: new Date('2026-08-06T00:01:00Z'),
    }),
    /evidence is stale/,
  );

  const sourceDrift = clone(base);
  sourceDrift.release.sourceHash = `sha256:${'f'.repeat(64)}`;
  assert.throws(
    () => validateMicroMvpReleaseEvidenceArtifact(sourceDrift, {
      apiBase: API_BASE, catalogs: inputCatalogs, now: new Date('2026-08-05T18:01:00Z'),
    }),
    /identity is stale/,
  );

  assert.throws(
    () => validateMicroMvpReleaseEvidenceArtifact(base, {
      apiBase: 'https://other.example.test',
      catalogs: inputCatalogs,
      now: new Date('2026-08-05T18:01:00Z'),
    }),
    /apiBase must exactly equal/,
  );

  const changedCatalogs = catalogs();
  changedCatalogs.effect[0].name = 'drift';
  assert.throws(
    () => validateMicroMvpReleaseEvidenceArtifact(base, {
      apiBase: API_BASE,
      catalogs: changedCatalogs,
      now: new Date('2026-08-05T18:01:00Z'),
    }),
    /catalog changed/,
  );
});

test('release evidence rejects absent, non-40-hex, mismatched, and non-HEAD deployment attestations', () => {
  const inputCatalogs = catalogs();
  const validate = (artifact) => validateMicroMvpReleaseEvidenceArtifact(artifact, {
    apiBase: API_BASE, catalogs: inputCatalogs, now: new Date('2026-08-05T18:01:00Z'),
  });
  const missing = artifactFor(inputCatalogs);
  delete missing.deploymentAttestation;
  assert.throws(() => validate(missing), /expected deployed commit/);

  const short = artifactFor(inputCatalogs);
  short.deploymentAttestation.sourceCommit = 'a'.repeat(39);
  assert.throws(() => validate(short), /expected deployed commit/);

  const mismatch = artifactFor(inputCatalogs);
  mismatch.deploymentAttestation.expectedDeployedCommit = 'f'.repeat(40);
  assert.throws(() => validate(mismatch), /expected deployed commit/);

  const nonHead = artifactFor(inputCatalogs);
  nonHead.deploymentAttestation.sourceCommit = 'f'.repeat(40);
  nonHead.deploymentAttestation.expectedDeployedCommit = 'f'.repeat(40);
  assert.throws(() => validate(nonHead), /expected deployed commit/);
});

test('generator executes the exact mandatory gate set before writing evidence', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-release-generator-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'evidence.json');
  const executed = [];

  const result = await generateMicroMvpReleaseEvidence({
    apiBase: API_BASE,
    frontendBase: FRONTEND_BASE,
    artifactPath: path,
    sourceCommit: CURRENT_COMMIT,
    expectedDeployedCommit: CURRENT_COMMIT,
    sourceCommitVerifier: () => CURRENT_COMMIT,
    catalogLoader: async () => catalogs(),
    coverageExpander: (coverage) => coverage,
    environment: {},
    gateExecutor: async (gate) => {
      executed.push(gate.id);
      const startedAt = new Date().toISOString();
      return {
        id: gate.id,
        command: gate.command,
        startedAt,
        completedAt: startedAt,
        status: 'passed',
        exitCode: 0,
        outputHash: `sha256:${'a'.repeat(64)}`,
        outputBytes: 1,
        reportHash: gate.tests ? `sha256:${'b'.repeat(64)}` : null,
        testSummary: gate.tests
          ? { total: 1, passed: 1, failed: 0, skipped: 0, todo: 0 }
          : null,
        ...(gate.id === 'semantic_coverage' ? { testCoverage: completeTestCoverage() } : {}),
      };
    },
  });

  assert.deepEqual(executed, REQUIRED_RELEASE_GATES.map((gate) => gate.id));
  assert.equal(result.destination, path);
  if (process.platform !== 'win32') {
    assert.equal(statSync(path).mode & 0o777, 0o600);
  }
  assert.equal(result.artifact.status, 'passed');
  assert.equal(result.artifact.deploymentAttestation.sourceCommit, CURRENT_COMMIT);
});

test('generator requires an exact local-HEAD deployment expectation before running gates', async () => {
  let executions = 0;
  await assert.rejects(
    generateMicroMvpReleaseEvidence({
      apiBase: API_BASE,
      frontendBase: FRONTEND_BASE,
      artifactPath: '/does/not/matter.json',
      sourceCommit: CURRENT_COMMIT,
      expectedDeployedCommit: 'f'.repeat(40),
      sourceCommitVerifier: () => CURRENT_COMMIT,
      gateExecutor: async () => { executions += 1; },
      environment: {},
    }),
    /must exactly equal --source-commit/,
  );
  assert.equal(executions, 0);
});

test('generator binds operator endpoint environment before running gates', async () => {
  let executions = 0;
  const generate = (environment) => generateMicroMvpReleaseEvidence({
    apiBase: API_BASE,
    frontendBase: FRONTEND_BASE,
    artifactPath: '/does/not/matter.json',
    sourceCommit: CURRENT_COMMIT,
    expectedDeployedCommit: CURRENT_COMMIT,
    sourceCommitVerifier: () => CURRENT_COMMIT,
    gateExecutor: async () => { executions += 1; },
    environment,
  });
  await assert.rejects(
    generate({ API_URL: 'https://other-api.example.test' }),
    /--api must exactly equal API_URL/,
  );
  await assert.rejects(
    generate({ FRONTEND_URL: 'https://other-frontend.example.test' }),
    /--frontend must exactly equal FRONTEND_URL/,
  );
  assert.equal(executions, 0);
});
