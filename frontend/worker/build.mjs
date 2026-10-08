import {build} from 'esbuild';
import {mkdir, copyFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {assertWorkerInputsCovered} from '../../scripts/release/plan-components.mjs';
const args=process.argv.slice(2);
if(args.length && (args.length!==2||args[0]!=='--out-dir'||!args[1]))throw Error('Usage: build.mjs [--out-dir DIRECTORY]');
const output=path.resolve(args[1]??'worker/dist');
await mkdir(output, {recursive: true});
const result = await build({entryPoints: ['worker/artifact.ts'], bundle: true, platform: 'node',
  target: 'node20', format: 'cjs', outfile: path.join(output,'artifact.cjs'), metafile: true});
const forbidden = Object.keys(result.metafile.inputs).filter(name => /node_modules\/(react|react-dom)\//.test(name)
  || /^src\/api\//.test(name) || name === 'src/character/api.ts' || name === 'src/utils/resources.ts');
if (forbidden.length) throw Error(`Worker imports browser transport: ${forbidden.join(', ')}`);
const inputs = Object.keys(result.metafile.inputs)
  .filter(name => !name.replaceAll('\\', '/').split('/').includes('node_modules'))
  .map(name => path.posix.normalize(`frontend/${name.replaceAll('\\', '/')}`)).sort();
assertWorkerInputsCovered(inputs);
// Additive evidence: planners may widen checks from this graph, never narrow
// them based on a potentially older build. Validate the declared boundary on
// every clean worker build so a new shared import cannot be missed silently.
await writeFile(path.join(output,'build-inputs.json'), `${JSON.stringify({schema_version: 1, inputs}, null, 2)}\n`);
await writeFile(path.join(output,'metafile.json'), `${JSON.stringify(result.metafile, null, 2)}\n`);
await copyFile('worker/server.mjs', path.join(output,'server.mjs'));
await copyFile('worker/replay.mjs', path.join(output,'replay.mjs'));
await copyFile('worker/mirrors.mjs', path.join(output,'mirrors.mjs'));
await copyFile('worker/native-hash.mjs', path.join(output,'native-hash.mjs'));
await copyFile('worker/combat-frames.mjs', path.join(output,'combat-frames.mjs'));
await copyFile('worker/speculative-transitions.mjs', path.join(output,'speculative-transitions.mjs'));

await copyFile('worker/state-delta.mjs', path.join(output,'state-delta.mjs'));
await copyFile('worker/partial-mirrors.mjs', path.join(output,'partial-mirrors.mjs'));
