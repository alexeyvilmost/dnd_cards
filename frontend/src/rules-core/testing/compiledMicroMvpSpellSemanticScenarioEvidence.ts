import { microMvpEntityObligationId } from '../coverage/microMvpDenominator';
import type { MandatoryTwoPcScenarioIdentity } from './mandatoryTwoPcProtocol';

export interface CompiledSpellScenarioEvidenceLink {
  entityId: string;
  obligationId: string;
}

export interface CompiledSpellScenarioEvidenceRegistration extends MandatoryTwoPcScenarioIdentity {
  assertionId: string;
  testFile: string;
  testName: string;
  links: readonly CompiledSpellScenarioEvidenceLink[];
}

const TEST_FILE = 'src/rules-core/testing/compiledMicroMvpSpellSemanticScenarios.test.ts';
const entity = (entityId: string): CompiledSpellScenarioEvidenceLink => ({
  entityId,
  obligationId: microMvpEntityObligationId(entityId),
});
const derived = (
  entityId: string,
  obligationId: string,
): CompiledSpellScenarioEvidenceLink => ({ entityId, obligationId });

/**
 * Candidate registrations for the central evidence index.  Keeping this
 * catalog beside the executable scenarios lets the gate adopt only complete,
 * exact test locators; it deliberately does not mutate microMvpEvidence.ts.
 */
export const COMPILED_MICRO_MVP_SPELL_SCENARIO_EVIDENCE = [
  {
    assertionId: 'SCENARIO-COMPILED-MICRO-MVP-SPELL-ATTACK-CANTRIPS',
    testFile: TEST_FILE,
    testName: 'runs Fire Bolt, Poison Spray, and Ray of Frost hit/miss envelopes with exact damage and source-turn expiry',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-SPELL-ATTACK-CANTRIPS-01',
    links: [
      entity('spell.fire-bolt'),
      entity('spell.poison-spray'),
      entity('spell.ray-of-frost'),
      derived('spell.ray-of-frost', 'derived.runtime.source-turn-relative-expiry'),
    ],
  },
  {
    assertionId: 'SCENARIO-COMPILED-MICRO-MVP-SPELL-CHILL-TOUCH',
    testFile: TEST_FILE,
    testName: 'runs Chill Touch hit/miss envelopes through healing denial and exact source-turn expiry',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-SPELL-CHILL-TOUCH-01',
    links: [
      entity('spell.chill-touch'),
      derived('spell.chill-touch', 'derived.runtime.chill-touch-healing-lock'),
      derived('spell.chill-touch', 'derived.runtime.source-turn-relative-expiry'),
    ],
  },
  {
    assertionId: 'SCENARIO-COMPILED-MICRO-MVP-SPELL-SAVES-AND-AREAS',
    testFile: TEST_FILE,
    testName: 'runs Sacred Flame fail/success and compiled Burning Hands/Thunderwave multi-target save envelopes',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-SPELL-SAVES-AREAS-01',
    links: [
      entity('spell.sacred-flame'),
      entity('spell.burning-hands'),
      entity('spell.thunderwave'),
      derived('spell.burning-hands', 'derived.runtime.area-geometry-and-multi-target'),
      derived('spell.thunderwave', 'derived.runtime.area-geometry-and-multi-target'),
      derived('spell.burning-hands', 'derived.runtime.environmental-object-effects'),
      derived('spell.thunderwave', 'derived.runtime.environmental-object-effects'),
    ],
  },
  {
    assertionId: 'SCENARIO-COMPILED-MICRO-MVP-SPELL-SUPPORT-AND-RECOVERY',
    testFile: TEST_FILE,
    testName: 'runs Guidance, Cure Wounds, False Life, and Mage Armor envelopes through persistent and restorative state',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-SPELL-SUPPORT-RECOVERY-01',
    links: [
      entity('spell.guidance'),
      entity('spell.cure-wounds'),
      entity('spell.false-life'),
      entity('spell.mage-armor'),
    ],
  },
  {
    assertionId: 'SCENARIO-COMPILED-MICRO-MVP-SPELL-GUIDING-BOLT',
    testFile: TEST_FILE,
    testName: 'runs Guiding Bolt hit/miss envelopes through next-attack consumption and source-turn expiry',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-SPELL-GUIDING-BOLT-01',
    links: [
      entity('spell.guiding-bolt'),
      derived('spell.guiding-bolt', 'derived.runtime.source-turn-relative-expiry'),
    ],
  },
] as const satisfies readonly CompiledSpellScenarioEvidenceRegistration[];
