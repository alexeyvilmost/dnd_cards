import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(new URL('..', import.meta.url).pathname);
await mkdir(resolve(root, 'e2e/generated'), { recursive: true });
await build({
  entryPoints: [resolve(root, 'src/rules-worker/execute.ts')],
  outfile: resolve(root, 'e2e/generated/rules-worker-execute.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
});
