import { apiClient } from '../../api/client';
import { readPersistedAuthToken } from '../../api/authSession';
import type { Card, CardsResponse } from '../../types';
import { readWithReviewUpdates } from '../../api/contentReview';

// Catalog visibility depends on authenticated identity. Do not share the
// anonymous/global cards cache with this administrative library projection.
function authorization() {
  const token = readPersistedAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const itemLibraryApi = {
  async list(params: Record<string, unknown>): Promise<CardsResponse> {
    return readWithReviewUpdates('card', async () => (await apiClient.get('/api/cards', { params, headers: authorization() })).data);
  },
  async detail(id: string): Promise<Card> {
    return readWithReviewUpdates('card', async () => (await apiClient.get(`/api/cards/${encodeURIComponent(id)}`, { headers: authorization() })).data);
  },
};
