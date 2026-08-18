#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  expandMicroMvpCoverageSummaryForCatalogs,
  loadCertificationCatalogs,
} from './micro-mvp-certifications.mjs';
import {
  MICRO_MVP_RELEASE_EVIDENCE_KIND,
  MICRO_MVP_RELEASE_EVIDENCE_SCHEMA_VERSION,
  REQUIRED_RELEASE_GATES,
  assertExactHttpOrigin,
  assertCurrentMicroMvpSourceMatchesCommit,
  currentMicroMvpReleaseIdentity,
  currentMicroMvpSourceCommit,
  microMvpCatalogFingerprint,
  validateMicroMvpReleaseEvidenceArtifact,
  validateMicroMvpTestCoverageSummary,
  writeMicroMvpReleaseEvidenceAtomic,
} from './micro-mvp-release-evidence.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = resolve(HERE, '../../frontend');
const BACKEND_ROOT = resolve(HERE, '../../backend');
const NPM = 'npm';
const PLAYWRIGHT_CLI = resolve(FRONTEND_ROOT, 'node_modules/@playwright/test/cli.js');

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') return { help: true };
    if (![
      '--artifact', '--api', '--frontend', '--source-commit', '--expected-deployed-commit',
    ].includes(arg)) throw new Error(`unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    values.set(arg, value);
    index += 1;
  }
  return {
    help: false,
    artifactPath: values.get('--artifact'),
    apiBase: values.get('--api'),
    frontendBase: values.get('--frontend'),
    sourceCommit: values.get('--source-commit'),
    expectedDeployedCommit: values.get('--expected-deployed-commit'),
  };
}

function usage() {
  return [
    'Execute every mandatory micro-MVP release gate and write one durable evidence artifact:',
    '  node scripts/content/generate-micro-mvp-release-evidence.mjs \\',
    '    --api https://backend.example \\',
    '    --frontend https://frontend.example \\',
    '    --source-commit <40-hex-local-HEAD> \\',
    '    --expected-deployed-commit <same-40-hex-verified-on-host> \\',
    '    --artifact backups/micro-mvp-release-evidence.json',
    '',
    'The destination must not exist. Strict micro/integration/browser gates require zero skips/todos.',
    'The deployed commit value is an operator attestation; verify it externally before running this command.',
  ].join('\n');
}

function sha256File(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} did not produce valid JSON: ${error.message}`);
  }
}

export function releaseInvocation(command, args, {
  platform = process.platform,
  nodeExecutable = process.execPath,
  npmExecPath = process.env.npm_execpath,
} = {}) {
  if (platform !== 'win32' || !/^npm(?:\.cmd)?$/i.test(command)) {
    return { command, args };
  }
  const npmCli = npmExecPath && /npm-cli\.(?:c?js|mjs)$/i.test(npmExecPath)
    ? resolve(npmExecPath)
    : resolve(dirname(nodeExecutable), 'node_modules/npm/bin/npm-cli.js');
  return { command: nodeExecutable, args: [npmCli, ...args] };
}

async function runCommand({
  command, args, env = {}, cwd = FRONTEND_ROOT, captureStdout = false,
}) {
  const hash = createHash('sha256');
  const stdoutChunks = [];
  let bytes = 0;
  const startedAt = new Date().toISOString();
  const exitCode = await new Promise((resolveExit, reject) => {
    const invocation = releaseInvocation(command, args);
    if (process.platform === 'win32' && /^npm(?:\.cmd)?$/i.test(command)
      && !existsSync(invocation.args[0])) {
      reject(new Error(`Unable to locate npm CLI at ${invocation.args[0]}`));
      return;
    }
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const forward = (stream, destination, label) => {
      stream.on('data', (chunk) => {
        const value = Buffer.from(chunk);
        hash.update(label).update('\0').update(value);
        bytes += value.byteLength;
        destination.write(value);
        if (captureStdout && label === 'stdout') stdoutChunks.push(value);
      });
    };
    forward(child.stdout, process.stdout, 'stdout');
    forward(child.stderr, process.stderr, 'stderr');
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        process.stderr.write(`Gate process terminated by ${signal}.\n`);
        resolveExit(1);
      } else {
        resolveExit(code ?? 1);
      }
    });
  });
  return {
    startedAt,
    completedAt: new Date().toISOString(),
    exitCode,
    outputHash: `sha256:${hash.digest('hex')}`,
    outputBytes: bytes,
    stdout: captureStdout ? Buffer.concat(stdoutChunks) : null,
  };
}

