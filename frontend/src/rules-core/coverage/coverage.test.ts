import { describe, expect, it } from 'vitest';
import { aspectId } from './aspectId';
import { buildAssertionEvidenceIndex } from './assertionEvidenceIndex';
import type { AssertionEvidence, AssertionResult } from './assertionEvidenceIndex';
import type { CapabilityEvidenceMatrix } from './capabilityEvidenceMatrix';
import type { CoverageReleasePin, RuleObligation, Sha256Hash } from './ruleObligation';
import {
  CoverageValidationError,
  validateCapabilityEvidence,
  validateCapabilityEvidenceStrict,
} from './validator';
import type { CoverageIssueKind, CoverageValidationInput } from './validator';

const RULES_HASH = `sha256:${'1'.repeat(64)}` as Sha256Hash;
const CONTENT_HASH = `sha256:${'2'.repeat(64)}` as Sha256Hash;
const SOURCE_HASH = `sha256:${'3'.repeat(64)}` as Sha256Hash;
const OTHER_RULES_HASH = `sha256:${'4'.repeat(64)}` as Sha256Hash;
const OTHER_CONTENT_HASH = `sha256:${'5'.repeat(64)}` as Sha256Hash;

const RELEASE: CoverageReleasePin = {
  systemId: 'dnd5e-2024',
  releaseId: 'micro-mvp@1',
  errataVersion: 'phb-2024-v1',
  rulesHash: RULES_HASH,
  contentHash: CONTENT_HASH,
};

const ATTACK_POSITIVE = aspectId('execution.positive');
const ATTACK_NEGATIVE = aspectId('execution.negative');
const ATTACK_BOUNDARY = aspectId('execution.boundary');
const REDUCER_UNIT = aspectId('reducer.unit');
const REDUCER_REPLAY = aspectId('reducer.replay');
const UI_A11Y = aspectId('ui.a11y');

function obligation(id: string, title: string): RuleObligation {
  return {
    schemaVersion: 1,
    id,
    title,
    statement: `${title} has an independently authored expected outcome.`,
    owner: 'rules-team',
    release: { ...RELEASE },
    source: {
      sourceId: 'phb-2024',
      track: 'PHB',
      edition: '2024',
      version: 'v1',
      section: 'Rules Glossary',
      locator: `anchor:${id}`,
      retrievedAt: '2026-08-04',
      sourceHash: SOURCE_HASH,
    },
  };
}

function assertion(
  assertionId: string,
  entityId: string,
  obligationId: string,
  aspect: ReturnType<typeof aspectId>,
  evidenceType: string,
): AssertionEvidence {
  return {
    schemaVersion: 1,
    assertionId,
    owner: 'qa-team',
    result: 'passed',
    rulesHash: RULES_HASH,
    contentHash: CONTENT_HASH,
    testFile: 'src/rules-core/coverage/acceptance.test.ts',
    testName: assertionId,
    links: [{ entityId, obligationId, aspectId: aspect, evidenceType }],
  };
}

function matrix(): CapabilityEvidenceMatrix {
  return {
    schemaVersion: 1,
    id: 'micro-mvp-capabilities-v1',
    owner: 'qa-lead',
    release: { ...RELEASE },
    scopeEntityIds: ['action:shove', 'core:turn-order'],
    profiles: [
      {
        id: 'executable_action',
        title: 'Executable action',
        owner: 'rules-team',
        requirements: [
          { aspectId: ATTACK_POSITIVE, evidenceTypes: ['scenario'], notApplicable: 'forbidden' },
          { aspectId: ATTACK_NEGATIVE, evidenceTypes: ['scenario'], notApplicable: 'forbidden' },
          { aspectId: ATTACK_BOUNDARY, evidenceTypes: ['scenario'], notApplicable: 'forbidden' },
        ],
      },
      {
        id: 'core_reducer',
        title: 'Core reducer',
        owner: 'engine-team',
        requirements: [
          { aspectId: REDUCER_UNIT, evidenceTypes: ['unit'], notApplicable: 'forbidden' },
          { aspectId: REDUCER_REPLAY, evidenceTypes: ['replay'], notApplicable: 'forbidden' },
          { aspectId: UI_A11Y, evidenceTypes: ['a11y'], notApplicable: 'allowed_by_scope_rule' },
        ],
      },
    ],
    targets: [
      {
        entityId: 'action:shove',
        obligationId: 'rule.attack.hit',
        capabilityProfileIds: ['executable_action'],
        owner: 'combat-team',
      },
      {
        entityId: 'core:turn-order',
        obligationId: 'rule.turn.order',
        capabilityProfileIds: ['core_reducer'],
        owner: 'engine-team',
      },
    ],
    notApplicableScopeRules: [{
      id: 'core-has-no-ui',
      owner: 'architecture-team',
      rationale: 'The platform-free reducer has no user interface surface.',
      basis: 'not_applicable_by_design',
      allowedCells: [{
        entityId: 'core:turn-order',
        obligationId: 'rule.turn.order',
        aspectId: UI_A11Y,
      }],
    }],
    notApplicable: [{
      entityId: 'core:turn-order',
      obligationId: 'rule.turn.order',
      aspectId: UI_A11Y,
      owner: 'engine-team',
      reason: 'Reducer acceptance is exercised without a rendered UI.',
      scopeRuleId: 'core-has-no-ui',
    }],
  };
}

