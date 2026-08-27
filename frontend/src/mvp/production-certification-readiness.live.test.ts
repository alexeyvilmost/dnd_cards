import { describe, expect, it } from 'vitest';
import {
  loadConditions,
  MICRO_MVP_CONDITION_CERTIFICATION_VERSION,
} from '../api/conditionsApi';
import {
  PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH,
  PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH,
  PINNED_MICRO_MVP_L1_OVERLAY_HASH,
} from '../canon/microMvpL1ReleaseIdentity';

describe('production certification readiness', () => {
  it('activates exactly 15 database conditions for the current compiled release', async () => {
    const result = await loadConditions({
      timeoutMs: 30_000,
      expectedRelease: {
        certificationVersion: MICRO_MVP_CONDITION_CERTIFICATION_VERSION,
        rulesHash: PINNED_MICRO_MVP_L1_OVERLAY_HASH,
        releaseContentHash: PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH,
        releaseHash: PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH,
      },
    });

    if (result.mode !== 'database_release') {
      throw new Error(`production condition authority is not ready: ${result.reason}`);
    }
    expect(result.count).toBe(15);
    expect(result.setHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
