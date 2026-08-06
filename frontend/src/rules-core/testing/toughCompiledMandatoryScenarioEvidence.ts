import { microMvpEntityObligationId } from '../coverage/microMvpDenominator';
import type { MandatoryTwoPcScenarioIdentity } from './mandatoryTwoPcProtocol';

export interface ToughScenarioEvidenceRegistration extends MandatoryTwoPcScenarioIdentity {
  assertionId: string;
  testFile: string;
  testName: string;
  links: ReadonlyArray<{ entityId: string; obligationId: string }>;
}

export const TOUGH_COMPILED_MANDATORY_SCENARIO_EVIDENCE = [{
  assertionId: 'SCENARIO-COMPILED-TOUGH-L1-HP-MANDATORY-PROTOCOL',
  testFile: 'src/rules-core/testing/toughCompiledMandatoryScenario.test.ts',
  testName: 'compiles Tough as exactly plus two level-1 HP then survives real two-PC spell damage, reload, migration, and replay',
  semanticProtocol: 'mandatory-two-pc-v1',
  scenarioId: 'SC-TOUGH-L1-01',
  links: [{
    entityId: 'feat.tough',
    obligationId: microMvpEntityObligationId('feat.tough'),
  }],
}] as const satisfies readonly ToughScenarioEvidenceRegistration[];