function validInput(): CoverageValidationInput {
  return {
    currentRelease: { ...RELEASE },
    currentEntityIds: ['action:shove', 'core:turn-order'],
    obligations: [
      obligation('rule.attack.hit', 'Attack resolution'),
      obligation('rule.turn.order', 'Turn ordering'),
    ],
    matrix: matrix(),
    assertions: [
      assertion('attack-positive', 'action:shove', 'rule.attack.hit', ATTACK_POSITIVE, 'scenario'),
      assertion('attack-negative', 'action:shove', 'rule.attack.hit', ATTACK_NEGATIVE, 'scenario'),
      assertion('attack-boundary', 'action:shove', 'rule.attack.hit', ATTACK_BOUNDARY, 'scenario'),
      assertion('turn-unit', 'core:turn-order', 'rule.turn.order', REDUCER_UNIT, 'unit'),
      assertion('turn-replay', 'core:turn-order', 'rule.turn.order', REDUCER_REPLAY, 'replay'),
    ],
  };
}

function expectIssue(
  input: CoverageValidationInput,
  kind: CoverageIssueKind,
  code?: string,
): void {
  const report = validateCapabilityEvidence(input);
  expect(report.valid).toBe(false);
  expect(report.issues.some((issue) => issue.kind === kind && (!code || issue.code === code))).toBe(true);
  expect(() => validateCapabilityEvidenceStrict(input)).toThrow(CoverageValidationError);
}

describe('aspectId', () => {
  it('accepts stable hierarchical IDs without normalization', () => {
    expect(aspectId('execution.save-boundary')).toBe('execution.save-boundary');
    expect(aspectId('ui.a11y_keyboard')).toBe('ui.a11y_keyboard');
  });

  it.each(['', ' Execution.positive', 'execution positive', 'Execution.positive', 'a/'.repeat(61)])(
    'rejects unstable ID %j',
    (value) => expect(() => aspectId(value)).toThrow(/Invalid aspectId/),
  );
});

