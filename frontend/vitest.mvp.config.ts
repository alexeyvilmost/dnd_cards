import { defineConfig } from 'vitest/config';

// Приёмочный MVP-набор: npm run test:mvp
// Живые контент-проверки включаются флагом: MVP_CONTENT=1 npm run test:mvp
export default defineConfig({
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
