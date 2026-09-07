import { describe, expect, it } from 'vitest';
import {
  isStaleClientBundleError,
  staleBundleRecoveryUrl,
} from './staleClientBundle';

describe('stale client bundle recovery', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://bagofholding.ru/assets/Login-old.js',
    'ChunkLoadError: Loading chunk 42 failed',
    'Importing a module script failed',
  ])('recognizes a removed deployment chunk: %s', (message) => {
    expect(isStaleClientBundleError(new Error(message))).toBe(true);
  });

  it('does not reload for an ordinary render failure', () => {
    expect(isStaleClientBundleError(new Error('Invalid armor formula'))).toBe(false);
  });

  it('preserves the route and existing query while adding a unique navigation key', () => {
    expect(staleBundleRecoveryUrl(
      'https://bagofholding.ru/login?returnTo=%2Fcharacters#form',
      1788746400000,
    )).toBe(
      'https://bagofholding.ru/login?returnTo=%2Fcharacters&__boh_reload=1788746400000#form',
    );
  });
});
