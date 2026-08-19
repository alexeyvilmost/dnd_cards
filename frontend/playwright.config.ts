import { defineConfig, devices } from '@playwright/test';

// GitHub's ubuntu runner already ships Google Chrome. Using that production
// channel in CI keeps browser acceptance deterministic without downloading a
// second ~browser image on every push. Local runs keep Playwright's managed
// Chromium so contributors can continue to use `playwright install` normally.
const ciBrowser = process.env.CI ? { channel: 'chrome' as const } : {};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  // Multi-character combat scenarios intentionally cross several full reloads.
  // Keep the enclosing test budget above their explicit 30s readiness waits so
  // a slow mobile renderer cannot cancel the fixture while data is still loading.
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The CI path intentionally uses the runner's system Chrome and therefore
    // does not install Playwright's separate ffmpeg bundle. Traces and failure
    // screenshots still provide diagnostics without making video recording a
    // hidden browser-runtime dependency.
    video: process.env.CI ? 'off' : 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], ...ciBrowser },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'], ...ciBrowser },
    },
  ],
  webServer: {
    // This gate starts only the static frontend preview. Every /api request is
    // intercepted by e2e/forge-api-fixture.ts; backend/PostgreSQL acceptance is
    // a separate opt-in/live gate and must not be inferred from these tests.
    command: 'npm run preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173/rules-lab',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
