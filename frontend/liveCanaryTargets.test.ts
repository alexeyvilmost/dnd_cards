import { afterEach, describe, expect, it } from 'vitest';
import {
  assertLiveCanaryRequestOrigin,
  requiredLiveCanaryOrigin,
} from './liveCanaryTargets';

const ENV_NAMES = [
  'LIVE_BROWSER_BASE_URL',
  'LIVE_BROWSER_API_URL',
  'LIVE_BROWSER_ALLOWED_ORIGIN',
] as const;

afterEach(() => {
  for (const name of ENV_NAMES) delete process.env[name];
});

describe('provider-neutral live browser target safety', () => {
  it('pins both production services to the public product origin', () => {
    process.env.LIVE_BROWSER_BASE_URL = 'https://bagofholding.ru';
    process.env.LIVE_BROWSER_API_URL = 'https://bagofholding.ru';

    expect(requiredLiveCanaryOrigin('LIVE_BROWSER_BASE_URL', 'frontend'))
      .toBe('https://bagofholding.ru');
    expect(requiredLiveCanaryOrigin('LIVE_BROWSER_API_URL', 'backend'))
      .toBe('https://bagofholding.ru');
  });

  it('accepts the explicitly pinned HTTPS deployment origin for both services', () => {
    process.env.LIVE_BROWSER_ALLOWED_ORIGIN = 'https://77-95-206-239.sslip.io';
    process.env.LIVE_BROWSER_BASE_URL = 'https://77-95-206-239.sslip.io';
    process.env.LIVE_BROWSER_API_URL = 'https://77-95-206-239.sslip.io';

    expect(requiredLiveCanaryOrigin('LIVE_BROWSER_BASE_URL', 'frontend'))
      .toBe('https://77-95-206-239.sslip.io');
    expect(requiredLiveCanaryOrigin('LIVE_BROWSER_API_URL', 'backend'))
      .toBe('https://77-95-206-239.sslip.io');
  });

  it('rejects an arbitrary remote origin unless it is explicitly pinned', () => {
    process.env.LIVE_BROWSER_BASE_URL = 'https://untrusted.example';

    expect(() => requiredLiveCanaryOrigin('LIVE_BROWSER_BASE_URL', 'frontend'))
      .toThrow(/LIVE_BROWSER_ALLOWED_ORIGIN/);
  });

  it.each([
    'http://shadow.example',
    'https://shadow.example/path',
    'https://user:password@shadow.example',
  ])('rejects an unsafe provider-neutral origin: %s', (origin) => {
    process.env.LIVE_BROWSER_ALLOWED_ORIGIN = origin;
    process.env.LIVE_BROWSER_BASE_URL = origin;

    expect(() => requiredLiveCanaryOrigin('LIVE_BROWSER_BASE_URL', 'frontend')).toThrow();
  });

  it('still verifies the final response origin after redirects', () => {
    expect(() => assertLiveCanaryRequestOrigin(
      'https://unexpected.example/api/health',
      'https://shadow.example',
      'health request',
    )).toThrow(/unexpected origin/);
  });
});
