import type { RegisteredScenarioTestEvidence } from './coverage/microMvpEvidence';

export const FIND_FAMILIAR_RUNTIME_SCENARIO_TEST_FILE =
  'src/rules-core/findFamiliarRuntime.integration.test.ts' as const;

export const FIND_FAMILIAR_RUNTIME_SCENARIO_EVIDENCE = [
  {
    assertionId: 'SCENARIO-COMPILED-FIND-FAMILIAR-LIFECYCLE',
    testFile: FIND_FAMILIAR_RUNTIME_SCENARIO_TEST_FILE,
    testName: 'ritually creates one pinned actor, runs strict turns/senses/dismiss/reappear, and never restores incense',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-FAMILIAR-LIFECYCLE-01',
    links: [{
      entityId: 'spell.find-familiar',
      obligationId: 'micro-mvp.entity.spell.find-familiar',
    }],
  },
  {
    assertionId: 'SCENARIO-COMPILED-PACT-CHAIN-FAMILIAR',
    testFile: FIND_FAMILIAR_RUNTIME_SCENARIO_TEST_FILE,
    testName: 'casts Pact Chain at will, gives the familiar its own turn, and replaces exactly one owner attack with its Reaction',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-FAMILIAR-PACT-CHAIN-01',
    links: [{
      entityId: 'class.warlock',
      obligationId: 'derived.invocation.pact-chain',
    }],
  },
  {
    assertionId: 'SCENARIO-COMPILED-FIND-FAMILIAR-TOUCH-ATTACK',
    testFile: FIND_FAMILIAR_RUNTIME_SCENARIO_TEST_FILE,
    testName: 'delivers compiled Chill Touch through a familiar across Shield, reload, strict turns, and exact replay',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-FAMILIAR-TOUCH-ATTACK-01',
    links: [{
      entityId: 'spell.find-familiar',
      obligationId: 'micro-mvp.entity.spell.find-familiar',
    }],
  },
] as const satisfies readonly RegisteredScenarioTestEvidence[];
