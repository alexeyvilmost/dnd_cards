import { describe, expect, it } from 'vitest';

import { withClientEventIds, type CreateCharacterEventItem } from './api';

const event = (clientEventId?: string): CreateCharacterEventItem => ({
  ...(clientEventId ? { client_event_id: clientEventId } : {}),
  type: 'narrative',
  payload: { type: 'narrative', text: 'Проверка' },
});

describe('withClientEventIds', () => {
  it('assigns a distinct UUID to every event missing an idempotency key', () => {
    const result = withClientEventIds([event(), event()]);

    expect(result[0].client_event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(result[1].client_event_id).not.toBe(result[0].client_event_id);
  });

  it('preserves an explicitly supplied key for safe retries', () => {
    const id = '8f13483e-05ea-4ac2-ad21-7cdd6ba21f72';
    expect(withClientEventIds([event(id)])[0].client_event_id).toBe(id);
  });
});
