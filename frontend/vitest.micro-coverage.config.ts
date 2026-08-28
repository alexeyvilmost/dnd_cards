import { defineConfig } from 'vitest/config';
import evidenceConfig from './micro-mvp-evidence.config.json';

const releaseJsonReportPath = process.env.MICRO_MVP_VITEST_JSON_REPORT_PATH?.trim() || null;

/**
 * Phase one executes every test that may back semantic evidence and writes an
 * atomic execution manifest. The separate gate phase consumes that manifest.
 */
export default defineConfig({
  test: {
    environment: evidenceConfig.environment,
    maxWorkers: 4,
    include: evidenceConfig.include,
    reporters: [
      'default',
      evidenceConfig.reporter,
      ...(releaseJsonReportPath ? ['json' as const] : []),
    ],
    ...(releaseJsonReportPath ? { outputFile: { json: releaseJsonReportPath } } : {}),
    testTimeout: evidenceConfig.testTimeoutMs,
    hookTimeout: evidenceConfig.hookTimeoutMs,
  },
});
