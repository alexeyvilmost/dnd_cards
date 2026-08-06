export const MICRO_MVP_EVIDENCE_MANIFEST_SCHEMA_VERSION = 2 as const;

export type MicroMvpEvidenceExecutionState = 'passed' | 'failed' | 'skipped' | 'todo';
export type MicroMvpEvidenceRunResult = 'passed' | 'failed' | 'interrupted';
export type MicroMvpEvidenceJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly MicroMvpEvidenceJsonValue[]
  | { readonly [key: string]: MicroMvpEvidenceJsonValue };
export type MicroMvpEvidenceExecutionMetadata = Readonly<Record<string, MicroMvpEvidenceJsonValue>>;

export interface MicroMvpEvidenceExecutionRecord {
  /** Vitest's deterministic task identity, including project, module and order. */
  testId: string;
  testFile: string;
  /** Vitest's exact suite-qualified name, separated by ` > `. */
  fullTestName: string;
  /** The exact leaf name used by the existing evidence registries. */
  testName: string;
  state: MicroMvpEvidenceExecutionState;
  /** JSON-safe Vitest task metadata, including semantic protocol tags when supplied. */
  meta: MicroMvpEvidenceExecutionMetadata;
}

export interface MicroMvpEvidenceExecutionManifest {
  schemaVersion: typeof MICRO_MVP_EVIDENCE_MANIFEST_SCHEMA_VERSION;
  runId: string;
  startedAt: string;
  createdAt: string;
  configHash: string;
  runResult: MicroMvpEvidenceRunResult;
  unhandledErrorCount: number;
  testCount: number;
  tests: readonly MicroMvpEvidenceExecutionRecord[];
}

export interface MicroMvpEvidenceManifestExpectation {
  runId: string;
  startedAt: string;
  configHash: string;
  now?: Date;
  maxAgeMs?: number;
}

export interface MicroMvpEvidenceManifestIssue {
  code:
    | 'invalid_manifest'
    | 'invalid_test_record'
    | 'duplicate_test_record'
    | 'run_id_mismatch'
    | 'run_started_at_mismatch'
    | 'config_hash_mismatch'
    | 'created_before_run'
    | 'created_in_future'
    | 'manifest_expired';
  message: string;
}

declare const validatedManifest: unique symbol;
export type ValidatedMicroMvpEvidenceExecutionManifest = MicroMvpEvidenceExecutionManifest & {
  readonly [validatedManifest]: true;
};

