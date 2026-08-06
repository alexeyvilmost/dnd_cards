/**
 * Browser-safe leaf module for the exact compiled micro-MVP release identity.
 *
 * These pins live outside the Node-backed compiler module so runtime
 * composition roots can bind DB authorities without importing that compiler.
 */
export const MICRO_MVP_L1_OVERLAY_VERSION = '1.9.0' as const;
export const MICRO_MVP_L1_OVERLAY_RELEASE_ID =
  `prod-snapshot@2026-07-15.micro-mvp-l1.overlay.${MICRO_MVP_L1_OVERLAY_VERSION}` as const;

export const PINNED_MICRO_MVP_L1_OVERLAY_HASH =
  'sha256:980678c4ab6c2d696b150142ce3ab2e3fa52bbc49cee5c9844b2535542aed108' as const;
export const PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH =
  'sha256:6b04b93ad93476c2e57224f902d1a0739e1ff3fa4994e9d36f6e77d7b927ff48' as const;
export const PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH =
  'sha256:8568dc40ae99dd4ea3d981799941e510445a682a107aece7c62a752593a8689c' as const;
export const PINNED_MICRO_MVP_L1_CONTENT_PATCH_HASH =
  'sha256:7a07f8b1ed3483370093c67277363d0b1a95852126db1ab124eabc813b6c5bc7' as const;
