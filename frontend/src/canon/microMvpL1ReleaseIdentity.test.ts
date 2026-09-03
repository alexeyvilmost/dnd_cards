import { describe, expect, it } from 'vitest';
import {
  PINNED_MICRO_MVP_CONDITION_RELEASE_CONTENT_HASH,
  PINNED_MICRO_MVP_CONDITION_RELEASE_HASH,
  PINNED_MICRO_MVP_CONDITION_RULES_HASH,
  PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH,
  PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH,
  PINNED_MICRO_MVP_L1_OVERLAY_HASH,
} from './microMvpL1ReleaseIdentity';

const SHA256 = /^sha256:[0-9a-f]{64}$/;

describe('independently pinned release authorities', () => {
  it('keeps genuine condition evidence pinned while the wider overlay advances', () => {
    const conditionRelease = [
      PINNED_MICRO_MVP_CONDITION_RULES_HASH,
      PINNED_MICRO_MVP_CONDITION_RELEASE_CONTENT_HASH,
      PINNED_MICRO_MVP_CONDITION_RELEASE_HASH,
    ];
    const currentOverlay = [
      PINNED_MICRO_MVP_L1_OVERLAY_HASH,
      PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH,
      PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH,
    ];

    expect(conditionRelease.every((hash) => SHA256.test(hash))).toBe(true);
    expect(currentOverlay.every((hash) => SHA256.test(hash))).toBe(true);
    expect(conditionRelease).not.toEqual(currentOverlay);
  });
});
