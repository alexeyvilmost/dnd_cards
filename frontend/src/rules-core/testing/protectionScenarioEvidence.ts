import { microMvpEntityObligationId } from '../coverage/microMvpDenominator';
import type { RegisteredScenarioTestEvidence } from '../coverage/microMvpEvidence';

export const PROTECTION_RUNTIME_SCENARIO_TEST_FILE =
  'src/rules-core/protectionRuntime.integration.test.ts' as const;

/**
 * Exported separately so the central denominator can register it explicitly;
 * merely importing this module never changes acceptance status.
 */
export const PROTECTION_RUNTIME_SCENARIO_EVIDENCE = [{
  assertionId: 'SCENARIO-COMPILED-FIGHTING-STYLE-PROTECTION-RUNTIME',
  testFile: PROTECTION_RUNTIME_SCENARIO_TEST_FILE,
  testName: 'protects the first and later attacks before RNG, survives later invisibility and Shield, then ends irreversibly beyond 5 feet',
  semanticProtocol: 'mandatory-two-pc-v1',
  scenarioId: 'SC-PROTECTION-RUNTIME-01',
  links: [{
    entityId: 'fighting-style.protection',
    obligationId: microMvpEntityObligationId('fighting-style.protection'),
  }],
}] as const satisfies readonly RegisteredScenarioTestEvidence[];
