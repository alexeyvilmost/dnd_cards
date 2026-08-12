import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production PWA update policy', () => {
  it('cannot strand users on an old auth/runtime bundle without an update prompt UI', () => {
    const config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
    expect(config).toContain("registerType: 'autoUpdate'");
    expect(config).toContain('clientsClaim: true');
    expect(config).toContain('skipWaiting: true');
    expect(config).not.toContain("registerType: 'prompt'");
  });
});
