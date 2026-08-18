/**
 * Browser-safe leaf module for the exact compiled micro-MVP release identity.
 *
 * These pins live outside the Node-backed compiler module so runtime
 * composition roots can bind DB authorities without importing that compiler.
 */
export const MICRO_MVP_L1_OVERLAY_VERSION = '1.10.0' as const;
export const MICRO_MVP_L1_OVERLAY_RELEASE_ID =
  `prod-snapshot@2026-07-15.micro-mvp-l1.overlay.${MICRO_MVP_L1_OVERLAY_VERSION}` as const;

export const PINNED_MICRO_MVP_L1_OVERLAY_HASH =
  'sha256:f973f8a300a34069252e5e3731967fdbe058b4f8b7a72431432b9c7a000b4b9a' as const;
export const PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH =
  'sha256:a07e1dfadcba503918753b09318b09791441d01049a2dfb4610ab937847d4325' as const;
export const PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH =
  'sha256:576426e498c3760f080224ae7e37599fd0ea8afa34a65fb243f5013b64413db2' as const;
export const PINNED_MICRO_MVP_L1_CONTENT_PATCH_HASH =
  'sha256:2f20d062cd74cd7d3e9f5a80485b29379ed7db53c6e8170346163ba12afbce22' as const;