export class MicroMvpEvidenceExecutionManifestError extends Error {
  constructor(readonly issues: readonly MicroMvpEvidenceManifestIssue[]) {
    super([
      `micro-MVP evidence execution manifest has ${issues.length} issue(s):`,
      ...issues.map((issue) => `[${issue.code}] ${issue.message}`),
    ].join('\n'));
    this.name = 'MicroMvpEvidenceExecutionManifestError';
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function isJsonSafeValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (ancestors.has(value)) return false;
  const nestedAncestors = new Set(ancestors).add(value);
  if (Array.isArray(value)) {
    return value.every((item) => isJsonSafeValue(item, nestedAncestors));
  }
  const prototype = Object.getPrototypeOf(value);
  return (prototype === null || prototype === Object.prototype)
    && Object.values(value).every((item) => isJsonSafeValue(item, nestedAncestors));
}

export function isNormalizedMicroMvpTestFile(testFile: string): boolean {
  const segments = testFile.split('/');
  return testFile.length > 0
    && !testFile.includes('\\')
    && !testFile.startsWith('/')
    && segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function parseTestRecord(
  value: unknown,
  index: number,
  issues: MicroMvpEvidenceManifestIssue[],
): MicroMvpEvidenceExecutionRecord | undefined {
  if (!isObject(value)) {
    issues.push({ code: 'invalid_test_record', message: `tests[${index}] must be an object` });
    return undefined;
  }
  const {
    testId, testFile, fullTestName, testName, state, meta,
  } = value;
  const validState = state === 'passed' || state === 'failed' || state === 'skipped' || state === 'todo';
  const validName = typeof testName === 'string' && testName.length > 0;
  const validFullName = typeof fullTestName === 'string'
    && fullTestName.length > 0
    && validName
    && (fullTestName === testName || fullTestName.endsWith(` > ${testName}`));
  if (
    typeof testId !== 'string'
    || testId.length === 0
    || typeof testFile !== 'string'
    || !isNormalizedMicroMvpTestFile(testFile)
    || !validName
    || !validFullName
    || !validState
    || !isObject(meta)
    || !isJsonSafeValue(meta)
  ) {
    issues.push({
      code: 'invalid_test_record',
      message: `tests[${index}] must contain a normalized file, exact full/leaf names, and a valid state`,
    });
    return undefined;
  }
  return {
    testId,
    testFile,
    fullTestName: fullTestName as string,
    testName: testName as string,
    state: state as MicroMvpEvidenceExecutionState,
    meta: meta as MicroMvpEvidenceExecutionMetadata,
  };
}

export function validateMicroMvpEvidenceExecutionManifest(
  value: unknown,
  expected: MicroMvpEvidenceManifestExpectation,
): ValidatedMicroMvpEvidenceExecutionManifest {
  const issues: MicroMvpEvidenceManifestIssue[] = [];
  if (!isObject(value)) {
    throw new MicroMvpEvidenceExecutionManifestError([
      { code: 'invalid_manifest', message: 'manifest root must be an object' },
    ]);
  }

  const tests = Array.isArray(value.tests)
    ? value.tests.flatMap((record, index) => {
      const parsed = parseTestRecord(record, index, issues);
      return parsed ? [parsed] : [];
    })
    : [];
  if (!Array.isArray(value.tests)) {
    issues.push({ code: 'invalid_manifest', message: 'tests must be an array' });
  }
  const runResult = value.runResult;
  const validRunResult = runResult === 'passed' || runResult === 'failed' || runResult === 'interrupted';
  if (
    value.schemaVersion !== MICRO_MVP_EVIDENCE_MANIFEST_SCHEMA_VERSION
    || typeof value.runId !== 'string'
    || !isIsoDate(value.startedAt)
    || !isIsoDate(value.createdAt)
    || typeof value.configHash !== 'string'
    || !validRunResult
    || !Number.isInteger(value.unhandledErrorCount)
    || (value.unhandledErrorCount as number) < 0
    || !Number.isInteger(value.testCount)
    || value.testCount !== tests.length
  ) {
    issues.push({
      code: 'invalid_manifest',
      message: 'manifest metadata or declared testCount is invalid',
    });
  }

  if (value.runId !== expected.runId) {
    issues.push({ code: 'run_id_mismatch', message: 'manifest does not belong to the current runner invocation' });
  }
  if (value.startedAt !== expected.startedAt) {
    issues.push({ code: 'run_started_at_mismatch', message: 'manifest start timestamp does not match the current run' });
  }
  if (value.configHash !== expected.configHash) {
    issues.push({ code: 'config_hash_mismatch', message: 'manifest was collected with another evidence configuration' });
  }

  const createdAtMs = typeof value.createdAt === 'string' ? Date.parse(value.createdAt) : Number.NaN;
  const startedAtMs = Date.parse(expected.startedAt);
  const nowMs = (expected.now ?? new Date()).getTime();
  const maxAgeMs = expected.maxAgeMs ?? 60 * 60 * 1000;
  if (Number.isFinite(createdAtMs) && Number.isFinite(startedAtMs) && createdAtMs < startedAtMs) {
    issues.push({ code: 'created_before_run', message: 'manifest predates the current collection run' });
  }
  if (Number.isFinite(createdAtMs) && createdAtMs > nowMs + 5_000) {
    issues.push({ code: 'created_in_future', message: 'manifest creation time is implausibly in the future' });
  }
  if (Number.isFinite(createdAtMs) && nowMs - createdAtMs > maxAgeMs) {
    issues.push({ code: 'manifest_expired', message: 'manifest is too old for the current acceptance run' });
  }

  const recordIds = new Set<string>();
  for (const record of tests) {
    if (recordIds.has(record.testId)) {
      issues.push({
        code: 'duplicate_test_record',
        message: `Vitest task ${record.testId} appears more than once`,
      });
    }
    recordIds.add(record.testId);
  }

  if (issues.length) throw new MicroMvpEvidenceExecutionManifestError(issues);
  return value as unknown as ValidatedMicroMvpEvidenceExecutionManifest;
}

export function matchingMicroMvpEvidenceExecutions(
  manifest: ValidatedMicroMvpEvidenceExecutionManifest,
  locator: { testFile: string; testName: string },
): readonly MicroMvpEvidenceExecutionRecord[] {
  return manifest.tests.filter((test) => (
    test.testFile === locator.testFile && test.testName === locator.testName
  ));
}
