import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, posix, relative, resolve, sep } from 'node:path';

const MANIFEST_SCHEMA_VERSION = 2;
const EXPECTED_MANIFEST_RELATIVE_PATH = '.micro-mvp-evidence/execution-manifest.json';
const ENVIRONMENT_KEYS = Object.freeze({
  configHash: 'MICRO_MVP_EVIDENCE_CONFIG_HASH',
  manifestPath: 'MICRO_MVP_EVIDENCE_MANIFEST_PATH',
  runId: 'MICRO_MVP_EVIDENCE_RUN_ID',
  startedAt: 'MICRO_MVP_EVIDENCE_RUN_STARTED_AT',
});

function requiredEnvironment(key) {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required evidence reporter environment variable ${key}`);
  return value;
}

function normalizeTestFile(moduleId, frontendRoot) {
  const withoutQuery = moduleId.split('?')[0];
  const candidate = isAbsolute(withoutQuery)
    ? relative(frontendRoot, withoutQuery)
    : withoutQuery;
  const portable = candidate.split(sep).join('/').replace(/^\.\//, '');
  const normalized = posix.normalize(portable);
  if (
    normalized === '.'
    || normalized.startsWith('../')
    || normalized.includes('/../')
    || posix.isAbsolute(normalized)
  ) {
    throw new Error(`Vitest reported a test module outside the frontend root: ${moduleId}`);
  }
  return normalized;
}

function executionState(testCase) {
  const result = testCase.result();
  if (result.state === 'skipped' && testCase.options.mode === 'todo') return 'todo';
  if (result.state === 'skipped') return 'skipped';
  if (result.state === 'passed') return 'passed';
  return 'failed';
}

function jsonSafeValue(value, path, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error(`Cyclic Vitest metadata at ${path}`);
    const nestedAncestors = new Set(ancestors).add(value);
    return value.map((item, index) => jsonSafeValue(item, `${path}[${index}]`, nestedAncestors));
  }
  if (typeof value === 'object' && value !== null) {
    if (ancestors.has(value)) throw new Error(`Cyclic Vitest metadata at ${path}`);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) {
      throw new Error(`Non-plain Vitest metadata object at ${path}`);
    }
    const nestedAncestors = new Set(ancestors).add(value);
    return Object.fromEntries(Object.keys(value).sort().map((key) => [
      key,
      jsonSafeValue(value[key], `${path}.${key}`, nestedAncestors),
    ]));
  }
  throw new Error(`Non-JSON Vitest metadata value at ${path}`);
}

function executionMetadata(testCase) {
  const meta = testCase.meta();
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
    throw new Error(`Vitest metadata for ${testCase.fullName} must be an object`);
  }
  return jsonSafeValue(meta, 'meta');
}

function compareRecords(left, right) {
  return left.testFile.localeCompare(right.testFile)
    || left.fullTestName.localeCompare(right.fullTestName)
    || left.testName.localeCompare(right.testName)
    || left.testId.localeCompare(right.testId);
}

export default class MicroMvpEvidenceReporter {
  async onTestRunEnd(testModules, unhandledErrors, reason) {
    const frontendRoot = process.cwd();
    const manifestPath = resolve(requiredEnvironment(ENVIRONMENT_KEYS.manifestPath));
    const expectedManifestPath = resolve(frontendRoot, EXPECTED_MANIFEST_RELATIVE_PATH);
    if (manifestPath !== expectedManifestPath) {
      throw new Error(`Evidence manifest path must be ${expectedManifestPath}`);
    }
    const runId = requiredEnvironment(ENVIRONMENT_KEYS.runId);
    const startedAt = requiredEnvironment(ENVIRONMENT_KEYS.startedAt);
    const configHash = requiredEnvironment(ENVIRONMENT_KEYS.configHash);

    const tests = testModules.flatMap((testModule) => (
      [...testModule.children.allTests()].map((testCase) => ({
        testId: testCase.id,
        testFile: normalizeTestFile(testCase.module.moduleId, frontendRoot),
        fullTestName: testCase.fullName,
        testName: testCase.name,
        state: executionState(testCase),
        meta: executionMetadata(testCase),
      }))
    )).sort(compareRecords);
    const hasFailedTest = tests.some((test) => test.state === 'failed');
    const runResult = reason === 'interrupted'
      ? 'interrupted'
      : reason === 'failed' || unhandledErrors.length > 0 || hasFailedTest
        ? 'failed'
        : 'passed';
    const manifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      runId,
      startedAt,
      createdAt: new Date().toISOString(),
      configHash,
      runResult,
      unhandledErrorCount: unhandledErrors.length,
      testCount: tests.length,
      tests,
    };

    await mkdir(dirname(manifestPath), { recursive: true });
    const temporaryPath = `${manifestPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      await rename(temporaryPath, manifestPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }
}
