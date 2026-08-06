import type { AspectId } from './aspectId';
import { coverageCellKey } from './capabilityEvidenceMatrix';
import type { EvidenceTypeId } from './capabilityEvidenceMatrix';
import type { Sha256Hash } from './ruleObligation';

export type AssertionResult = 'passed' | 'failed' | 'skipped' | 'todo';

export interface AssertionEvidenceLink {
  entityId: string;
  obligationId: string;
  aspectId: AspectId;
  evidenceType: EvidenceTypeId;
}
export interface AssertionEvidence {
  schemaVersion: 1;
  assertionId: string;
  owner: string;
  result: AssertionResult;
  rulesHash: Sha256Hash;
  contentHash: Sha256Hash;
  testFile: string;
  testName: string;
  links: readonly AssertionEvidenceLink[];
}

export interface IndexedAssertionEvidence {
  assertionId: string;
  owner: string;
  result: AssertionResult;
  evidenceType: EvidenceTypeId;
  rulesHash: Sha256Hash;
  contentHash: Sha256Hash;
  testFile: string;
  testName: string;
}

export type AssertionEvidenceIndex = Readonly<
  Record<string, readonly IndexedAssertionEvidence[]>
>;

/**
 * Builds a deterministic lookup index without deciding whether evidence is valid.
 * The strict validator owns duplicate, orphan, result, and hash checks.
 */
export function buildAssertionEvidenceIndex(
  assertions: readonly AssertionEvidence[],
): AssertionEvidenceIndex {
  const byCell = new Map<string, IndexedAssertionEvidence[]>();

  for (const assertion of assertions) {
    for (const link of assertion.links) {
      const key = coverageCellKey(link);
      const entries = byCell.get(key) ?? [];
      entries.push({
        assertionId: assertion.assertionId,
        owner: assertion.owner,
        result: assertion.result,
        evidenceType: link.evidenceType,
        rulesHash: assertion.rulesHash,
        contentHash: assertion.contentHash,
        testFile: assertion.testFile,
        testName: assertion.testName,
      });
      byCell.set(key, entries);
    }
  }

  return Object.fromEntries(
    [...byCell.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entries]) => [
        key,
        entries.sort((left, right) => (
          left.assertionId.localeCompare(right.assertionId)
          || left.evidenceType.localeCompare(right.evidenceType)
        )),
      ]),
  );
}
