import { canonicalStringify } from '../determinism';
import {
  runCompiledMicroMvpAcceptanceCase,
  type CompiledMicroMvpAcceptanceCorpus,
  type CompiledMicroMvpBuildAxis,
} from '../testing/compiledMicroMvpAcceptanceCorpus';
import type { MicroMvpCoverageDenominator } from './microMvpDenominator';

export interface CompiledMicroMvpAcceptanceEvidence {
  schemaVersion: 1;
  evidenceKind: 'compiled_build_fact';
  assertionId: string;
  scenarioId: string;
  scenarioAssertionId: string;
  subjectStableKey: string;
  axis: CompiledMicroMvpBuildAxis;
  entityId: string;
  cardNumber: string;
  commonTraceAssertionIds: readonly [string, string, string, string, string];
  checkpointCount: number;
  replayHash: string;
}

export interface CompiledMicroMvpAcceptanceEvidenceIssue {
  code:
    | 'duplicate_fact'
    | 'missing_fact'
    | 'unexpected_fact'
    | 'missing_executable_assertion'
    | 'missing_common_trace_assertion'
    | 'missing_release_entity'
    | 'duplicate_release_entity'
    | 'replay_diverged';
  key: string;
  message: string;
}

export class CompiledMicroMvpAcceptanceEvidenceError extends Error {
  constructor(readonly issues: readonly CompiledMicroMvpAcceptanceEvidenceIssue[]) {
    super([
      `compiled micro-MVP acceptance evidence has ${issues.length} issue(s):`,
      ...issues.map((issue) => `[${issue.code}] ${issue.key}: ${issue.message}`),
    ].join('\n'));
    this.name = 'CompiledMicroMvpAcceptanceEvidenceError';
  }
}

function factKey(axis: CompiledMicroMvpBuildAxis, entityId: string): string {
  return `${axis}:${entityId}`;
}

