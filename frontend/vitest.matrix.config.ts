import { defineConfig } from 'vitest/config';

/**
 * Детерминированный offline-gate матрицы. Он компилирует все 448 сочетаний из
 * pinned snapshot и принципиально не импортирует live API suites.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/canon/microMicroMatrix.test.ts',
      'src/canon/microMvpRoots.test.ts',
      'src/rules-core/testing/compiledMicroMvpBuildSemantics.test.ts',
    ],
    hookTimeout: 60_000,
    testTimeout: 120_000,
  },
});
