import type { AspectId } from './aspectId';
import type { CoverageReleasePin } from './ruleObligation';

export type EvidenceTypeId = string;

export interface CoverageCellReference {
  entityId: string;
  obligationId: string;
  aspectId: AspectId;
}
export interface EvidenceRequirement {
  aspectId: AspectId;
  /** Every listed evidence type needs at least one current passing assertion. */
  evidenceTypes: readonly EvidenceTypeId[];
  /** N/A remains forbidden unless both the profile and an exact scope rule allow it. */
  notApplicable: 'forbidden' | 'allowed_by_scope_rule';
}

export interface CapabilityProfile {
  id: string;
  title: string;
  owner: string;
  requirements: readonly EvidenceRequirement[];
}

/** Assigns one or more profiles to an explicit entity/rule pair. */
export interface CapabilityTarget {
  entityId: string;
  obligationId: string;
  capabilityProfileIds: readonly string[];
  owner: string;
}

export interface NotApplicableScopeRule {
  id: string;
  owner: string;
  rationale: string;
  /** `unsupported_mechanic` is deliberately not a legal basis. */
  basis: 'outside_release' | 'not_applicable_by_design';
  /** Exact cells make the waiver auditable and prevent wildcard scope shrinkage. */
  allowedCells: readonly CoverageCellReference[];
}

export interface NotApplicableDeclaration extends CoverageCellReference {
  owner: string;
  reason: string;
  scopeRuleId: string;
}

/**
 * Declarative denominator. `scopeEntityIds` must be compared with an independently
 * loaded current manifest by the validator; assertions never add or remove cells.
 */
export interface CapabilityEvidenceMatrix {
  schemaVersion: 1;
  id: string;
  owner: string;
  release: CoverageReleasePin;
  scopeEntityIds: readonly string[];
  profiles: readonly CapabilityProfile[];
  targets: readonly CapabilityTarget[];
  notApplicableScopeRules: readonly NotApplicableScopeRule[];
  notApplicable: readonly NotApplicableDeclaration[];
}

export function coverageCellKey(reference: CoverageCellReference): string {
  return [reference.entityId, reference.obligationId, reference.aspectId]
    .map((part) => encodeURIComponent(part))
    .join('|');
}
