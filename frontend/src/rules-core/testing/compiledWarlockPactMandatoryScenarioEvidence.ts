export const COMPILED_WARLOCK_PACT_MANDATORY_SCENARIO_TEST_FILE =
  'src/rules-core/testing/compiledWarlockPactMandatoryScenarios.test.ts' as const;

const warlockLink = (obligationId: string) => ({
  entityId: 'class.warlock',
  obligationId,
});

export const COMPILED_WARLOCK_PACT_MANDATORY_SCENARIO_EVIDENCE = [
  {
    assertionId: 'SCENARIO-COMPILED-WARLOCK-PACT-BLADE-CANONICAL',
    testFile: COMPILED_WARLOCK_PACT_MANDATORY_SCENARIO_TEST_FILE,
    testName: 'runs Pact Blade bond, replacement, focus, attack, pending-safe checkpoints, and explicit terminal lifecycle',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-PB-01',
    links: [
      warlockLink('derived.invocation.pact-blade'),
      warlockLink('derived.invocation.pact-blade.bond-and-replacement'),
      warlockLink('derived.invocation.pact-blade.attack-and-damage'),
      warlockLink('derived.invocation.pact-blade.material-focus'),
      warlockLink('derived.invocation.pact-blade.end-lifecycle'),
    ],
  },
  {
    assertionId: 'SCENARIO-COMPILED-WARLOCK-PACT-CHAIN-CANONICAL',
    testFile: COMPILED_WARLOCK_PACT_MANDATORY_SCENARIO_TEST_FILE,
    testName: 'runs Pact Chain casting, actor turns, attack substitution, and Touch delivery through its one familiar',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-PC-01',
    links: [
      warlockLink('derived.invocation.pact-chain'),
      warlockLink('derived.invocation.pact-chain.casting-and-forms'),
      warlockLink('derived.invocation.pact-chain.actor-lifecycle'),
      warlockLink('derived.invocation.pact-chain.attack-substitution'),
      warlockLink('derived.invocation.pact-chain.touch-delivery'),
    ],
  },
  {
    assertionId: 'SCENARIO-COMPILED-WARLOCK-PACT-TOME-CANONICAL',
    testFile: COMPILED_WARLOCK_PACT_MANDATORY_SCENARIO_TEST_FILE,
    testName: 'runs Pact Tome rest replacement, physical focus, both casting modes, and shared explicit owner death',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-PT-01',
    links: [
      warlockLink('derived.invocation.pact-tome'),
      warlockLink('derived.invocation.pact-tome.rest-selection'),
      warlockLink('derived.invocation.pact-tome.book-and-focus'),
      warlockLink('derived.invocation.pact-tome.casting-modes'),
      warlockLink('derived.invocation.pact-tome.owner-death'),
    ],
  },
] as const;
