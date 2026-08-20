import { defineConfig } from 'vitest/config';

// Приёмочный MVP-набор: npm run test:mvp
// Живые контент-проверки включаются флагом: MVP_CONTENT=1 npm run test:mvp
const liveContentEnabled = process.env.MVP_CONTENT === '1';
const liveApiUrl = (process.env.API_URL || process.env.VITE_API_URL || '').trim();
if (liveContentEnabled && !liveApiUrl) {
  throw new Error('MVP_CONTENT=1 requires an explicit API_URL; refusing a silent fallback');
}

export default defineConfig({
  // api/client.ts is the same client used by Forge and the character sheet.
  // Bind it to the exact catalog under test instead of Vitest's localhost DEV
  // default or a historical hosting-provider URL.
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify(liveApiUrl),
  },
  test: {
    environment: 'node',
    include: ['src/mvp/**/*.mvp.test.ts'],
    setupFiles: ['src/mvp/liveReadRetry.setup.ts'],
    // Live suites share one production catalog. Running files in parallel can
    // overload the API with repeated bundle expansion and create partial,
    // mutually inconsistent reads that no real character build performs.
    fileParallelism: false,
  },
});
