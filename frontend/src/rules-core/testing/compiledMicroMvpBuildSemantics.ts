import type { CompiledMicroMvpL1Root } from '../../canon/microMvpL1Overlay';
import { canonicalStringify } from '../determinism';
import {
  microMvpChoiceObligationId,
  microMvpEntityObligationId,
} from '../coverage/microMvpDenominator';
import type { CompiledMicroMvpScenarioActorState } from './compiledMicroMvpScenarioAdapter';
import {
  COMPILED_MICRO_MVP_COMMON_TRACE,
  createCompiledMicroMvpAcceptanceCaseForRoot,
  runCompiledMicroMvpAcceptanceCase,
  type CompiledMicroMvpAcceptanceCase,
  type CompiledMicroMvpAcceptanceCorpus,
} from './compiledMicroMvpAcceptanceCorpus';
import type { ScenarioRun } from './scenario';
import type { MandatoryTwoPcScenarioIdentity } from './mandatoryTwoPcProtocol';

export const COMPILED_MICRO_MVP_BUILD_SEMANTICS_TEST_FILE =
  'src/rules-core/testing/compiledMicroMvpBuildSemantics.test.ts' as const;

export interface CompiledMicroMvpSemanticEvidenceLink {
  entityId: string;
  obligationId: string;
}

export interface CompiledMicroMvpSemanticEvidenceRegistration extends MandatoryTwoPcScenarioIdentity {
  assertionId: string;
  testFile: typeof COMPILED_MICRO_MVP_BUILD_SEMANTICS_TEST_FILE;
  testName: string;
  links: readonly CompiledMicroMvpSemanticEvidenceLink[];
}

const PRODUCT_RULE_OBLIGATION = 'micro-mvp.product-rule.free_origin_feat_choice_v1';

function entityLink(entityId: string): CompiledMicroMvpSemanticEvidenceLink {
  return { entityId, obligationId: microMvpEntityObligationId(entityId) };
}

function choiceLink(
  entityId: string,
  suffix: string,
): CompiledMicroMvpSemanticEvidenceLink {
  return { entityId, obligationId: microMvpChoiceObligationId(suffix, entityId) };
}

function lineageLink(
  species: 'dragonborn' | 'elf',
  lineage: string,
): CompiledMicroMvpSemanticEvidenceLink {
  return {
    entityId: `species.${species}`,
    obligationId: `derived.lineage.${species}.${lineage}`,
  };
}

/**
 * Candidate registrations only for semantic claims made by this suite. Unlike
 * compiled_build_fact evidence, every entry points to a test that checks the
 * compiled mechanics/state after executing the common two-PC protocol.
 */
