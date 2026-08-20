/**
 * Browser-safe leaf module for the exact compiled micro-MVP release identity.
 *
 * These pins live outside the Node-backed compiler module so runtime
 * composition roots can bind DB authorities without importing that compiler.
 */
export const MICRO_MVP_L1_OVERLAY_VERSION = '1.11.0' as const;
export const MICRO_MVP_L1_OVERLAY_RELEASE_ID =
  `prod-snapshot@2026-08-20.micro-mvp-l1.overlay.${MICRO_MVP_L1_OVERLAY_VERSION}` as const;

export const PINNED_MICRO_MVP_L1_OVERLAY_HASH =
  'sha256:d0aeb327930700610a690da3aebc40e861235bd62311505c3c18f8211ea4358a' as const;
export const PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH =
  'sha256:ef56284504b61459efee65d0679f25d17a493f3922fd9d026c678fa4c9e766bd' as const;
export const PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH =
  'sha256:88a074547cca923566c430dc7af0ee3ff808cabdeb61ea5e6315920f907e1508' as const;
export const PINNED_MICRO_MVP_L1_CONTENT_PATCH_HASH =
  'sha256:cde7a83dccfb5bf7c1a4de5d69dc98f05b3900d040548a360ce26ef17b6db209' as const;
