import type { AssertionEvidence, AssertionEvidenceLink } from './assertionEvidenceIndex';
import type { CoverageReleasePin } from './ruleObligation';
import type { MicroMvpCoverageDenominator } from './microMvpDenominator';
import {
  matchingMicroMvpEvidenceExecutions,
  type ValidatedMicroMvpEvidenceExecutionManifest,
} from './microMvpEvidenceExecution';
import {
  MICRO_MVP_COVERAGE_RELEASE,
  MICRO_MVP_SEMANTIC_ASPECT,
  microMvpChoiceObligationId,
  microMvpEntityObligationId,
} from './microMvpDenominator';
import {
  MICRO_MVP_SCENARIO_CORPUS,
  runMicroMvpScenarioCase,
} from '../testing/microMvpScenarioCorpus';
import type { MicroMvpScenarioId } from '../testing/microMvpScenarioCorpus';
import { COMPILED_MICRO_MVP_BUILD_SEMANTIC_EVIDENCE } from '../testing/compiledMicroMvpBuildSemantics';
import { COMPILED_MICRO_MVP_SPELL_SCENARIO_EVIDENCE } from '../testing/compiledMicroMvpSpellSemanticScenarioEvidence';
import { COMPILED_WORLD_SPELL_SCENARIO_EVIDENCE } from '../compiledWorldSpellScenarios';
import { FIND_FAMILIAR_RUNTIME_SCENARIO_EVIDENCE } from '../findFamiliarRuntimeEvidence';
import { COMPILED_WARLOCK_INVOCATION_SCENARIO_EVIDENCE } from '../testing/compiledWarlockInvocationScenarioEvidence';
import { FIGHTER_MANDATORY_PROTOCOL_SCENARIO_EVIDENCE } from '../testing/fighterMandatoryProtocolScenarioEvidence';
import { COMPILED_MICRO_MVP_SPECIES_FEAT_STYLE_RUNTIME_EVIDENCE } from '../testing/compiledMicroMvpSpeciesFeatStyleRuntimeEvidence';
import { PROTECTION_RUNTIME_SCENARIO_EVIDENCE } from '../testing/protectionScenarioEvidence';
import { TOUGH_COMPILED_MANDATORY_SCENARIO_EVIDENCE } from '../testing/toughCompiledMandatoryScenarioEvidence';
import { TWO_WEAPON_FIGHTING_CANONICAL_MANDATORY_SCENARIO_EVIDENCE } from '../testing/twoWeaponFightingCanonicalMandatoryScenarioEvidence';
import { COMPILED_WARLOCK_PACT_MANDATORY_SCENARIO_EVIDENCE } from '../testing/compiledWarlockPactMandatoryScenarioEvidence';
import { WEAPON_MASTERY_2024_MANDATORY_SCENARIO_EVIDENCE } from '../testing/weaponMastery2024MandatoryScenarioEvidence';
import type { MandatoryTwoPcScenarioIdentity } from '../testing/mandatoryTwoPcProtocol';

export interface RegisteredEvidenceLink {
  entityId: string;
  obligationId: string;
}

export interface RegisteredUnitTestLocator {
  testFile: string;
  testName: string;
}

export interface RegisteredUnitEvidence {
  assertionId: string;
  /** A single exact test, mutually exclusive with `conjunctiveTests`. */
  testFile?: string;
  /** A single exact test, mutually exclusive with `conjunctiveTests`. */
  testName?: string;
  /**
   * One semantic assertion backed by every listed exact test. Materialization
   * fails closed when the list is empty, duplicated, mixed with a single-test
   * locator, or when any member becomes stale.
   */
  conjunctiveTests?: readonly RegisteredUnitTestLocator[];
  links: readonly RegisteredEvidenceLink[];
}

export interface RegisteredScenarioEvidence extends RegisteredEvidenceLink {
  assertionId: string;
  scenarioId: MicroMvpScenarioId;
  /** Every listed DSL assertion must pass before this conjunctive evidence exists. */
  scenarioAssertionIds: readonly string[];
}

/**
 * A named integration test that owns the same mandatory scenario contract as
 * the DSL corpus: two player characters, strict turns, a non-spell action, a
 * spell, persisted state/effect, a save, a check, checkpoint reload, and exact
 * event replay. The test executes in the same blocking Vitest command as the
 * evidence gate, while this registry makes its semantic links fail closed on
 * rename or deletion.
 */
export interface RegisteredScenarioTestEvidence extends MandatoryTwoPcScenarioIdentity {
  assertionId: string;
  testFile: string;
  testName: string;
  links: readonly RegisteredEvidenceLink[];
}

export const MICRO_MVP_COMPILED_RELEASE_SCENARIO_LOCATOR = {
  evidenceKind: 'compiled_release_scenario',
  semanticProtocol: 'compiled-release-corpus-v1',
  scenarioId: 'SC-COMPILED-RELEASE-CORPUS-01',
  testFile: 'src/rules-core/coverage/compiledMicroMvpAcceptanceEvidence.test.ts',
  testName: 'materializes every released entity from the pinned compiled corpus and runs each through the common two-PC protocol',
} as const;

export interface RegisteredCompiledReleaseScenarioEvidence {
  assertionId: string;
  evidenceKind: typeof MICRO_MVP_COMPILED_RELEASE_SCENARIO_LOCATOR.evidenceKind;
  semanticProtocol: typeof MICRO_MVP_COMPILED_RELEASE_SCENARIO_LOCATOR.semanticProtocol;
  scenarioId: typeof MICRO_MVP_COMPILED_RELEASE_SCENARIO_LOCATOR.scenarioId;
  testFile: typeof MICRO_MVP_COMPILED_RELEASE_SCENARIO_LOCATOR.testFile;
  testName: typeof MICRO_MVP_COMPILED_RELEASE_SCENARIO_LOCATOR.testName;
  links: readonly RegisteredEvidenceLink[];
}

export interface EvidenceRegistrationIssue {
  code:
    | 'duplicate_assertion_id'
    | 'duplicate_scenario_id'
    | 'duplicate_test_locator'
    | 'empty_conjunctive_tests'
    | 'invalid_test_locator_mode'
    | 'missing_test_execution'
    | 'ambiguous_test_execution'
    | 'test_execution_not_passed'
    | 'scenario_protocol_mismatch'
    | 'unknown_scenario_assertion';
  assertionId: string;
  message: string;
}

export class MicroMvpEvidenceRegistrationError extends Error {
  constructor(readonly issues: readonly EvidenceRegistrationIssue[]) {
    super([
      `micro-MVP evidence registry has ${issues.length} issue(s):`,
      ...issues.map((issue) => `[${issue.code}] ${issue.assertionId}: ${issue.message}`),
    ].join('\n'));
    this.name = 'MicroMvpEvidenceRegistrationError';
  }
}

function link(entityId: string, obligationId = microMvpEntityObligationId(entityId)) {
  return { entityId, obligationId };
}

function derivedLink(entityId: string, obligationId: string): RegisteredEvidenceLink {
  return { entityId, obligationId };
}

/**
 * One exact current-run corpus test proves release provenance for every cell.
 * The links come from the independent denominator, never from assertions or
 * the hand-authored scenario slice, so neither can shrink released scope.
 */
export function createMicroMvpCompiledReleaseScenarioEvidenceRegistry(
  denominator: MicroMvpCoverageDenominator,
): readonly RegisteredCompiledReleaseScenarioEvidence[] {
  return [{
    assertionId: 'COMPILED-RELEASE-SCENARIO-MICRO-MVP-DENOMINATOR',
    ...MICRO_MVP_COMPILED_RELEASE_SCENARIO_LOCATOR,
    links: denominator.matrix.targets.map(({ entityId, obligationId }) => ({
      entityId,
      obligationId,
    })),
  }];
}

/**
 * Traceability registrations point at tests that already execute in the normal
 * Vitest suite. They are materialized only after the current-run execution
 * manifest proves that every exact locator finished in the passed state.
 */
