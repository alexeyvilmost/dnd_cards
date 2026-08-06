import type { RegisteredScenarioTestEvidence } from './coverage/microMvpEvidence';

export const COMPILED_WORLD_SPELL_SCENARIO_TEST_FILE =
  'src/rules-core/compiledWorldSpellScenarios.integration.test.ts' as const;

/**
 * Scenario links are kept outside the Vitest module so the blocking coverage
 * gate can materialize them without importing and registering the tests.
 */
export const COMPILED_WORLD_SPELL_SCENARIO_EVIDENCE = [
  {
    assertionId: 'SCENARIO-COMPILED-WORLD-DANCING-LIGHTS',
    testFile: COMPILED_WORLD_SPELL_SCENARIO_TEST_FILE,
    testName: 'casts compiled Dancing Lights, moves the linked lights, and preserves exact concentration through reload',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-WORLD-DANCING-LIGHTS-01',
    links: [{ entityId: 'spell.dancing-lights', obligationId: 'micro-mvp.entity.spell.dancing-lights' }],
  },
  {
    assertionId: 'SCENARIO-COMPILED-WORLD-DRUIDCRAFT',
    testFile: COMPILED_WORLD_SPELL_SCENARIO_TEST_FILE,
    testName: 'casts compiled Druidcraft and mutates only the explicit legal plant target',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-WORLD-DRUIDCRAFT-01',
    links: [{ entityId: 'spell.druidcraft', obligationId: 'micro-mvp.entity.spell.druidcraft' }],
  },
  {
    assertionId: 'SCENARIO-COMPILED-WORLD-MENDING',
    testFile: COMPILED_WORLD_SPELL_SCENARIO_TEST_FILE,
    testName: 'casts compiled Mending and repairs the explicit touched break through replay',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-WORLD-MENDING-01',
    links: [{ entityId: 'spell.mending', obligationId: 'micro-mvp.entity.spell.mending' }],
  },
  {
    assertionId: 'SCENARIO-COMPILED-WORLD-PRESTIDIGITATION',
    testFile: COMPILED_WORLD_SPELL_SCENARIO_TEST_FILE,
    testName: 'casts compiled Prestidigitation and expires its creation at the exact source-turn boundary',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-WORLD-PRESTIDIGITATION-01',
    links: [{ entityId: 'spell.prestidigitation', obligationId: 'micro-mvp.entity.spell.prestidigitation' }],
  },
  {
    assertionId: 'SCENARIO-COMPILED-WORLD-LIGHT',
    testFile: COMPILED_WORLD_SPELL_SCENARIO_TEST_FILE,
    testName: 'casts compiled Light twice and replaces only the caster previous illumination',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-WORLD-LIGHT-01',
    links: [
      { entityId: 'spell.light', obligationId: 'micro-mvp.entity.spell.light' },
      { entityId: 'spell.light', obligationId: 'derived.runtime.light-world-illumination' },
    ],
  },
  {
    assertionId: 'SCENARIO-COMPILED-WORLD-DETECT-MAGIC',
    testFile: COMPILED_WORLD_SPELL_SCENARIO_TEST_FILE,
    testName: 'casts compiled Detect Magic with a source-owned slot and reveals only an unblocked visible aura on a later turn',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-WORLD-DETECT-MAGIC-01',
    links: [
      { entityId: 'spell.detect-magic', obligationId: 'micro-mvp.entity.spell.detect-magic' },
      { entityId: 'spell.detect-magic', obligationId: 'derived.runtime.detect-magic-world-sensing' },
      { entityId: 'class.wizard', obligationId: 'micro-mvp.entity.class.wizard' },
      { entityId: 'class.wizard', obligationId: 'derived.runtime.wizard-prepared-subset' },
    ],
  },
  {
    assertionId: 'SCENARIO-COMPILED-WORLD-DETECT-POISON',
    testFile: COMPILED_WORLD_SPELL_SCENARIO_TEST_FILE,
    testName: 'casts compiled Detect Poison and Disease with a source-owned slot and records its exact sensed poison fact',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-WORLD-DETECT-POISON-01',
    links: [{
      entityId: 'spell.detect-poison-and-disease',
      obligationId: 'micro-mvp.entity.spell.detect-poison-and-disease',
    }],
  },
  {
    assertionId: 'SCENARIO-COMPILED-WORLD-PURIFY',
    testFile: COMPILED_WORLD_SPELL_SCENARIO_TEST_FILE,
    testName: 'casts compiled Purify Food and Drink with a source-owned slot and changes only nonmagical food in its sphere',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-WORLD-PURIFY-01',
    links: [{
      entityId: 'spell.purify-food-and-drink',
      obligationId: 'micro-mvp.entity.spell.purify-food-and-drink',
    }],
  },
] as const satisfies readonly RegisteredScenarioTestEvidence[];
