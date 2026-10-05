// Explicit fixture maintenance only. Never invoked by tests or a release gate.
// Reads the audited Git tree without checking it out or changing working files.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {build, version as esbuildVersion} from 'esbuild';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const sourceCommit = '4549fb3c903659d3fe2beb272f7f903a731f7388';
const fixtureDirectory = fileURLToPath(new URL('../worker/fixtures/replay-v1/', import.meta.url));
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const git = args => execFileSync('git', args, {cwd: repo, maxBuffer: 32 * 1024 * 1024});
const files = new Set(git(['ls-tree', '-r', '--name-only', sourceCommit]).toString('utf8').trim().split('\n'));
const sourceInputs = new Map();
const result = await build({entryPoints: ['frontend/worker/artifact.ts'], bundle: true, platform: 'node',
  target: 'node20', format: 'cjs', write: false, metafile: true, plugins: [{name: 'immutable-git-inputs', setup(builder) {
    builder.onResolve({filter: /.*/}, args => {
      const candidate = args.path.startsWith('.') ? path.posix.join(path.posix.dirname(args.importer), args.path) : args.path;
      if (candidate.startsWith('node:')) return {path: candidate, external: true};
      const resolved = ['', '.ts', '.tsx', '.json', '.js', '/index.ts', '/index.tsx'].map(suffix => candidate + suffix).find(file => files.has(file));
      if (!resolved || !/^(frontend\/(src|worker|charges|utils)\/|backend\/animationpresentation\/)/.test(resolved)) {
        throw Error(`Historical worker import is outside the audited source tree: ${candidate}`);
      }
      return {path: resolved, namespace: 'historical-git'};
    });
    builder.onLoad({filter: /.*/, namespace: 'historical-git'}, args => {
      const bytes = git(['show', `${sourceCommit}:${args.path}`]);
      sourceInputs.set(args.path, hash(bytes));
      return {contents: bytes.toString('utf8'), loader: args.path.endsWith('.json') ? 'json' : args.path.endsWith('.tsx') ? 'tsx' : 'ts'};
    });
  }}]});
const bytes = result.outputFiles[0].contents;
const compressed = gzipSync(bytes, {level: 9});
const manifest = {schemaVersion: 1, purpose: 'Historical executable replay; never a manual entity review certificate',
  sourceCommit, esbuildVersion, build: {target: 'node20', format: 'cjs', platform: 'node'},
  artifactFile: 'artifact.cjs.gz', artifactHash: hash(bytes), compressedHash: hash(compressed),
  bytes: bytes.length, compressedBytes: compressed.length,
  sourceInputs: Object.fromEntries([...sourceInputs].sort(([a], [b]) => a.localeCompare(b)))};
await mkdir(fixtureDirectory, {recursive: true});
async function writeOnce(file, contents) {
  try {
    const existing = await readFile(file);
    if (!existing.equals(Buffer.from(contents))) throw Error(`Refusing to overwrite historical fixture ${path.basename(file)}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(file, contents, {flag: 'wx'});
  }
}
await writeOnce(path.join(fixtureDirectory, 'artifact.cjs.gz'), compressed);
await writeOnce(path.join(fixtureDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(JSON.stringify({sourceCommit, artifactHash: manifest.artifactHash, bytes: bytes.length, compressedBytes: compressed.length, inputs: sourceInputs.size}) + '\n');
