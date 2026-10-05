import { ENTITY_SUPPORT_STATUSES, type EntityReviewStatus } from '../content/supportStatus';

export interface CatalogReviewSummary { total: number; counts: Record<EntityReviewStatus, number> }
export interface CatalogReviewResponse { review_summary?: CatalogReviewSummary }
export interface CatalogPageQuery { page?: number; limit?: number; search?: string; review_status?: string; review_summary?: boolean }

/** A page is never a substitute for the server's complete filtered counts. */
export function requiredReviewSummary(response: CatalogReviewResponse, enabled: boolean): CatalogReviewSummary | undefined {
  if (!enabled) return undefined;
  const summary = response.review_summary;
  if (!summary || !Number.isSafeInteger(summary.total) || summary.total < 0
    || ENTITY_SUPPORT_STATUSES.some(status => !Number.isSafeInteger(summary.counts?.[status]) || summary.counts[status] < 0)
    || ENTITY_SUPPORT_STATUSES.reduce((total, status) => total + summary.counts[status], 0) !== summary.total) {
    throw new Error('Статистика проверки недоступна. Обновите страницу или повторите позже.');
  }
  return summary;
}
