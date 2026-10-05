import { describe, it, expect } from 'vitest';
import { requiredReviewSummary } from './catalogReview';
import { ENTITY_SUPPORT_STATUSES, type EntityReviewStatus } from '../content/supportStatus';

describe('server review summary', () => {
  const counts = Object.fromEntries(ENTITY_SUPPORT_STATUSES.map(status => [status, 2])) as Record<EntityReviewStatus, number>;
  it('accepts complete counts independent of the loaded page', () => {
    const summary = { total: 16, counts };
    expect(requiredReviewSummary({ review_summary: summary }, true)).toBe(summary);
    expect(requiredReviewSummary({}, false)).toBeUndefined();
  });
  it.each([undefined, { total: 17, counts }, { total: 16, counts: { ...counts, verified: -1 } }, { total: 16, counts: {} }])('fails visibly for invalid counts: %j', summary => {
    expect(() => requiredReviewSummary({ review_summary: summary } as Parameters<typeof requiredReviewSummary>[0], true)).toThrow('Статистика');
  });
});
