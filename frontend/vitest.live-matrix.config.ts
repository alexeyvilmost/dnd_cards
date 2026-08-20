import { defineConfig } from 'vitest/config';

/** Scheduled/manual read-only audit of the live content API. */
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/mvp/micro-micro.matrix.live.test.ts',
      'src/mvp/micro-micro.certification.live.test.ts',
      'src/mvp/mini-mvp.ongoing-spells.live.test.ts',
    ],
    setupFiles: ['src/mvp/liveReadRetry.setup.ts'],
    fileParallelism: false,
    hookTimeout: 180_000,
    testTimeout: 900_000,
  },
});
