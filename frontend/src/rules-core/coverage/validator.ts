import { isAspectId } from './aspectId';
import { buildAssertionEvidenceIndex } from './assertionEvidenceIndex';
import type {
  AssertionEvidence,
  AssertionEvidenceIndex,
  AssertionEvidenceLink,
} from './assertionEvidenceIndex';
import { coverageCellKey } from './capabilityEvidenceMatrix';
import type {
  CapabilityEvidenceMatrix,
  CoverageCellReference,
  EvidenceRequirement,
} from './capabilityEvidenceMatrix';
import type {
  CoverageReleasePin,
  RuleObligation,
} from './ruleObligation';

export type CoverageIssueKind =
  | 'duplicate'
  | 'orphan'
  | 'stale'
  | 'no_owner'
  | 'unjustified_not_applicable'
  | 'missing_evidence'
  | 'non_passing'
  | 'invalid';

export interface CoverageIssue {
  kind: CoverageIssueKind;
  code: string;
  path: string;
  message: string;
}

export interface CoverageSummary {
  /** Counts describe only the current manifest supplied to validation. */
  declaredEntities: number;
  obligations: number;
  denominatorCells: number;
  applicableCells: number;
  justifiedNotApplicableCells: number;
  requiredEvidenceSlots: number;
  passedEvidenceSlots: number;
  uncoveredEvidenceSlots: number;
  assertions: number;
}

export interface CoverageValidationReport {
  valid: boolean;
  issues: readonly CoverageIssue[];
  summary: CoverageSummary;
  evidenceIndex: AssertionEvidenceIndex;
}

export interface CoverageValidationInput {
  /** Current release comes from the build artifact, not from the evidence itself. */
  currentRelease: CoverageReleasePin;
  /** Current entity IDs come from the independently loaded content manifest. */
  currentEntityIds: readonly string[];
  obligations: readonly RuleObligation[];
  matrix: CapabilityEvidenceMatrix;
  assertions: readonly AssertionEvidence[];
}

interface ExpectedCell extends CoverageCellReference {
  evidenceTypes: Set<string>;
  notApplicableAllowed: boolean;
}

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim().length === 0;
}

function addIssue(
  issues: CoverageIssue[],
  kind: CoverageIssueKind,
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ kind, code, path, message });
}

function duplicateValues(values: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return duplicates;
}

function compareRelease(
  actual: CoverageReleasePin,
  expected: CoverageReleasePin,
  path: string,
  issues: CoverageIssue[],
): void {
  if (actual.rulesHash !== expected.rulesHash) {
    addIssue(issues, 'stale', 'stale_rules_hash', `${path}.rulesHash`,
      `Expected ${expected.rulesHash}, received ${actual.rulesHash}`);
  }
  if (actual.contentHash !== expected.contentHash) {
    addIssue(issues, 'stale', 'stale_content_hash', `${path}.contentHash`,
      `Expected ${expected.contentHash}, received ${actual.contentHash}`);
  }
  for (const field of ['systemId', 'releaseId', 'errataVersion'] as const) {
    if (actual[field] !== expected[field]) {
      addIssue(issues, 'stale', 'stale_release_metadata', `${path}.${field}`,
        `Expected ${expected[field]}, received ${actual[field]}`);
    }
  }
}

function validateReleaseShape(
  release: CoverageReleasePin,
  path: string,
  issues: CoverageIssue[],
): void {
  for (const field of ['systemId', 'releaseId', 'errataVersion'] as const) {
    if (isBlank(release[field])) {
      addIssue(issues, 'invalid', 'invalid_release', `${path}.${field}`, `${field} must not be blank`);
    }
  }
  for (const field of ['rulesHash', 'contentHash'] as const) {
    if (!SHA256_PATTERN.test(release[field])) {
      addIssue(issues, 'invalid', 'invalid_hash', `${path}.${field}`, `${field} must be a SHA-256 hash`);
    }
  }
}

