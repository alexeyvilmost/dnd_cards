import { describe, expect, it } from 'vitest';
import { resolveRulesWorkerPort } from './config';

describe('rules worker runtime config', () => {
  it('keeps its loopback port separate from the Railway public API port', () => {
    expect(resolveRulesWorkerPort({ PORT: '8080', RULES_WORKER_PORT: '9090' })).toBe(9090);
  });

  it('falls back to the process port outside the combined container', () => {
    expect(resolveRulesWorkerPort({ PORT: '8181' })).toBe(8181);
    expect(resolveRulesWorkerPort({})).toBe(9090);
  });
});
