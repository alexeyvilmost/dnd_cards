import { microMvpEntityObligationId } from '../coverage/microMvpDenominator';
import type { MandatoryTwoPcScenarioIdentity } from './mandatoryTwoPcProtocol';

export interface FighterMandatoryScenarioEvidenceLink {
  entityId: string;
  obligationId: string;
}

export interface FighterMandatoryScenarioEvidenceRegistration extends MandatoryTwoPcScenarioIdentity {
  assertionId: string;
  testFile: string;
  testName: string;
  links: readonly FighterMandatoryScenarioEvidenceLink[];
}

const TEST_FILE = 'src/rules-core/testing/fighterMandatoryProtocolScenarios.test.ts';
const link = (
  entityId: string,
  obligationId: string,
): FighterMandatoryScenarioEvidenceLink => ({ entityId, obligationId });

/** Exact executable locators for adoption by the central evidence index. */
export const FIGHTER_MANDATORY_PROTOCOL_SCENARIO_EVIDENCE = [
  {
    assertionId: 'SCENARIO-CLASS-FIGHTER-L1-MANDATORY-PROTOCOL',
    testFile: TEST_FILE,
    testName: 'runs the Fighter L1 mandatory two-PC protocol through Second Wind and Topple with exact migration and replay',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-FIGHTER-L1-01',
    links: [link('class.fighter', microMvpEntityObligationId('class.fighter'))],
  },
  {
    assertionId: 'SCENARIO-MASTERY-TOPPLE-AFTER-SHIELD-MANDATORY-PROTOCOL',
    testFile: TEST_FILE,
    testName: 'runs the mandatory two-PC protocol then resumes one Topple save after accepted Shield without repeating damage or costs',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-FIGHTER-TOPPLE-SHIELD-01',
    links: [link('class.fighter', 'derived.mastery.topple-after-shield')],
  },
  {
    assertionId: 'SCENARIO-MASTERY-TOPPLE-CONCENTRATION-MANDATORY-PROTOCOL',
    testFile: TEST_FILE,
    testName: 'runs the mandatory two-PC protocol then serializes Topple before Concentration across reloads with one pending decision',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-FIGHTER-TOPPLE-CONCENTRATION-01',
    links: [link('class.fighter', 'derived.mastery.topple-concentration-queue')],
  },
] as const satisfies readonly FighterMandatoryScenarioEvidenceRegistration[];
