import { describe, expect, it } from 'vitest';
import type {
  MicroMvpEvidenceExecutionRecord,
  ValidatedMicroMvpEvidenceExecutionManifest,
} from './microMvpEvidenceExecution';
import {
  PHB_2024_CONDITION_OBLIGATIONS,
  Phb2024ConditionEvidenceError,
  validatePhb2024ConditionEvidenceContract,
  validatePhb2024ConditionEvidenceExecution,
} from './phb2024ConditionEvidence';

function passingManifest(): ValidatedMicroMvpEvidenceExecutionManifest {
  const tests: MicroMvpEvidenceExecutionRecord[] = PHB_2024_CONDITION_OBLIGATIONS
    .flatMap((item, index) => [item.unitTest, item.twoPcTest].map((locator, kindIndex) => ({
      testId: `condition-evidence:${index}:${kindIndex}`,
      testFile: locator.testFile,
      fullTestName: `condition evidence > ${locator.testName}`,
      testName: locator.testName,
      state: 'passed' as const,
      meta: {},
    })));
  return {
    schemaVersion: 2,
    runId: 'condition-evidence-test',
    startedAt: '2026-08-05T00:00:00.000Z',
    createdAt: '2026-08-05T00:00:01.000Z',
    configHash: 'sha256:test',
    runResult: 'passed',
    unhandledErrorCount: 0,
    testCount: tests.length,
    tests,
  } as unknown as ValidatedMicroMvpEvidenceExecutionManifest;
}

describe('PHB 2024 atomic condition evidence gate', () => {
  it('accepts exactly one passed unit and two-PC execution per atomic obligation', () => {
    expect(() => validatePhb2024ConditionEvidenceContract()).not.toThrow();
    expect(() => validatePhb2024ConditionEvidenceExecution(passingManifest())).not.toThrow();
  });

  it('fails closed on a missing, failed, or ambiguous exact execution', () => {
    const base = passingManifest();
    const missing = {
      ...base, tests: base.tests.slice(1),
    } as unknown as ValidatedMicroMvpEvidenceExecutionManifest;
    expect(() => validatePhb2024ConditionEvidenceExecution(missing))
      .toThrow(Phb2024ConditionEvidenceError);
    expect(() => validatePhb2024ConditionEvidenceExecution(missing))
      .toThrow(/missing_test_execution/);

    const failed = {
      ...base,
      tests: base.tests.map((test, index) => (
      index === 0 ? { ...test, state: 'failed' as const } : test
      )),
    } as unknown as ValidatedMicroMvpEvidenceExecutionManifest;
    expect(() => validatePhb2024ConditionEvidenceExecution(failed))
      .toThrow(/test_execution_not_passed/);

    const ambiguous = {
      ...base,
      tests: [...base.tests, {
        ...base.tests[0], testId: 'condition-evidence:duplicate',
      }],
    } as unknown as ValidatedMicroMvpEvidenceExecutionManifest;
    expect(() => validatePhb2024ConditionEvidenceExecution(ambiguous))
      .toThrow(/ambiguous_test_execution/);
  });
});
