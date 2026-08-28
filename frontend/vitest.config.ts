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
      // The milestone suite has its own mandatory `test:mvp` gate. Keeping it
      // out of the generic unit run avoids duplicating live-gated specs as
      // anonymous skips in release evidence.
      'src/mvp/**/*.mvp.test.ts',
      'src/mvp/**/*.live.test.ts',
    ],
  },
}));