async function executeDeploymentHealthGate(apiBase, frontendBase, expectedDeployedCommit) {
  const startedAt = new Date().toISOString();
  let bytes = Buffer.alloc(0);
  let passed = false;
  try {
    const [backendResponse, frontendResponse] = await Promise.all([
      fetch(`${apiBase}/api/health`, {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      }),
      fetch(`${frontendBase}/build-info.json`, {
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      }),
    ]);
    const [backendBytes, frontendBytes] = await Promise.all([
      backendResponse.arrayBuffer().then((value) => Buffer.from(value)),
      frontendResponse.arrayBuffer().then((value) => Buffer.from(value)),
    ]);
    bytes = Buffer.concat([backendBytes, Buffer.from('\0frontend\0'), frontendBytes]);
    if (backendBytes.byteLength <= 64 * 1024 && frontendBytes.byteLength <= 64 * 1024) {
      const backend = JSON.parse(backendBytes.toString('utf8'));
      const frontend = JSON.parse(frontendBytes.toString('utf8'));
      passed = backendResponse.status === 200
        && backend?.status === 'ok'
        && backend?.source_commit === expectedDeployedCommit
        && frontendResponse.status === 200
        && frontend?.source_commit === expectedDeployedCommit;
    }
  } catch {
    // The release gate reports only a mismatch. It deliberately does not echo
    // response bodies or transport diagnostics from a production endpoint.
    passed = false;
  }
  process.stdout.write(
    `[release-evidence] backend/frontend deployment health ${passed ? 'matches' : 'does not match'} expected commit\n`,
  );
  return {
    startedAt,
    completedAt: new Date().toISOString(),
    exitCode: passed ? 0 : 1,
    outputHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    outputBytes: bytes.byteLength,
    stdout: null,
  };
}

function passedTestSummary({ total, passed, failed, skipped, todo = 0 }, definition) {
  const gateId = definition.id;
  for (const [key, value] of Object.entries({ total, passed, failed, skipped, todo })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${gateId} has invalid ${key}`);
  }
  if (total < 1 || failed !== 0 || passed + skipped + todo !== total
    || skipped !== (definition.allowedSkippedTests?.length ?? 0)
    || todo !== (definition.allowedTodoTests?.length ?? 0)) {
    throw new Error(`${gateId} did not execute a complete non-empty pass within its skip/todo policy`);
  }
  return { total, passed, failed, skipped, todo };
}

function exactVitestExceptions(report, status) {
  return (report.testResults ?? []).flatMap((suite) => (
    suite.assertionResults ?? []
  )).filter((assertion) => assertion.status === status)
    .map((assertion) => assertion.fullName)
    .sort();
}

function vitestSummary(report, definition) {
  const expectedSkipped = [...(definition.allowedSkippedTests ?? [])].sort();
  const expectedTodo = [...(definition.allowedTodoTests ?? [])].sort();
  const actualSkipped = exactVitestExceptions(report, 'pending');
  const actualTodo = exactVitestExceptions(report, 'todo');
  if (JSON.stringify(actualSkipped) !== JSON.stringify(expectedSkipped)
    || JSON.stringify(actualTodo) !== JSON.stringify(expectedTodo)) {
    throw new Error(`${definition.id} emitted an unexpected skipped/todo test identity`);
  }
  const summary = passedTestSummary({
    total: report.numTotalTests,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    skipped: report.numPendingTests,
    todo: report.numTodoTests,
  }, definition);
  if (report.success !== true || report.numFailedTestSuites !== 0) {
    throw new Error(`${definition.id} JSON report is not a complete pass`);
  }
  if (expectedSkipped.length === 0 && report.numPendingTestSuites !== 0) {
    throw new Error(`${definition.id} JSON report contains a skipped suite`);
  }
  return summary;
}

function tapCount(source, label) {
  const matches = [...source.matchAll(new RegExp(`^# ${label} (\\d+)$`, 'gm'))];
  if (matches.length !== 1) throw new Error(`micro_manifest TAP report has invalid ${label} total`);
  return Number(matches[0][1]);
}

function nodeTapSummary(source, definition) {
  const total = tapCount(source, 'tests');
  const failed = tapCount(source, 'fail') + tapCount(source, 'cancelled');
  return passedTestSummary({
    total,
    passed: tapCount(source, 'pass'),
    failed,
    skipped: tapCount(source, 'skipped'),
    todo: tapCount(source, 'todo'),
  }, definition);
}

function goJsonSummary(source, definition) {
  const terminal = new Map();
  for (const [index, line] of source.split('\n').entries()) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new Error(`${definition.id} emitted invalid JSON on line ${index + 1}: ${error.message}`);
    }
    if (!event.Test || !['pass', 'fail', 'skip'].includes(event.Action)) continue;
    terminal.set(`${event.Package}\0${event.Test}`, event.Action);
  }
  const states = [...terminal.values()];
  return passedTestSummary({
    total: states.length,
    passed: states.filter((state) => state === 'pass').length,
    failed: states.filter((state) => state === 'fail').length,
    skipped: states.filter((state) => state === 'skip').length,
    todo: 0,
  }, definition);
}

