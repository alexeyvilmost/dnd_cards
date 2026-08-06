/**
 * Browser-safe leaf module for the exact compiled micro-MVP release identity.
 *
 * These pins live outside the Node-backed compiler module so runtime
 * composition roots can bind DB authorities without importing that compiler.
 */
export const MICRO_MVP_L1_OVERLAY_VERSION = '1.10.0' as const;
export const MICRO_MVP_L1_OVERLAY_RELEASE_ID =
  `prod-snapshot@2026-08-06.micro-mvp-l1.overlay.${MICRO_MVP_L1_OVERLAY_VERSION}` as const;

export const PINNED_MICRO_MVP_L1_OVERLAY_HASH =
  'sha256:bb83dc32c63f72c7c29cb81128aa309e580f36eeb17bc6f72db6bd437836ffbc' as const;
export const PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH =
  'sha256:4ee64d32fffe6b88e797a10ae89207d5f88c0f2214cc16df043d6b9464e9f056' as const;
export const PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH =
  'sha256:04678a044c4dc809d213e01e392bc0f16562d5103ee96e070089c1edf7e7100b' as const;
export const PINNED_MICRO_MVP_L1_CONTENT_PATCH_HASH =
  'sha256:1bb6cbc3df976c8891155ab7cdda90822e340c0d582b15cc164cbd403a21ae41' as const;
