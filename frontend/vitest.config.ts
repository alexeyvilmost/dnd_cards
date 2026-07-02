import { defineConfig } from 'vitest/config';

// Обычный прогон (npm test) НЕ включает приёмочный MVP-набор (src/mvp) —
// тот запускается отдельно: npm run test:mvp (см. src/mvp/contracts.ts).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'src/mvp/**'],
  },
});
