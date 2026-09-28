import { describe, expect, it } from 'vitest';
import {
  ENTITY_SUPPORT_STATUSES, filterEntitiesBySupport, isEntityVisibleBySupport,
  isMechanicsLocked, normalizeSupportStatus, supportSelectionWarning,
  supportStatusOf, supportStatusPresentation,
} from './supportStatus';

describe('manual catalog review status', () => {
  it('offers all eight distinct statuses and colors without requiring old certificates', () => {
    expect(ENTITY_SUPPORT_STATUSES).toHaveLength(8);
    expect(new Set(ENTITY_SUPPORT_STATUSES.map(status => supportStatusPresentation(status).color)).size).toBe(8);
    for (const status of ENTITY_SUPPORT_STATUSES) {
      expect(supportStatusOf({ support: { status } })).toBe(status);
    }
    expect(supportStatusOf(undefined)).toBe('not_verified');
    expect(supportStatusPresentation('partial_narrative_verified_partial')).toMatchObject({
      label: 'Частично нарративное, механика проверена частично', color: '#ec4899',
    });
  });

  it('reads historical values without modifying the historical certificate', () => {
    const original = { support: { status: 'verified_mechanical' as const, mechanics_locked: true, evidence_id: 'historical' } };
    expect(supportStatusOf(original)).toBe('verified');
    expect(original.support.status).toBe('verified_mechanical');
    expect(normalizeSupportStatus('verified_narrative')).toBe('narrative');
    expect(normalizeSupportStatus('untested')).toBe('not_tested');
    expect(normalizeSupportStatus('known_mismatch')).toBe('not_verified');
    expect(normalizeSupportStatus('unknown')).toBe('not_verified');
  });

  it('keeps entities selectable and editable regardless of review or historical lock', () => {
    const rows = [
      { id: 'spell-one', support: { status: 'not_verified' as const, mechanics_locked: true } },
      { id: 'action-two', support: { status: 'partial_narrative_not_verified' as const } },
      { id: 'item-three' },
    ];
    expect(filterEntitiesBySupport(rows, false)).toEqual(rows);
    for (const row of rows) {
      expect(isEntityVisibleBySupport(row, false)).toBe(true);
      expect(supportSelectionWarning(row)).toBeNull();
      expect(isMechanicsLocked(row)).toBe(false);
    }
  });
});
