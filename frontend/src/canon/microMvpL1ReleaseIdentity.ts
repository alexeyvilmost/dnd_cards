/**
 * Browser-safe leaf module for the exact compiled micro-MVP release identity.
 *
 * These pins live outside the Node-backed compiler module so runtime
 * composition roots can bind DB authorities without importing that compiler.
 */
export const MICRO_MVP_L1_OVERLAY_VERSION = '1.13.0' as const;
export const MICRO_MVP_L1_OVERLAY_RELEASE_ID =
  `prod-snapshot@2026-08-20.micro-mvp-l1.overlay.${MICRO_MVP_L1_OVERLAY_VERSION}` as const;

export const PINNED_MICRO_MVP_L1_OVERLAY_HASH =
  'sha256:67860317c1e3d1ede6993e688ad305f112186975e561508192e5ec34f4443292' as const;
export const PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH =
  'sha256:2ddba1ce7354f7d3e813a2531329019e6039dc27163259a59989f5557d233ca8' as const;
export const PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH =
  'sha256:313dcc9fff197929b0d59e87246f6aac7ed162eaaf3107a583cba8ad3573d99f' as const;
export const PINNED_MICRO_MVP_L1_CONTENT_PATCH_HASH =
  'sha256:31148b36b944474af7506da946fcaaeb0adf42696dda359a91ad88f8a7aa40f5' as const;
