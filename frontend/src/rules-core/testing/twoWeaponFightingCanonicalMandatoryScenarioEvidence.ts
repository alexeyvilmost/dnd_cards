import { microMvpEntityObligationId } from '../coverage/microMvpDenominator';
import type { MandatoryTwoPcScenarioIdentity } from './mandatoryTwoPcProtocol';

export interface TwoWeaponFightingScenarioEvidenceRegistration extends MandatoryTwoPcScenarioIdentity {
  assertionId: string;
  testFile: string;
  testName: string;
  links: ReadonlyArray<{ entityId: string; obligationId: string }>;
}

export const TWO_WEAPON_FIGHTING_CANONICAL_MANDATORY_SCENARIO_EVIDENCE = [{
  assertionId: 'SCENARIO-COMPILED-TWO-WEAPON-FIGHTING-CANONICAL-LIGHT',
  testFile: 'src/rules-core/testing/twoWeaponFightingCanonicalMandatoryScenario.test.ts',
  testName: 'executes the canonical Light-property Bonus Action attack with compiled Two-Weapon Fighting exactly once inside a real two-PC protocol, reload, and replay',
  semanticProtocol: 'mandatory-two-pc-v1',
  scenarioId: 'SC-TWO-WEAPON-FIGHTING-01',
  links: [{
    entityId: 'fighting-style.two-weapon-fighting',
    obligationId: microMvpEntityObligationId('fighting-style.two-weapon-fighting'),
  }],
}] as const satisfies readonly TwoWeaponFightingScenarioEvidenceRegistration[];
