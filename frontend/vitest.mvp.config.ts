import { defineConfig } from 'vitest/config';

// Приёмочный MVP-набор: npm run test:mvp
// Живые контент-проверки включаются флагом: MVP_CONTENT=1 npm run test:mvp
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/mvp/**/*.mvp.test.ts'],
  },
});
