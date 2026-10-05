// Explicit maintenance only. Normal tests read frozen bytes and never update them.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {readFile,readdir,mkdir,writeFile,access} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {build} from 'esbuild';
import ts from 'typescript';
import {execute,cleanEnvironment} from '../../scripts/testing/runtime.mjs';
import {replayPendingCase} from '../src/rules-core/testing/pendingReplay.mjs';

const args=process.argv.slice(2),version=args.find(value=>value.startsWith('--version='))?.slice(10),dry=args.includes('--dry-run');
if(!/^pending-lifecycle-v[1-9][0-9]*$/.test(version??'')||args.some(value=>value!=='--dry-run'&&value!==`--version=${version}`))throw Error('Choose --version=pending-lifecycle-vN and optionally --dry-run');
const frontend=fileURLToPath(new URL('../',import.meta.url)),root=path.dirname(frontend);
const target=path.join(frontend,'src/rules-core/testing/fixtures',version);
if(!dry){try{await access(target);throw Error('Frozen corpus already exists; choose a new version');}catch(error){if(error.code!=='ENOENT')throw error;}}
const owner=randomBytes(16).toString('hex'),directory=path.join(root,'outputs/testing/pending-lifecycle-capture',owner);
await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'owner.txt'),owner,{flag:'wx'});
const files=['itemEventReactions.integration','actionCostPolicy.integration','arcaneRecovery.integration','activeSlotRecovery.integration',
  'failedCheckBoost.integration','saveDamageReaction.integration','protectionRuntime.integration','attackRuntime.integration',
  'magicMissileShield','masterySaveContinuation','interactionPrimitives','world'].map(name=>`src/rules-core/${name}.test.ts`);
const config=path.join(directory,'config.mjs'),reportFile=path.join(directory,'vitest-report.json');
await writeFile(config,`export default ${JSON.stringify({root:frontend,test:{environment:'node',maxWorkers:1,include:files,
  setupFiles:[fileURLToPath(new URL('./pending-lifecycle-capture.setup.ts',import.meta.url))],testTimeout:30000,hookTimeout:60000}})};\n`,{flag:'wx'});
await execute(process.execPath,[path.join(frontend,'node_modules/vitest/vitest.mjs'),'run','--config',config,'--reporter=json','--outputFile',reportFile],
  {cwd:frontend,env:cleanEnvironment({PENDING_CAPTURE_DIRECTORY:directory}),timeout:300000,log:path.join(directory,'capture.log')});
const report=JSON.parse(await readFile(reportFile,'utf8'));
assert.ok(report.numTotalTests>0);assert.equal(report.numPassedTests,report.numTotalTests);assert.equal(report.numPendingTests,0);assert.equal(report.numFailedTests,0);
const rows=await Promise.all((await readdir(directory)).filter(file=>/^[a-z_]+-[a-f0-9]{64}\.json$/.test(file)).sort().map(async file=>JSON.parse(await readFile(path.join(directory,file),'utf8'))));
const domain=ts.createSourceFile('domain.ts',await readFile(path.join(frontend,'src/rules-core/domain.ts'),'utf8'),ts.ScriptTarget.Latest,true);
const declarations=new Map(domain.statements.filter(row=>row.name).map(row=>[row.name.text,row]));
const discriminator=name=>{
  const declaration=declarations.get(name),field=declaration.members?.find(row=>row.name?.getText(domain)==='type');
  if(field&&ts.isLiteralTypeNode(field.type)&&ts.isStringLiteral(field.type.literal))return field.type.literal.text;
  for(const clause of declaration.heritageClauses??[])for(const reference of clause.types){const value=discriminator(reference.expression.getText(domain));if(value)return value;}
  throw Error(`Missing phase discriminator for ${name}`);
};
const phases=declarations.get('PendingResolution').type.types.map(reference=>discriminator(reference.typeName.getText(domain))).sort();
assert.deepEqual([...new Set(rows.map(row=>row.phase))].sort(),phases,'Existing semantic fixtures must exercise every supported phase');
const hash=value=>createHash('sha256').update(value).digest('hex');
const bundled=await build({absWorkingDir:frontend,entryPoints:['src/rules-core/handler.ts'],bundle:true,platform:'node',format:'cjs',target:'node20',write:false,metafile:true});
const artifact=bundled.outputFiles[0].contents,artifactPath=path.join(directory,'handler.cjs');await writeFile(artifactPath,artifact,{flag:'wx'});
const {handleCommand}=createRequire(import.meta.url)(artifactPath);
for(const row of rows)replayPendingCase(handleCommand,row);
const corpus=Buffer.from(JSON.stringify({schemaVersion:1,cases:rows})),packed=gzipSync(corpus,{level:9}),packedArtifact=gzipSync(artifact,{level:9});
const sources=Object.fromEntries(await Promise.all(Object.keys(bundled.metafile.inputs).sort().map(async file=>[file,hash(await readFile(path.resolve(frontend,file)))])));
const manifest={schemaVersion:1,scope:'Current synthetic rule continuations captured from passing semantic tests; not a historical production worker or certification.',
  phaseCounts:Object.fromEntries(phases.map(phase=>[phase,rows.filter(row=>row.phase===phase).length])),cases:rows.length,
  file:'corpus.json.gz',sha256:hash(corpus),compressedSha256:hash(packed),artifactFile:'handler.cjs.gz',artifactSha256:hash(artifact),artifactCompressedSha256:hash(packedArtifact),
  capture:{tests:report.numTotalTests,files},sources};
const output=dry?path.join(directory,'candidate'):target;await mkdir(output,{recursive:true});
for(const[file,bytes]of[['manifest.json',JSON.stringify(manifest,null,2)+'\n'],['corpus.json.gz',packed],['handler.cjs.gz',packedArtifact]])await writeFile(path.join(output,file),bytes,{flag:'wx'});
console.log(JSON.stringify({dryRun:dry,cases:rows.length,phases:phases.length,sha256:manifest.sha256,directory:output}));
