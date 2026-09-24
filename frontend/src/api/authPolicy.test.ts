import { describe, expect, it } from 'vitest';
import { shouldAttachAuthToken } from './authPolicy';

describe('catalog authentication policy', () => {
  it.each([
    ['/api/spells?fields=list&limit=500'],
    ['/api/backgrounds/e3505422-e7f8-479b-928e-b5dbbbc694b3'],
    ['/api/content-images/classes/one'],
    ['/api/integrations/ttg/bestiary/skeleton-mm'],
  ])('keeps public read anonymous: %s', (url) => {
    expect(shouldAttachAuthToken('get', url)).toBe(false);
  });

  it.each(['/api/cards', '/api/cards?fields=list&rarity=rare', 'https://bagofholding.ru/api/cards/one', '/api/cards/one/battle-stats'])('attaches the current identity for item read: %s', url => {
    expect(shouldAttachAuthToken('get', url)).toBe(true);
    expect(shouldAttachAuthToken('head', url)).toBe(true);
  });

  it('keeps authentication on user data and every mutation', () => {
    expect(shouldAttachAuthToken('get', '/api/my-item-catalog?fields=list')).toBe(true);
    expect(shouldAttachAuthToken('get', '/api/characters-v3/me')).toBe(true);
    expect(shouldAttachAuthToken('get', '/api/auth/me')).toBe(true);
    expect(shouldAttachAuthToken('put', '/api/spells/one')).toBe(true);
    expect(shouldAttachAuthToken('delete', '/api/cards/one')).toBe(true);
    expect(shouldAttachAuthToken('get', '/api/integrations/private/profile')).toBe(true);
  });
});
