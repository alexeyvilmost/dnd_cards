import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/rules-core/coverage/microMvpDenominator.gate.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