describe('honest capability denominator and evidence index', () => {
  it('accepts only current passing evidence and reports the declared denominator', () => {
    const report = validateCapabilityEvidenceStrict(validInput());

    expect(report.valid).toBe(true);
    expect(report.summary).toEqual({
      declaredEntities: 2,
      obligations: 2,
      denominatorCells: 6,
      applicableCells: 5,
      justifiedNotApplicableCells: 1,
      requiredEvidenceSlots: 5,
      passedEvidenceSlots: 5,
      uncoveredEvidenceSlots: 0,
      assertions: 5,
    });
    expect(Object.keys(report.evidenceIndex)).toHaveLength(5);
  });

  it('derives denominator from scope/profiles, never from assertions', () => {
    const input = validInput();
    input.assertions = input.assertions.slice(0, 1);
    const report = validateCapabilityEvidence(input);

    expect(report.summary.denominatorCells).toBe(6);
    expect(report.summary.requiredEvidenceSlots).toBe(5);
    expect(report.summary.passedEvidenceSlots).toBe(1);
    expect(report.summary.uncoveredEvidenceSlots).toBe(4);
    expectIssue(input, 'missing_evidence', 'missing_passing_evidence');
  });

  it('builds a deterministic many-links-per-assertion index', () => {
    const first = assertion(
      'shared-scenario',
      'action:shove',
      'rule.attack.hit',
      ATTACK_POSITIVE,
      'scenario',
    );
    first.links = [
      ...first.links,
      {
        entityId: 'action:shove',
        obligationId: 'rule.attack.hit',
        aspectId: ATTACK_NEGATIVE,
        evidenceType: 'scenario',
      },
    ];
    const later = assertion(
      'z-assertion',
      'core:turn-order',
      'rule.turn.order',
      REDUCER_UNIT,
      'unit',
    );

    const forward = buildAssertionEvidenceIndex([later, first]);
    const reverse = buildAssertionEvidenceIndex([first, later]);
    expect(forward).toEqual(reverse);
    expect(Object.keys(forward)).toHaveLength(3);
    expect(Object.values(forward).flat().map((entry) => entry.assertionId)).toEqual([
      'shared-scenario', 'shared-scenario', 'z-assertion',
    ]);
  });

  it('rejects a vacuous empty denominator', () => {
    const input = validInput();
    input.currentEntityIds = [];
    input.obligations = [];
    input.matrix = {
      ...input.matrix,
      scopeEntityIds: [],
      targets: [],
      notApplicable: [],
      notApplicableScopeRules: [],
    };
    input.assertions = [];
    expectIssue(input, 'invalid', 'empty_denominator');
  });
});

describe('duplicate rejection', () => {
  it('rejects duplicate obligations', () => {
    const input = validInput();
    input.obligations = [...input.obligations, input.obligations[0]];
    expectIssue(input, 'duplicate', 'duplicate_obligation');
  });

  it('rejects duplicate profiles, targets and target profile assignments', () => {
    const profileInput = validInput();
    profileInput.matrix.profiles = [
      ...profileInput.matrix.profiles,
      profileInput.matrix.profiles[0],
    ];
    expectIssue(profileInput, 'duplicate', 'duplicate_profile');

    const targetInput = validInput();
    targetInput.matrix.targets = [
      ...targetInput.matrix.targets,
      targetInput.matrix.targets[0],
    ];
    expectIssue(targetInput, 'duplicate', 'duplicate_target');

    const assignmentInput = validInput();
    assignmentInput.matrix.targets = assignmentInput.matrix.targets.map((target, index) => (
      index === 0
        ? { ...target, capabilityProfileIds: ['executable_action', 'executable_action'] }
        : target
    ));
    expectIssue(assignmentInput, 'duplicate', 'duplicate_target_profile');
  });

  it('rejects duplicate profile requirements and evidence types', () => {
    const aspectInput = validInput();
    const executable = aspectInput.matrix.profiles[0];
    aspectInput.matrix.profiles = [
      {
        ...executable,
        requirements: [...executable.requirements, executable.requirements[0]],
      },
      aspectInput.matrix.profiles[1],
    ];
    expectIssue(aspectInput, 'duplicate', 'duplicate_profile_aspect');

    const evidenceInput = validInput();
    const firstProfile = evidenceInput.matrix.profiles[0];
    evidenceInput.matrix.profiles = [
      {
        ...firstProfile,
        requirements: firstProfile.requirements.map((requirement, index) => (
          index === 0 ? { ...requirement, evidenceTypes: ['scenario', 'scenario'] } : requirement
        )),
      },
      evidenceInput.matrix.profiles[1],
    ];
    expectIssue(evidenceInput, 'duplicate', 'duplicate_evidence_type');
  });

  it('rejects duplicate assertions, assertion links, and N/A declarations', () => {
    const assertionInput = validInput();
    assertionInput.assertions = [...assertionInput.assertions, assertionInput.assertions[0]];
    expectIssue(assertionInput, 'duplicate', 'duplicate_assertion');

    const linkInput = validInput();
    linkInput.assertions = linkInput.assertions.map((item, index) => (
      index === 0 ? { ...item, links: [...item.links, item.links[0]] } : item
    ));
    expectIssue(linkInput, 'duplicate', 'duplicate_assertion_link');

    const naInput = validInput();
    naInput.matrix.notApplicable = [
      ...naInput.matrix.notApplicable,
      naInput.matrix.notApplicable[0],
    ];
    expectIssue(naInput, 'duplicate', 'duplicate_na_declaration');
  });
});

