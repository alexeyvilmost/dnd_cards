import { defineConfig } from 'vitest/config';

/** Выделенный live-gate: не входит в быстрый unit/MVP-набор и всегда проверяет 256 сочетаний. */
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/mvp/micro-micro.matrix.live.test.ts',
      'src/mvp/micro-micro.certification.live.test.ts',
    ],
    hookTimeout: 180_000,
    testTimeout: 900_000,
  },
});
