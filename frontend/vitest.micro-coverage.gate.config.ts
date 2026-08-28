import { defineConfig } from 'vitest/config';

const releaseJsonReportPath = process.env.MICRO_MVP_VITEST_JSON_REPORT_PATH?.trim() || null;

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/rules-core/coverage/microMvpDenominator.gate.ts'],
    reporters: ['default', ...(releaseJsonReportPath ? ['json' as const] : [])],
    ...(releaseJsonReportPath ? { outputFile: { json: releaseJsonReportPath } } : {}),
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
