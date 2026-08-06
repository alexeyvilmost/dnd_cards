import { describe, expect, it } from 'vitest';
import { authenticatedReturnPath } from './authReturnPath';

describe('authenticatedReturnPath', () => {
  it('preserves the protected invite destination including its fragment', () => {
    expect(authenticatedReturnPath({
      from: { pathname: '/encounter/abc', search: '?view=board', hash: '#invite=signed-token' },
    })).toBe('/encounter/abc?view=board#invite=signed-token');
  });

  it('rejects external and malformed destinations', () => {
    expect(authenticatedReturnPath({ from: { pathname: '//evil.example/path' } })).toBe('/');
    expect(authenticatedReturnPath({ from: { pathname: '/\\evil.example/path' } })).toBe('/');
    expect(authenticatedReturnPath({ from: { pathname: 'https://evil.example' } })).toBe('/');
  });
});
