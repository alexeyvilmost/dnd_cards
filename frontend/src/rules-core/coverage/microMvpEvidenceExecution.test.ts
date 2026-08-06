import { describe, expect, it } from 'vitest';
import {
  materializeMicroMvpScenarioTestEvidence,
  materializeMicroMvpUnitEvidence,
  MicroMvpEvidenceRegistrationError,
  type RegisteredScenarioTestEvidence,
  type RegisteredUnitEvidence,
  type RegisteredUnitTestLocator,
} from './microMvpEvidence';
import {
  MicroMvpEvidenceExecutionManifestError,
  validateMicroMvpEvidenceExecutionManifest,
  type MicroMvpEvidenceExecutionManifest,
  type MicroMvpEvidenceExecutionRecord,
  type MicroMvpEvidenceExecutionState,
  type MicroMvpEvidenceManifestExpectation,
} from './microMvpEvidenceExecution';

declare module '@vitest/runner' {
  interface TaskMeta {
    semanticProtocol?: string;
    scenarioId?: string;
  }
}

const RUN_ID = 'execution-manifest-test-run';
const STARTED_AT = '2026-08-05T10:00:00.000Z';
const CREATED_AT = '2026-08-05T10:00:01.000Z';
const CONFIG_HASH = `sha256:${'b'.repeat(64)}`;
const EXPECTATION: MicroMvpEvidenceManifestExpectation = {
  runId: RUN_ID,
  startedAt: STARTED_AT,
  configHash: CONFIG_HASH,
  now: new Date('2026-08-05T10:00:02.000Z'),
};
const LOCATOR: RegisteredUnitTestLocator = {
  testFile: 'src/rules-core/example.integration.test.ts',
  testName: 'executes the registered semantic behavior',
};
const LINK = {
  entityId: 'class.warlock',
  obligationId: 'micro-mvp.entity.class.warlock.behavior_v1',
};

function record(
  locator: RegisteredUnitTestLocator,
  state: MicroMvpEvidenceExecutionState = 'passed',
  suite = 'compiled semantic contract',
  testId = `${locator.testFile}#${suite}#${locator.testName}`,
): MicroMvpEvidenceExecutionRecord {
  return {
    testId,
    ...locator,
    fullTestName: `${suite} > ${locator.testName}`,
    state,
    meta: {},
  };
}

function manifest(
  tests: readonly MicroMvpEvidenceExecutionRecord[],
  overrides: Partial<MicroMvpEvidenceExecutionManifest> = {},
  expectation: MicroMvpEvidenceManifestExpectation = EXPECTATION,
) {
  return validateMicroMvpEvidenceExecutionManifest({
    schemaVersion: 2,
    runId: RUN_ID,
    startedAt: STARTED_AT,
    createdAt: CREATED_AT,
    configHash: CONFIG_HASH,
    runResult: tests.some((test) => test.state === 'failed') ? 'failed' : 'passed',
    unhandledErrorCount: 0,
    testCount: tests.length,
    tests,
    ...overrides,
  }, expectation);
}

function unitRegistration(locator: RegisteredUnitTestLocator = LOCATOR): RegisteredUnitEvidence {
  return {
    assertionId: 'UNIT-EXECUTION-MANIFEST-CONTRACT',
    ...locator,
    links: [LINK],
  };
}

