export interface ConditionImmunityRule {
  condition: string;
  /** Every tag is required; this keeps magical sleep distinct from ordinary unconsciousness. */
  requiredCauseTags?: string[];
  sourceEntityIds: [string, ...string[]];
}

export interface RestProfile {
  longRestHours: number;
  sleepRequired: boolean;
  sourceEntityIds: [string, ...string[]];
}

export interface ActorRuleTraits {
  conditionImmunities?: ConditionImmunityRule[];
  restProfile?: RestProfile;
}

export interface ConditionApplicationFacts {
  condition: string;
  causeTags: string[];
}

export interface ConditionApplicationDecision {
  allowed: boolean;
  immunity?: ConditionImmunityRule;
}

function normalized(value: string): string {
  return value.trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
}

/** Match immunity by mechanical cause tags, never by localized action name. */
export function conditionApplicationDecision(
  traits: ActorRuleTraits | undefined,
  facts: ConditionApplicationFacts,
): ConditionApplicationDecision {
  const condition = normalized(facts.condition);
  const causeTags = new Set(facts.causeTags.map(normalized));
  const immunity = traits?.conditionImmunities?.find((candidate) => (
    normalized(candidate.condition) === condition
      && (candidate.requiredCauseTags ?? []).every((tag) => causeTags.has(normalized(tag)))
  ));
  return immunity ? { allowed: false, immunity } : { allowed: true };
}

export type LongRestEligibility =
  | { eligible: true; requiredHours: number; sleepRequired: boolean }
  | { eligible: false; requiredHours: number; providedHours: number; sleepRequired: boolean };

/**
 * Duration is an explicit scenario/clock fact. The rules core does not infer
 * elapsed time from Date.now, which keeps rest validation replayable.
 */
export function longRestEligibility(
  traits: ActorRuleTraits | undefined,
  providedHours: number,
): LongRestEligibility {
  const profile = traits?.restProfile ?? {
    longRestHours: 8,
    sleepRequired: true,
    sourceEntityIds: ['system:dnd5e-2024:long-rest'] as [string],
  };
  if (!Number.isFinite(providedHours) || providedHours < profile.longRestHours) {
    return {
      eligible: false,
      requiredHours: profile.longRestHours,
      providedHours,
      sleepRequired: profile.sleepRequired,
    };
  }
  return {
    eligible: true,
    requiredHours: profile.longRestHours,
    sleepRequired: profile.sleepRequired,
  };
}
