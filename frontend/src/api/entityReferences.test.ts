// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { AxiosAdapter } from 'axios';
import { apiClient, effectsApi } from './client';
import { clearApiCache } from './apiCache';

const originalAdapter = apiClient.defaults.adapter;
afterEach(() => { apiClient.defaults.adapter = originalAdapter; clearApiCache(); localStorage.clear(); });

describe('reference catalog cache invalidation', () => {
  it('reloads an effect after another entity changes its incoming references', async () => {
    let effectReads = 0;
    const adapter: AxiosAdapter = async config => ({ config, status: 200, statusText: 'OK', headers: {},
      data: config.method === 'get' ? { id: 'effect', referenced_by: Array.from({ length: effectReads++ }, () => ({ entity_type: 'race', entity_id: 'new-source', level: 5, paths: [] })) } : {},
    });
    apiClient.defaults.adapter = adapter;
    expect((await effectsApi.getEffect('effect')).referenced_by).toHaveLength(0);
    await apiClient.put('/api/races/new-source', { level_progression: { 5: { effects: ['effect'] } } });
    expect((await effectsApi.getEffect('effect')).referenced_by).toHaveLength(1);
    expect(effectReads).toBe(2);
  });

  it('keeps saved catalog data cached during a read-only draft preview', async () => {
    let effectReads = 0;
    const adapter: AxiosAdapter = async config => ({ config, status: 200, statusText: 'OK', headers: {},
      data: config.method === 'get' ? { id: `effect-${++effectReads}` } : { references: [], referenced_by: [] },
    });
    apiClient.defaults.adapter = adapter;
    const original = await effectsApi.getEffect('effect');
    await apiClient.post('/api/entity-references/class/preview', { entity: { level_progression: {} } });
    expect(await effectsApi.getEffect('effect')).toBe(original);
    expect(effectReads).toBe(1);
  });

  it('authenticates effect filters and keeps administrator references out of another identity cache', async () => {
    const identities: unknown[] = [];
    const adapter: AxiosAdapter = async config => {
      const authorization = config.headers.Authorization;
      identities.push(authorization);
      return { config, status: 200, statusText: 'OK', headers: {}, data: {
        effects: [{ id: 'effect', referenced_by: authorization === 'Bearer admin'
          ? [{ entity_type: 'card', entity_id: 'private-card', paths: [] }] : [] }], total: 1,
      } };
    };
    apiClient.defaults.adapter = adapter;
    for (const token of ['admin', 'player', null]) {
      if (token) localStorage.setItem('auth_token', token); else localStorage.removeItem('auth_token');
      const result = await effectsApi.getEffects({ reference_state: 'linked', reference_type: 'card' });
      expect(result.effects[0].referenced_by).toHaveLength(token === 'admin' ? 1 : 0);
      expect(await effectsApi.getEffects({ reference_state: 'linked', reference_type: 'card' })).toBe(result);
    }
    expect(identities).toEqual(['Bearer admin', 'Bearer player', undefined]);
  });
});