function postgresTestTarget(dsn, variable) {
  let parsed;
  try {
    parsed = new URL(dsn);
  } catch {
    // Never echo a DSN parse error: URL implementations may include the
    // credential-bearing input in their diagnostic text.
    throw new Error(`${variable} must be a PostgreSQL URL`);
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
    || !parsed.hostname || !parsed.pathname || parsed.pathname === '/') {
    throw new Error(`${variable} must identify an explicit PostgreSQL database`);
  }
  return [
    parsed.hostname.toLowerCase(),
    parsed.port || '5432',
    decodeURIComponent(parsed.pathname.slice(1)),
  ].join('\0');
}

async function executeVitestGate(definition, {
  temporaryDirectory, script, apiBase, npmTest = false, live = false,
}) {
  const reportPath = join(temporaryDirectory, `${definition.id}.json`);
  const execution = await runCommand({
    command: NPM,
    args: [
      ...(npmTest ? ['test'] : ['run', script]),
      '--', '--reporter=json', `--outputFile=${reportPath}`,
    ],
    env: live ? { MVP_CONTENT: '1', VITE_API_URL: apiBase } : {},
  });
  if (execution.exitCode !== 0) return { execution, testSummary: null, reportHash: null };
  const report = readJson(reportPath, definition.id);
  return {
    execution,
    testSummary: vitestSummary(report, definition),
    reportHash: sha256File(reportPath),
  };
}