export function createMicroMvpUnitEvidenceRegistry(
  denominator: MicroMvpCoverageDenominator,
): readonly RegisteredUnitEvidence[] {
  const overlayTest = 'src/canon/microMvpL1Overlay.test.ts';
  const entitySemanticsTest = 'src/rules-core/coverage/microMvpEntitySemantics.test.ts';
  const spellSemanticsTest = 'src/rules-core/microMvpSpellEntitySemantics.test.ts';
  const magicMissileShieldTest = 'src/rules-core/magicMissileShield.test.ts';
  const masteryTest = 'src/rules-core/masterySaveContinuation.test.ts';
  const weaponMasteryCompilerTest = 'src/engine/weaponMastery2024.test.ts';
  const weaponProfileTest = 'src/engine/weaponProfile.test.ts';
  const reachableWeaponProfileTest = 'src/canon/microMvpWeaponProfiles.test.ts';
  const attackRuntimeTest = 'src/rules-core/attackRuntime.integration.test.ts';
  const equipmentTest = 'src/engine/equipment.test.ts';
  const worldTest = 'src/rules-core/world.test.ts';
  const worldObjectsTest = 'src/rules-core/worldObjects.test.ts';
  const worldObjectCommandsTest = 'src/rules-core/worldObjectCommands.test.ts';
  const classChoiceTest = 'src/rules-core/coverage/microMvpClassChoiceSemantics.test.ts';
  const areaSpellTest = 'src/rules-core/areaSpellPinnedSemantics.test.ts';
  const compiledSpellcastingTest = 'src/rules-core/compiledSpellcasting.integration.test.ts';
  const arcaneRecoveryTest = 'src/rules-core/arcaneRecovery.integration.test.ts';
  const spellcastingAccessTest = 'src/rules-core/spellcastingAccess.test.ts';
  const elfTraitsTest = 'src/rules-core/elfTraits.integration.test.ts';
  const originSpeciesTest = 'src/rules-core/coverage/microMvpOriginSpeciesSemantics.test.ts';
  const timingPrimitivesTest = 'src/rules-core/timingPrimitives.test.ts';
  const newSpellPrimitivesOverlayTest = 'src/canon/microMvpL1Overlay.newSpellPrimitives.test.ts';
  const sneakAttackTest = 'src/engine/sneakAttack2024.test.ts';
  const fightingStylesPinnedTest = 'src/rules-core/fightingStylesPinnedSemantics.test.ts';
  const dragonbornAttackTest = 'src/rules-core/dragonbornAttackReplacement.integration.test.ts';
  const dwarfVerticalTest = 'src/rules-core/dwarfVertical.integration.test.ts';
  const findFamiliarTest = 'src/rules-core/findFamiliar.test.ts';
  const findFamiliarRuntimeTest = 'src/rules-core/findFamiliarRuntime.integration.test.ts';
  const warlockPactsTest = 'src/rules-core/warlockPacts.test.ts';
  const pactBladeWorldAdapterTest = 'src/rules-core/pactBladeWorldAdapter.test.ts';
  const pactBladeWorldIntegrationTest = 'src/rules-core/pactBladeWorldIntegration.test.ts';
  const pactTomeRuntimeTest = 'src/rules-core/pactTomeRuntime.test.ts';
  const pactTomeWorldAdapterTest = 'src/rules-core/pactTomeWorldAdapter.test.ts';
  const pactTomeWorldIntegrationTest = 'src/rules-core/pactTomeWorldIntegration.test.ts';
  const warlockPactMigrationTest = 'src/rules-core/warlockPactStateMigration.test.ts';
  const worldMigrationTest = 'src/rules-core/worldMigration.test.ts';
  const pactMandatoryScenarioTest =
    'src/rules-core/testing/compiledWarlockPactMandatoryScenarios.test.ts';
  const scenarioCorpusTest = 'src/rules-core/testing/microMvpScenarioCorpus.test.ts';
  const compiledSpellSemanticScenarioTest =
    'src/rules-core/testing/compiledMicroMvpSpellSemanticScenarios.test.ts';
  const worldSpellPrimitivesTest = 'src/rules-core/worldSpellPrimitives.test.ts';
  const worldSpellRuntimeTest = 'src/rules-core/worldSpellRuntime.integration.test.ts';
  const compiledWorldRitualsTest = 'src/rules-core/compiledWorldRituals.integration.test.ts';
  const blessCompiledTest = 'src/rules-core/blessCompiled.integration.test.ts';
  const multiTargetResolutionTest = 'src/rules-core/multiTargetResolution.test.ts';
  const armorOfAgathysCompiledTest = 'src/rules-core/armorOfAgathysCompiled.integration.test.ts';
  const armorOfAgathysRuntimeTest = 'src/rules-core/armorOfAgathys.integration.test.ts';
  const dragonbornLineageLinks = denominator.derivedObligations
    .filter((item) => item.id.startsWith('derived.lineage.dragonborn.'))
    .map((item) => derivedLink('species.dragonborn', item.id));
  const elfLineageLinks = denominator.derivedObligations
    .filter((item) => item.id.startsWith('derived.lineage.elf.'))
    .map((item) => derivedLink('species.elf', item.id));

  return [
    {
      assertionId: 'UNIT-MICRO-MVP-WEAPON-PROFILE-AUTHORITY',
      conjunctiveTests: [
        {
          testFile: reachableWeaponProfileTest,
          testName: 'covers every weapon referenced by all 448 compiled roots with one strict profile',
        },
        {
          testFile: weaponProfileTest,
          testName: 'parses a complete profile and ignores every contradictory display field',
        },
        {
          testFile: attackRuntimeTest,
          testName: 'applies the data-owned Heavy threshold in canonical attacks and fails closed without score facts',
        },
        {
          testFile: equipmentTest,
          testName: 'uses weapon_profile for profiled two-handed legality and fails closed on malformed profile',
        },
      ],
      links: [
        derivedLink('class.fighter', 'derived.runtime.weapon-profile-authority'),
        derivedLink('class.rogue', 'derived.runtime.weapon-profile-authority'),
      ],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-FREE-ORIGIN-FEAT',
      testFile: overlayTest,
      testName: 'keeps product and Human feat grants independent while honoring repeatable metadata',
      links: denominator.entities
        .filter((entity) => entity.collection === 'originFeats')
        .map((entity) => link(
          entity.id,
          'micro-mvp.product-rule.free_origin_feat_choice_v1',
        )),
    },
    {
      assertionId: 'UNIT-MICRO-MVP-BACKGROUND-SEMANTICS',
      testFile: entitySemanticsTest,
      testName: 'materializes Soldier, Sage, Criminal, and Acolyte stable grants while replacing each official Origin feat',
      links: [
        'background.soldier',
        'background.sage',
        'background.criminal',
        'background.acolyte',
      ].map((entityId) => link(entityId)),
    },
    {
      assertionId: 'UNIT-MICRO-MVP-TOUGH-SEMANTICS',
      testFile: entitySemanticsTest,
      testName: 'rebuilds Tough maximum HP as exactly twice character level with pinned feat provenance',
      links: [link('feat.tough')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-ALERT-SEMANTICS',
      conjunctiveTests: [
        {
          testFile: originSpeciesTest,
          testName: 'executes compiled Alert as Proficiency Bonus on Initiative only with exact feat provenance',
        },
        {
          testFile: timingPrimitivesTest,
          testName: 'swaps Alert Initiative in the post-roll window with canonical provenance and deterministic replay',
        },
        {
          testFile: timingPrimitivesTest,
          testName: 'rejects Alert swaps without grant, consent, eligibility, or the immediate timing window',
        },
      ],
      links: [link('feat.alert')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-ALERT-INITIATIVE-SWAP',
      conjunctiveTests: [
        {
          testFile: timingPrimitivesTest,
          testName: 'swaps Alert Initiative in the post-roll window with canonical provenance and deterministic replay',
        },
        {
          testFile: timingPrimitivesTest,
          testName: 'rejects Alert swaps without grant, consent, eligibility, or the immediate timing window',
        },
      ],
      links: [derivedLink('feat.alert', 'derived.runtime.alert-initiative-swap')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-MAGIC-INITIATE-SEMANTICS',
      conjunctiveTests: [
        {
          testFile: entitySemanticsTest,
          testName: 'resolves the pinned Magic Initiate spells with feat provenance and exercises free-use and slot-paid casts',
        },
        {
          testFile: entitySemanticsTest,
          testName: 'persists every Magic Initiate spellcasting-ability branch and scopes its spell grants to the feat',
        },
        {
          testFile: spellcastingAccessTest,
          testName: 'uses a Magic Initiate free cast first and still permits a slot cast afterwards',
        },
      ],
      links: [link('feat.magic-initiate')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-MAGIC-INITIATE-CHOICES',
      testFile: entitySemanticsTest,
      testName: 'resolves the pinned Magic Initiate spells with feat provenance and exercises free-use and slot-paid casts',
      links: [
        derivedLink(
          'feat.magic-initiate',
          microMvpChoiceObligationId('magic_initiate_wizard_cantrips', 'feat.magic-initiate'),
        ),
        derivedLink(
          'feat.magic-initiate',
          microMvpChoiceObligationId('magic_initiate_wizard_level_1', 'feat.magic-initiate'),
        ),
      ],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SKILLED-SEMANTICS',
      conjunctiveTests: [
        {
          testFile: entitySemanticsTest,
          testName: 'resolves Skilled as three distinct pinned choice grants with exact feat provenance',
        },
        {
          testFile: entitySemanticsTest,
          testName: 'allows Skilled to mix any three distinct PHB skills and tool variants',
        },
      ],
      links: [
        link('feat.skilled'),
        derivedLink(
          'feat.skilled',
          microMvpChoiceObligationId('feat_skilled', 'feat.skilled'),
        ),
      ],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-HUMAN-SEMANTICS',
      conjunctiveTests: [
        {
          testFile: originSpeciesTest,
          testName: 'executes Human Resourceful after Long Rest and excludes the foreign Elf choice',
        },
        {
          testFile: originSpeciesTest,
          testName: 'resolves every legal Human Skillful branch as one source-owned proficiency',
        },
        {
          testFile: overlayTest,
          testName: 'keeps product and Human feat grants independent while honoring repeatable metadata',
        },
      ],
      links: [link('species.human')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-HUMAN-VERSATILE-CHOICE',
      testFile: overlayTest,
      testName: 'keeps product and Human feat grants independent while honoring repeatable metadata',
      links: [derivedLink(
        'species.human',
        microMvpChoiceObligationId('human_feat', 'species.human'),
      )],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-HUMAN-SKILLFUL-CHOICE',
      testFile: originSpeciesTest,
      testName: 'resolves every legal Human Skillful branch as one source-owned proficiency',
      links: [derivedLink(
        'species.human',
        microMvpChoiceObligationId('human_skill', 'species.human'),
      )],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-ELF-SEMANTICS',
      conjunctiveTests: [
        {
          testFile: originSpeciesTest,
          testName: 'projects Elf Darkvision and Fey Ancestry and resolves every Keen Senses branch',
        },
        {
          testFile: overlayTest,
          testName: 'materializes every Elf L1 lineage grant without exposing its L3/L5 spells',
        },
        {
          testFile: elfTraitsTest,
          testName: 'accepts a four-hour Elf Trance without shortening the Human Long Rest',
        },
      ],
      links: [link('species.elf')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-ELF-KEEN-SENSES-CHOICE',
      testFile: originSpeciesTest,
      testName: 'projects Elf Darkvision and Fey Ancestry and resolves every Keen Senses branch',
      links: [derivedLink(
        'species.elf',
        microMvpChoiceObligationId('elf_skill', 'species.elf'),
      )],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-FIGHTER-FIGHTING-STYLE-CHOICE',
      testFile: entitySemanticsTest,
      testName: 'materializes every micro-MVP Fighting Style choice from its pinned feat with overlay provenance',
      links: [derivedLink(
        'class.fighter',
        microMvpChoiceObligationId('fighter_fighting_style', 'class.fighter'),
      )],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-FIGHTER-COMPLETE-L1',
      conjunctiveTests: [
        {
          testFile: classChoiceTest,
          testName: 'compiles every Fighter L1 with one of four legal Fighting Styles, Second Wind, and three distinct legal mastery choices without L2 features',
        },
        {
          testFile: classChoiceTest,
          testName: 'restores exactly one expended Second Wind use on a Short Rest and all uses only on a Long Rest',
        },
        {
          testFile: classChoiceTest,
          testName: 'binds every selected Fighter and Rogue Weapon Mastery to its executable mastery effect',
        },
      ],
      links: [link('class.fighter')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-FIGHTER-WEAPON-MASTERY-CHOICE',
      conjunctiveTests: [
        {
          testFile: classChoiceTest,
          testName: 'compiles every Fighter L1 with one of four legal Fighting Styles, Second Wind, and three distinct legal mastery choices without L2 features',
        },
        {
          testFile: classChoiceTest,
          testName: 'binds every selected Fighter and Rogue Weapon Mastery to its executable mastery effect',
        },
      ],
      links: [derivedLink(
        'class.fighter',
        microMvpChoiceObligationId('weapon-mastery', 'class.fighter'),
      )],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-WIZARD-CANTRIP-CHOICE',
      testFile: classChoiceTest,
      testName: 'compiles every Wizard L1 with exactly three cantrips, a six-spell book, Arcane Recovery, and no L2 Scholar feature',
      links: [derivedLink(
        'class.wizard',
        microMvpChoiceObligationId('wizard_cantrips', 'class.wizard'),
      )],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-WIZARD-COMPLETE-L1',
      conjunctiveTests: [
        {
          testFile: classChoiceTest,
          testName: 'compiles every Wizard L1 with exactly three cantrips, a six-spell book, Arcane Recovery, and no L2 Scholar feature',
        },
        {
          testFile: classChoiceTest,
          testName: 'keeps the Wizard six-spell book separate from an exact four-spell prepared subset',
        },
        {
          testFile: compiledSpellcastingTest,
          testName: 'rejects an unprepared normal cast and a foreign grant before costs or events',
        },
        {
          testFile: compiledSpellcastingTest,
          testName: 'casts an unprepared Wizard ritual without a slot and persists exact source provenance',
        },
        {
          testFile: compiledSpellcastingTest,
          testName: 'casts a prepared Wizard spell with exactly one source-owned slot payment',
        },
        {
          testFile: arcaneRecoveryTest,
          testName: 'recovers one level-1 slot after the rest, spends its Long-Rest charge, and replays exactly',
        },
        {
          testFile: arcaneRecoveryTest,
          testName: 'rejects an over-budget, duplicate, unavailable, or ungranted decision before committing the rest',
        },
      ],
      links: [link('class.wizard')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-WIZARD-SPELLBOOK-CHOICE',
      conjunctiveTests: [
        {
          testFile: classChoiceTest,
          testName: 'compiles every Wizard L1 with exactly three cantrips, a six-spell book, Arcane Recovery, and no L2 Scholar feature',
        },
        {
          testFile: classChoiceTest,
          testName: 'keeps the Wizard six-spell book separate from an exact four-spell prepared subset',
        },
      ],
      links: [derivedLink(
        'class.wizard',
        microMvpChoiceObligationId('wizard_spellbook_level_1', 'class.wizard'),
      )],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-WIZARD-PREPARED-AND-RITUAL-ACCESS',
      conjunctiveTests: [
        {
          testFile: spellcastingAccessTest,
          testName: 'keeps a six-spell Wizard book separate from its exact four-spell prepared subset',
        },
        {
          testFile: spellcastingAccessTest,
          testName: 'changes only the Wizard prepared subset and rejects duplicates, wrong counts, and foreign spells',
        },
        {
          testFile: spellcastingAccessTest,
          testName: 'allows a spellbook ritual without preparation but rejects a non-ritual ritual cast',
        },
        {
          testFile: compiledSpellcastingTest,
          testName: 'rejects an unprepared normal cast and a foreign grant before costs or events',
        },
        {
          testFile: compiledSpellcastingTest,
          testName: 'casts an unprepared Wizard ritual without a slot and persists exact source provenance',
        },
        {
          testFile: compiledSpellcastingTest,
          testName: 'casts a prepared Wizard spell with exactly one source-owned slot payment',
        },
      ],
      links: [derivedLink('class.wizard', 'derived.runtime.wizard-prepared-subset')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-ROGUE-EXPERTISE-CHOICE',
      testFile: classChoiceTest,
      testName: 'compiles every Rogue L1 with exact Expertise, 1d6 Sneak Attack, two legal masteries, and no L2 Cunning Action',
      links: [derivedLink(
        'class.rogue',
        microMvpChoiceObligationId('rogue_expertise_l1', 'class.rogue'),
      )],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-ROGUE-COMPLETE-L1',
      conjunctiveTests: [
        {
          testFile: classChoiceTest,
          testName: 'compiles every Rogue L1 with exact Expertise, 1d6 Sneak Attack, two legal masteries, and no L2 Cunning Action',
        },
        {
          testFile: classChoiceTest,
          testName: 'grants every Rogue Thieves’ Cant and one additional language at level 1',
        },
        {
          testFile: sneakAttackTest,
          testName: 'requires a Finesse/Ranged weapon and Advantage, then fires only once per turn',
        },
        {
          testFile: sneakAttackTest,
          testName: 'accepts an explicit nearby eligible ally fact, but not while the roll has Disadvantage',
        },
      ],
      links: [link('class.rogue')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-ROGUE-WEAPON-MASTERY-CHOICE',
      conjunctiveTests: [
        {
          testFile: classChoiceTest,
          testName: 'compiles every Rogue L1 with exact Expertise, 1d6 Sneak Attack, two legal masteries, and no L2 Cunning Action',
        },
        {
          testFile: classChoiceTest,
          testName: 'binds every selected Fighter and Rogue Weapon Mastery to its executable mastery effect',
        },
      ],
      links: [derivedLink(
        'class.rogue',
        microMvpChoiceObligationId('weapon-mastery', 'class.rogue'),
      )],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-CLERIC-SPELL-CHOICES',
      testFile: classChoiceTest,
      testName: 'compiles every Cleric L1 with exactly three class cantrips, four prepared spells, and no L2 Channel Divinity',
      links: [
        link('class.cleric'),
        derivedLink('class.cleric', microMvpChoiceObligationId('cleric_cantrips', 'class.cleric')),
        derivedLink('class.cleric', microMvpChoiceObligationId('cleric_spells_l1', 'class.cleric')),
      ],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-CLERIC-DIVINE-ORDER',
      testFile: classChoiceTest,
      testName: 'materializes both structured Divine Order branches with their exact level-1 grants',
      links: [
        link('class.cleric'),
        derivedLink('class.cleric', microMvpChoiceObligationId('cleric_divine_order', 'class.cleric')),
      ],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SORCERER-L1-BUILD',
      testFile: classChoiceTest,
      testName: 'compiles every Sorcerer L1 with four cantrips, two prepared spells, class-scoped Innate Sorcery, and no L2 Sorcery Points or Metamagic',
      links: [
        link('class.sorcerer'),
        derivedLink('class.sorcerer', microMvpChoiceObligationId('sorcerer_cantrips', 'class.sorcerer')),
        derivedLink('class.sorcerer', microMvpChoiceObligationId('sorcerer_spells_known', 'class.sorcerer')),
      ],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-WARLOCK-L1-BUILD',
      testFile: classChoiceTest,
      testName: 'compiles every Warlock L1 with two cantrips, two prepared spells, one pact slot carrying Short-Rest recharge metadata, and no L2 feature',
      links: [
        link('class.warlock'),
        derivedLink('class.warlock', microMvpChoiceObligationId('warlock_cantrips', 'class.warlock')),
        derivedLink('class.warlock', microMvpChoiceObligationId('warlock_spells_known', 'class.warlock')),
      ],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-WARLOCK-INVOCATION-CHOICE',
      testFile: classChoiceTest,
      testName: 'offers exactly the five eligible level-1 Warlock invocations and materializes exactly one selected branch',
      links: [
        link('class.warlock'),
        derivedLink('class.warlock', microMvpChoiceObligationId('warlock_invocation_l1', 'class.warlock')),
      ],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-DRUID-L1-BUILD',
      testFile: classChoiceTest,
      testName: 'compiles every Druid L1 with exactly two class cantrips, four prepared spells, and no Wild Shape or other L2 feature',
      links: [
        link('class.druid'),
        derivedLink('class.druid', microMvpChoiceObligationId('druid_cantrips', 'class.druid')),
        derivedLink('class.druid', microMvpChoiceObligationId('druid_spells_l1', 'class.druid')),
      ],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-DRUID-PRIMAL-ORDER',
      testFile: classChoiceTest,
      testName: 'materializes both structured Primal Order branches with their exact level-1 grants',
      links: [
        link('class.druid'),
        derivedLink('class.druid', microMvpChoiceObligationId('druid_primal_order', 'class.druid')),
      ],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-GUIDANCE',
      conjunctiveTests: [
        {
          testFile: overlayTest,
          testName: 'replaces supported narrative records with executable structured mechanics',
        },
        {
          testFile: scenarioCorpusTest,
          testName: 'SC-05 consumes Help but keeps Guidance for its concentration duration',
        },
        {
          testFile: compiledSpellSemanticScenarioTest,
          testName: 'runs Guidance, Cure Wounds, False Life, and Mage Armor envelopes through persistent and restorative state',
        },
      ],
      links: [link('spell.guidance')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-BLESS',
      conjunctiveTests: [
        {
          testFile: blessCompiledTest,
          testName: 'adds the compiled spell’s persistent d4 to an ally attack and save, but never a check',
        },
        {
          testFile: multiTargetResolutionTest,
          testName: 'applies one Bless cast to three targets, creates one ledger, and removes every link on replacement/failure',
        },
      ],
      links: [link('spell.bless')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-ARMOR-OF-AGATHYS',
      conjunctiveTests: [
        {
          testFile: newSpellPrimitivesOverlayTest,
          testName: 'compiles Armor of Agathys as a Bonus Action primitive without narrative retaliation',
        },
        {
          testFile: armorOfAgathysCompiledTest,
          testName: 'casts the compiled source on turn one, retaliates against the other PC on turn two, and replays exactly',
        },
        {
          testFile: armorOfAgathysRuntimeTest,
          testName: 'requires an explicit THP choice and an exact paid source, and scales from the paid slot',
        },
        {
          testFile: armorOfAgathysRuntimeTest,
          testName: 'keeps current THP explicitly, replaces only its previous copy, and omits a zero-THP effect',
        },
        {
          testFile: armorOfAgathysRuntimeTest,
          testName: 'retaliates after a canonical weapon hit across every Cold damage adjustment',
        },
        {
          testFile: armorOfAgathysRuntimeTest,
          testName: 'retaliates for unarmed and spell melee hits, but not for a ranged spell hit',
        },
        {
          testFile: armorOfAgathysRuntimeTest,
          testName: 'ends after another event removes all THP without treating non-attack damage as a trigger',
        },
        {
          testFile: armorOfAgathysRuntimeTest,
          testName: 'resolves retaliation after a Shield resume only when the final attack still hits',
        },
        {
          testFile: armorOfAgathysRuntimeTest,
          testName: 'queues a CON save when retaliation damages the concentrating attacker',
        },
        {
          testFile: armorOfAgathysRuntimeTest,
          testName: 'fails closed on forged persisted duration, scaling, ownership, action, and zero THP',
        },
      ],
      links: [link('spell.armor-of-agathys')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-DANCING-LIGHTS',
      conjunctiveTests: [
        {
          testFile: newSpellPrimitivesOverlayTest,
          testName: 'compiles every world primitive from its exact pinned spell without narrative authority',
        },
        {
          testFile: worldSpellPrimitivesTest,
          testName: 'creates every legal individual-light count with linked dim lights and replayable duration',
        },
        {
          testFile: worldSpellPrimitivesTest,
          testName: 'creates the single combined Medium humanoid form and rejects illegal casts',
        },
        {
          testFile: worldSpellPrimitivesTest,
          testName: 'moves every light once, caps movement, removes out-of-range lights, and preserves linking',
        },
        {
          testFile: worldSpellRuntimeTest,
          testName: 'casts and moves source-owned Dancing Lights, then removes them with exact concentration',
        },
      ],
      links: [link('spell.dancing-lights')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-DRUIDCRAFT',
      conjunctiveTests: [
        {
          testFile: newSpellPrimitivesOverlayTest,
          testName: 'compiles every world primitive from its exact pinned spell without narrative authority',
        },
        {
          testFile: worldSpellPrimitivesTest,
          testName: 'resolves and replays Weather Sensor for exactly one round at the range boundary',
        },
        {
          testFile: worldSpellPrimitivesTest,
          testName: 'executes every legal Bloom and Fire Play target variant',
        },
        {
          testFile: worldSpellPrimitivesTest,
          testName: 'creates an instantaneous bounded sensory effect and leaves no persistent object',
        },
        {
          testFile: worldSpellPrimitivesTest,
          testName: 'requires explicit valid facts in range and option-specific targets',
        },
        {
          testFile: worldSpellRuntimeTest,
          testName: 'executes Druidcraft options and Mending only from explicit valid facts',
        },
      ],
      links: [link('spell.druidcraft')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-MENDING',
      conjunctiveTests: [
        {
          testFile: newSpellPrimitivesOverlayTest,
          testName: 'compiles every world primitive from its exact pinned spell without narrative authority',
        },
        {
          testFile: worldSpellPrimitivesTest,
          testName: 'repairs every legal break-size boundary without restoring or stripping magic',
        },
        {
          testFile: worldSpellPrimitivesTest,
          testName: 'rejects absent, oversized, corrupt, or not-explicitly-touched breaks',
        },
        {
          testFile: worldSpellRuntimeTest,
          testName: 'executes Druidcraft options and Mending only from explicit valid facts',
        },
      ],
      links: [link('spell.mending')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-POISON-SPRAY',
      testFile: newSpellPrimitivesOverlayTest,
      testName: 'pins Poison Spray to one 30-foot ranged spell attack dealing 1d12 poison damage',
      links: [link('spell.poison-spray')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-PRESTIDIGITATION',
      conjunctiveTests: [
        {
          testFile: newSpellPrimitivesOverlayTest,
          testName: 'compiles every world primitive from its exact pinned spell without narrative authority',
        },
        {
          testFile: worldSpellPrimitivesTest,
          testName: 'resolves the instantaneous Sensory Effect and Fire Play options with JSON replay',
        },
        {
          testFile: worldSpellPrimitivesTest,
          testName: 'cleans and soils an object at both one-cubic-foot boundaries',
        },
        {
          testFile: worldSpellPrimitivesTest,
          testName: 'attaches one-hour Minor Sensation and Magic Mark effects without overwriting foreign effects',
        },
        {
          testFile: worldSpellPrimitivesTest,
          testName: 'creates a bounded non-damaging, worthless Minor Creation until the source actor next ends a turn',
        },
        {
          testFile: worldSpellPrimitivesTest,
          testName: 'enforces three active source-owned effects and supports explicit attachment/creation replacement',
        },
        {
          testFile: worldSpellRuntimeTest,
          testName: 'persists Prestidigitation effects and replays source-turn and round lifecycles',
        },
      ],
      links: [link('spell.prestidigitation')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-FIND-FAMILIAR',
      conjunctiveTests: [
        {
          testFile: findFamiliarTest,
          testName: 'exposes exactly the eleven PHB base forms and eight Pact Chain special forms',
        },
        {
          testFile: findFamiliarTest,
          testName: 'validates serialized catalogs and rejects noncanonical or self-declared authority',
        },
        {
          testFile: findFamiliarTest,
          testName: 'distinguishes slot, ritual, and Pact Chain Magic-action casts while always consuming incense',
        },
        {
          testFile: findFamiliarTest,
          testName: 'recasts by transforming the same actor, never by retaining a second familiar',
        },
        {
          testFile: findFamiliarTest,
          testName: 'allows telepathy at 0 and exactly 100 feet, but only while present',
        },
        {
          testFile: findFamiliarTest,
          testName: 'uses a Bonus Action to share all familiar senses until exactly the next owner-turn start',
        },
        {
          testFile: findFamiliarTest,
          testName: 'delivers only Touch spells within 100 feet by spending the familiar Reaction',
        },
        {
          testFile: findFamiliarTest,
          testName: 'rolls its own Initiative, is an ally, acts independently, and normally cannot Attack',
        },
        {
          testFile: findFamiliarTest,
          testName: 'drops every carried/worn item and disappears at 0 HP without mutating input',
        },
        {
          testFile: findFamiliarTest,
          testName: 'temporarily dismisses by Magic action and reappears at 0 or exactly 30 feet',
        },
        {
          testFile: findFamiliarTest,
          testName: 'dismisses forever without leaving a hidden familiar or taking its items',
        },
        {
          testFile: findFamiliarTest,
          testName: 'round-trips complete state through JSON and remains deterministic after replay',
        },
      ],
      links: [link('spell.find-familiar')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-FIRE-BOLT',
      testFile: spellSemanticsTest,
      testName: 'executes Fire Bolt hit and miss from the pinned entity with one action, 1d10 Fire, and no miss damage',
      links: [link('spell.fire-bolt')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-SACRED-FLAME',
      testFile: spellSemanticsTest,
      testName: 'executes Sacred Flame Dexterity save boundaries without cover bonuses and deals 1d8 Radiant only on failure',
      links: [link('spell.sacred-flame')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-CURE-WOUNDS',
      testFile: spellSemanticsTest,
      testName: 'executes Cure Wounds on a touched ally for 2d8 plus spellcasting modifier and spends exactly one action and slot',
      links: [link('spell.cure-wounds')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-FALSE-LIFE',
      testFile: spellSemanticsTest,
      testName: 'executes False Life from the pinned entity as 2d4+4 Temporary HP without changing HP and without stacking',
      links: [link('spell.false-life')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-MAGE-ARMOR',
      conjunctiveTests: [
        {
          testFile: spellSemanticsTest,
          testName: 'compiles pinned Mage Armor with willing-unarmored targeting and rejects every unproven target before cost',
        },
        {
          testFile: spellSemanticsTest,
          testName: 'executes pinned Mage Armor as one non-stacking 13+Dex AC method for exactly eight hours',
        },
        {
          testFile: spellSemanticsTest,
          testName: 'ends pinned Mage Armor immediately and permanently through canonical DonArmor events and JSON replay',
        },
      ],
      links: [link('spell.mage-armor')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-RAY-OF-FROST',
      testFile: spellSemanticsTest,
      testName: 'executes Ray of Frost hit damage and a source-owned -10 Speed effect through the caster next-turn start',
      links: [
        link('spell.ray-of-frost'),
        derivedLink('spell.ray-of-frost', 'derived.runtime.source-turn-relative-expiry'),
      ],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-CHILL-TOUCH',
      testFile: spellSemanticsTest,
      testName: 'executes Chill Touch melee hit damage and denies only HP healing through the caster next-turn end',
      links: [
        link('spell.chill-touch'),
        derivedLink('spell.chill-touch', 'derived.runtime.chill-touch-healing-lock'),
        derivedLink('spell.chill-touch', 'derived.runtime.source-turn-relative-expiry'),
      ],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-GUIDING-BOLT',
      testFile: spellSemanticsTest,
      testName: 'executes Guiding Bolt 4d6 Radiant and consumes next-attack Advantage or expires it at the source-turn boundary',
      links: [
        link('spell.guiding-bolt'),
        derivedLink('spell.guiding-bolt', 'derived.runtime.source-turn-relative-expiry'),
      ],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-MAGIC-MISSILE-DARTS',
      testFile: magicMissileShieldTest,
      testName: 'auto-hits one target with three separate simultaneous d4+1 darts and pays/casts once',
      links: [
        link('spell.magic-missile'),
        derivedLink(
          'spell.magic-missile',
          'derived.runtime.magic-missile-distribution-and-shield',
        ),
      ],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-MAGIC-MISSILE-SHIELD',
      testFile: spellSemanticsTest,
      testName: 'executes compiled Magic Missile as three distributed d4+1 darts and lets compiled Shield negate its allocated darts',
      links: [
        link('spell.magic-missile'),
        link('spell.shield'),
        derivedLink(
          'spell.magic-missile',
          'derived.runtime.magic-missile-distribution-and-shield',
        ),
      ],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-SHIELD-ATTACK',
      testFile: spellSemanticsTest,
      testName: 'executes Shield only in a hit reaction window with accept, decline, exact costs, +5 AC, and start-turn expiry',
      links: [link('spell.shield')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-BURNING-HANDS-AREA',
      testFile: areaSpellTest,
      testName: 'executes compiled Burning Hands once for every explicit area target with one shared 3d6 Fire roll and floor-half success damage across JSON reload',
      links: [
        link('spell.burning-hands'),
        derivedLink('spell.burning-hands', 'derived.runtime.area-geometry-and-multi-target'),
      ],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-THUNDERWAVE-AREA',
      testFile: areaSpellTest,
      testName: 'executes compiled Thunderwave as one shared 2d8 Thunder roll and pushes only creatures that fail the Constitution save',
      links: [
        link('spell.thunderwave'),
        derivedLink('spell.thunderwave', 'derived.runtime.area-geometry-and-multi-target'),
      ],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-AREA-DUPLICATE-FAIL-CLOSED',
      testFile: areaSpellTest,
      testName: 'rejects duplicate compiled area targets before spending action or spell slot',
      links: [
        derivedLink('spell.burning-hands', 'derived.runtime.area-geometry-and-multi-target'),
        derivedLink('spell.thunderwave', 'derived.runtime.area-geometry-and-multi-target'),
      ],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-LIGHT-WORLD',
      testFile: worldObjectsTest,
      testName: 'implements Light attachment, replacement, opaque cover, size and touch limits, and the full one-hour duration',
      links: [
        link('spell.light'),
        derivedLink('spell.light', 'derived.runtime.light-world-illumination'),
      ],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-MINOR-ILLUSION-WORLD',
      testFile: worldObjectsTest,
      testName: 'implements bounded sound and image Minor Illusion, replacement, per-observer Study and physical disclosure, and duration',
      links: [
        link('spell.minor-illusion'),
        derivedLink('spell.minor-illusion', 'derived.runtime.minor-illusion-object-and-study'),
      ],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-DETECT-MAGIC-PRIMITIVE',
      testFile: worldObjectsTest,
      testName: 'implements Detect Magic distance, material blocking, visible aura, and school disclosure',
      links: [
        link('spell.detect-magic'),
        derivedLink('spell.detect-magic', 'derived.runtime.detect-magic-world-sensing'),
      ],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-DETECT-MAGIC-COMMAND',
      testFile: worldObjectCommandsTest,
      testName: 'requires active Detect Magic concentration and spends a later Magic action to reveal aura facts',
      links: [
        link('spell.detect-magic'),
        derivedLink('spell.detect-magic', 'derived.runtime.detect-magic-world-sensing'),
      ],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-DETECT-POISON-DISEASE-RITUAL',
      conjunctiveTests: [
        {
          testFile: newSpellPrimitivesOverlayTest,
          testName: 'compiles every world primitive from its exact pinned spell without narrative authority',
        },
        {
          testFile: worldSpellPrimitivesTest,
          testName: 'reveals location and exact kind for every supported source at 30 feet',
        },
        {
          testFile: worldSpellPrimitivesTest,
          testName: 'rejects out-of-range, blocked, malformed, and non-hazard observations',
        },
        {
          testFile: worldSpellPrimitivesTest,
          testName: 'is blocked by every exact material threshold',
        },
        {
          testFile: worldSpellPrimitivesTest,
          testName: 'is not blocked below thresholds or by other material, but fails closed on corrupt thickness',
        },
        {
          testFile: worldSpellRuntimeTest,
          testName: 'observes poison only under exact active concentration and records structured facts',
        },
        {
          testFile: compiledWorldRitualsTest,
          testName: 'casts compiled Detect Poison and Disease as a ritual, spends no slot, and senses through its exact concentration',
        },
      ],
      links: [link('spell.detect-poison-and-disease')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-SPELL-PURIFY-FOOD-DRINK-RITUAL',
      conjunctiveTests: [
        {
          testFile: newSpellPrimitivesOverlayTest,
          testName: 'compiles every world primitive from its exact pinned spell without narrative authority',
        },
        {
          testFile: worldSpellPrimitivesTest,
          testName: 'purifies only poisoned or rotten nonmagical food and drink explicitly in the sphere',
        },
        {
          testFile: worldSpellPrimitivesTest,
          testName: 'accepts both center-distance boundaries and rejects inferred area membership or corrupt input',
        },
        {
          testFile: worldSpellRuntimeTest,
          testName: 'purifies only explicit nonmagical food and drink in the declared sphere',
        },
        {
          testFile: compiledWorldRitualsTest,
          testName: 'casts compiled Purify Food and Drink as a ritual without a slot and mutates only explicit nonmagical food',
        },
      ],
      links: [link('spell.purify-food-and-drink')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-BURNING-HANDS-OBJECTS',
      testFile: worldObjectsTest,
      testName: 'ignites only uncarried flammable Burning Hands objects explicitly inside the area',
      links: [derivedLink(
        'spell.burning-hands',
        'derived.runtime.environmental-object-effects',
      )],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-THUNDERWAVE-OBJECTS',
      testFile: worldObjectsTest,
      testName: 'pushes only unsecured Thunderwave objects entirely inside the explicit cube',
      links: [derivedLink(
        'spell.thunderwave',
        'derived.runtime.environmental-object-effects',
      )],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-DRAGONBORN-LINEAGES',
      testFile: overlayTest,
      testName: 'materializes all Dragonborn L1 ancestries and removes the L5 flight leak',
      links: dragonbornLineageLinks,
    },
    {
      assertionId: 'UNIT-MICRO-MVP-DRAGONBORN-COMPLETE-L1',
      conjunctiveTests: [
        {
          testFile: overlayTest,
          testName: 'materializes all Dragonborn L1 ancestries and removes the L5 flight leak',
        },
        {
          testFile: dragonbornAttackTest,
          testName: 'compiles every L1 Dragonborn Breath as one source-owned Attack replacement',
        },
        {
          testFile: dragonbornAttackTest,
          testName: 'replaces exactly one attack, persists its save continuation, applies typed resistance, and replays after JSON checkpoint',
        },
        {
          testFile: dragonbornAttackTest,
          testName: 'rejects standalone, malformed, repeated, and exhausted attempts before their costs or events',
        },
      ],
      links: [link('species.dragonborn')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-DRAGONBORN-ATTACK-REPLACEMENT',
      conjunctiveTests: [
        {
          testFile: dragonbornAttackTest,
          testName: 'compiles every L1 Dragonborn Breath as one source-owned Attack replacement',
        },
        {
          testFile: dragonbornAttackTest,
          testName: 'replaces exactly one attack, persists its save continuation, applies typed resistance, and replays after JSON checkpoint',
        },
        {
          testFile: dragonbornAttackTest,
          testName: 'rejects standalone, malformed, repeated, and exhausted attempts before their costs or events',
        },
      ],
      links: [derivedLink(
        'species.dragonborn',
        'derived.runtime.dragonborn-attack-replacement',
      )],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-DWARF-COMPLETE-L1',
      conjunctiveTests: [
        {
          testFile: dwarfVerticalTest,
          testName: 'projects every PHB 2024 Dwarf trait and legal Stonecunning resource from compiled roots',
        },
        {
          testFile: dwarfVerticalTest,
          testName: 'adds exactly one maximum HP per character level through Dwarven Toughness',
        },
        {
          testFile: dwarfVerticalTest,
          testName: 'executes Stonecunning only on natural/worked stone, persists 100 rounds, replays, and recharges on Long Rest',
        },
        {
          testFile: dwarfVerticalTest,
          testName: 'enforces exactly proficiency-bonus Stonecunning uses before the next Long Rest',
        },
        {
          testFile: dwarfVerticalTest,
          testName: 'applies Dwarven Resilience to poison damage and saves that avoid or end Poisoned after reload',
        },
      ],
      links: [link('species.dwarf')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-ELF-LINEAGES',
      testFile: overlayTest,
      testName: 'materializes every Elf L1 lineage grant without exposing its L3/L5 spells',
      links: elfLineageLinks,
    },
    {
      assertionId: 'UNIT-MICRO-MVP-ELF-LINEAGE-SPELLCASTING-ABILITY',
      conjunctiveTests: [
        {
          testFile: overlayTest,
          testName: 'materializes every Elf L1 lineage grant without exposing its L3/L5 spells',
        },
        {
          testFile: overlayTest,
          testName: 'compiles each legal Elf lineage spellcasting ability as source-scoped provenance',
        },
        {
          testFile: compiledSpellcastingTest,
          testName: 'executes an Elf lineage cantrip with the persisted player-selected ability',
        },
      ],
      links: [derivedLink(
        'species.elf',
        'derived.runtime.elf-lineage-spellcasting-ability',
      )],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-ELF-TRANCE-AND-SLEEP-IMMUNITY',
      conjunctiveTests: [
        {
          testFile: elfTraitsTest,
          testName: 'projects exact source-owned traits into every compiled Elf and no non-Elf',
        },
        {
          testFile: elfTraitsTest,
          testName: 'blocks only tagged magical sleep on an Elf and applies the same condition to a Human',
        },
        {
          testFile: elfTraitsTest,
          testName: 'accepts a four-hour Elf Trance without shortening the Human Long Rest',
        },
      ],
      links: [derivedLink('species.elf', 'derived.runtime.elf-trance-and-sleep-immunity')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-ACTIVE-EFFECT-PROJECTION',
      testFile: overlayTest,
      testName: 'promotes L1 active effects to owned actions and seeds Weapon Mastery',
      links: [derivedLink('species.dwarf', 'derived.runtime.active-effect-build-projection')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-ARMOR-OF-SHADOWS',
      testFile: overlayTest,
      testName: 'executes Armor of Shadows as self-only at-will Mage Armor with stable invocation provenance',
      links: [derivedLink('class.warlock', 'derived.invocation.armor-of-shadows')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-ELDRITCH-MIND',
      testFile: worldTest,
      testName: 'applies Eldritch Mind only to the Constitution save made to maintain Concentration',
      links: [derivedLink('class.warlock', 'derived.invocation.eldritch-mind')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-PACT-BLADE',
      conjunctiveTests: [
        {
          testFile: pactBladeWorldAdapterTest,
          testName: 'conjures a catalog-derived weapon into the declared hand and atomically stores Card↔item bridge',
        },
        {
          testFile: pactBladeWorldIntegrationTest,
          testName: 'conjures a held Card/item instance and attacks another actor with CHA, proficiency, and radiant damage',
        },
        {
          testFile: pactBladeWorldIntegrationTest,
          testName: 'uses the held blade only for M, derives touched Card identity, and preserves an existing item',
        },
        {
          testFile: pactBladeWorldIntegrationTest,
          testName: 'does not infer death from 0 HP and atomically cleans Blade, concentration, effects, and grapples on explicit death',
        },
      ],
      links: [derivedLink('class.warlock', 'derived.invocation.pact-blade')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-PACT-BLADE-BOND-AND-REPLACEMENT',
      conjunctiveTests: [
        {
          testFile: pactBladeWorldAdapterTest,
          testName: 'conjures a catalog-derived weapon into the declared hand and atomically stores Card↔item bridge',
        },
        {
          testFile: pactBladeWorldAdapterTest,
          testName: 'replaces only after all checks pass, deleting old conjured object but preserving existing item state',
        },
        {
          testFile: pactBladeWorldIntegrationTest,
          testName: 'fails closed when the bond action is routed through generic UseAction',
        },
        {
          testFile: warlockPactMigrationTest,
          testName: 'round-trips active Blade bonds and rejects every malformed persisted lifecycle branch',
        },
      ],
      links: [derivedLink(
        'class.warlock',
        'derived.invocation.pact-blade.bond-and-replacement',
      )],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-PACT-BLADE-ATTACK-AND-DAMAGE',
      conjunctiveTests: [
        {
          testFile: pactBladeWorldAdapterTest,
          testName: 'derives per-attack STR/DEX/CHA and every damage choice without mutating the bond',
        },
        {
          testFile: pactBladeWorldIntegrationTest,
          testName: 'conjures a held Card/item instance and attacks another actor with CHA, proficiency, and radiant damage',
        },
        {
          testFile: pactBladeWorldIntegrationTest,
          testName: 'persists the Pact projection through Shield/reload and keeps lifecycle observations locked while pending',
        },
      ],
      links: [derivedLink(
        'class.warlock',
        'derived.invocation.pact-blade.attack-and-damage',
      )],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-PACT-BLADE-MATERIAL-FOCUS',
      conjunctiveTests: [
        {
          testFile: pactBladeWorldAdapterTest,
          testName: 'projects the bonded held weapon only for Material components and preserves V/S and costly-material duties',
        },
        {
          testFile: pactBladeWorldIntegrationTest,
          testName: 'uses the held blade only for M, derives touched Card identity, and preserves an existing item',
        },
      ],
      links: [derivedLink(
        'class.warlock',
        'derived.invocation.pact-blade.material-focus',
      )],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-PACT-BLADE-END-LIFECYCLE',
      conjunctiveTests: [
        {
          testFile: pactBladeWorldAdapterTest,
          testName: 'tracks continuous distance, resets at 5 feet, and ends at the literal >=60-second RAW boundary',
        },
        {
          testFile: pactBladeWorldAdapterTest,
          testName: 'ends on explicit owner death, never merely because HP is 0',
        },
        {
          testFile: pactBladeWorldIntegrationTest,
          testName: 'does not infer death from 0 HP and atomically cleans Blade, concentration, effects, and grapples on explicit death',
        },
        {
          testFile: pactBladeWorldIntegrationTest,
          testName: 'allows distance observations out of turn and ends the conjured bond at sixty seconds',
        },
        {
          testFile: worldMigrationTest,
          testName: 'upgrades missing v4 lifecycle to alive but fails closed for missing or uncommitted v5 death facts',
        },
      ],
      links: [derivedLink(
        'class.warlock',
        'derived.invocation.pact-blade.end-lifecycle',
      )],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-PACT-CHAIN',
      conjunctiveTests: [
        {
          testFile: findFamiliarTest,
          testName: 'exposes exactly the eleven PHB base forms and eight Pact Chain special forms',
        },
        {
          testFile: findFamiliarTest,
          testName: 'distinguishes slot, ritual, and Pact Chain Magic-action casts while always consuming incense',
        },
        {
          testFile: findFamiliarTest,
          testName: 'uses one familiar Reaction to replace exactly one attack in the owner Attack action',
        },
        {
          testFile: findFamiliarTest,
          testName: 'permits a normal-form Chain familiar attack but rejects every unauthorized substitution',
        },
        {
          testFile: findFamiliarRuntimeTest,
          testName: 'casts Pact Chain at will, gives the familiar its own turn, and replaces exactly one owner attack with its Reaction',
        },
        {
          testFile: warlockPactMigrationTest,
          testName: 'round-trips a Chain familiar and rejects malformed identity and world cross-references',
        },
      ],
      links: [derivedLink('class.warlock', 'derived.invocation.pact-chain')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-PACT-CHAIN-CASTING-AND-FORMS',
      conjunctiveTests: [
        {
          testFile: findFamiliarTest,
          testName: 'exposes exactly the eleven PHB base forms and eight Pact Chain special forms',
        },
        {
          testFile: findFamiliarTest,
          testName: 'distinguishes slot, ritual, and Pact Chain Magic-action casts while always consuming incense',
        },
        {
          testFile: findFamiliarRuntimeTest,
          testName: 'casts Pact Chain at will, gives the familiar its own turn, and replaces exactly one owner attack with its Reaction',
        },
        {
          testFile: warlockPactMigrationTest,
          testName: 'round-trips all three exact compiled projections and preserves them byte-identically on replay',
        },
      ],
      links: [derivedLink(
        'class.warlock',
        'derived.invocation.pact-chain.casting-and-forms',
      )],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-PACT-CHAIN-ACTOR-LIFECYCLE',
      conjunctiveTests: [
        {
          testFile: findFamiliarTest,
          testName: 'rolls its own Initiative, is an ally, acts independently, and normally cannot Attack',
        },
        {
          testFile: findFamiliarTest,
          testName: 'drops every carried/worn item and disappears at 0 HP without mutating input',
        },
        {
          testFile: findFamiliarTest,
          testName: 'temporarily dismisses by Magic action and reappears at 0 or exactly 30 feet',
        },
        {
          testFile: findFamiliarRuntimeTest,
          testName: 'casts Pact Chain at will, gives the familiar its own turn, and replaces exactly one owner attack with its Reaction',
        },
        {
          testFile: warlockPactMigrationTest,
          testName: 'round-trips a Chain familiar and rejects malformed identity and world cross-references',
        },
      ],
      links: [derivedLink(
        'class.warlock',
        'derived.invocation.pact-chain.actor-lifecycle',
      )],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-PACT-CHAIN-ATTACK-SUBSTITUTION',
      conjunctiveTests: [
        {
          testFile: findFamiliarTest,
          testName: 'uses one familiar Reaction to replace exactly one attack in the owner Attack action',
        },
        {
          testFile: findFamiliarTest,
          testName: 'permits a normal-form Chain familiar attack but rejects every unauthorized substitution',
        },
        {
          testFile: warlockPactsTest,
          testName: 'materializes a legal Pact Chain familiar and spends one owner attack plus the familiar Reaction',
        },
        {
          testFile: findFamiliarRuntimeTest,
          testName: 'casts Pact Chain at will, gives the familiar its own turn, and replaces exactly one owner attack with its Reaction',
        },
      ],
      links: [derivedLink(
        'class.warlock',
        'derived.invocation.pact-chain.attack-substitution',
      )],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-PACT-CHAIN-TOUCH-DELIVERY',
      conjunctiveTests: [
        {
          testFile: findFamiliarTest,
          testName: 'delivers only Touch spells within 100 feet by spending the familiar Reaction',
        },
        {
          testFile: findFamiliarTest,
          testName: 'rejects non-Touch, distant, absent, ownerless, actionless, or Reaction-less delivery',
        },
        {
          testFile: findFamiliarRuntimeTest,
          testName: 'delivers compiled Chill Touch through a familiar across Shield, reload, strict turns, and exact replay',
        },
        {
          testFile: findFamiliarRuntimeTest,
          testName: 'opens and resumes an immutable catalog Touch target-save without double-paying its owner or familiar',
        },
      ],
      links: [derivedLink(
        'class.warlock',
        'derived.invocation.pact-chain.touch-delivery',
      )],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-PACT-TOME',
      conjunctiveTests: [
        {
          testFile: warlockPactsTest,
          testName: 'creates a Pact Tome after either rest with exactly three cantrips and two new level-1 rituals',
        },
        {
          testFile: pactTomeRuntimeTest,
          testName: 'completes a Long Rest by atomically replacing only the old source-owned book and grants',
        },
        {
          testFile: pactTomeRuntimeTest,
          testName: 'resolves a level-1 spell with a Pact slot and the same spell as a ten-minute no-slot ritual',
        },
        {
          testFile: pactTomeRuntimeTest,
          testName: 'rejects every cast not owned by the carried active Book of Shadows',
        },
        {
          testFile: pactTomeWorldAdapterTest,
          testName: 'atomically dismisses only the active Tome after an authoritative owner-death fact',
        },
      ],
      links: [derivedLink('class.warlock', 'derived.invocation.pact-tome')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-PACT-TOME-REST-SELECTION',
      conjunctiveTests: [
        {
          testFile: warlockPactsTest,
          testName: 'creates a Pact Tome after either rest with exactly three cantrips and two new level-1 rituals',
        },
        {
          testFile: pactTomeRuntimeTest,
          testName: 'completes a Long Rest by atomically replacing only the old source-owned book and grants',
        },
        {
          testFile: pactTomeWorldAdapterTest,
          testName: 'derives immutable mixed-class eligibility and atomically creates the first physical book',
        },
        {
          testFile: pactTomeWorldIntegrationTest,
          testName: 'atomically replaces books at both rests and audits slot/ritual casts through replay and migration',
        },
      ],
      links: [derivedLink(
        'class.warlock',
        'derived.invocation.pact-tome.rest-selection',
      )],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-PACT-TOME-BOOK-AND-FOCUS',
      conjunctiveTests: [
        {
          testFile: pactTomeRuntimeTest,
          testName: 'rejects every cast not owned by the carried active Book of Shadows',
        },
        {
          testFile: pactTomeWorldAdapterTest,
          testName: 'derives immutable mixed-class eligibility and atomically creates the first physical book',
        },
        {
          testFile: pactTomeWorldIntegrationTest,
          testName: 'atomically replaces books at both rests and audits slot/ritual casts through replay and migration',
        },
        {
          testFile: warlockPactMigrationTest,
          testName: 'fails closed when Tome state, focus object, or prepared Warlock grants diverge',
        },
      ],
      links: [derivedLink(
        'class.warlock',
        'derived.invocation.pact-tome.book-and-focus',
      )],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-PACT-TOME-CASTING-MODES',
      conjunctiveTests: [
        {
          testFile: pactTomeRuntimeTest,
          testName: 'resolves a level-1 spell with a Pact slot and the same spell as a ten-minute no-slot ritual',
        },
        {
          testFile: pactTomeWorldAdapterTest,
          testName: 'audits normal and ritual casts against the active physical book and source grant',
        },
        {
          testFile: pactTomeWorldIntegrationTest,
          testName: 'atomically replaces books at both rests and audits slot/ritual casts through replay and migration',
        },
      ],
      links: [derivedLink(
        'class.warlock',
        'derived.invocation.pact-tome.casting-modes',
      )],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-PACT-TOME-OWNER-DEATH',
      conjunctiveTests: [
        {
          testFile: pactTomeRuntimeTest,
          testName: 'dismisses the exact active Tome from an explicit authoritative owner-death fact and replays it',
        },
        {
          testFile: pactTomeWorldAdapterTest,
          testName: 'atomically dismisses only the active Tome after an authoritative owner-death fact',
        },
        {
          testFile: pactMandatoryScenarioTest,
          testName: 'runs Pact Tome rest replacement, physical focus, both casting modes, and shared explicit owner death',
        },
      ],
      links: [derivedLink(
        'class.warlock',
        'derived.invocation.pact-tome.owner-death',
      )],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-FIGHTING-STYLE-ARCHERY',
      testFile: fightingStylesPinnedTest,
      testName: 'binds pinned Archery FEAT-0063/fs_archery to the ranged-weapon attack-roll projection',
      links: [link('fighting-style.archery')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-FIGHTING-STYLE-DEFENSE',
      testFile: fightingStylesPinnedTest,
      testName: 'binds pinned Defense FEAT-0056/fs_defense to the worn-armor AC projection',
      links: [link('fighting-style.defense')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-FIGHTING-STYLE-TWO-WEAPON',
      testFile: fightingStylesPinnedTest,
      testName: 'binds pinned Two-Weapon Fighting FEAT-0061/fs_two_weapon to the Light extra-attack damage projection',
      links: [link('fighting-style.two-weapon-fighting')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-FIGHTING-STYLE-PROTECTION',
      testFile: fightingStylesPinnedTest,
      testName: 'binds pinned Protection to a shield-gated Reaction for any other target',
      links: [link('fighting-style.protection')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-TOPPLE-CONTINUATION',
      testFile: masteryTest,
      testName: 'commits hit damage, opens Topple without rolling the target, and resumes manually after reload',
      links: [derivedLink('class.fighter', 'derived.mastery.topple')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-TOPPLE-AFTER-SHIELD',
      testFile: masteryTest,
      testName: 'opens the same mastery continuation after Shield resolves but the attack still hits',
      links: [derivedLink('class.fighter', 'derived.mastery.topple-after-shield')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-TOPPLE-CONCENTRATION-QUEUE',
      testFile: masteryTest,
      testName: 'queues the base-damage concentration save behind Topple and opens one pending at a time',
      links: [derivedLink('class.fighter', 'derived.mastery.topple-concentration-queue')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-WEAPON-MASTERY-TOPPLE-PRIMITIVE',
      testFile: weaponMasteryCompilerTest,
      testName: 'Topple compiles the canonical CON save and formula-derived DC',
      links: [derivedLink('class.fighter', 'derived.mastery.topple')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-WEAPON-MASTERY-SAP-PRIMITIVE',
      testFile: weaponMasteryCompilerTest,
      testName: 'Sap is target-owned, consumes only the next attack and expires at source next turn',
      links: [derivedLink('class.fighter', 'derived.mastery.sap')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-WEAPON-MASTERY-SLOW-PRIMITIVE',
      testFile: weaponMasteryCompilerTest,
      testName: 'Slow requires actual damage and remains a non-stacking 10-foot penalty',
      links: [derivedLink('class.fighter', 'derived.mastery.slow')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-WEAPON-MASTERY-VEX-PRIMITIVE',
      testFile: weaponMasteryCompilerTest,
      testName: 'Vex locks advantage and consumption to the exact damaged target',
      links: [derivedLink('class.fighter', 'derived.mastery.vex')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-WEAPON-MASTERY-PUSH-PRIMITIVE',
      testFile: weaponMasteryCompilerTest,
      testName: 'Push accepts an explicit 0..10-foot choice only for a Large-or-smaller target',
      links: [derivedLink('class.fighter', 'derived.mastery.push')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-WEAPON-MASTERY-GRAZE-PRIMITIVE',
      testFile: weaponMasteryCompilerTest,
      testName: 'Graze clamps a negative modifier to zero and suppresses unrelated damage modifiers',
      links: [derivedLink('class.fighter', 'derived.mastery.graze')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-WEAPON-MASTERY-NICK-PRIMITIVE',
      testFile: weaponMasteryCompilerTest,
      testName: 'Nick is an action-economy declaration and owns a per-turn identity',
      links: [derivedLink('class.fighter', 'derived.mastery.nick')],
    },
    {
      assertionId: 'UNIT-MICRO-MVP-WEAPON-MASTERY-CLEAVE-PRIMITIVE',
      testFile: weaponMasteryCompilerTest,
      testName: 'Cleave opens one melee, same-weapon, target-linked serializable follow-up per turn',
      links: [derivedLink('class.fighter', 'derived.mastery.cleave')],
    },
  ];
}

const SCENARIO_EVIDENCE: readonly RegisteredScenarioEvidence[] = [
  {
    assertionId: 'SCENARIO-RUNTIME-FIGHTER-WEAPON-PROFILE-AUTHORITY',
    scenarioId: 'SC-01',
    scenarioAssertionIds: [
      'SC-01-WEAPON-HIT-DAMAGE',
      'SC-01-MASTERY-SAVE-WINDOW',
      'SC-01-MASTERY-PRONE-STATE',
    ],
    ...derivedLink('class.fighter', 'derived.runtime.weapon-profile-authority'),
  },
  {
    assertionId: 'SCENARIO-RUNTIME-ROGUE-WEAPON-PROFILE-AUTHORITY',
    scenarioId: 'SC-02',
    scenarioAssertionIds: [
      'SC-02-SNEAK-POSITIVE-DAMAGE',
      'SC-02-SNEAK-ONCE-TURN-LEDGER',
      'SC-02-HIDE-ENDS-AFTER-FIRST-ATTACK',
    ],
    ...derivedLink('class.rogue', 'derived.runtime.weapon-profile-authority'),
  },
  {
    assertionId: 'SCENARIO-CLASS-ROGUE-L1',
    scenarioId: 'SC-02',
    scenarioAssertionIds: [
      'SC-02-HIDE-RELOAD',
      'SC-02-SNEAK-POSITIVE-DAMAGE',
      'SC-02-SNEAK-ONCE-TURN-LEDGER',
      'SC-02-HIDE-ENDS-AFTER-FIRST-ATTACK',
      'SC-02-SHOVE-SAVE',
      'SC-02-SACRED-FLAME-SAVE',
    ],
    ...link('class.rogue'),
  },
  {
    assertionId: 'SCENARIO-CLASS-CLERIC-L1',
    scenarioId: 'SC-02',
    scenarioAssertionIds: [
      'SC-02-BLESS-TARGET-EFFECT',
      'SC-02-BLESS-CONCENTRATION',
      'SC-02-CURE-WOUNDS-HEAL',
      'SC-02-CURE-WOUNDS-SLOT-COST',
      'SC-02-SACRED-FLAME-SAVE-WINDOW',
      'SC-02-SACRED-FLAME-DAMAGE',
    ],
    ...link('class.cleric'),
  },
  {
    assertionId: 'SCENARIO-CLASS-SORCERER-L1',
    scenarioId: 'SC-03',
    scenarioAssertionIds: [
      'SC-03-INNATE-COSTS-BONUS',
      'SC-03-INNATE-EXECUTABLE-EFFECT',
      'SC-03-FIRE-BOLT-1-DAMAGE',
      'SC-03-CONCENTRATION-RELOAD',
      'SC-03-CONCENTRATION-SAVE',
    ],
    ...link('class.sorcerer'),
  },
  {
    assertionId: 'SCENARIO-CLASS-DRUID-L1',
    scenarioId: 'SC-03',
    scenarioAssertionIds: [
      'SC-03-PRIMAL-ORDER-ARCANA-CHECK',
      'SC-03-ENTANGLE-SAVE-WINDOW',
      'SC-03-ENTANGLE-RELOAD',
      'SC-03-ENTANGLE-RESTRAINED',
      'SC-03-ENTANGLE-CONCENTRATION',
    ],
    ...link('class.druid'),
  },
  {
    assertionId: 'SCENARIO-CLASS-WARLOCK-L1',
    scenarioId: 'SC-04',
    scenarioAssertionIds: [
      'SC-04-PACT-SLOT-SPENT',
      'SC-04-PACT-SLOT-RESTORED',
      'SC-04-PACT-SLOT-PERSISTS-RELOAD',
    ],
    ...link('class.warlock'),
  },
  {
    assertionId: 'SCENARIO-SPELL-MAGIC-MISSILE',
    scenarioId: 'SC-06',
    scenarioAssertionIds: [
      'SC-06-MISSILE-REACTION-WINDOW',
      'SC-06-MISSILE-NO-DAMAGE-BEFORE-REACTION',
      'SC-06-MISSILE-COSTS-ONE-ACTION',
      'SC-06-MISSILE-COSTS-ONE-SLOT',
      'SC-06-MISSILE-ALLOCATION-PROVENANCE',
      'SC-06-MISSILE-WINDOW-RELOAD',
      'SC-06-SHIELD-BLOCKS-CASTER-DART',
      'SC-06-MISSILE-OTHER-TARGET-DAMAGED',
      'SC-06-SHIELD-BLOCKS-ONE-DART-EVENT',
      'SC-06-MISSILE-FIRST-SEPARATE-D4-PLUS-ONE',
      'SC-06-MISSILE-SECOND-SEPARATE-D4-PLUS-ONE',
      'SC-06-MISSILE-HP-RELOAD',
    ],
    ...link('spell.magic-missile'),
  },
  {
    assertionId: 'SCENARIO-RUNTIME-MAGIC-MISSILE-SHIELD',
    scenarioId: 'SC-06',
    scenarioAssertionIds: [
      'SC-06-MISSILE-REACTION-WINDOW',
      'SC-06-MISSILE-NO-DAMAGE-BEFORE-REACTION',
      'SC-06-MISSILE-ALLOCATION-PROVENANCE',
      'SC-06-MISSILE-WINDOW-RELOAD',
      'SC-06-SHIELD-BLOCKS-CASTER-DART',
      'SC-06-MISSILE-OTHER-TARGET-DAMAGED',
      'SC-06-SHIELD-BLOCKS-ONE-DART-EVENT',
      'SC-06-MISSILE-FIRST-SEPARATE-D4-PLUS-ONE',
      'SC-06-MISSILE-SECOND-SEPARATE-D4-PLUS-ONE',
      'SC-06-SHIELD-STATE-RELOAD',
    ],
    ...derivedLink(
      'spell.magic-missile',
      'derived.runtime.magic-missile-distribution-and-shield',
    ),
  },
  {
    assertionId: 'SCENARIO-SPELL-SHIELD-ATTACK',
    scenarioId: 'SC-01',
    scenarioAssertionIds: [
      'SC-01-SHIELD-WINDOW-BEFORE-DAMAGE',
      'SC-01-WIZARD-HP-UNTOUCHED-BEFORE-REACTION',
      'SC-01-SHIELD-WINDOW-RELOAD',
      'SC-01-SHIELD-CLOSES-WINDOW',
      'SC-01-SHIELD-TURNS-HIT-INTO-MISS',
      'SC-01-SHIELD-COSTS-REACTION',
      'SC-01-SHIELD-COSTS-SLOT',
      'SC-01-SHIELD-POST-REACTION-ROLL',
      'SC-01-SHIELD-DURATION-EXPIRES',
      'SC-01-SHIELD-EFFECT-REMOVED',
    ],
    ...link('spell.shield'),
  },
  {
    assertionId: 'SCENARIO-SPELL-SHIELD-MAGIC-MISSILE',
    scenarioId: 'SC-06',
    scenarioAssertionIds: [
      'SC-06-MISSILE-REACTION-WINDOW',
      'SC-06-MISSILE-NO-DAMAGE-BEFORE-REACTION',
      'SC-06-MISSILE-WINDOW-RELOAD',
      'SC-06-SHIELD-CLOSES-WINDOW',
      'SC-06-SHIELD-BLOCKS-CASTER-DART',
      'SC-06-SHIELD-COSTS-ONE-REACTION',
      'SC-06-SHIELD-COSTS-ONE-SLOT',
      'SC-06-SHIELD-REACTION-DECLARED',
      'SC-06-SHIELD-IMMUNITY-MARKER',
      'SC-06-SHIELD-PLUS-FIVE-MARKER',
      'SC-06-SHIELD-BLOCKS-ONE-DART-EVENT',
      'SC-06-SHIELD-STATE-RELOAD',
      'SC-06-SHIELD-REMAINS-THROUGH-OTHER-TURN',
      'SC-06-SHIELD-EXPIRES-AT-CASTER-START',
      'SC-06-SHIELD-STATE-REMOVED',
    ],
    ...link('spell.shield'),
  },
  {
    assertionId: 'SCENARIO-MASTERY-TOPPLE',
    scenarioId: 'SC-01',
    scenarioAssertionIds: [
      'SC-01-MASTERY-SAVE-WINDOW',
      'SC-01-MASTERY-NOT-APPLIED-BEFORE-SAVE',
      'SC-01-WEAPON-HIT-DAMAGE',
      'SC-01-MASTERY-SAVE-RELOAD',
      'SC-01-MASTERY-DAMAGE-NOT-REPEATED',
      'SC-01-MASTERY-SAVE-CLOSED',
      'SC-01-MASTERY-PRONE-STATE',
      'SC-01-MASTERY-CONDITION-EVENT',
      'SC-01-MASTERY-DOES-NOT-REPEAT-DAMAGE',
    ],
    ...derivedLink('class.fighter', 'derived.mastery.topple'),
  },
  {
    assertionId: 'SCENARIO-SPELL-MINOR-ILLUSION',
    scenarioId: 'SC-07',
    scenarioAssertionIds: [
      'SC-07-MINOR-ILLUSION-CREATED',
      'SC-07-MINOR-ILLUSION-COST',
      'SC-07-MINOR-ILLUSION-RELOAD',
      'SC-07-MINOR-ILLUSION-STUDY-ROLL',
      'SC-07-MINOR-ILLUSION-DISCERNED',
      'SC-07-STUDY-COSTS-ACTION',
      'SC-07-MINOR-ILLUSION-PHYSICALLY-REVEALED',
      'SC-07-PHYSICAL-INTERACTION-DECLARED',
      'SC-07-ILLUSION-DURATION-ADVANCED',
    ],
    ...link('spell.minor-illusion'),
  },
  {
    assertionId: 'SCENARIO-RUNTIME-MINOR-ILLUSION-WORLD',
    scenarioId: 'SC-07',
    scenarioAssertionIds: [
      'SC-07-MINOR-ILLUSION-CREATED',
      'SC-07-MINOR-ILLUSION-RELOAD',
      'SC-07-MINOR-ILLUSION-STUDY-ROLL',
      'SC-07-MINOR-ILLUSION-DISCERNED',
      'SC-07-STUDY-COSTS-ACTION',
      'SC-07-MINOR-ILLUSION-PHYSICALLY-REVEALED',
      'SC-07-PHYSICAL-INTERACTION-DECLARED',
      'SC-07-ILLUSION-DURATION-ADVANCED',
    ],
    ...derivedLink(
      'spell.minor-illusion',
      'derived.runtime.minor-illusion-object-and-study',
    ),
  },
  {
    assertionId: 'SCENARIO-RUNTIME-BURNING-HANDS-OBJECTS',
    scenarioId: 'SC-07',
    scenarioAssertionIds: [
      'SC-07-BURNING-HANDS-SAVE-WINDOW',
      'SC-07-BURNING-HANDS-IGNITES-CURTAIN',
      'SC-07-BURNING-HANDS-DOES-NOT-IGNITE-OUTSIDE',
      'SC-07-BURNING-HANDS-OBJECT-RELOAD',
      'SC-07-BURNING-HANDS-SAVE-ROLL',
      'SC-07-BURNING-HANDS-THREE-D6',
    ],
    ...derivedLink(
      'spell.burning-hands',
      'derived.runtime.environmental-object-effects',
    ),
  },
  {
    assertionId: 'SCENARIO-RUNTIME-THUNDERWAVE-OBJECTS',
    scenarioId: 'SC-01',
    scenarioAssertionIds: [
      'SC-01-THUNDERWAVE-SAVE-WINDOW',
      'SC-01-THUNDERWAVE-OBJECT-PUSH',
      'SC-01-THUNDERWAVE-SAVE-ROLL',
      'SC-01-THUNDERWAVE-DAMAGE',
      'SC-01-THUNDERWAVE-OBJECT-RELOAD',
    ],
    ...derivedLink(
      'spell.thunderwave',
      'derived.runtime.environmental-object-effects',
    ),
  },
];

const SCENARIO_TEST_EVIDENCE: readonly RegisteredScenarioTestEvidence[] = [
  ...COMPILED_MICRO_MVP_BUILD_SEMANTIC_EVIDENCE,
  ...COMPILED_MICRO_MVP_SPELL_SCENARIO_EVIDENCE,
  ...COMPILED_WORLD_SPELL_SCENARIO_EVIDENCE,
  ...FIND_FAMILIAR_RUNTIME_SCENARIO_EVIDENCE,
  ...COMPILED_WARLOCK_INVOCATION_SCENARIO_EVIDENCE,
  ...FIGHTER_MANDATORY_PROTOCOL_SCENARIO_EVIDENCE,
  ...COMPILED_MICRO_MVP_SPECIES_FEAT_STYLE_RUNTIME_EVIDENCE,
  ...PROTECTION_RUNTIME_SCENARIO_EVIDENCE,
  ...TOUGH_COMPILED_MANDATORY_SCENARIO_EVIDENCE,
  ...TWO_WEAPON_FIGHTING_CANONICAL_MANDATORY_SCENARIO_EVIDENCE,
  ...COMPILED_WARLOCK_PACT_MANDATORY_SCENARIO_EVIDENCE,
  ...WEAPON_MASTERY_2024_MANDATORY_SCENARIO_EVIDENCE,
  {
    assertionId: 'SCENARIO-SPELL-BLESS-COMPILED',
    testFile: 'src/rules-core/blessCompiled.integration.test.ts',
    testName: 'adds the compiled spell’s persistent d4 to an ally attack and save, but never a check',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-BLESS-COMPILED-01',
    links: [link('spell.bless')],
  },
  {
    assertionId: 'SCENARIO-SPELL-ARMOR-OF-AGATHYS-COMPILED',
    testFile: 'src/rules-core/armorOfAgathysCompiled.integration.test.ts',
    testName: 'casts the compiled source on turn one, retaliates against the other PC on turn two, and replays exactly',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-ARMOR-OF-AGATHYS-01',
    links: [link('spell.armor-of-agathys')],
  },
];

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function evidenceLink(
  registration: RegisteredEvidenceLink,
  evidenceType: 'unit' | 'scenario' | 'compiled_release_scenario',
): AssertionEvidenceLink {
  return {
    ...registration,
    aspectId: MICRO_MVP_SEMANTIC_ASPECT,
    evidenceType,
  };
}

function evidence(
  input: {
    assertionId: string;
    testFile: string;
    testName: string;
    links: readonly RegisteredEvidenceLink[];
    evidenceType: 'unit' | 'scenario' | 'compiled_release_scenario';
  },
  release: CoverageReleasePin = MICRO_MVP_COVERAGE_RELEASE,
): AssertionEvidence {
  return {
    schemaVersion: 1,
    assertionId: input.assertionId,
    owner: 'rules-qa',
    result: 'passed',
    rulesHash: release.rulesHash,
    contentHash: release.contentHash,
    testFile: input.testFile,
    testName: input.testName,
    links: input.links.map((item) => evidenceLink(item, input.evidenceType)),
  };
}

function unitTestLocatorKey(locator: RegisteredUnitTestLocator): string {
  return `${encodeURIComponent(locator.testFile)}|${encodeURIComponent(locator.testName)}`;
}

function compareUnitTestLocators(
  left: RegisteredUnitTestLocator,
  right: RegisteredUnitTestLocator,
): number {
  return left.testFile.localeCompare(right.testFile)
    || left.testName.localeCompare(right.testName);
}

function unitTestLocators(
  registration: RegisteredUnitEvidence,
  issues: EvidenceRegistrationIssue[],
): readonly RegisteredUnitTestLocator[] {
  const hasSingleFile = typeof registration.testFile === 'string';
  const hasSingleName = typeof registration.testName === 'string';
  const hasConjunction = registration.conjunctiveTests !== undefined;
  const singleMode = hasSingleFile && hasSingleName && !hasConjunction;
  const conjunctionMode = !hasSingleFile && !hasSingleName && hasConjunction;

  if (!singleMode && !conjunctionMode) {
    issues.push({
      code: 'invalid_test_locator_mode',
      assertionId: registration.assertionId,
      message: 'register exactly one single test or one conjunctive test list, never a mixture',
    });
    return [];
  }

  const locators = singleMode
    ? [{ testFile: registration.testFile!, testName: registration.testName! }]
    : [...registration.conjunctiveTests!];
  if (hasConjunction && locators.length === 0) {
    issues.push({
      code: 'empty_conjunctive_tests',
      assertionId: registration.assertionId,
      message: 'conjunctiveTests must contain at least one exact test locator',
    });
    return [];
  }

  const keys = locators.map(unitTestLocatorKey);
  for (const duplicate of duplicateValues(keys)) {
    const locator = locators.find((item) => unitTestLocatorKey(item) === duplicate)!;
    issues.push({
      code: 'duplicate_test_locator',
      assertionId: registration.assertionId,
      message: `test ${JSON.stringify(locator.testName)} is duplicated for ${locator.testFile}`,
    });
  }
  return locators.sort(compareUnitTestLocators);
}

function materializedUnitLocator(
  locators: readonly RegisteredUnitTestLocator[],
): RegisteredUnitTestLocator {
  if (locators.length === 1) return locators[0];
  return {
    testFile: locators[0].testFile,
    testName: locators
      .map((locator) => `${locator.testFile}#${locator.testName}`)
      .join(' && '),
  };
}

export function materializeMicroMvpUnitEvidence(
  registry: readonly RegisteredUnitEvidence[],
  executionManifest: ValidatedMicroMvpEvidenceExecutionManifest,
): readonly AssertionEvidence[] {
  const issues: EvidenceRegistrationIssue[] = [];
  for (const assertionId of duplicateValues(registry.map((item) => item.assertionId))) {
    issues.push({
      code: 'duplicate_assertion_id', assertionId,
      message: 'assertionId appears more than once in the unit registry',
    });
  }
  const locatorsByAssertion = new Map<string, readonly RegisteredUnitTestLocator[]>();
  for (const registration of registry) {
    const locators = unitTestLocators(registration, issues);
    locatorsByAssertion.set(registration.assertionId, locators);
    for (const locator of locators) {
      const executions = matchingMicroMvpEvidenceExecutions(executionManifest, locator);
      if (executions.length === 0) {
        issues.push({
          code: 'missing_test_execution', assertionId: registration.assertionId,
          message: `test ${JSON.stringify(locator.testName)} in ${locator.testFile} was not executed in the current run`,
        });
      } else if (new Set(executions.map((execution) => execution.fullTestName)).size > 1) {
        issues.push({
          code: 'ambiguous_test_execution', assertionId: registration.assertionId,
          message: `test ${JSON.stringify(locator.testName)} in ${locator.testFile} matched ${executions.length} suite-qualified executions`,
        });
      } else if (executions.some((execution) => execution.state !== 'passed')) {
        const failedStates = [...new Set(executions
          .filter((execution) => execution.state !== 'passed')
          .map((execution) => execution.state))].sort();
        issues.push({
          code: 'test_execution_not_passed', assertionId: registration.assertionId,
          message: `test ${JSON.stringify(executions[0].fullTestName)} in ${locator.testFile} has non-passed execution state(s): ${failedStates.join(', ')}`,
        });
      }
    }
  }
  if (issues.length) throw new MicroMvpEvidenceRegistrationError(issues);
  return registry.map((registration) => evidence({
    assertionId: registration.assertionId,
    ...materializedUnitLocator(locatorsByAssertion.get(registration.assertionId)!),
    links: registration.links,
    evidenceType: 'unit',
  }));
}

export function executeMicroMvpScenarioEvidence(
  registry: readonly RegisteredScenarioEvidence[] = SCENARIO_EVIDENCE,
): readonly AssertionEvidence[] {
  const issues: EvidenceRegistrationIssue[] = [];
  for (const assertionId of duplicateValues(registry.map((item) => item.assertionId))) {
    issues.push({
      code: 'duplicate_assertion_id', assertionId,
      message: 'assertionId appears more than once in the scenario registry',
    });
  }

  const observedByScenario = new Map<MicroMvpScenarioId, Set<string>>();
  for (const scenarioId of [...new Set(registry.map((item) => item.scenarioId))].sort()) {
    const run = runMicroMvpScenarioCase(MICRO_MVP_SCENARIO_CORPUS[scenarioId]);
    observedByScenario.set(scenarioId, new Set(run.assertionIds));
  }
  for (const registration of registry) {
    const observed = observedByScenario.get(registration.scenarioId);
    const missing = registration.scenarioAssertionIds.filter((assertionId) => !observed?.has(assertionId));
    if (missing.length) {
      issues.push({
        code: 'unknown_scenario_assertion', assertionId: registration.assertionId,
        message: `${missing.join(', ')} did not pass in ${registration.scenarioId}`,
      });
    }
  }
  if (issues.length) throw new MicroMvpEvidenceRegistrationError(issues);

  return registry.map((registration) => evidence({
    assertionId: registration.assertionId,
    testFile: 'src/rules-core/testing/microMvpScenarioCorpus.ts',
    testName: `${registration.scenarioId}:${registration.scenarioAssertionIds.join('+')}`,
    links: [registration],
    evidenceType: 'scenario',
  }));
}

export function materializeMicroMvpScenarioTestEvidence(
  registry: readonly RegisteredScenarioTestEvidence[] = SCENARIO_TEST_EVIDENCE,
  executionManifest: ValidatedMicroMvpEvidenceExecutionManifest,
): readonly AssertionEvidence[] {
  const issues: EvidenceRegistrationIssue[] = [];
  for (const assertionId of duplicateValues(registry.map((item) => item.assertionId))) {
    issues.push({
      code: 'duplicate_assertion_id', assertionId,
      message: 'assertionId appears more than once in the scenario-test registry',
    });
  }
  for (const scenarioId of duplicateValues(registry.map((item) => item.scenarioId))) {
    issues.push({
      code: 'duplicate_scenario_id', assertionId: scenarioId,
      message: 'scenarioId appears more than once in the scenario-test registry',
    });
  }
  for (const registration of registry) {
    const executions = matchingMicroMvpEvidenceExecutions(executionManifest, registration);
    if (executions.length === 0) {
      issues.push({
        code: 'missing_test_execution', assertionId: registration.assertionId,
        message: `test ${JSON.stringify(registration.testName)} in ${registration.testFile} was not executed in the current run`,
      });
    } else if (new Set(executions.map((execution) => execution.fullTestName)).size > 1) {
      issues.push({
        code: 'ambiguous_test_execution', assertionId: registration.assertionId,
        message: `test ${JSON.stringify(registration.testName)} in ${registration.testFile} matched ${executions.length} suite-qualified executions`,
      });
    } else if (executions.some((execution) => execution.state !== 'passed')) {
      const failedStates = [...new Set(executions
        .filter((execution) => execution.state !== 'passed')
        .map((execution) => execution.state))].sort();
      issues.push({
        code: 'test_execution_not_passed', assertionId: registration.assertionId,
        message: `test ${JSON.stringify(executions[0].fullTestName)} in ${registration.testFile} has non-passed execution state(s): ${failedStates.join(', ')}`,
      });
    } else if (registration.semanticProtocol !== 'mandatory-two-pc-v1'
      || typeof registration.scenarioId !== 'string'
      || registration.scenarioId.trim().length === 0
      || executions.some((execution) => (
      execution.meta.semanticProtocol !== registration.semanticProtocol
        || execution.meta.scenarioId !== registration.scenarioId
      ))) {
      issues.push({
        code: 'scenario_protocol_mismatch', assertionId: registration.assertionId,
        message: `test ${JSON.stringify(executions[0].fullTestName)} must execute protocol "mandatory-two-pc-v1" as non-empty scenario ${JSON.stringify(registration.scenarioId)}`,
      });
    }
  }
  if (issues.length) throw new MicroMvpEvidenceRegistrationError(issues);
  return registry.map((registration) => evidence({
    assertionId: registration.assertionId,
    testFile: registration.testFile,
    testName: registration.testName,
    links: registration.links,
    evidenceType: 'scenario',
  }));
}

export function materializeMicroMvpCompiledReleaseScenarioEvidence(
  registry: readonly RegisteredCompiledReleaseScenarioEvidence[],
  executionManifest: ValidatedMicroMvpEvidenceExecutionManifest,
): readonly AssertionEvidence[] {
  const issues: EvidenceRegistrationIssue[] = [];
  for (const assertionId of duplicateValues(registry.map((item) => item.assertionId))) {
    issues.push({
      code: 'duplicate_assertion_id', assertionId,
      message: 'assertionId appears more than once in the compiled-release registry',
    });
  }
  for (const registration of registry) {
    const executions = matchingMicroMvpEvidenceExecutions(executionManifest, registration);
    if (executions.length === 0) {
      issues.push({
        code: 'missing_test_execution', assertionId: registration.assertionId,
        message: `compiled release test ${JSON.stringify(registration.testName)} in ${registration.testFile} was not executed in the current run`,
      });
      continue;
    }
    if (executions.length !== 1) {
      issues.push({
        code: 'ambiguous_test_execution', assertionId: registration.assertionId,
        message: `compiled release test ${JSON.stringify(registration.testName)} in ${registration.testFile} matched ${executions.length} executions`,
      });
      continue;
    }
    const [execution] = executions;
    if (execution.state !== 'passed') {
      issues.push({
        code: 'test_execution_not_passed', assertionId: registration.assertionId,
        message: `compiled release test ${JSON.stringify(execution.fullTestName)} is ${execution.state}`,
      });
    } else if (
      registration.evidenceKind !== MICRO_MVP_COMPILED_RELEASE_SCENARIO_LOCATOR.evidenceKind
      || registration.semanticProtocol !== MICRO_MVP_COMPILED_RELEASE_SCENARIO_LOCATOR.semanticProtocol
      || registration.scenarioId !== MICRO_MVP_COMPILED_RELEASE_SCENARIO_LOCATOR.scenarioId
      || registration.testFile !== MICRO_MVP_COMPILED_RELEASE_SCENARIO_LOCATOR.testFile
      || registration.testName !== MICRO_MVP_COMPILED_RELEASE_SCENARIO_LOCATOR.testName
      || execution.meta.evidenceKind !== registration.evidenceKind
      || execution.meta.semanticProtocol !== registration.semanticProtocol
      || execution.meta.scenarioId !== registration.scenarioId
    ) {
      issues.push({
        code: 'scenario_protocol_mismatch', assertionId: registration.assertionId,
        message: `compiled release test ${JSON.stringify(execution.fullTestName)} must carry the exact compiled-release corpus metadata`,
      });
    }
  }
  if (issues.length) throw new MicroMvpEvidenceRegistrationError(issues);
  return registry.map((registration) => evidence({
    assertionId: registration.assertionId,
    testFile: registration.testFile,
    testName: registration.testName,
    links: registration.links,
    evidenceType: 'compiled_release_scenario',
  }));
}

export const MICRO_MVP_SCENARIO_EVIDENCE_REGISTRY = SCENARIO_EVIDENCE;
export const MICRO_MVP_SCENARIO_TEST_EVIDENCE_REGISTRY = SCENARIO_TEST_EVIDENCE;
