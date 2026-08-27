import { defineConfig, devices } from '@playwright/test';
import { requiredLiveCanaryOrigin } from './liveCanaryTargets';

if (process.env.LIVE_BROWSER_CANARY !== '1') {
  throw new Error('Set LIVE_BROWSER_CANARY=1 to authorize the mutating live browser canary');
}

const frontendURL = requiredLiveCanaryOrigin('LIVE_BROWSER_BASE_URL', 'frontend');
const ciBrowser = process.env.CI ? { channel: 'chrome' as const } : {};

export default defineConfig({
  testDir: './e2e-live',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  // Do not persist an HTML action report: this suite types real credentials.
  // Console assertions remain available without retaining authenticated media.
  reporter: [['list']],
  outputDir: 'test-results-live',
  use: {
    baseURL: frontendURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // The canary types real account credentials. Persistent trace/video may
    // capture action arguments or authenticated traffic, so production
    // diagnostics deliberately retain no browser media.
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{
    name: 'live-desktop-chromium',
    use: { ...devices['Desktop Chrome'], ...ciBrowser },
  }],
});
