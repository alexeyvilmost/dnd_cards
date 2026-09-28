// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENTITY_SUPPORT_STATUSES, type EntityReviewStatus } from '../../content/supportStatus';
import { LibraryReviewStatusFilter, LibraryReviewStatusSummary, filterReviewStatuses } from './LibraryReviewStatus';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const rows = ENTITY_SUPPORT_STATUSES.map((status, index) => ({ id: String(index), support: { status } }));

function ReviewLibrary() {
  const [statuses, setStatuses] = useState<EntityReviewStatus[]>([]);
  return <>
    <LibraryReviewStatusFilter value={statuses} onChange={setStatuses} />
    <LibraryReviewStatusSummary entities={rows} />
    <output>{filterReviewStatuses(rows, statuses).map(row => row.support.status).join(',')}</output>
  </>;
}

describe('review status library controls', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it('combines statuses as alternatives while the chart retains all seven source counts', async () => {
    await act(async () => root.render(<ReviewLibrary />));
    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    expect(checkboxes).toHaveLength(7);
    await act(async () => { checkboxes[0].click(); });
    await act(async () => { checkboxes[2].click(); });
    expect(container.querySelector('output')?.textContent).toBe('verified,not_verified');
    expect(container.querySelector('.library-review-summary p')?.textContent).toContain('7 сущностей');
    expect(container.querySelectorAll('.library-review-summary__bar span')).toHaveLength(7);
    expect([...container.querySelectorAll('.library-review-summary strong')].map(row => row.textContent)).toEqual(Array(7).fill('1'));
    await act(async () => container.querySelector('button')!.click());
    expect(container.querySelector('output')?.textContent).toBe(ENTITY_SUPPORT_STATUSES.join(','));
  });

  it('shows an empty library with seven explicit zero counts and no invalid bar widths', async () => {
    await act(async () => root.render(<LibraryReviewStatusSummary entities={[]} />));
    expect(container.querySelectorAll('.library-review-summary__bar span')).toHaveLength(0);
    expect([...container.querySelectorAll('strong')].map(row => row.textContent)).toEqual(Array(7).fill('0'));
  });
});
