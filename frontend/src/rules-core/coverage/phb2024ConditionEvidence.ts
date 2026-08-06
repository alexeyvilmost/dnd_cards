import {
  matchingMicroMvpEvidenceExecutions,
  type ValidatedMicroMvpEvidenceExecutionManifest,
} from './microMvpEvidenceExecution';

export const PHB_2024_CONDITION_OBLIGATION_CARDINALITY = 55 as const;
export const PHB_2024_CONDITION_TEST_FILE =
  'src/rules-core/conditions2024.integration.test.ts' as const;

export interface Phb2024ConditionObligationEvidence {
  conditionId: string;
  clauseId: string;
  obligationId: string;
  unitTest: { testFile: string; testName: string };
  twoPcTest: { testFile: string; testName: string };
}

export interface Phb2024ConditionEvidenceContract {
  conditionId: string;
  obligations: readonly Phb2024ConditionObligationEvidence[];
}

const obligation = (
  conditionId: string,
  clauseId: string,
): Phb2024ConditionObligationEvidence => {
  const obligationId = `condition.${conditionId}.${clauseId}`;
  return {
    conditionId,
    clauseId,
    obligationId,
    unitTest: {
      testFile: PHB_2024_CONDITION_TEST_FILE,
      testName: `unit ${obligationId}`,
    },
    twoPcTest: {
      testFile: PHB_2024_CONDITION_TEST_FILE,
      testName: `two-PC ${obligationId}`,
    },
  };
};

const evidence = (
  conditionId: string,
  clauseIds: readonly string[],
): Phb2024ConditionEvidenceContract => ({
  conditionId,
  obligations: clauseIds.map((clauseId) => obligation(conditionId, clauseId)),
});

/**
 * Independent, atomic PHB 2024 condition denominator. Every clause below must
 * have both an exact pure/unit test and an exact mandatory two-player test in
 * the same current evidence run. Broad condition-level smoke tests cannot
 * satisfy an individual clause.
 */
export const PHB_2024_CONDITION_EVIDENCE: readonly Phb2024ConditionEvidenceContract[] = [
  evidence('blinded', [
    'cannot_see', 'sight_check_auto_fail', 'own_attack_disadvantage',
    'incoming_attack_advantage',
  ]),
  evidence('charmed', ['source_scoped_harm_denial', 'source_social_advantage']),
  evidence('deafened', ['hearing_check_auto_fail']),
  evidence('exhaustion', [
    'level_stacking', 'd20_minus_2_per_level', 'speed_minus_5_per_level',
    'long_rest_minus_one', 'level_6_death',
  ]),
  evidence('frightened', [
    'source_los_attack_disadvantage', 'source_los_check_disadvantage',
    'cannot_approach_source_even_without_los',
  ]),
  evidence('grappled', ['speed_zero', 'attack_disadvantage_except_grappler']),
  evidence('incapacitated', [
    'deny_action_bonus_reaction_concentration_and_speech', 'initiative_disadvantage',
  ]),
  evidence('invisible', [
    'own_attack_advantage_unless_seen', 'incoming_attack_disadvantage_unless_seen',
    'initiative_advantage', 'requires_sight_targeting_world_fact',
  ]),
  evidence('paralyzed', [
    'includes_incapacitated', 'speed_zero', 'str_dex_auto_fail',
    'incoming_advantage', 'within_5ft_auto_crit',
  ]),
  evidence('petrified', [
    'includes_incapacitated', 'speed_zero', 'str_dex_auto_fail',
    'incoming_advantage', 'all_damage_resistance', 'poisoned_immunity',
  ]),
  evidence('poisoned', ['own_attack_disadvantage', 'ability_check_disadvantage']),
  evidence('prone', [
    'own_attack_disadvantage', 'incoming_within_5ft_advantage',
    'incoming_beyond_5ft_disadvantage', 'stand_cost_world_fact',
  ]),
  evidence('restrained', [
    'speed_zero', 'own_attack_disadvantage', 'dex_save_disadvantage',
    'incoming_attack_advantage',
  ]),
  evidence('stunned', ['includes_incapacitated', 'str_dex_auto_fail', 'incoming_attack_advantage']),
  evidence('unconscious', [
    'includes_incapacitated_and_prone_not_paralyzed', 'speed_zero', 'str_dex_auto_fail',
    'incoming_advantage', 'within_5ft_auto_crit', 'leaves_prone',
    'drops_held_items_world_fact', 'unaware_of_surroundings_world_fact',
  ]),
] as const;

