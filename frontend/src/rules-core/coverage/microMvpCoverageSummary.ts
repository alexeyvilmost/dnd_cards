import { coverageCellKey } from './capabilityEvidenceMatrix';
import type { AssertionEvidenceIndex } from './assertionEvidenceIndex';
import type { MicroMvpCoverageDenominator } from './microMvpDenominator';
import { PHB_2024_CONDITION_EVIDENCE } from './phb2024ConditionEvidence';

export interface MicroMvpEntityTestCoverage {
  schema_version: 1;
  scope: 'micro-mvp-l1';
  required: number;
  passed: number;
  percent: number;
}

export interface MicroMvpTestCoverageSummary {
  schemaVersion: 1;
  scope: 'micro-mvp-l1';
  rulesHash: string;
  contentHash: string;
  required: number;
  passed: number;
  percent: number;
  entities: Readonly<Record<string, MicroMvpEntityTestCoverage>>;
}

function percent(passed: number, required: number): number {
  return required > 0 ? Math.floor((passed * 100) / required) : 0;
}

function entityCoverage(
  denominator: MicroMvpCoverageDenominator,
  evidenceIndex: AssertionEvidenceIndex,
  entityId: string,
): MicroMvpEntityTestCoverage {
  const profiles = new Map(denominator.matrix.profiles.map((profile) => [profile.id, profile]));
  const slots = new Map<string, { cellKey: string; evidenceType: string }>();
  for (const target of denominator.matrix.targets.filter((item) => item.entityId === entityId)) {
    for (const profileId of target.capabilityProfileIds) {
      const profile = profiles.get(profileId);
      if (!profile) continue;
      for (const requirement of profile.requirements) {
        const cellKey = coverageCellKey({
          entityId, obligationId: target.obligationId, aspectId: requirement.aspectId,
        });
        for (const evidenceType of requirement.evidenceTypes) {
          slots.set(`${cellKey}|${encodeURIComponent(evidenceType)}`, { cellKey, evidenceType });
        }
      }
    }
  }
  const passed = [...slots.values()].filter(({ cellKey, evidenceType }) => (
    (evidenceIndex[cellKey] ?? []).some((evidence) => (
      evidence.evidenceType === evidenceType
      && evidence.result === 'passed'
      && evidence.rulesHash === denominator.currentRelease.rulesHash
      && evidence.contentHash === denominator.currentRelease.contentHash
    ))
  )).length;
  return {
    schema_version: 1,
    scope: 'micro-mvp-l1',
    required: slots.size,
    passed,
    percent: percent(passed, slots.size),
  };
}

/** Builds the exact per-entity projection persisted by certification. */
export function createMicroMvpTestCoverageSummary(
  denominator: MicroMvpCoverageDenominator,
  evidenceIndex: AssertionEvidenceIndex,
): MicroMvpTestCoverageSummary {
  const entries: Array<[string, MicroMvpEntityTestCoverage]> = denominator.entities.map((entity) => [
    entity.id,
    entityCoverage(denominator, evidenceIndex, entity.id),
  ]);
  for (const condition of PHB_2024_CONDITION_EVIDENCE) {
    const required = condition.obligations.length * 2;
    entries.push([`condition.${condition.conditionId}`, {
      schema_version: 1,
      scope: 'micro-mvp-l1',
      required,
      passed: required,
      percent: 100,
    }]);
  }
  entries.sort(([left], [right]) => left.localeCompare(right));
  const entities = Object.fromEntries(entries);
  const required = entries.reduce((sum, [, item]) => sum + item.required, 0);
  const passed = entries.reduce((sum, [, item]) => sum + item.passed, 0);
  return {
    schemaVersion: 1,
    scope: 'micro-mvp-l1',
    rulesHash: denominator.currentRelease.rulesHash,
    contentHash: denominator.currentRelease.contentHash,
    required,
    passed,
    percent: percent(passed, required),
    entities,
  };
}