export async function executeMicroMvpReleaseGate(definition, {
  apiBase,
  frontendBase,
  temporaryDirectory,
  expectedDeployedCommit,
}) {
  process.stdout.write(`\n[release-evidence] ${definition.id}: ${definition.command}\n`);
  let execution;
  let testSummary = null;
  let reportHash = null;
  let testCoverage = null;
  switch (definition.id) {
    case 'backend_go_test': {
      const integrationVariables = ['CANONICAL_RUNTIME_TEST_DSN', 'CONTENT_MIGRATION_TEST_DSN'];
      for (const variable of integrationVariables) {
        if (!process.env[variable]?.trim()) {
          throw new Error(`${definition.id} requires ${variable}; integration skips are forbidden`);
        }
      }
      if (process.env.CONTENT_MIGRATION_TEST_BOOTSTRAP === '1') {
        throw new Error(
          `${definition.id} forbids CONTENT_MIGRATION_TEST_BOOTSTRAP; release evidence requires a restored production-like content database`,
        );
      }
      const canonicalTarget = postgresTestTarget(
        process.env.CANONICAL_RUNTIME_TEST_DSN,
        'CANONICAL_RUNTIME_TEST_DSN',
      );
      const contentTarget = postgresTestTarget(
        process.env.CONTENT_MIGRATION_TEST_DSN,
        'CONTENT_MIGRATION_TEST_DSN',
      );
      if (canonicalTarget === contentTarget) {
        throw new Error(
          `${definition.id} requires distinct canonical-runtime and restored content PostgreSQL databases`,
        );
      }
      execution = await runCommand({
        command: 'go',
        args: ['test', '-race', '-count=1', '-p', '1', '-json', './...'],
        cwd: BACKEND_ROOT,
        captureStdout: true,
      });
      if (execution.exitCode === 0) {
        const reportBytes = execution.stdout ?? Buffer.alloc(0);
        testSummary = goJsonSummary(reportBytes.toString('utf8'), definition);
        reportHash = `sha256:${createHash('sha256').update(reportBytes).digest('hex')}`;
      }
      break;
    }
    case 'backend_go_vet':
      execution = await runCommand({ command: 'go', args: ['vet', './...'], cwd: BACKEND_ROOT });
      break;
    case 'deployment_health': {
      if (!/^[0-9a-f]{40}$/.test(expectedDeployedCommit ?? '')) {
        throw new Error('deployment_health requires an exact expected deployed commit');
      }
      execution = await executeDeploymentHealthGate(apiBase, frontendBase, expectedDeployedCommit);
      break;
    }
    case 'frontend_test': ({ execution, testSummary, reportHash } = await executeVitestGate(
      definition,
      { temporaryDirectory, apiBase, npmTest: true },
    )); break;
    case 'frontend_mvp': ({ execution, testSummary, reportHash } = await executeVitestGate(
      definition,
      { temporaryDirectory, apiBase, script: 'test:mvp', live: true },
    )); break;
    case 'micro_manifest': {
      const reportPath = join(temporaryDirectory, 'micro-manifest.tap');
      execution = await runCommand({
        command: NPM,
        args: ['run', 'test:micro:manifest'],
        env: {
          NODE_OPTIONS: `--test-reporter=tap --test-reporter-destination=${reportPath}`,
        },
      });
      if (execution.exitCode === 0) {
        const source = readFileSync(reportPath, 'utf8');
        testSummary = nodeTapSummary(source, definition);
        reportHash = sha256File(reportPath);
      }
      break;
    }
    case 'micro_matrix': ({ execution, testSummary, reportHash } = await executeVitestGate(
      definition,
      { temporaryDirectory, apiBase, script: 'test:micro:matrix' },
    )); break;
    case 'rules_core_coverage': ({ execution, testSummary, reportHash } = await executeVitestGate(
      definition,
      { temporaryDirectory, apiBase, script: 'test:rules:coverage' },
    )); break;
    case 'rules_primitive_coverage': ({ execution, testSummary, reportHash } = await executeVitestGate(
      definition,
      { temporaryDirectory, apiBase, script: 'test:rules:primitives' },
    )); break;
    case 'semantic_coverage': {
      execution = await runCommand({ command: NPM, args: ['run', 'test:micro:coverage'] });
      if (execution.exitCode === 0) {
        const manifestPath = resolve(FRONTEND_ROOT, '.micro-mvp-evidence/execution-manifest.json');
        const coveragePath = resolve(FRONTEND_ROOT, '.micro-mvp-evidence/coverage-summary.json');
        const manifest = readJson(manifestPath, definition.id);
        testCoverage = validateMicroMvpTestCoverageSummary(
          readJson(coveragePath, `${definition.id} coverage`),
          currentMicroMvpReleaseIdentity(),
        );
        const states = manifest.tests?.map((item) => item.state) ?? [];
        testSummary = passedTestSummary({
          total: manifest.testCount,
          passed: states.filter((state) => state === 'passed').length,
          failed: states.filter((state) => state === 'failed').length,
          skipped: states.filter((state) => state === 'skipped').length,
          todo: states.filter((state) => state === 'todo').length,
        }, definition);
        if (manifest.runResult !== 'passed' || manifest.unhandledErrorCount !== 0) {
          throw new Error('offline coverage execution manifest did not pass cleanly');
        }
        reportHash = `sha256:${createHash('sha256')
          .update(readFileSync(manifestPath))
          .update(readFileSync(coveragePath))
          .digest('hex')}`;
      }
      break;
    }
    case 'live_matrix': {
      const reportPath = join(temporaryDirectory, 'live-matrix.json');
      execution = await runCommand({
        command: NPM,
        args: [
          'run', 'test:micro:live-matrix', '--',
          '--reporter=json', `--outputFile=${reportPath}`,
        ],
        env: { MVP_CONTENT: '1', VITE_API_URL: apiBase },
      });
      if (execution.exitCode === 0) {
        const report = readJson(reportPath, definition.id);
        testSummary = vitestSummary(report, definition);
        reportHash = sha256File(reportPath);
      }
      break;
    }
    case 'rules_lab_fixture':
      execution = await runCommand({ command: NPM, args: ['run', 'rules-lab:check'] });
      break;
    case 'sheet_combat_certification':
      execution = await runCommand({ command: NPM, args: ['run', 'sheet-combat-certification:check'] });
      break;
    case 'build':
      execution = await runCommand({
        command: NPM,
        args: ['run', 'build'],
        env: { VITE_API_URL: apiBase },
      });
      break;
    case 'lint':
      execution = await runCommand({ command: NPM, args: ['run', 'lint'] });
      break;
    case 'browser': {
      const reportPath = join(temporaryDirectory, 'playwright.json');
      execution = await runCommand({
        command: process.execPath,
        args: [PLAYWRIGHT_CLI, 'test', '--reporter=json'],
        env: {
          CI: '1',
          VITE_API_URL: apiBase,
          PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath,
        },
      });
      if (execution.exitCode === 0) {
        const report = readJson(reportPath, definition.id);
        testSummary = passedTestSummary({
          total: Number(report.stats?.expected ?? 0)
            + Number(report.stats?.skipped ?? 0)
            + Number(report.stats?.unexpected ?? 0)
            + Number(report.stats?.flaky ?? 0),
          passed: Number(report.stats?.expected ?? 0),
          failed: Number(report.stats?.unexpected ?? 0) + Number(report.stats?.flaky ?? 0),
          skipped: Number(report.stats?.skipped ?? 0),
        }, definition);
        if ((report.errors?.length ?? 0) !== 0) throw new Error('browser report has global errors');
        reportHash = sha256File(reportPath);
      }
      break;
    }
    default:
      throw new Error(`unsupported release gate ${definition.id}`);
  }
  if (execution.exitCode !== 0) throw new Error(`${definition.id} failed with exit code ${execution.exitCode}`);
  return {
    id: definition.id,
    command: definition.command,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
    status: 'passed',
    exitCode: 0,
    outputHash: execution.outputHash,
    outputBytes: execution.outputBytes,
    reportHash,
    testSummary,
    ...(testCoverage ? { testCoverage } : {}),
  };
}