function requireOwner(
  owner: string,
  path: string,
  issues: CoverageIssue[],
): void {
  if (isBlank(owner)) {
    addIssue(issues, 'no_owner', 'missing_owner', path, 'An explicit owner is required');
  }
}

function validateCellReference(
  reference: CoverageCellReference,
  path: string,
  issues: CoverageIssue[],
): void {
  if (isBlank(reference.entityId)) {
    addIssue(issues, 'invalid', 'invalid_entity_id', `${path}.entityId`, 'entityId must not be blank');
  }
  if (isBlank(reference.obligationId)) {
    addIssue(issues, 'invalid', 'invalid_obligation_id', `${path}.obligationId`, 'obligationId must not be blank');
  }
  if (!isAspectId(reference.aspectId)) {
    addIssue(issues, 'invalid', 'invalid_aspect_id', `${path}.aspectId`, 'aspectId is not stable/valid');
  }
}

function requirementKey(requirement: EvidenceRequirement): string {
  return requirement.aspectId;
}

function assertionLinkKey(link: AssertionEvidenceLink): string {
  return `${coverageCellKey(link)}|${encodeURIComponent(link.evidenceType)}`;
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function hasCurrentHashes(
  assertion: AssertionEvidence,
  release: CoverageReleasePin,
): boolean {
  return assertion.rulesHash === release.rulesHash
    && assertion.contentHash === release.contentHash;
}

function sortedIssues(issues: CoverageIssue[]): CoverageIssue[] {
  return issues.sort((left, right) => (
    left.kind.localeCompare(right.kind)
    || left.code.localeCompare(right.code)
    || left.path.localeCompare(right.path)
    || left.message.localeCompare(right.message)
  ));
}

/**
 * Validates structure and evidence without throwing. A `valid: true` report means
 * every denominator slot has current passing evidence (or a justified exact N/A).
 */
export function validateCapabilityEvidence(
  input: CoverageValidationInput,
): CoverageValidationReport {
  const { currentRelease, currentEntityIds, obligations, matrix, assertions } = input;
  const issues: CoverageIssue[] = [];

  validateReleaseShape(currentRelease, 'currentRelease', issues);
  validateReleaseShape(matrix.release, 'matrix.release', issues);
  compareRelease(matrix.release, currentRelease, 'matrix.release', issues);
  requireOwner(matrix.owner, 'matrix.owner', issues);
  if (isBlank(matrix.id)) {
    addIssue(issues, 'invalid', 'invalid_matrix_id', 'matrix.id', 'matrix id must not be blank');
  }

  for (const duplicate of duplicateValues(currentEntityIds)) {
    addIssue(issues, 'duplicate', 'duplicate_current_entity', 'currentEntityIds',
      `Current manifest contains duplicate entity ${duplicate}`);
  }
  for (const duplicate of duplicateValues(matrix.scopeEntityIds)) {
    addIssue(issues, 'duplicate', 'duplicate_scope_entity', 'matrix.scopeEntityIds',
      `Matrix scope contains duplicate entity ${duplicate}`);
  }

  const currentEntitySet = new Set(currentEntityIds);
  const matrixEntitySet = new Set(matrix.scopeEntityIds);
  if (!setsEqual(currentEntitySet, matrixEntitySet)) {
    const missing = [...currentEntitySet].filter((id) => !matrixEntitySet.has(id));
    const removed = [...matrixEntitySet].filter((id) => !currentEntitySet.has(id));
    addIssue(issues, 'stale', 'stale_entity_scope', 'matrix.scopeEntityIds',
      `Scope differs from current manifest; missing=[${missing.join(', ')}], orphaned=[${removed.join(', ')}]`);
  }
  if (currentEntitySet.size === 0) {
    addIssue(issues, 'invalid', 'empty_denominator', 'currentEntityIds',
      'Current manifest is empty; zero entities cannot prove coverage');
  }

  const duplicateObligationIds = duplicateValues(obligations.map((item) => item.id));
  for (const duplicate of duplicateObligationIds) {
    addIssue(issues, 'duplicate', 'duplicate_obligation', 'obligations',
      `Duplicate obligation ${duplicate}`);
  }
  if (obligations.length === 0) {
    addIssue(issues, 'invalid', 'empty_denominator', 'obligations',
      'Obligation registry is empty; zero obligations cannot prove coverage');
  }

  const obligationsById = new Map<string, RuleObligation>();
  obligations.forEach((obligation, index) => {
    const path = `obligations[${index}]`;
    if (!obligationsById.has(obligation.id)) obligationsById.set(obligation.id, obligation);
    if (isBlank(obligation.id)) {
      addIssue(issues, 'invalid', 'invalid_obligation_id', `${path}.id`, 'Obligation id must not be blank');
    }
    if (isBlank(obligation.title) || isBlank(obligation.statement)) {
      addIssue(issues, 'invalid', 'invalid_obligation', path,
        'Obligation title and independently authored statement are required');
    }
    requireOwner(obligation.owner, `${path}.owner`, issues);
    validateReleaseShape(obligation.release, `${path}.release`, issues);
    compareRelease(obligation.release, currentRelease, `${path}.release`, issues);
    for (const field of ['sourceId', 'track', 'edition', 'version', 'section', 'locator', 'retrievedAt'] as const) {
      if (isBlank(obligation.source[field])) {
        addIssue(issues, 'invalid', 'invalid_source_reference', `${path}.source.${field}`,
          `${field} must not be blank`);
      }
    }
    if (!SHA256_PATTERN.test(obligation.source.sourceHash)) {
      addIssue(issues, 'invalid', 'invalid_hash', `${path}.source.sourceHash`,
        'sourceHash must be a SHA-256 hash');
    }
  });

  const duplicateProfileIds = duplicateValues(matrix.profiles.map((profile) => profile.id));
  for (const duplicate of duplicateProfileIds) {
    addIssue(issues, 'duplicate', 'duplicate_profile', 'matrix.profiles',
      `Duplicate capability profile ${duplicate}`);
  }
  const profilesById = new Map(matrix.profiles.map((profile) => [profile.id, profile]));
  matrix.profiles.forEach((profile, profileIndex) => {
    const path = `matrix.profiles[${profileIndex}]`;
    if (isBlank(profile.id) || isBlank(profile.title)) {
      addIssue(issues, 'invalid', 'invalid_profile', path, 'Profile id and title are required');
    }
    requireOwner(profile.owner, `${path}.owner`, issues);
    if (profile.requirements.length === 0) {
      addIssue(issues, 'invalid', 'empty_profile', `${path}.requirements`,
        'A capability profile must define at least one evidence requirement');
    }
    for (const duplicate of duplicateValues(profile.requirements.map(requirementKey))) {
      addIssue(issues, 'duplicate', 'duplicate_profile_aspect', `${path}.requirements`,
        `Aspect ${duplicate} appears more than once in the profile`);
    }
    profile.requirements.forEach((requirement, requirementIndex) => {
      const requirementPath = `${path}.requirements[${requirementIndex}]`;
      if (!isAspectId(requirement.aspectId)) {
        addIssue(issues, 'invalid', 'invalid_aspect_id', `${requirementPath}.aspectId`,
          'aspectId is not stable/valid');
      }
      if (requirement.evidenceTypes.length === 0) {
        addIssue(issues, 'invalid', 'empty_evidence_requirement', `${requirementPath}.evidenceTypes`,
          'At least one evidence type is required');
      }
      for (const evidenceType of requirement.evidenceTypes) {
        if (isBlank(evidenceType)) {
          addIssue(issues, 'invalid', 'invalid_evidence_type', `${requirementPath}.evidenceTypes`,
            'Evidence type must not be blank');
        }
      }
      for (const duplicate of duplicateValues(requirement.evidenceTypes)) {
        addIssue(issues, 'duplicate', 'duplicate_evidence_type', `${requirementPath}.evidenceTypes`,
          `Evidence type ${duplicate} is duplicated`);
      }
      if (!['forbidden', 'allowed_by_scope_rule'].includes(requirement.notApplicable)) {
        addIssue(issues, 'invalid', 'invalid_not_applicable_policy', `${requirementPath}.notApplicable`,
          'Unknown N/A policy');
      }
    });
  });

  const targetKeys = matrix.targets.map((target) => (
    `${encodeURIComponent(target.entityId)}|${encodeURIComponent(target.obligationId)}`
  ));
  for (const duplicate of duplicateValues(targetKeys)) {
    addIssue(issues, 'duplicate', 'duplicate_target', 'matrix.targets',
      `Duplicate entity/obligation target ${duplicate}`);
  }

  const expectedCells = new Map<string, ExpectedCell>();
  const assignedEntityIds = new Set<string>();
  const assignedObligationIds = new Set<string>();

  matrix.targets.forEach((target, targetIndex) => {
    const path = `matrix.targets[${targetIndex}]`;
    requireOwner(target.owner, `${path}.owner`, issues);
    if (isBlank(target.entityId) || isBlank(target.obligationId)) {
      addIssue(issues, 'invalid', 'invalid_target', path,
        'Target entityId and obligationId are required');
    }
    if (!matrixEntitySet.has(target.entityId) || !currentEntitySet.has(target.entityId)) {
      addIssue(issues, 'orphan', 'orphan_target_entity', `${path}.entityId`,
        `Target references entity outside the current matrix scope: ${target.entityId}`);
    } else {
      assignedEntityIds.add(target.entityId);
    }
    if (!obligationsById.has(target.obligationId)) {
      addIssue(issues, 'orphan', 'orphan_target_obligation', `${path}.obligationId`,
        `Target references unknown obligation ${target.obligationId}`);
    } else {
      assignedObligationIds.add(target.obligationId);
    }
    if (target.capabilityProfileIds.length === 0) {
      addIssue(issues, 'invalid', 'target_without_profile', `${path}.capabilityProfileIds`,
        'Every target needs at least one capability profile');
    }
    for (const duplicate of duplicateValues(target.capabilityProfileIds)) {
      addIssue(issues, 'duplicate', 'duplicate_target_profile', `${path}.capabilityProfileIds`,
        `Profile ${duplicate} is assigned more than once`);
    }

    for (const profileId of target.capabilityProfileIds) {
      const profile = profilesById.get(profileId);
      if (!profile) {
        addIssue(issues, 'orphan', 'orphan_target_profile', `${path}.capabilityProfileIds`,
          `Target references unknown profile ${profileId}`);
        continue;
      }
      for (const requirement of profile.requirements) {
        if (!isAspectId(requirement.aspectId)) continue;
        const reference: CoverageCellReference = {
          entityId: target.entityId,
          obligationId: target.obligationId,
          aspectId: requirement.aspectId,
        };
        const key = coverageCellKey(reference);
        const existing = expectedCells.get(key);
        if (existing) {
          for (const evidenceType of requirement.evidenceTypes) existing.evidenceTypes.add(evidenceType);
          existing.notApplicableAllowed = existing.notApplicableAllowed
            && requirement.notApplicable === 'allowed_by_scope_rule';
        } else {
          expectedCells.set(key, {
            ...reference,
            evidenceTypes: new Set(requirement.evidenceTypes),
            notApplicableAllowed: requirement.notApplicable === 'allowed_by_scope_rule',
          });
        }
      }
    }
  });

  for (const entityId of matrixEntitySet) {
    if (!assignedEntityIds.has(entityId)) {
      addIssue(issues, 'orphan', 'scope_entity_without_capability', 'matrix.scopeEntityIds',
        `Scoped entity ${entityId} has no capability target and would be absent from the denominator`);
    }
  }
  for (const obligation of obligations) {
    if (!assignedObligationIds.has(obligation.id)) {
      addIssue(issues, 'orphan', 'orphan_obligation', 'obligations',
        `Obligation ${obligation.id} has no capability target`);
    }
  }
  if (expectedCells.size === 0) {
    addIssue(issues, 'invalid', 'empty_denominator', 'matrix.targets',
      'Capability expansion produced zero denominator cells');
  }

  const duplicateScopeRuleIds = duplicateValues(matrix.notApplicableScopeRules.map((rule) => rule.id));
  for (const duplicate of duplicateScopeRuleIds) {
    addIssue(issues, 'duplicate', 'duplicate_na_scope_rule', 'matrix.notApplicableScopeRules',
      `Duplicate N/A scope rule ${duplicate}`);
  }
  const scopeRulesById = new Map(matrix.notApplicableScopeRules.map((rule) => [rule.id, rule]));
  matrix.notApplicableScopeRules.forEach((rule, ruleIndex) => {
    const path = `matrix.notApplicableScopeRules[${ruleIndex}]`;
    if (isBlank(rule.id) || isBlank(rule.rationale)) {
      addIssue(issues, 'unjustified_not_applicable', 'invalid_na_scope_rule', path,
        'N/A scope rule needs an id and rationale');
    }
    requireOwner(rule.owner, `${path}.owner`, issues);
    if (!['outside_release', 'not_applicable_by_design'].includes(rule.basis)) {
      addIssue(issues, 'unjustified_not_applicable', 'unsupported_na_basis', `${path}.basis`,
        'Unsupported mechanics cannot be hidden behind N/A');
    }
    if (rule.allowedCells.length === 0) {
      addIssue(issues, 'unjustified_not_applicable', 'empty_na_scope', `${path}.allowedCells`,
        'N/A scope rule must allow at least one exact cell');
    }
    const allowedKeys = rule.allowedCells.map((cell) => coverageCellKey(cell));
    for (const duplicate of duplicateValues(allowedKeys)) {
      addIssue(issues, 'duplicate', 'duplicate_na_allowed_cell', `${path}.allowedCells`,
        `N/A rule repeats cell ${duplicate}`);
    }
    rule.allowedCells.forEach((cell, cellIndex) => {
      validateCellReference(cell, `${path}.allowedCells[${cellIndex}]`, issues);
      if (!expectedCells.has(coverageCellKey(cell))) {
        addIssue(issues, 'orphan', 'orphan_na_allowed_cell', `${path}.allowedCells[${cellIndex}]`,
          'N/A scope rule references a cell outside the denominator');
      }
    });
  });

  const naKeys = matrix.notApplicable.map((declaration) => coverageCellKey(declaration));
  for (const duplicate of duplicateValues(naKeys)) {
    addIssue(issues, 'duplicate', 'duplicate_na_declaration', 'matrix.notApplicable',
      `Duplicate N/A declaration for ${duplicate}`);
  }
  const duplicateNaKeys = duplicateValues(naKeys);
  const validNaKeys = new Set<string>();
  const usedScopeRuleIds = new Set<string>();
  matrix.notApplicable.forEach((declaration, declarationIndex) => {
    const path = `matrix.notApplicable[${declarationIndex}]`;
    const key = coverageCellKey(declaration);
    validateCellReference(declaration, path, issues);
    requireOwner(declaration.owner, `${path}.owner`, issues);
    let justified = !duplicateNaKeys.has(key);
    if (isBlank(declaration.owner)) justified = false;
    if (isBlank(declaration.reason)) {
      addIssue(issues, 'unjustified_not_applicable', 'missing_na_reason', `${path}.reason`,
        'N/A declaration needs a concrete reason');
      justified = false;
    }
    const cell = expectedCells.get(key);
    if (!cell) {
      addIssue(issues, 'orphan', 'orphan_na_declaration', path,
        'N/A declaration references a cell outside the denominator');
      justified = false;
    } else if (!cell.notApplicableAllowed) {
      addIssue(issues, 'unjustified_not_applicable', 'na_forbidden_by_profile', path,
        'At least one capability profile requires evidence for this aspect');
      justified = false;
    }
    const scopeRule = scopeRulesById.get(declaration.scopeRuleId);
    if (!scopeRule) {
      addIssue(issues, 'unjustified_not_applicable', 'unknown_na_scope_rule', `${path}.scopeRuleId`,
        `Unknown N/A scope rule ${declaration.scopeRuleId}`);
      justified = false;
    } else {
      usedScopeRuleIds.add(scopeRule.id);
      if (!scopeRule.allowedCells.some((allowed) => coverageCellKey(allowed) === key)) {
        addIssue(issues, 'unjustified_not_applicable', 'na_outside_scope_rule', path,
          `Scope rule ${scopeRule.id} does not allow this exact cell`);
        justified = false;
      }
      if (isBlank(scopeRule.owner) || isBlank(scopeRule.rationale)
        || !['outside_release', 'not_applicable_by_design'].includes(scopeRule.basis)) {
        justified = false;
      }
    }
    if (justified) validNaKeys.add(key);
  });
  matrix.notApplicableScopeRules.forEach((rule, index) => {
    if (!usedScopeRuleIds.has(rule.id)) {
      addIssue(issues, 'orphan', 'unused_na_scope_rule', `matrix.notApplicableScopeRules[${index}]`,
        `N/A scope rule ${rule.id} is not used by any declaration`);
    }
  });

  const duplicateAssertionIds = duplicateValues(assertions.map((assertion) => assertion.assertionId));
  for (const duplicate of duplicateAssertionIds) {
    addIssue(issues, 'duplicate', 'duplicate_assertion', 'assertions',
      `Duplicate assertion ID ${duplicate}`);
  }
  const passingSlots = new Set<string>();
  assertions.forEach((assertion, assertionIndex) => {
    const path = `assertions[${assertionIndex}]`;
    if (isBlank(assertion.assertionId)) {
      addIssue(issues, 'invalid', 'invalid_assertion_id', `${path}.assertionId`,
        'Assertion ID must not be blank');
    }
    requireOwner(assertion.owner, `${path}.owner`, issues);
    if (isBlank(assertion.testFile) || isBlank(assertion.testName)) {
      addIssue(issues, 'invalid', 'invalid_assertion_locator', path,
        'testFile and testName are required');
    }
    if (!SHA256_PATTERN.test(assertion.rulesHash) || !SHA256_PATTERN.test(assertion.contentHash)) {
      addIssue(issues, 'invalid', 'invalid_hash', path,
        'Assertion rulesHash and contentHash must be SHA-256 hashes');
    }
    if (assertion.rulesHash !== currentRelease.rulesHash) {
      addIssue(issues, 'stale', 'stale_rules_hash', `${path}.rulesHash`,
        `Assertion ${assertion.assertionId} was produced for another rules artifact`);
    }
    if (assertion.contentHash !== currentRelease.contentHash) {
      addIssue(issues, 'stale', 'stale_content_hash', `${path}.contentHash`,
        `Assertion ${assertion.assertionId} was produced for another content artifact`);
    }
    if (assertion.links.length === 0) {
      addIssue(issues, 'orphan', 'assertion_without_links', `${path}.links`,
        'An assertion without explicit evidence links proves no obligation');
    }
    if (assertion.result !== 'passed') {
      addIssue(issues, 'non_passing', 'non_passing_assertion', `${path}.result`,
        `Assertion ${assertion.assertionId} is ${assertion.result}`);
    }
    const linkKeys = assertion.links.map(assertionLinkKey);
    for (const duplicate of duplicateValues(linkKeys)) {
      addIssue(issues, 'duplicate', 'duplicate_assertion_link', `${path}.links`,
        `Assertion repeats evidence link ${duplicate}`);
    }

    assertion.links.forEach((link, linkIndex) => {
      const linkPath = `${path}.links[${linkIndex}]`;
      validateCellReference(link, linkPath, issues);
      if (isBlank(link.evidenceType)) {
        addIssue(issues, 'invalid', 'invalid_evidence_type', `${linkPath}.evidenceType`,
          'Evidence type must not be blank');
      }
      const cellKey = coverageCellKey(link);
      const cell = expectedCells.get(cellKey);
      if (!cell) {
        addIssue(issues, 'orphan', 'orphan_assertion_link', linkPath,
          'Assertion references a cell outside the denominator');
        return;
      }
      if (!cell.evidenceTypes.has(link.evidenceType)) {
        addIssue(issues, 'orphan', 'unexpected_evidence_type', `${linkPath}.evidenceType`,
          `Evidence type ${link.evidenceType} is not required by this cell`);
        return;
      }
      if (validNaKeys.has(cellKey)) {
        addIssue(issues, 'invalid', 'evidence_for_not_applicable', linkPath,
          'A justified N/A cell must not also carry assertion evidence');
        return;
      }
      if (assertion.result === 'passed'
        && hasCurrentHashes(assertion, currentRelease)
        && !isBlank(assertion.owner)
        && !duplicateAssertionIds.has(assertion.assertionId)
        && !duplicateValues(linkKeys).has(assertionLinkKey(link))) {
        passingSlots.add(`${cellKey}|${encodeURIComponent(link.evidenceType)}`);
      }
    });
  });

  let requiredEvidenceSlots = 0;
  for (const [cellKey, cell] of expectedCells) {
    if (validNaKeys.has(cellKey)) continue;
    requiredEvidenceSlots += cell.evidenceTypes.size;
    for (const evidenceType of cell.evidenceTypes) {
      const slotKey = `${cellKey}|${encodeURIComponent(evidenceType)}`;
      if (!passingSlots.has(slotKey)) {
        addIssue(issues, 'missing_evidence', 'missing_passing_evidence', cellKey,
          `No current passing ${evidenceType} assertion for ${cell.obligationId}/${cell.aspectId}`);
      }
    }
  }

  const passedEvidenceSlots = [...passingSlots].filter((slot) => {
    const cellKey = slot.slice(0, slot.lastIndexOf('|'));
    return expectedCells.has(cellKey) && !validNaKeys.has(cellKey);
  }).length;
  const summary: CoverageSummary = {
    declaredEntities: currentEntitySet.size,
    obligations: new Set(obligations.map((obligation) => obligation.id)).size,
    denominatorCells: expectedCells.size,
    applicableCells: expectedCells.size - validNaKeys.size,
    justifiedNotApplicableCells: validNaKeys.size,
    requiredEvidenceSlots,
    passedEvidenceSlots,
    uncoveredEvidenceSlots: Math.max(0, requiredEvidenceSlots - passedEvidenceSlots),
    assertions: assertions.length,
  };

  const sorted = sortedIssues(issues);
  return {
    valid: sorted.length === 0,
    issues: sorted,
    summary,
    evidenceIndex: buildAssertionEvidenceIndex(assertions),
  };
}

export class CoverageValidationError extends Error {
  readonly report: CoverageValidationReport;

  constructor(report: CoverageValidationReport) {
    const details = report.issues
      .map((issue) => `[${issue.kind}/${issue.code}] ${issue.path}: ${issue.message}`)
      .join('\n');
    super(`Capability evidence validation failed with ${report.issues.length} issue(s)\n${details}`);
    this.name = 'CoverageValidationError';
    this.report = report;
  }
}

/** Strict CI gate: returns the report or throws with every discovered violation. */
export function validateCapabilityEvidenceStrict(
  input: CoverageValidationInput,
): CoverageValidationReport {
  const report = validateCapabilityEvidence(input);
  if (!report.valid) throw new CoverageValidationError(report);
  return report;
}
