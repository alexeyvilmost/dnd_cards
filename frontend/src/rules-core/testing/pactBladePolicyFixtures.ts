import type { PactBladeLifecyclePolicy } from '../warlockPacts';

/** PHB 2024 acceptance oracle. Production reads these values from mechanics. */
export const PACT_BLADE_PHB_2024_LIFECYCLE_POLICY: PactBladeLifecyclePolicy = Object.freeze({
  separationDistanceFt: 5,
  continuousSeparationSecondsToEnd: 60,
  endOnOwnerDeath: true,
});

export const PACT_BLADE_PHB_2024_RAW_LIFECYCLE_POLICY = Object.freeze({
  separation_distance_ft: 5,
  continuous_separation_seconds_to_end: 60,
  end_on_owner_death: true,
});
