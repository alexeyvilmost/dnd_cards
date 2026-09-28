import { mergeConfig } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';
import viteConfig from './vite.config';

/** Default unit suite is offline; live API audits have an explicit config. */
export default mergeConfig(viteConfig, defineConfig({
  test: {
    // The compiler suites materialize all 448 roots. A bounded pool avoids
    // starving their explicit timeouts when the full repository runs at once.
    // GitHub-hosted runners commonly expose two effective CPU cores. More
    // workers make the 448-root compiler suites contend with each other and
    // can trip their semantic 30s timeout even though each suite is healthy in
    // isolation.
    maxWorkers: 2,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    exclude: [
      ...configDefaults.exclude,
      'e2e/**',
      'e2e-live/**',
      // Scripts use Node's built-in test runner and are owned by explicit
      // release gates. Vitest must not collect their compatible file names as
      // empty suites.
      'scripts/**/*.test.mjs',
      'worker/**/*.test.mjs',
      // Historical entity/certification suites are retained for explicit
      // diagnostics only. They are not evidence for manual review statuses.
      'src/mvp/**',
      'src/canon/**',
      'src/mechanics/contentSweep.test.ts',
      'src/rules-core/coverage/**',
      'src/rules-core/testing/microMvpScenarioCorpus.test.ts',
      'src/api/conditionsApi.test.ts',
      'src/content/supportStatus.test.ts',
      'src/components/forge/SupportStatusBadge.test.tsx',
      // Live API diagnostics are opt-in regardless of which feature folder
      // owns them. Keeping the suffix boundary global prevents a credential-
      // gated probe from appearing as an anonymous skip in the offline suite.
      'src/**/*.live.test.ts',
    ],
  },
}));