export async function generateMicroMvpReleaseEvidence({
  apiBase,
  frontendBase,
  artifactPath,
  sourceCommit,
  expectedDeployedCommit,
  gateExecutor = executeMicroMvpReleaseGate,
  catalogLoader = () => loadCertificationCatalogs(undefined, { baseUrl: apiBase }),
  coverageExpander = expandMicroMvpCoverageSummaryForCatalogs,
  sourceCommitVerifier = assertCurrentMicroMvpSourceMatchesCommit,
} = {}) {
  if (!apiBase || !frontendBase || !artifactPath || !sourceCommit || !expectedDeployedCommit) {
    throw new Error(
      '--api, --frontend, --artifact, --source-commit and --expected-deployed-commit are required',
    );
  }
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)
    || !/^[0-9a-f]{40}$/.test(expectedDeployedCommit)) {
    throw new Error('source and expected deployed commits must be full lowercase 40-hex IDs');
  }
  if (sourceCommit !== expectedDeployedCommit) {
    throw new Error('--expected-deployed-commit must exactly equal --source-commit');
  }
  if (currentMicroMvpSourceCommit() !== sourceCommit) {
    throw new Error('--source-commit must exactly equal local HEAD');
  }
  await sourceCommitVerifier(sourceCommit);
  if (process.env.API_URL && process.env.API_URL !== apiBase) {
    throw new Error('--api must exactly equal API_URL when API_URL is set');
  }
  if (process.env.FRONTEND_URL && process.env.FRONTEND_URL !== frontendBase) {
    throw new Error('--frontend must exactly equal FRONTEND_URL when FRONTEND_URL is set');
  }
  const parsedApi = new URL(apiBase);
  if (!['http:', 'https:'].includes(parsedApi.protocol)
    || parsedApi.username || parsedApi.password || parsedApi.search || parsedApi.hash
    || parsedApi.pathname !== '/' || apiBase.endsWith('/')) {
    throw new Error('--api must be an exact credential-free HTTP(S) origin without trailing slash');
  }
  assertExactHttpOrigin(frontendBase, '--frontend');

  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'micro-mvp-release-evidence-'));
  const startedAt = new Date().toISOString();
  const sourceBefore = currentMicroMvpReleaseIdentity();
  try {
    const gates = [];
    for (const definition of REQUIRED_RELEASE_GATES) {
      gates.push(await gateExecutor(definition, {
        apiBase,
        frontendBase,
        temporaryDirectory,
        expectedDeployedCommit,
      }));
    }
    const catalogs = await catalogLoader();
    const semanticCoverageGate = gates.find((gate) => gate.id === 'semantic_coverage');
    semanticCoverageGate.testCoverage = coverageExpander(
      semanticCoverageGate.testCoverage,
      catalogs,
    );
    const sourceAfter = currentMicroMvpReleaseIdentity();
    if (JSON.stringify(sourceBefore) !== JSON.stringify(sourceAfter)) {
      throw new Error('release source changed while mandatory gates were running');
    }
    const artifact = {
      schemaVersion: MICRO_MVP_RELEASE_EVIDENCE_SCHEMA_VERSION,
      kind: MICRO_MVP_RELEASE_EVIDENCE_KIND,
      evidenceId: randomUUID(),
      apiBase,
      frontendBase,
      startedAt,
      completedAt: new Date().toISOString(),
      status: 'passed',
      totalTests: gates.reduce((total, gate) => total + (gate.testSummary?.total ?? 0), 0),
      passedTests: gates.reduce((total, gate) => total + (gate.testSummary?.passed ?? 0), 0),
      skippedTests: gates.reduce((total, gate) => total + (gate.testSummary?.skipped ?? 0), 0),
      failedTests: gates.reduce((total, gate) => total + (gate.testSummary?.failed ?? 0), 0),
      todoTests: gates.reduce((total, gate) => total + (gate.testSummary?.todo ?? 0), 0),
      deploymentAttestation: {
        sourceCommit,
        expectedDeployedCommit,
        basis: 'operator-supplied-commit-identity',
        externalVerificationRequired: true,
      },
      release: sourceAfter,
      catalog: microMvpCatalogFingerprint(catalogs),
      gates,
    };
    validateMicroMvpReleaseEvidenceArtifact(artifact, {
      apiBase, frontendBase, catalogs, sourceCommit,
    });
    const destination = writeMicroMvpReleaseEvidenceAtomic(artifactPath, artifact, {
      refuseOverwrite: true,
    });
    process.stdout.write(`\nEVIDENCE ${artifact.evidenceId} -> ${destination}\n`);
    return { artifact, destination };
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  await generateMicroMvpReleaseEvidence(args);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message ?? error);
    console.error(usage());
    process.exitCode = 1;
  });
}
