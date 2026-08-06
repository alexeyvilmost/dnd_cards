export type Sha256Hash = `sha256:${string}`;

export interface CoverageReleasePin {
  systemId: string;
  releaseId: string;
  errataVersion: string;
  rulesHash: Sha256Hash;
  contentHash: Sha256Hash;
}
export interface RuleSourceReference {
  /** Stable source/corpus ID, not a mutable display title. */
  sourceId: string;
  /** PHB, DMG, MM, project ruling, or another independently pinned track. */
  track: string;
  edition: string;
  version: string;
  section: string;
  /** Page, anchor, or another short locator. Do not copy protected rules text here. */
  locator: string;
  retrievedAt: string;
  sourceHash: Sha256Hash;
}

/**
 * One reviewable rule statement. Obligations are the semantic denominator;
 * production code and content tags are not allowed to manufacture the oracle.
 */
export interface RuleObligation {
  schemaVersion: 1;
  id: string;
  title: string;
  statement: string;
  owner: string;
  release: CoverageReleasePin;
  source: RuleSourceReference;
}
