import type { RegisteredScenarioTestEvidence } from '../coverage/microMvpEvidence';

export const COMPILED_WARLOCK_INVOCATION_SCENARIO_TEST_FILE =
  'src/rules-core/testing/compiledWarlockInvocationScenarios.test.ts' as const;

export const COMPILED_WARLOCK_INVOCATION_SCENARIO_EVIDENCE = [
  {
    assertionId: 'SCENARIO-COMPILED-WARLOCK-ARMOR-OF-SHADOWS',
    testFile: COMPILED_WARLOCK_INVOCATION_SCENARIO_TEST_FILE,
    testName: 'runs compiled Armor of Shadows as self-only at-will Mage Armor without spending the Pact slot',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-WARLOCK-ARMOR-SHADOWS-01',
    links: [{
      entityId: 'class.warlock',
      obligationId: 'derived.invocation.armor-of-shadows',
    }],
  },
  {
    assertionId: 'SCENARIO-COMPILED-WARLOCK-ELDRITCH-MIND',
    testFile: COMPILED_WARLOCK_INVOCATION_SCENARIO_TEST_FILE,
    testName: 'runs compiled Eldritch Mind through a damaging cross-PC spell and the exact Concentration save',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-WARLOCK-ELDRITCH-MIND-01',
    links: [{
      entityId: 'class.warlock',
      obligationId: 'derived.invocation.eldritch-mind',
    }],
  },
  {
    assertionId: 'SCENARIO-COMPILED-WARLOCK-PACT-TOME',
    testFile: COMPILED_WARLOCK_INVOCATION_SCENARIO_TEST_FILE,
    testName: 'runs a compiled Pact Tome cantrip from its source-owned book and preserves all five choices',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-WARLOCK-PACT-TOME-01',
    links: [{
      entityId: 'class.warlock',
      obligationId: 'derived.invocation.pact-tome',
    }],
  },
] as const satisfies readonly RegisteredScenarioTestEvidence[];