export const COMPILED_MICRO_MVP_BUILD_SEMANTIC_EVIDENCE = [
  {
    assertionId: 'SCENARIO-COMPILED-BACKGROUND-SEMANTICS',
    testFile: COMPILED_MICRO_MVP_BUILD_SEMANTICS_TEST_FILE,
    testName: 'runs each background through the common two-PC protocol and proves stable grants, equipment, and feat replacement',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-BUILD-BACKGROUNDS-01',
    links: [
      'background.soldier', 'background.sage', 'background.criminal', 'background.acolyte',
    ].map(entityLink),
  },
  {
    assertionId: 'SCENARIO-COMPILED-PRODUCT-ORIGIN-AND-HUMAN',
    testFile: COMPILED_MICRO_MVP_BUILD_SEMANTICS_TEST_FILE,
    testName: 'runs every product Origin feat on a Human and proves independent background, product, and species grants',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-BUILD-HUMAN-ORIGIN-01',
    links: [
      ...['feat.alert', 'feat.magic-initiate', 'feat.skilled', 'feat.tough'].map((entityId) => ({
        entityId, obligationId: PRODUCT_RULE_OBLIGATION,
      })),
      choiceLink('species.human', 'human_feat'),
      choiceLink('species.human', 'human_skill'),
    ],
  },
  {
    assertionId: 'SCENARIO-COMPILED-CLASS-SPELL-CHOICES',
    testFile: COMPILED_MICRO_MVP_BUILD_SEMANTICS_TEST_FILE,
    testName: 'runs every class spell-choice root and proves exact counts, legal pools, grants, and provenance',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-BUILD-CLASS-SPELLS-01',
    links: [
      choiceLink('class.cleric', 'cleric_cantrips'),
      choiceLink('class.cleric', 'cleric_spells_l1'),
      choiceLink('class.druid', 'druid_cantrips'),
      choiceLink('class.druid', 'druid_spells_l1'),
      choiceLink('class.sorcerer', 'sorcerer_cantrips'),
      choiceLink('class.sorcerer', 'sorcerer_spells_known'),
      choiceLink('class.warlock', 'warlock_cantrips'),
      choiceLink('class.warlock', 'warlock_spells_known'),
      choiceLink('class.wizard', 'wizard_cantrips'),
      choiceLink('class.wizard', 'wizard_spellbook_level_1'),
    ],
  },
  {
    assertionId: 'SCENARIO-COMPILED-STRUCTURED-CLASS-CHOICES',
    testFile: COMPILED_MICRO_MVP_BUILD_SEMANTICS_TEST_FILE,
    testName: 'runs every structured class-choice branch and proves its materialized grants and provenance',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-BUILD-CLASS-STRUCTURED-01',
    links: [
      choiceLink('class.cleric', 'cleric_divine_order'),
      choiceLink('class.druid', 'druid_primal_order'),
      choiceLink('class.fighter', 'fighter_fighting_style'),
      choiceLink('class.warlock', 'warlock_invocation_l1'),
    ],
  },
  {
    assertionId: 'SCENARIO-COMPILED-SKILL-AND-FEAT-CHOICES',
    testFile: COMPILED_MICRO_MVP_BUILD_SEMANTICS_TEST_FILE,
    testName: 'runs skill, feat, and Expertise choice roots and proves exact legal grants with source ownership',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-BUILD-SKILLS-FEATS-01',
    links: [
      choiceLink('species.elf', 'elf_skill'),
      choiceLink('feat.skilled', 'feat_skilled'),
      choiceLink('feat.magic-initiate', 'magic_initiate_wizard_cantrips'),
      choiceLink('feat.magic-initiate', 'magic_initiate_wizard_level_1'),
      choiceLink('class.rogue', 'rogue_expertise_l1'),
    ],
  },
  {
    assertionId: 'SCENARIO-COMPILED-WEAPON-MASTERY-CHOICES',
    testFile: COMPILED_MICRO_MVP_BUILD_SEMANTICS_TEST_FILE,
    testName: 'runs Fighter and Rogue mastery roots and proves qualified selections and executable bindings',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-BUILD-WEAPON-MASTERY-01',
    links: [
      choiceLink('class.fighter', 'weapon-mastery'),
      choiceLink('class.rogue', 'weapon-mastery'),
    ],
  },
  {
    assertionId: 'SCENARIO-COMPILED-DRAGONBORN-LINEAGES',
    testFile: COMPILED_MICRO_MVP_BUILD_SEMANTICS_TEST_FILE,
    testName: 'runs all ten Dragonborn ancestries and proves matching Breath Weapon, resistance, uses, and no flight leakage',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-BUILD-DRAGONBORN-LINEAGES-01',
    links: [
      ...[
        'black', 'blue', 'brass', 'bronze', 'copper',
        'gold', 'green', 'red', 'silver', 'white',
      ].map((lineage) => lineageLink('dragonborn', lineage)),
    ],
  },
  {
    assertionId: 'SCENARIO-COMPILED-ELF-LINEAGES',
    testFile: COMPILED_MICRO_MVP_BUILD_SEMANTICS_TEST_FILE,
    testName: 'runs all three Elf lineages and proves level-1 grants, source ability, and no level-3 or level-5 leakage',
    semanticProtocol: 'mandatory-two-pc-v1',
    scenarioId: 'SC-BUILD-ELF-LINEAGES-01',
    links: ['drow', 'high-elf', 'wood-elf'].map((lineage) => lineageLink('elf', lineage)),
  },
] as const satisfies readonly CompiledMicroMvpSemanticEvidenceRegistration[];

