import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// This profile is never a live/prod canary. The fixture validates the complete
// registry, DSN, readiness and ownership again before opening any browser page.
const directory = process.env.TEST_RUN_DIRECTORY;
const origin = process.env.TEST_UI_ORIGIN;
if (!directory || !origin || !/^test_[a-f0-9]{24}$/.test(process.env.TEST_RUN_ID ?? '')) {
  throw new Error('Use the runner-owned scripts/testing/stack.mjs integration profile');
}
const url = new URL(origin);
if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
  throw new Error('The local browser profile requires the owned loopback origin');
}
const root = fileURLToPath(new URL('../outputs/testing/runs/', import.meta.url));
const owned = path.join(realpathSync(root), process.env.TEST_RUN_ID!);
if (realpathSync(directory) !== owned) throw new Error('Browser artifacts must stay in the owned run directory');
const registry = JSON.parse(readFileSync(path.join(owned, 'registry.json'), 'utf8'));
if (registry.runId !== process.env.TEST_RUN_ID || registry.status !== 'ready' || registry.origins?.ui !== origin) {
  throw new Error('Browser profile registry mismatch');
}

export default defineConfig({
  testDir: './e2e-local', fullyParallel: false, workers: 1, retries: 0,
  timeout: 120_000, expect: { timeout: 15_000 },
  outputDir: path.join(directory, 'acceptance', 'playwright'),
  reporter: [['line'], ['json', { outputFile: path.join(directory, 'acceptance', 'playwright.json') }]],
  use: {
    baseURL: origin, browserName: 'chromium', channel: process.env.TEST_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'chrome' : undefined), headless: true,
    viewport: { width: 1440, height: 1050 }, serviceWorkers: 'block',
    // Traces/HAR can persist Authorization and passwords. Keep them disabled;
    // assertion messages are sanitized and failure screenshots are local only.
    trace: 'off', video: 'off', screenshot: 'only-on-failure',
  },
});
