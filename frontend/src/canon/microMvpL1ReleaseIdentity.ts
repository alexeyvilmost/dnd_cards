/**
 * Browser-safe leaf module for the exact compiled micro-MVP release identity.
 *
 * These pins live outside the Node-backed compiler module so runtime
 * composition roots can bind DB authorities without importing that compiler.
 */
export const MICRO_MVP_L1_OVERLAY_VERSION = '1.14.0' as const;
export const MICRO_MVP_L1_OVERLAY_RELEASE_ID =
  `prod-snapshot@2026-08-20.micro-mvp-l1.overlay.${MICRO_MVP_L1_OVERLAY_VERSION}` as const;

export const PINNED_MICRO_MVP_L1_OVERLAY_HASH =
  'sha256:475cf792832c0edc32b88d2d4bcd537146d90694b250964221b36291cf8b77c6' as const;
export const PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH =
  'sha256:9f28e9a8049d662b4e15bc6287838b47bf56e2e65001281bce3e9199f90e9633' as const;
export const PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH =
  'sha256:b78a359098d0728d6ccf46a942af7dece176a4519531d75bc0f3dd9d0ab15ef8' as const;
export const PINNED_MICRO_MVP_L1_CONTENT_PATCH_HASH =
  'sha256:633fafd289b191d4b3feac67252424f8f3f69690148452f99d22b9586e2c2eb2' as const;

/**
 * Exact release evidence carried by the 15 mechanically certified PHB 2024
 * condition rows in the database.
 *
 * Condition authority intentionally advances only after the condition suite
 * has produced and persisted a new evidence bundle. Unrelated additions to
 * the wider sheet-combat catalog (for example the actor-bound Unarmed Strike)
 * must not silently rewrite that evidence or make the already-certified
 * condition library unavailable.
 */
export const PINNED_MICRO_MVP_CONDITION_RULES_HASH =
  'sha256:67860317c1e3d1ede6993e688ad305f112186975e561508192e5ec34f4443292' as const;
export const PINNED_MICRO_MVP_CONDITION_RELEASE_CONTENT_HASH =
  'sha256:2ddba1ce7354f7d3e813a2531329019e6039dc27163259a59989f5557d233ca8' as const;
export const PINNED_MICRO_MVP_CONDITION_RELEASE_HASH =
  'sha256:313dcc9fff197929b0d59e87246f6aac7ed162eaaf3107a583cba8ad3573d99f' as const;