describe('orphan rejection', () => {
  it('rejects unknown target entity, obligation, and capability profile', () => {
    const entityInput = validInput();
    entityInput.matrix.targets = entityInput.matrix.targets.map((target, index) => (
      index === 0 ? { ...target, entityId: 'action:unknown' } : target
    ));
    expectIssue(entityInput, 'orphan', 'orphan_target_entity');

    const obligationInput = validInput();
    obligationInput.matrix.targets = obligationInput.matrix.targets.map((target, index) => (
      index === 0 ? { ...target, obligationId: 'rule.unknown' } : target
    ));
    expectIssue(obligationInput, 'orphan', 'orphan_target_obligation');

    const profileInput = validInput();
    profileInput.matrix.targets = profileInput.matrix.targets.map((target, index) => (
      index === 0 ? { ...target, capabilityProfileIds: ['unknown_profile'] } : target
    ));
    expectIssue(profileInput, 'orphan', 'orphan_target_profile');
  });

  it('rejects scoped entities and obligations omitted from targets', () => {
    const input = validInput();
    input.matrix.targets = input.matrix.targets.slice(0, 1);
    expectIssue(input, 'orphan', 'scope_entity_without_capability');
    expectIssue(input, 'orphan', 'orphan_obligation');
  });

  it('rejects assertion links outside a denominator cell or evidence requirement', () => {
    const cellInput = validInput();
    cellInput.assertions = cellInput.assertions.map((item, index) => (
      index === 0
        ? {
          ...item,
          links: [{ ...item.links[0], aspectId: aspectId('execution.unknown') }],
        }
        : item
    ));
    expectIssue(cellInput, 'orphan', 'orphan_assertion_link');

    const typeInput = validInput();
    typeInput.assertions = typeInput.assertions.map((item, index) => (
      index === 0
        ? { ...item, links: [{ ...item.links[0], evidenceType: 'tag-only' }] }
        : item
    ));
    expectIssue(typeInput, 'orphan', 'unexpected_evidence_type');
  });

  it('rejects assertions with no explicit links and unused N/A scope rules', () => {
    const assertionInput = validInput();
    assertionInput.assertions = [
      ...assertionInput.assertions,
      { ...assertionInput.assertions[0], assertionId: 'empty-claim', links: [] },
    ];
    expectIssue(assertionInput, 'orphan', 'assertion_without_links');

    const ruleInput = validInput();
    ruleInput.matrix.notApplicable = [];
    expectIssue(ruleInput, 'orphan', 'unused_na_scope_rule');
  });
});

describe('rules/content freshness', () => {
  it('rejects stale matrix rules and content hashes independently', () => {
    const rulesInput = validInput();
    rulesInput.matrix.release = { ...rulesInput.matrix.release, rulesHash: OTHER_RULES_HASH };
    expectIssue(rulesInput, 'stale', 'stale_rules_hash');

    const contentInput = validInput();
    contentInput.matrix.release = { ...contentInput.matrix.release, contentHash: OTHER_CONTENT_HASH };
    expectIssue(contentInput, 'stale', 'stale_content_hash');
  });

  it('rejects stale obligation and assertion evidence hashes', () => {
    const obligationInput = validInput();
    obligationInput.obligations = obligationInput.obligations.map((item, index) => (
      index === 0
        ? { ...item, release: { ...item.release, rulesHash: OTHER_RULES_HASH } }
        : item
    ));
    expectIssue(obligationInput, 'stale', 'stale_rules_hash');

    const assertionInput = validInput();
    assertionInput.assertions = assertionInput.assertions.map((item, index) => (
      index === 0
        ? { ...item, contentHash: OTHER_CONTENT_HASH }
        : item
    ));
    expectIssue(assertionInput, 'stale', 'stale_content_hash');
    expect(validateCapabilityEvidence(assertionInput).summary.uncoveredEvidenceSlots).toBe(1);
  });

  it('rejects a stale entity denominator even if claimed hashes were not changed', () => {
    const input = validInput();
    input.currentEntityIds = [...input.currentEntityIds, 'action:new-from-current-content'];
    expectIssue(input, 'stale', 'stale_entity_scope');
  });
});

