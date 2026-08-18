import { describe, expect, it } from 'vitest';
import type { ValidatedMicroMvpEvidenceExecutionManifest } from './microMvpEvidenceExecution';
import {
  BASIC_INTERACTION_EVIDENCE,
  validateBasicInteractionEvidenceExecution,
} from './basicInteractionEvidence';

function manifest(): ValidatedMicroMvpEvidenceExecutionManifest {
  const tests = BASIC_INTERACTION_EVIDENCE.flatMap((contract) => (
    [contract.unit, contract.twoPc].map((locator, index) => ({
      testId: `${contract.primitive}:${locator.evidenceKind}:${index}`,
      testFile: locator.testFile,
      fullTestName: locator.testName,
      testName: locator.testName,
      state: 'passed' as const,
      meta: {
        basicPrimitive: contract.primitive,
        evidenceKind: locator.evidenceKind,
      },
    }))
  ));
  return {
    schemaVersion: 2,
    runId: 'test-run',
    startedAt: '2026-08-18T00:00:00.000Z',
    createdAt: '2026-08-18T00:00:01.000Z',
    configHash: 'test-config',
    runResult: 'passed',
    unhandledErrorCount: 0,
    testCount: tests.length,
    tests,
  } as unknown as ValidatedMicroMvpEvidenceExecutionManifest;
}

describe('basic interaction evidence contract', () => {
  it('requires focused and two-PC evidence for all four reusable primitives', () => {
    expect(BASIC_INTERACTION_EVIDENCE.map((item) => item.primitive).sort()).toEqual([
      'ability_check', 'attack', 'resource_spend', 'saving_throw',
    ]);
    expect(() => validateBasicInteractionEvidenceExecution(manifest())).not.toThrow();
  });

  it('fails closed on a missing, failed, or metadata-free execution', () => {
    const complete = manifest();
    const missing = {
      ...complete,
      tests: complete.tests.slice(1),
    } as unknown as ValidatedMicroMvpEvidenceExecutionManifest;
    expect(() => validateBasicInteractionEvidenceExecution(missing)).toThrow(/matched 0 executions/);

    const failed = {
      ...complete,
      tests: complete.tests.map((test, index) => index === 0
        ? { ...test, state: 'failed' as const }
        : test),
    } as unknown as ValidatedMicroMvpEvidenceExecutionManifest;
    expect(() => validateBasicInteractionEvidenceExecution(failed)).toThrow(/execution is failed/);

    const unbound = {
      ...complete,
      tests: complete.tests.map((test, index) => index === 0
        ? { ...test, meta: {} }
        : test),
    } as unknown as ValidatedMicroMvpEvidenceExecutionManifest;
    expect(() => validateBasicInteractionEvidenceExecution(unbound)).toThrow(/metadata/);
  });
});
