export const MANDATORY_TWO_PC_SCENARIO_PROTOCOL = 'mandatory-two-pc-v1' as const;

/**
 * Stable identity carried by both the evidence registry and the exact Vitest
 * execution record.  The protocol value is intentionally a literal: no other
 * label is eligible to satisfy scenario evidence.
 */
export interface MandatoryTwoPcScenarioIdentity {
  semanticProtocol: typeof MANDATORY_TWO_PC_SCENARIO_PROTOCOL;
  scenarioId: string;
}
