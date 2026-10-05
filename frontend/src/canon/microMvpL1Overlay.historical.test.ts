import { beforeAll, describe, expect, it } from 'vitest';
import { assertMicroMvpL1OverlayReady, compileMicroMvpL1Overlay, type CompiledMicroMvpL1Provider,
  MICRO_MVP_L1_OVERLAY_RELEASE_ID,
  MICRO_MVP_L1_OVERLAY_VERSION,
  PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH,
  PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH,
  PINNED_MICRO_MVP_L1_OVERLAY_HASH,
} from './microMvpL1Overlay';
import { assertPinnedProdSnapshotL1Ready } from './prodSnapshotL1Fixtures';

// Exact former release-pin contract. Explicit historical diagnostic only:
// current compiler changes must never silently refresh these old pins.
describe('historical micro-MVP L1 release identity', () => {
  let provider: CompiledMicroMvpL1Provider;
  beforeAll(async () => { provider = await compileMicroMvpL1Overlay(); });
  it('pins overlay, compiled content, and release hashes independently from the raw release', () => {
    expect(MICRO_MVP_L1_OVERLAY_VERSION).toBe('1.14.0');
    expect(provider.release).toMatchObject({
      id: MICRO_MVP_L1_OVERLAY_RELEASE_ID,
      sourceReleaseId: provider.source.release.id,
      sourceContentHash: provider.source.release.contentHash,
      overlayHash: PINNED_MICRO_MVP_L1_OVERLAY_HASH,
      contentHash: PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH,
      releaseHash: PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH,
    });
    expect(provider.ruleset).toEqual({
      systemId: 'dnd5e-2024',
      releaseId: MICRO_MVP_L1_OVERLAY_RELEASE_ID,
      contentHash: PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH,
      errataVersion: provider.source.release.errataVersion,
    });

    expect(() => assertPinnedProdSnapshotL1Ready(provider.source)).toThrow();
    expect(() => assertMicroMvpL1OverlayReady(provider)).not.toThrow();
  });

});