export const PHB_2024_CONDITION_IDS = PHB_2024_CONDITION_EVIDENCE
  .map((entry) => entry.conditionId);

export const PHB_2024_CONDITION_OBLIGATIONS = PHB_2024_CONDITION_EVIDENCE
  .flatMap((entry) => entry.obligations);

export interface Phb2024ConditionEvidenceIssue {
  code:
    | 'invalid_condition_denominator'
    | 'duplicate_obligation'
    | 'duplicate_test_locator'
    | 'missing_test_execution'
    | 'ambiguous_test_execution'
    | 'test_execution_not_passed';
  obligationId: string;
  message: string;
}

export class Phb2024ConditionEvidenceError extends Error {
  constructor(readonly issues: readonly Phb2024ConditionEvidenceIssue[]) {
    super([
      `PHB 2024 condition evidence has ${issues.length} issue(s):`,
      ...issues.map((issue) => `[${issue.code}] ${issue.obligationId}: ${issue.message}`),
    ].join('\n'));
    this.name = 'Phb2024ConditionEvidenceError';
  }
}

export function validatePhb2024ConditionEvidenceContract(): void {
  const issues: Phb2024ConditionEvidenceIssue[] = [];
  if (PHB_2024_CONDITION_EVIDENCE.length !== 15
    || new Set(PHB_2024_CONDITION_IDS).size !== 15
    || PHB_2024_CONDITION_OBLIGATIONS.length !== PHB_2024_CONDITION_OBLIGATION_CARDINALITY) {
    issues.push({
      code: 'invalid_condition_denominator',
      obligationId: 'condition.*',
      message: 'expected exactly 15 conditions and 55 atomic obligations',
    });
  }

  const obligationIds = PHB_2024_CONDITION_OBLIGATIONS.map((item) => item.obligationId);
  for (const duplicated of obligationIds.filter((id, index) => obligationIds.indexOf(id) !== index)) {
    issues.push({
      code: 'duplicate_obligation', obligationId: duplicated,
      message: 'atomic obligation appears more than once',
    });
  }
  const locators = PHB_2024_CONDITION_OBLIGATIONS.flatMap((item) => [
    `${item.unitTest.testFile}\0${item.unitTest.testName}`,
    `${item.twoPcTest.testFile}\0${item.twoPcTest.testName}`,
  ]);
  for (const duplicated of locators.filter((id, index) => locators.indexOf(id) !== index)) {
    issues.push({
      code: 'duplicate_test_locator', obligationId: duplicated.split('\0')[1] ?? duplicated,
      message: 'exact condition test locator appears more than once',
    });
  }
  if (issues.length) throw new Phb2024ConditionEvidenceError(issues);
}

/** Blocking micro-MVP gate: both exact locators must exist exactly once and
 * have passed in this runner invocation. A rename, deletion, skip, todo, or
 * broad replacement therefore leaves the atomic clause uncertified. */
export function validatePhb2024ConditionEvidenceExecution(
  manifest: ValidatedMicroMvpEvidenceExecutionManifest,
): void {
  validatePhb2024ConditionEvidenceContract();
  const issues: Phb2024ConditionEvidenceIssue[] = [];
  for (const item of PHB_2024_CONDITION_OBLIGATIONS) {
    for (const [kind, locator] of [
      ['unit', item.unitTest],
      ['two-PC', item.twoPcTest],
    ] as const) {
      const matches = matchingMicroMvpEvidenceExecutions(manifest, locator);
      if (matches.length === 0) {
        issues.push({
          code: 'missing_test_execution', obligationId: item.obligationId,
          message: `${kind} test ${locator.testFile} :: ${locator.testName} is absent`,
        });
      } else if (matches.length > 1) {
        issues.push({
          code: 'ambiguous_test_execution', obligationId: item.obligationId,
          message: `${kind} test locator matched ${matches.length} executions`,
        });
      } else if (matches[0].state !== 'passed') {
        issues.push({
          code: 'test_execution_not_passed', obligationId: item.obligationId,
          message: `${kind} test state is ${matches[0].state}`,
        });
      }
    }
  }
  if (issues.length) throw new Phb2024ConditionEvidenceError(issues);
}
