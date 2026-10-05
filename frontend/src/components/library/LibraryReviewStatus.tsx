import { ENTITY_SUPPORT_STATUSES, supportStatusOf, supportStatusPresentation, type EntityReviewStatus, type SupportableEntity } from '../../content/supportStatus';
import './LibraryReviewStatus.css';
import type { CatalogReviewSummary } from '../../api/catalogReview';

export function parseReviewStatuses(value: string): EntityReviewStatus[] {
  const selected = new Set(value.split(','));
  return ENTITY_SUPPORT_STATUSES.filter(status => selected.has(status));
}

export function filterReviewStatuses<T extends SupportableEntity>(rows: T[], selected: readonly EntityReviewStatus[]): T[] {
  return selected.length ? rows.filter(row => selected.includes(supportStatusOf(row))) : rows;
}

export function LibraryReviewStatusFilter({ value, onChange }: { value: EntityReviewStatus[]; onChange: (value: EntityReviewStatus[]) => void }) {
  return <fieldset className="library-review-filter">
    <legend>Статус</legend>
    <div className="library-review-filter__options">{ENTITY_SUPPORT_STATUSES.map(status => {
      const presentation = supportStatusPresentation(status);
      return <label key={status}>
        <input type="checkbox" checked={value.includes(status)} onChange={event => onChange(event.target.checked ? [...value, status] : value.filter(item => item !== status))} />
        <span className="library-review-swatch" style={{ backgroundColor: presentation.color }} aria-hidden="true" />
        {presentation.label}
      </label>;
    })}</div>
    {!!value.length && <button type="button" onClick={() => onChange([])}>Все статусы</button>}
  </fieldset>;
}

export function LibraryReviewStatusSummary({ entities = [], summary, loading = false }: {
  entities?: readonly SupportableEntity[]; summary?: CatalogReviewSummary; loading?: boolean;
}) {
  if (loading) return <p className="library-review-summary" role="status">Загрузка статистики проверки…</p>;
  const counts = new Map(ENTITY_SUPPORT_STATUSES.map(status => [status, summary?.counts[status] ?? 0]));
  for (const entity of summary ? [] : entities) {
    const status = supportStatusOf(entity);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return <section className="library-review-summary" aria-label="Распределение статусов проверки">
    <p>Статусы проверки: {summary?.total ?? entities.length} сущностей в этом разделе с учётом поиска и остальных фильтров, до фильтра «Статус».</p>
    <div className="library-review-summary__bar" aria-hidden="true">{ENTITY_SUPPORT_STATUSES.map(status => {
      const count = counts.get(status)!;
      return count > 0 && <span key={status} data-status={status} style={{ flexGrow: count, backgroundColor: supportStatusPresentation(status).color }} />;
    })}</div>
    <ul>{ENTITY_SUPPORT_STATUSES.map(status => <li key={status} data-status={status}>
      <span className="library-review-swatch" style={{ backgroundColor: supportStatusPresentation(status).color }} aria-hidden="true" />
      <span>{supportStatusPresentation(status).label}: <strong>{counts.get(status)}</strong></span>
    </li>)}</ul>
  </section>;
}
