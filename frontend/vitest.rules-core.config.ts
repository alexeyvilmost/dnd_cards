import { defineConfig } from 'vitest/config';

/**
 * Blocking line/branch gate for the small replay-critical kernel. Semantic
 * entity coverage is enforced separately by the obligation/evidence matrix.
 */
export default defineConfig({
  test: {
    environment: 'node',
    maxWorkers: 4,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Coverage must observe every executable rules-core test. A curated list
    // silently stopped covering new familiar/Protection/Tome reducer branches.
    include: ['src/rules-core/**/*.test.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage/rules-core',
      include: [
        'src/rules-core/determinism.ts',
        'src/rules-core/reducer.ts',
        'src/rules-core/session.ts',
        'src/rules-core/worldMigration.ts',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