export interface ExecutedCompiledMicroMvpSemanticCase {
  scenario: CompiledMicroMvpAcceptanceCase;
  run: ScenarioRun;
  root: CompiledMicroMvpL1Root;
  initialSubject: CompiledMicroMvpScenarioActorState;
  finalSubject: CompiledMicroMvpScenarioActorState;
}

export class CompiledMicroMvpSemanticProtocolError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Compiled semantic two-PC protocol failed:\n${problems.join('\n')}`);
    this.name = 'CompiledMicroMvpSemanticProtocolError';
  }
}

/**
 * Executes, rather than merely labels, the common acceptance protocol before a
 * semantic test is allowed to inspect its root and surviving runtime state.
 */
export function executeCompiledMicroMvpSemanticCase(input: {
  corpus: CompiledMicroMvpAcceptanceCorpus;
  root: CompiledMicroMvpL1Root;
  index: number;
  idPrefix: string;
}): ExecutedCompiledMicroMvpSemanticCase {
  const scenario = createCompiledMicroMvpAcceptanceCaseForRoot(
    input.corpus,
    input.root,
    { index: input.index, idPrefix: input.idPrefix },
  );
  const run = runCompiledMicroMvpAcceptanceCase(scenario);
  const problems: string[] = [];
  const initialActors = Object.values(run.initialState.actors);
  if (initialActors.length !== 2
    || initialActors.some((actor) => actor.kind !== 'playerCharacter')) {
    problems.push('scenario must instantiate exactly two player characters');
  }
  if (scenario.subject.fixtureId === scenario.support.fixtureId) {
    problems.push('subject and support must use distinct compiled roots');
  }
  if (canonicalStringify(run.observedTrace)
    !== canonicalStringify([...COMPILED_MICRO_MVP_COMMON_TRACE].sort())) {
    problems.push('nonspell, spell, condition, save, and check trace is incomplete');
  }
  if (run.rejections.length) problems.push(`scenario has ${run.rejections.length} rejection(s)`);
  if (run.checkpoints.length !== 2) problems.push(`expected 2 checkpoints, got ${run.checkpoints.length}`);
  if (run.rngConsumed !== scenario.spec.rollTape?.length) {
    problems.push('strict deterministic RNG tape was not consumed exactly');
  }
  if (canonicalStringify(run.finalState) !== canonicalStringify(run.replayState)) {
    problems.push('event replay diverged from authoritative state');
  }
  if (run.finalState.scene.mode !== 'encounter' || run.finalState.scene.round < 2) {
    problems.push('strict subject/support turn sequence did not complete');
  }
  const requiredAssertions = [
    `${scenario.id}:TWO-PC-INITIATIVE`,
    `${scenario.id}:NONSPELL-ACTION`,
    `${scenario.id}:CONDITION-APPLIED`,
    `${scenario.id}:ABILITY-CHECK`,
    `${scenario.id}:SUBJECT-ENDS-TURN`,
    `${scenario.id}:CROSS-PC-SPELL`,
    `${scenario.id}:SAVING-THROW`,
    `${scenario.id}:SUPPORT-ENDS-TURN`,
    `${scenario.id}:BUILD-SURVIVES-CHECKPOINT`,
    `${scenario.id}:SAVE-SURVIVES-CHECKPOINT`,
  ];
  for (const assertionId of requiredAssertions) {
    if (!run.assertionIds.includes(assertionId)) problems.push(`${assertionId} did not execute`);
  }
  const initialSubject = run.initialState.actors.subject as CompiledMicroMvpScenarioActorState;
  const finalSubject = run.finalState.actors.subject as CompiledMicroMvpScenarioActorState;
  if (initialSubject.compiledSource?.stableKey !== input.root.stableKey
    || finalSubject.compiledSource?.stableKey !== input.root.stableKey) {
    problems.push('compiled subject identity did not survive execution/checkpoints');
  }
  if (problems.length) throw new CompiledMicroMvpSemanticProtocolError(problems);
  return { scenario, run, root: input.root, initialSubject, finalSubject };
}
