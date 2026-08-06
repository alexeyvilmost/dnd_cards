import type { RegisteredScenarioTestEvidence } from '../coverage/microMvpEvidence';

const TEST_FILE = 'src/rules-core/testing/weaponMastery2024MandatoryScenarios.test.ts';

type MasteryEvidence = {
  type: 'topple' | 'sap' | 'slow' | 'vex' | 'push' | 'graze' | 'nick' | 'cleave';
  assertionId: string;
};

const MASTERIES: readonly MasteryEvidence[] = [
  { type: 'topple', assertionId: 'SCENARIO-WEAPON-MASTERY-TOPPLE-CANONICAL' },
  { type: 'sap', assertionId: 'SCENARIO-WEAPON-MASTERY-SAP-CANONICAL' },
  { type: 'slow', assertionId: 'SCENARIO-WEAPON-MASTERY-SLOW-CANONICAL' },
  { type: 'vex', assertionId: 'SCENARIO-WEAPON-MASTERY-VEX-CANONICAL' },
  { type: 'push', assertionId: 'SCENARIO-WEAPON-MASTERY-PUSH-CANONICAL' },
  { type: 'graze', assertionId: 'SCENARIO-WEAPON-MASTERY-GRAZE-CANONICAL' },
  { type: 'nick', assertionId: 'SCENARIO-WEAPON-MASTERY-NICK-CANONICAL' },
  { type: 'cleave', assertionId: 'SCENARIO-WEAPON-MASTERY-CLEAVE-CANONICAL' },
];

/** Exact executable locators for all eight canonical PHB 2024 mastery primitives. */
export const WEAPON_MASTERY_2024_MANDATORY_SCENARIO_EVIDENCE = MASTERIES.map((entry) => ({
  assertionId: entry.assertionId,
  testFile: TEST_FILE,
  testName: `${entry.type}: real Card/Effect binding executes across the sequential two-PC protocol`,
  semanticProtocol: 'mandatory-two-pc-v1' as const,
  scenarioId: `SC-WEAPON-MASTERY-${entry.type.toUpperCase()}-01`,
  links: [{
    entityId: 'class.fighter',
    obligationId: `derived.mastery.${entry.type}`,
  }],
})) satisfies readonly RegisteredScenarioTestEvidence[];