function replayHash(value: unknown): string {
  // This is a stable evidence fingerprint, not a cryptographic content pin.
  const source = canonicalStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function requiredCommonAssertionIds(scenarioId: string): [string, string, string, string, string] {
  return [
    `${scenarioId}:NONSPELL-ACTION`,
    `${scenarioId}:CROSS-PC-SPELL`,
    `${scenarioId}:CONDITION-APPLIED`,
    `${scenarioId}:SAVING-THROW`,
    `${scenarioId}:ABILITY-CHECK`,
  ];
}

/**
 * Executes every selected compiled scenario before producing evidence. These
 * facts prove that a production compiler root materialized and survived the
 * common interaction/replay protocol. They deliberately use a distinct
 * evidence kind and therefore cannot satisfy semantic entity obligations by
 * themselves.
 */
export function executeCompiledMicroMvpAcceptanceEvidence(
  corpus: CompiledMicroMvpAcceptanceCorpus,
): readonly CompiledMicroMvpAcceptanceEvidence[] {
  const issues: CompiledMicroMvpAcceptanceEvidenceIssue[] = [];
  const evidenceByKey = new Map<string, CompiledMicroMvpAcceptanceEvidence>();

  for (const scenario of corpus.cases) {
    const run = runCompiledMicroMvpAcceptanceCase(scenario);
    const observed = new Set(run.assertionIds);
    const commonAssertionIds = requiredCommonAssertionIds(scenario.id);
    for (const assertionId of commonAssertionIds) {
      if (!observed.has(assertionId)) {
        issues.push({
          code: 'missing_common_trace_assertion', key: scenario.id,
          message: `${assertionId} did not execute`,
        });
      }
    }
    if (canonicalStringify(run.finalState) !== canonicalStringify(run.replayState)) {
      issues.push({
        code: 'replay_diverged', key: scenario.id,
        message: 'folded events differ from the authoritative final state',
      });
    }
    for (const claim of scenario.buildClaims) {
      const key = factKey(claim.axis, claim.entityId);
      if (!observed.has(claim.assertionId)) {
        issues.push({
          code: 'missing_executable_assertion', key,
          message: `${claim.assertionId} did not execute in ${scenario.id}`,
        });
        continue;
      }
      if (evidenceByKey.has(key)) continue;
      evidenceByKey.set(key, {
        schemaVersion: 1,
        evidenceKind: 'compiled_build_fact',
        assertionId: `COMPILED-FACT-${claim.axis.toUpperCase()}-${claim.entityId}`,
        scenarioId: scenario.id,
        scenarioAssertionId: claim.assertionId,
        subjectStableKey: scenario.subject.stableKey,
        axis: claim.axis,
        entityId: claim.entityId,
        cardNumber: claim.cardNumber,
        commonTraceAssertionIds: commonAssertionIds,
        checkpointCount: run.checkpoints.length,
        replayHash: replayHash(run.replayState),
      });
    }
  }
  if (issues.length) throw new CompiledMicroMvpAcceptanceEvidenceError(issues);
  return [...evidenceByKey.values()].sort((left, right) => (
    factKey(left.axis, left.entityId).localeCompare(factKey(right.axis, right.entityId))
  ));
}

export function validateCompiledMicroMvpAcceptanceEvidence(
  corpus: CompiledMicroMvpAcceptanceCorpus,
  evidence: readonly CompiledMicroMvpAcceptanceEvidence[],
): void {
  const issues: CompiledMicroMvpAcceptanceEvidenceIssue[] = [];
  const required = new Set(corpus.requiredBuildKeys);
  const seen = new Set<string>();
  for (const item of evidence) {
    const key = factKey(item.axis, item.entityId);
    if (seen.has(key)) {
      issues.push({ code: 'duplicate_fact', key, message: 'fact appears more than once' });
    }
    seen.add(key);
    if (!required.has(key)) {
      issues.push({ code: 'unexpected_fact', key, message: 'fact is outside the compiled corpus denominator' });
    }
  }
  for (const key of required) {
    if (!seen.has(key)) issues.push({ code: 'missing_fact', key, message: 'compiled fact has no evidence' });
  }
  if (issues.length) throw new CompiledMicroMvpAcceptanceEvidenceError(issues);
}

/**
 * The corpus-derived build keys are intentionally not trusted as the release
 * denominator. This cross-check starts from the independently loaded manifest
 * and requires one executed compiled fact for every released card number.
 * Extra facts (for example a selected invocation or lineage) are allowed: they
 * are derived capabilities, not top-level manifest entities.
 */
export function validateCompiledMicroMvpReleaseEntityCoverage(
  denominator: Pick<MicroMvpCoverageDenominator, 'entities'>,
  evidence: readonly CompiledMicroMvpAcceptanceEvidence[],
): void {
  const issues: CompiledMicroMvpAcceptanceEvidenceIssue[] = [];
  const factsByCardNumber = new Map<string, CompiledMicroMvpAcceptanceEvidence[]>();
  for (const item of evidence) {
    const items = factsByCardNumber.get(item.cardNumber) ?? [];
    items.push(item);
    factsByCardNumber.set(item.cardNumber, items);
  }
  const entitiesByCardNumber = new Map<string, string[]>();
  for (const entity of denominator.entities) {
    const entityIds = entitiesByCardNumber.get(entity.cardNumber) ?? [];
    entityIds.push(entity.id);
    entitiesByCardNumber.set(entity.cardNumber, entityIds);
  }
  for (const [cardNumber, entityIds] of entitiesByCardNumber) {
    if (entityIds.length > 1) {
      issues.push({
        code: 'duplicate_release_entity', key: cardNumber,
        message: `release card maps to multiple entities: ${entityIds.join(', ')}`,
      });
    }
  }
  for (const entity of denominator.entities) {
    const matches = factsByCardNumber.get(entity.cardNumber) ?? [];
    if (matches.length === 0) {
      issues.push({
        code: 'missing_release_entity', key: entity.id,
        message: `${entity.cardNumber} has no executed compiled two-PC fact`,
      });
    } else if (matches.length > 1) {
      issues.push({
        code: 'duplicate_release_entity', key: entity.id,
        message: `${entity.cardNumber} has ${matches.length} compiled facts`,
      });
    }
  }
  if (issues.length) throw new CompiledMicroMvpAcceptanceEvidenceError(issues);
}