function expectRegistrationIssue(run: () => unknown, code: string) {
  try {
    run();
    throw new Error(`expected evidence registration issue ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(MicroMvpEvidenceRegistrationError);
    expect((error as MicroMvpEvidenceRegistrationError).issues).toContainEqual(
      expect.objectContaining({ code }),
    );
  }
}

describe('micro-MVP executable evidence manifest', () => {
  it('materializes an exact locator only from its passed current-run execution', {
    meta: {
      semanticProtocol: 'reporter-contract-v1',
      scenarioId: 'SC-REPORTER-CONTRACT',
    },
  }, () => {
    const evidence = materializeMicroMvpUnitEvidence(
      [unitRegistration()],
      manifest([record(LOCATOR)]),
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toEqual(expect.objectContaining({
      assertionId: 'UNIT-EXECUTION-MANIFEST-CONTRACT',
      result: 'passed',
      testFile: LOCATOR.testFile,
      testName: LOCATOR.testName,
    }));
  });

  it('requires every repeated Vitest task with the same parameterized full name to pass', () => {
    const repeated = [
      record(LOCATOR, 'passed', 'parameterized contract', 'parameter-case-1'),
      record(LOCATOR, 'passed', 'parameterized contract', 'parameter-case-2'),
    ];
    expect(materializeMicroMvpUnitEvidence(
      [unitRegistration()],
      manifest(repeated),
    )).toHaveLength(1);

    expectRegistrationIssue(
      () => materializeMicroMvpUnitEvidence(
        [unitRegistration()],
        manifest([
          repeated[0],
          { ...repeated[1], state: 'failed' },
        ]),
      ),
      'test_execution_not_passed',
    );
  });

  it('rejects an unqualified leaf name shared by different suites', () => {
    expectRegistrationIssue(
      () => materializeMicroMvpUnitEvidence(
        [unitRegistration()],
        manifest([
          record(LOCATOR, 'passed', 'first suite', 'first-suite-task'),
          record(LOCATOR, 'passed', 'second suite', 'second-suite-task'),
        ]),
      ),
      'ambiguous_test_execution',
    );
  });

  it('preserves JSON-safe semantic protocol metadata and rejects malformed non-object metadata', () => {
    const tagged = {
      ...record(LOCATOR),
      meta: {
        semanticProtocol: 'mandatory-two-pc-v1',
        scenarioId: 'SC-PB-01',
        checkpoints: ['reload', 'replay'],
      },
    };
    const current = manifest([tagged]);
    expect(current.tests[0].meta).toEqual(tagged.meta);

    expect(() => manifest([{
      ...tagged,
      meta: 'not-an-object',
    } as unknown as MicroMvpEvidenceExecutionRecord])).toThrow(
      MicroMvpEvidenceExecutionManifestError,
    );
  });

  it('rejects a missing execution even when the old source-string heuristic would find the test name', () => {
    const deadSource = `it('${LOCATOR.testName}', () => { /* dead text only */ })`;
    expect(deadSource).toContain(LOCATOR.testName);
    expectRegistrationIssue(
      () => materializeMicroMvpUnitEvidence([unitRegistration()], manifest([])),
      'missing_test_execution',
    );
  });

  it.each(['skipped', 'todo', 'failed'] as const)(
    'rejects a registered locator whose current execution state is %s',
    (state) => {
      expectRegistrationIssue(
        () => materializeMicroMvpUnitEvidence(
          [unitRegistration()],
          manifest([record(LOCATOR, state)]),
        ),
        'test_execution_not_passed',
      );
    },
  );

  it('rejects a named scenario-test locator when it was skipped', () => {
    const registration: RegisteredScenarioTestEvidence = {
      assertionId: 'SCENARIO-EXECUTION-MANIFEST-CONTRACT',
      ...LOCATOR,
      semanticProtocol: 'mandatory-two-pc-v1',
      scenarioId: 'SC-EXECUTION-MANIFEST-01',
      links: [LINK],
    };
    expectRegistrationIssue(
      () => materializeMicroMvpScenarioTestEvidence(
        [registration],
        manifest([record(LOCATOR, 'skipped')]),
      ),
      'test_execution_not_passed',
    );
  });

  it.each([
    {
      label: 'missing protocol',
      registration: {
        assertionId: 'SCENARIO-MISSING-PROTOCOL', ...LOCATOR,
        scenarioId: 'SC-MISSING-PROTOCOL-01', links: [LINK],
      },
    },
    {
      label: 'missing scenario id',
      registration: {
        assertionId: 'SCENARIO-MISSING-ID', ...LOCATOR,
        semanticProtocol: 'mandatory-two-pc-v1', links: [LINK],
      },
    },
    {
      label: 'forged protocol',
      registration: {
        assertionId: 'SCENARIO-FORGED-PROTOCOL', ...LOCATOR,
        semanticProtocol: 'mandatory-two-pc-v2', scenarioId: 'SC-FORGED-PROTOCOL-01', links: [LINK],
      },
    },
    {
      label: 'forged scenario id',
      registration: {
        assertionId: 'SCENARIO-FORGED-ID', ...LOCATOR,
        semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-FORGED-ID-02', links: [LINK],
      },
    },
  ])('rejects scenario evidence with $label instead of exact execution metadata', ({ registration }) => {
    const executed = {
      ...record(LOCATOR),
      meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-FORGED-ID-01' },
    };
    expectRegistrationIssue(
      () => materializeMicroMvpScenarioTestEvidence(
        [registration as unknown as RegisteredScenarioTestEvidence],
        manifest([executed]),
      ),
      'scenario_protocol_mismatch',
    );
  });

  it('rejects reused scenario IDs even when both exact executions pass with matching metadata', () => {
    const second = {
      testFile: 'src/rules-core/second-scenario.integration.test.ts',
      testName: 'executes a second mandatory scenario',
    };
    const registrations: RegisteredScenarioTestEvidence[] = [LOCATOR, second].map((locator, index) => ({
      assertionId: `SCENARIO-DUPLICATE-ID-${index + 1}`,
      ...locator,
      semanticProtocol: 'mandatory-two-pc-v1',
      scenarioId: 'SC-DUPLICATE-01',
      links: [LINK],
    }));
    const records = [LOCATOR, second].map((locator) => ({
      ...record(locator),
      meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-DUPLICATE-01' },
    }));
    expectRegistrationIssue(
      () => materializeMicroMvpScenarioTestEvidence(registrations, manifest(records)),
      'duplicate_scenario_id',
    );
  });

  it('rejects the whole conjunctive assertion when one current-run member did not pass', () => {
    const second = {
      testFile: 'src/rules-core/second.integration.test.ts',
      testName: 'executes the second half of the semantic contract',
    };
    const registration: RegisteredUnitEvidence = {
      assertionId: 'UNIT-EXECUTION-MANIFEST-CONJUNCTION',
      conjunctiveTests: [LOCATOR, second],
      links: [LINK],
    };
    expectRegistrationIssue(
      () => materializeMicroMvpUnitEvidence(
        [registration],
        manifest([record(LOCATOR), record(second, 'failed')]),
      ),
      'test_execution_not_passed',
    );
  });

  it.each([
    {
      label: 'another run id',
      overrides: { runId: 'stale-run-id' },
      expectation: EXPECTATION,
      code: 'run_id_mismatch',
    },
    {
      label: 'another config hash',
      overrides: { configHash: `sha256:${'c'.repeat(64)}` },
      expectation: EXPECTATION,
      code: 'config_hash_mismatch',
    },
    {
      label: 'a creation time before this run',
      overrides: { createdAt: '2026-08-05T09:59:59.000Z' },
      expectation: EXPECTATION,
      code: 'created_before_run',
    },
  ])('rejects a stale manifest from $label', ({ overrides, expectation, code }) => {
    try {
      manifest([record(LOCATOR)], overrides, expectation);
      throw new Error(`expected stale manifest issue ${code}`);
    } catch (error) {
      expect(error).toBeInstanceOf(MicroMvpEvidenceExecutionManifestError);
      expect((error as MicroMvpEvidenceExecutionManifestError).issues).toContainEqual(
        expect.objectContaining({ code }),
      );
    }
  });
});
