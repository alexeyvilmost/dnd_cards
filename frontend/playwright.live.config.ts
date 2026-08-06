import { defineConfig, devices } from '@playwright/test';
import { requiredLiveCanaryOrigin } from './liveCanaryTargets';

if (process.env.LIVE_BROWSER_CANARY !== '1') {
  throw new Error('Set LIVE_BROWSER_CANARY=1 to authorize the mutating live browser canary');
}

const frontendURL = requiredLiveCanaryOrigin('LIVE_BROWSER_BASE_URL', 'frontend');

export default defineConfig({
  testDir: './e2e-live',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  // Do not persist an HTML action report: this suite types real credentials.
  // Redacted diagnostics and a masked failure screenshot are sufficient.
  reporter: [['list']],
  outputDir: 'test-results-live',
  use: {
    baseURL: frontendURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // The canary types real account credentials. Persistent trace/video may
    // capture action arguments or authenticated traffic, so production
    // diagnostics are deliberately limited to the masked failure screenshot.
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{
    name: 'live-desktop-chromium',
    use: { ...devices['Desktop Chrome'] },
  }],
});
