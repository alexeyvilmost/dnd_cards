/**
 * Browser-safe leaf module for the exact compiled micro-MVP release identity.
 *
 * These pins live outside the Node-backed compiler module so runtime
 * composition roots can bind DB authorities without importing that compiler.
 */
export const MICRO_MVP_L1_OVERLAY_VERSION = '1.12.0' as const;
export const MICRO_MVP_L1_OVERLAY_RELEASE_ID =
  `prod-snapshot@2026-08-20.micro-mvp-l1.overlay.${MICRO_MVP_L1_OVERLAY_VERSION}` as const;

export const PINNED_MICRO_MVP_L1_OVERLAY_HASH =
  'sha256:7ef20f51ae9683433431133887da21f9e2622a87368e7a9b675a9ba7fd3d08fe' as const;
export const PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH =
  'sha256:7000486672c3f8fc3b0f21da0561ca2b48eb218b4de8278d2c8ebb2b1c99e1e5' as const;
export const PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH =
  'sha256:174f3f2dbf8dba29f5765da4d52a07e1779305773607755900a170963ea95c53' as const;
export const PINNED_MICRO_MVP_L1_CONTENT_PATCH_HASH =
  'sha256:3ec837f18864a9787f0fc8c1b2a2c40f7ddc438e321c08f755a8fa225b2862a4' as const;
