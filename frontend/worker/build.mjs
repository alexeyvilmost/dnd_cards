import {build} from 'esbuild';
import {mkdir, copyFile} from 'node:fs/promises';
await mkdir('worker/dist', {recursive: true});
const result = await build({entryPoints: ['worker/artifact.ts'], bundle: true, platform: 'node',
  target: 'node20', format: 'cjs', outfile: 'worker/dist/artifact.cjs', metafile: true});
const forbidden = Object.keys(result.metafile.inputs).filter(name => /node_modules\/(react|react-dom)\//.test(name)
  || /^src\/api\//.test(name) || name === 'src/character/api.ts' || name === 'src/utils/resources.ts');
if (forbidden.length) throw Error(`Worker imports browser transport: ${forbidden.join(', ')}`);
await copyFile('worker/server.mjs', 'worker/dist/server.mjs');
await copyFile('worker/replay.mjs', 'worker/dist/replay.mjs');
