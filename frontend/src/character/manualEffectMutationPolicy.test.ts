import { describe, expect, it } from 'vitest';
import {
  assertManualEffectMutationAllowed,
  manualEffectMutationBlockReason,
  ONLINE_ENCOUNTER_MANUAL_EFFECT_BLOCK_REASON,
} from './manualEffectMutationPolicy';

describe('manual effect mutation authority policy', () => {
  it.each([undefined, null, ''])('allows a detached local sheet (%s)', (encounterId) => {
    expect(manualEffectMutationBlockReason(encounterId)).toBeNull();
    expect(() => assertManualEffectMutationAllowed(encounterId)).not.toThrow();
  });

  it('fails closed for a sheet linked to an online encounter', () => {
    expect(manualEffectMutationBlockReason('encounter-1')).toBe(
      ONLINE_ENCOUNTER_MANUAL_EFFECT_BLOCK_REASON,
    );
    expect(() => assertManualEffectMutationAllowed('encounter-1')).toThrow(
      ONLINE_ENCOUNTER_MANUAL_EFFECT_BLOCK_REASON,
    );
  });
});
