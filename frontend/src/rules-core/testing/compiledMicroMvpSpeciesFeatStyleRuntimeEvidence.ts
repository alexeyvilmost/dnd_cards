import {
  microMvpEntityObligationId,
} from '../coverage/microMvpDenominator';
import type { MandatoryTwoPcScenarioIdentity } from './mandatoryTwoPcProtocol';

export const COMPILED_MICRO_MVP_SPECIES_FEAT_STYLE_RUNTIME_TEST_FILE =
  'src/rules-core/testing/compiledMicroMvpSpeciesFeatStyleRuntime.test.ts' as const;

export interface CompiledRuntimeEvidenceLink {
  entityId: string;
  obligationId: string;
}

export interface CompiledRuntimeEvidenceRegistration extends MandatoryTwoPcScenarioIdentity {
  assertionId: string;
  testFile: typeof COMPILED_MICRO_MVP_SPECIES_FEAT_STYLE_RUNTIME_TEST_FILE;
  testName: string;
  links: readonly CompiledRuntimeEvidenceLink[];
}

function entityLink(entityId: string): CompiledRuntimeEvidenceLink {
  return { entityId, obligationId: microMvpEntityObligationId(entityId) };
}

function derivedLink(entityId: string, obligationId: string): CompiledRuntimeEvidenceLink {
  return { entityId, obligationId };
}

/**
 * Every registration below names a test that first runs the shared compiled
 * two-PC acceptance trace and then executes the claimed rule in that same
 * chronological ScenarioSpec. Build projection by itself is never evidence.
 */
export const COMPILED_MICRO_MVP_SPECIES_FEAT_STYLE_RUNTIME_EVIDENCE = [
  {
    assertionId: 'SCENARIO-COMPILED-HUMAN-RUNTIME',
    testFile: COMPILED_MICRO_MVP_SPECIES_FEAT_STYLE_RUNTIME_TEST_FILE,
    testName: 'executes the complete Human runtime package inside one compiled two-PC chronology',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-RUNTIME-HUMAN-01',
    links: [entityLink('species.human')],
  },
  {
    assertionId: 'SCENARIO-COMPILED-ELF-RUNTIME',
    testFile: COMPILED_MICRO_MVP_SPECIES_FEAT_STYLE_RUNTIME_TEST_FILE,
    testName: 'executes the complete Elf runtime package inside one compiled two-PC chronology',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-RUNTIME-ELF-01',
    links: [
      entityLink('species.elf'),
      derivedLink('species.elf', 'derived.runtime.elf-trance-and-sleep-immunity'),
    ],
  },
  {
    assertionId: 'SCENARIO-COMPILED-ELF-LINEAGE-ABILITY-RUNTIME',
    testFile: COMPILED_MICRO_MVP_SPECIES_FEAT_STYLE_RUNTIME_TEST_FILE,
    testName: 'casts an Elf lineage cantrip with its persisted ability inside one compiled two-PC chronology',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-RUNTIME-ELF-LINEAGE-SPELL-01',
    links: [
      derivedLink('species.elf', 'derived.runtime.elf-lineage-spellcasting-ability'),
    ],
  },
  {
    assertionId: 'SCENARIO-COMPILED-DWARF-RUNTIME',
    testFile: COMPILED_MICRO_MVP_SPECIES_FEAT_STYLE_RUNTIME_TEST_FILE,
    testName: 'executes the complete Dwarf runtime package inside one compiled two-PC chronology',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-RUNTIME-DWARF-01',
    links: [
      entityLink('species.dwarf'),
      derivedLink('species.dwarf', 'derived.runtime.active-effect-build-projection'),
    ],
  },
  {
    assertionId: 'SCENARIO-COMPILED-DRAGONBORN-RUNTIME',
    testFile: COMPILED_MICRO_MVP_SPECIES_FEAT_STYLE_RUNTIME_TEST_FILE,
    testName: 'executes Breath Weapon and ancestry resistance inside one compiled two-PC chronology',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-RUNTIME-DRAGONBORN-01',
    links: [
      entityLink('species.dragonborn'),
      derivedLink('species.dragonborn', 'derived.runtime.dragonborn-attack-replacement'),
    ],
  },
  {
    assertionId: 'SCENARIO-COMPILED-ALERT-RUNTIME',
    testFile: COMPILED_MICRO_MVP_SPECIES_FEAT_STYLE_RUNTIME_TEST_FILE,
    testName: 'executes Alert initiative bonus and immediate swap inside one compiled two-PC chronology',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-RUNTIME-ALERT-01',
    links: [
      entityLink('feat.alert'),
      derivedLink('feat.alert', 'derived.runtime.alert-initiative-swap'),
    ],
  },
  {
    assertionId: 'SCENARIO-COMPILED-MAGIC-INITIATE-RUNTIME',
    testFile: COMPILED_MICRO_MVP_SPECIES_FEAT_STYLE_RUNTIME_TEST_FILE,
    testName: 'casts Magic Initiate with its free use and then a slot inside one compiled two-PC chronology',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-RUNTIME-MAGIC-INITIATE-01',
    links: [entityLink('feat.magic-initiate')],
  },
  {
    assertionId: 'SCENARIO-COMPILED-SKILLED-RUNTIME',
    testFile: COMPILED_MICRO_MVP_SPECIES_FEAT_STYLE_RUNTIME_TEST_FILE,
    testName: 'uses all three Skilled selections in checks inside one compiled two-PC chronology',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-RUNTIME-SKILLED-01',
    links: [entityLink('feat.skilled')],
  },
  {
    assertionId: 'SCENARIO-COMPILED-ARCHERY-RUNTIME',
    testFile: COMPILED_MICRO_MVP_SPECIES_FEAT_STYLE_RUNTIME_TEST_FILE,
    testName: 'applies Archery only to ranged weapon attacks inside one compiled two-PC chronology',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-RUNTIME-ARCHERY-01',
    links: [entityLink('fighting-style.archery')],
  },
  {
    assertionId: 'SCENARIO-COMPILED-DEFENSE-RUNTIME',
    testFile: COMPILED_MICRO_MVP_SPECIES_FEAT_STYLE_RUNTIME_TEST_FILE,
    testName: 'applies Defense only after armor is donned inside one compiled two-PC chronology',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-RUNTIME-DEFENSE-01',
    links: [entityLink('fighting-style.defense')],
  },
] as const satisfies readonly CompiledRuntimeEvidenceRegistration[];

export const COMPILED_MICRO_MVP_RUNTIME_UNCOVERED = [] as const;
