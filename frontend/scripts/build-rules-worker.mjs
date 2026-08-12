import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '../backend/rules-worker/worker.mjs');
const check = process.argv.includes('--check');

await build({
  entryPoints: [resolve(root, 'src/rules-worker/server.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  write: false,
  sourcemap: false,
  minify: false,
  legalComments: 'none',
}).then(async (result) => {
  const bytes = result.outputFiles[0].contents;
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (check) {
    const existing = await readFile(output);
    if (!existing.equals(bytes)) throw new Error(`rules worker bundle drift: expected sha256:${hash}`);
    process.stdout.write(`Rules worker bundle is current (sha256:${hash})\n`);
    return;
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, bytes);
  process.stdout.write(`Generated ${output} (sha256:${hash})\n`);
});
