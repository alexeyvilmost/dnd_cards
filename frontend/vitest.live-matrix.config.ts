import { defineConfig } from 'vitest/config';

if (process.env.MVP_CONTENT !== '1') {
  throw new Error('Live content tests require MVP_CONTENT=1; refusing to report a skipped suite as green');
}

const liveApiUrl = process.env.VITE_API_URL?.trim();
if (!liveApiUrl) {
  throw new Error('Live content tests require an explicit VITE_API_URL');
}
try {
  const parsed = new URL(liveApiUrl);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('unsupported protocol');
} catch (error) {
  throw new Error(`Live content tests received an invalid VITE_API_URL: ${String(error)}`);
}

/** Scheduled/manual read-only audit of the live content API. */
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/mvp/micro-micro.matrix.live.test.ts',
      'src/mvp/micro-micro.certification.live.test.ts',
      'src/mvp/mini-mvp.ongoing-spells.live.test.ts',
      'src/mvp/mini-mvp.traversal-spells.live.test.ts',
      'src/mvp/mini-mvp.control-spells.live.test.ts',
      'src/mvp/mini-mvp.utility-cantrips.live.test.ts',
      'src/mvp/mini-mvp.utility-level1-spells.live.test.ts',
      'src/mvp/mini-mvp.forge-roots.live.test.ts',
      'src/mvp/mini-mvp.fighting-styles-forge.live.test.ts',
      'src/mvp/mini-mvp.fighting-style-primitives.live.test.ts',
    ],
    setupFiles: ['src/mvp/liveReadRetry.setup.ts'],
    fileParallelism: false,
    hookTimeout: 180_000,
    testTimeout: 900_000,
  },
});