describe('ownership gate', () => {
  it.each([
    ['matrix', (input: CoverageValidationInput) => { input.matrix.owner = ''; }],
    ['obligation', (input: CoverageValidationInput) => {
      input.obligations = [{ ...input.obligations[0], owner: '' }, input.obligations[1]];
    }],
    ['profile', (input: CoverageValidationInput) => {
      input.matrix.profiles = [{ ...input.matrix.profiles[0], owner: '' }, input.matrix.profiles[1]];
    }],
    ['target', (input: CoverageValidationInput) => {
      input.matrix.targets = [{ ...input.matrix.targets[0], owner: '' }, input.matrix.targets[1]];
    }],
    ['N/A scope rule', (input: CoverageValidationInput) => {
      input.matrix.notApplicableScopeRules = [{
        ...input.matrix.notApplicableScopeRules[0], owner: '',
      }];
    }],
    ['N/A declaration', (input: CoverageValidationInput) => {
      input.matrix.notApplicable = [{ ...input.matrix.notApplicable[0], owner: '' }];
    }],
    ['assertion', (input: CoverageValidationInput) => {
      input.assertions = [{ ...input.assertions[0], owner: '' }, ...input.assertions.slice(1)];
    }],
  ])('rejects missing owner on %s', (_label, mutate) => {
    const input = validInput();
    mutate(input);
    expectIssue(input, 'no_owner', 'missing_owner');
  });
});

describe('N/A gate', () => {
  it('does not remove a forbidden aspect from the denominator', () => {
    const input = validInput();
    const reducer = input.matrix.profiles[1];
    input.matrix.profiles = [
      input.matrix.profiles[0],
      {
        ...reducer,
        requirements: reducer.requirements.map((requirement) => (
          requirement.aspectId === UI_A11Y
            ? { ...requirement, notApplicable: 'forbidden' as const }
            : requirement
        )),
      },
    ];
    const report = validateCapabilityEvidence(input);
    expect(report.summary.justifiedNotApplicableCells).toBe(0);
    expect(report.summary.requiredEvidenceSlots).toBe(6);
    expectIssue(input, 'unjustified_not_applicable', 'na_forbidden_by_profile');
  });

  it('rejects missing reason and unknown or nonmatching scope rules', () => {
    const reasonInput = validInput();
    reasonInput.matrix.notApplicable = [{ ...reasonInput.matrix.notApplicable[0], reason: ' ' }];
    expectIssue(reasonInput, 'unjustified_not_applicable', 'missing_na_reason');

    const unknownInput = validInput();
    unknownInput.matrix.notApplicable = [{
      ...unknownInput.matrix.notApplicable[0], scopeRuleId: 'unknown-rule',
    }];
    expectIssue(unknownInput, 'unjustified_not_applicable', 'unknown_na_scope_rule');

    const mismatchInput = validInput();
    mismatchInput.matrix.notApplicableScopeRules = [{
      ...mismatchInput.matrix.notApplicableScopeRules[0],
      allowedCells: [{
        entityId: 'action:shove',
        obligationId: 'rule.attack.hit',
        aspectId: ATTACK_POSITIVE,
      }],
    }];
    expectIssue(mismatchInput, 'unjustified_not_applicable', 'na_outside_scope_rule');
  });

  it('rejects unsupported mechanic as an N/A basis at runtime', () => {
    const input = validInput();
    input.matrix.notApplicableScopeRules = [{
      ...input.matrix.notApplicableScopeRules[0],
      basis: 'unsupported_mechanic',
    } as unknown as CapabilityEvidenceMatrix['notApplicableScopeRules'][number]];
    expectIssue(input, 'unjustified_not_applicable', 'unsupported_na_basis');
  });

  it('rejects evidence attached to a justified N/A cell', () => {
    const input = validInput();
    input.assertions = [
      ...input.assertions,
      assertion('fake-a11y', 'core:turn-order', 'rule.turn.order', UI_A11Y, 'a11y'),
    ];
    expectIssue(input, 'invalid', 'evidence_for_not_applicable');
  });
});

describe('assertion result gate', () => {
  it.each<AssertionResult>(['failed', 'skipped', 'todo'])(
    'rejects %s evidence and leaves its slot uncovered',
    (result) => {
      const input = validInput();
      input.assertions = input.assertions.map((item, index) => (
        index === 0 ? { ...item, result } : item
      ));
      const report = validateCapabilityEvidence(input);
      expect(report.summary.uncoveredEvidenceSlots).toBe(1);
      expectIssue(input, 'non_passing', 'non_passing_assertion');
    },
  );
});
