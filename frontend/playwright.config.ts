import { defineConfig, devices } from '@playwright/test';

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
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
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
