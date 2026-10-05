// Explicit write-once maintenance command; never invoked by the normal test runner.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir, mkdtemp, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {build} from 'esbuild';

const root=fileURLToPath(new URL('../',import.meta.url));
const target=new URL('../src/rules-core/testing/fixtures/event-queue-v1/',import.meta.url);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const temporary=await mkdtemp(path.join(tmpdir(),'handler-replay-capture-'));
try {
  const bundled=await build({absWorkingDir:root,entryPoints:['src/rules-core/testing/handlerReplayScenarios.ts'],bundle:true,platform:'node',format:'cjs',target:'node20',write:false,metafile:true});
  const moduleFile=path.join(temporary,'capture.cjs'); await writeFile(moduleFile,bundled.outputFiles[0].contents);
  const {recordHandlerReplayCorpus}=createRequire(import.meta.url)(moduleFile);
  const cases=recordHandlerReplayCorpus(); assert.ok(cases.length>=13);
  const bytes=Buffer.from(JSON.stringify({schemaVersion:1,cases}));
  const compressed=gzipSync(bytes,{level:9});
  const sources=Object.fromEntries(await Promise.all(Object.keys(bundled.metafile.inputs).sort().map(async file=>[file,hash(await readFile(path.resolve(root,file)))])));
  const manifest={schemaVersion:1,scope:'Synthetic world event reaction queue before cohesive function extraction; not an old production artifact certificate.',
    file:'corpus.json.gz',cases:cases.length,sha256:hash(bytes),compressedSha256:hash(compressed),sources};
  await mkdir(target,{recursive:true});
  for(const [name,data] of [['corpus.json.gz',compressed],['manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n')]]) {
    const destination=new URL(name,target);
    try {assert.deepEqual(await readFile(destination),data,`Refusing to overwrite immutable ${name}; use a new versioned corpus`);}
    catch(error){if(error.code!=='ENOENT')throw error;await writeFile(destination,data,{flag:'wx'});}
  }
  console.log(JSON.stringify({cases:cases.length,bytes:bytes.length,compressed:compressed.length,sha256:manifest.sha256}));
} finally {
  const resolved=path.resolve(temporary),base=path.resolve(tmpdir())+path.sep;
  assert.ok(resolved.startsWith(base)&&path.basename(resolved).startsWith('handler-replay-capture-'));
  await rm(resolved,{recursive:true,force:true});
}
