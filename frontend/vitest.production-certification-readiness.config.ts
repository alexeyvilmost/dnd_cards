import { defineConfig } from 'vitest/config';

if (process.env.MVP_CONTENT !== '1') {
  throw new Error(
    'Production certification readiness requires MVP_CONTENT=1; refusing a skipped live gate',
  );
}

function exactHttpOrigin(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`${label} is required`);
  const parsed = new URL(value);
  if (!['https:', 'http:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    throw new Error(`${label} must be an exact HTTP(S) origin`);
  }
  return parsed.origin;
}

const viteApiOrigin = exactHttpOrigin(process.env.VITE_API_URL, 'VITE_API_URL');
const contentApiOrigin = exactHttpOrigin(process.env.API_URL, 'API_URL');
if (viteApiOrigin !== contentApiOrigin) {
  throw new Error('VITE_API_URL and API_URL must identify the same production API origin');
}

/** One GET-only runtime-authority predicate used immediately before live browser canaries. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/mvp/production-certification-readiness.live.test.ts'],
    setupFiles: ['src/mvp/liveReadRetry.setup.ts'],
    fileParallelism: false,
    hookTimeout: 45_000,
    testTimeout: 45_000,
  },
});
