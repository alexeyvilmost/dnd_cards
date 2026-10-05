import { describe, expect, it } from 'vitest';
import { imageAPIError } from './imageErrors';

describe('image error diagnostics', () => {
  it('distinguishes application authorization from upstream region and permissions', () => {
    expect(imageAPIError(403, {code: 'content_admin_required', source: 'application'}).source).toBe('application');
    for (const code of ['image_region_unavailable', 'image_provider_permission']) {
      const error = imageAPIError(502, {code, source: 'provider', outcome: 'rejected', request_id: 'req-app', provider_request_id: 'req-upstream'});
      expect(error.source).toBe('provider');
      expect(error.code).toBe(code);
      expect(error.outcome).toBe('rejected');
      expect(error.status).toBe(502);
      expect(error.message).toContain('req-app');
      expect(error.providerRequestId).toBe('req-upstream');
    }
  });
  it('does not render arbitrary provider text, HTML or malformed diagnostic IDs', () => {
    const error = imageAPIError(502, {error: '<html>secret prompt sk-private data:image/png;base64,AAA</html>', code: 'anything', request_id: 'secret\nheader', provider_request_id: '<script>'}, 'browser-safe');
    expect(error.message).not.toMatch(/secret|sk-private|base64|html/);
    expect(error.requestId).toBe('browser-safe');
    expect(error.providerRequestId).toBeUndefined();
    expect(error).not.toHaveProperty('response');
  });
  it('does not infer a regional block from an unclassified provider 403', () => {
    const error = imageAPIError(502, {code: 'image_provider_forbidden', source: 'provider'});
    expect(error.code).toBe('image_provider_forbidden');
    expect(error.message).not.toContain('регион');
  });
  it('explains uncertain network outcomes and expired application authentication', () => {
    expect(imageAPIError(undefined, undefined).message).toContain('неизвестен');
    expect(imageAPIError(401, undefined).message).toContain('войти');
    expect(imageAPIError(504, {code: 'image_timeout', source: 'network', outcome: 'unknown'}).outcome).toBe('unknown');
  });
});
