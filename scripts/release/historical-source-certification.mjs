#!/usr/bin/env node
// Exact historical provenance, deliberately distinct from executable CJS hashes.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile,lstat,realpath,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const descriptorFile=new URL('./fixtures/historical-source-04678a04.json',import.meta.url);
const sha=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const gitBlob=bytes=>createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
// Matches the archived rules-core/determinism.ts JSON algorithm. No current
// rule compiler or runtime is loaded to reinterpret the old certificate.
function canonical(value){
  if(value===null||['string','boolean'].includes(typeof value))return value;
  if(typeof value==='number'){if(!Number.isFinite(value))throw Error('Invalid canonical number');return Object.is(value,-0)?0:value;}
  if(Array.isArray(value))return value.map(canonical);
  if(typeof value!=='object')throw Error('Invalid historical JSON');
  return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])]));
}
const contentHash=value=>sha(Buffer.from(JSON.stringify(canonical(value))));
const equal=(a,b)=>contentHash(a)===contentHash(b);
export function normalizeSourceReleaseHash(value){
  if(typeof value!=='string'||! /^(?:sha256:)?[a-f0-9]{64}$/.test(value))throw Error('Exact source-release SHA256 required');
  return value.startsWith('sha256:')?value:'sha256:'+value;
}
async function descriptor(releaseHash){
  const value=JSON.parse(await readFile(descriptorFile,'utf8'));
  if(value.schemaVersion!==1||value.kind!=='historical-source-certification-descriptor'||value.releaseHash!==normalizeSourceReleaseHash(releaseHash))throw Error('Unsupported historical source release');
  return value;
}
function assertBytes(bytes,row){
  if(bytes.length!==row.bytes||sha(bytes)!==row.sha256||gitBlob(bytes)!==row.gitBlob)throw Error(`Historical source bytes differ: ${row.path}`);
}
function pin(source,name){
  const found=source.match(new RegExp(`export const ${name} =\\s*'([^']+)'`));
  if(!found)throw Error('Historical source pin unavailable');return found[1];
}
function databaseBinding(source,release,artifactVersion){
  const constant=name=>{const match=source.match(new RegExp(`const ${name} = "([^"]+)"`));if(!match)throw Error('Historical database identity is unavailable');return match[1];};
  const raw=source.match(/const microMVPManifestCanonical = `([^`]+)`/)?.[1];
  if(!raw)throw Error('Historical canonical manifest is unavailable');
  const manifest=JSON.parse(raw),manifestHash=sha(Buffer.from(raw));
  if(JSON.stringify(canonical(manifest))!==raw||manifestHash!==constant('microMVPManifestHash')
    ||constant('microMVPReleaseID')!==release.id||constant('microMVPRulesArtifactHash')!==release.releaseHash
    ||constant('microMVPRulesContentHash')!==release.contentHash||manifest.artifactVersion!==artifactVersion
    ||manifest.releaseId!==release.id||manifest.source!=='checked-in:sheetCombatCertification.generated.json')throw Error('Historical database manifest binding differs');
  return {rulesetReleaseId:constant('microMVPRulesReleaseID'),manifestHash,manifestCanonicalBytesSha256:manifestHash,manifest,
    serializerVersion:'rules-core-canonical-json-v1',manifestSchemaVersion:1,protocolSchemaVersion:1,artifactVersion:release.id};
}
function certify(d,bytes){
  const c=JSON.parse(bytes.get(d.certificatePath)),text=p=>bytes.get(p).toString('utf8');
  if(c.schemaVersion!==1||c.artifactVersion!=='1.0.0')throw Error('Historical certification version differs');
  const {contentHash:claimedContent,...certificateContent}=c;
  const projection=Object.fromEntries(['source','summary','coverage','actions','accessSignaturesByAction','preparedSourceProfiles','magicInitiate'].map(key=>[key,c[key]]));
  if(contentHash(certificateContent)!==claimedContent||contentHash(projection)!==c.sourceProjectionHash)throw Error('Historical certificate hashes differ');
  const source=text('frontend/src/canon/prodSnapshotL1Fixtures.ts'),identity=text('frontend/src/canon/microMvpL1ReleaseIdentity.ts');
  const sourceReleaseId=pin(source,'PINNED_PROD_SNAPSHOT_L1_RELEASE_ID'),rulesHash=pin(source,'PINNED_PROD_SNAPSHOT_L1_RULES_HASH');
  const sourceContentHash=pin(source,'PINNED_PROD_SNAPSHOT_L1_CONTENT_HASH');
  const sourceReleaseHash=contentHash({id:sourceReleaseId,rulesHash,contentHash:sourceContentHash});
  if(sourceReleaseHash!==pin(source,'PINNED_PROD_SNAPSHOT_L1_RELEASE_HASH'))throw Error('Historical source-release calculation differs');
  const r=c.source.release,ruleset=c.source.ruleset;
  if(r.sourceReleaseId!==sourceReleaseId||r.sourceContentHash!==sourceContentHash
    ||r.overlayHash!==pin(identity,'PINNED_MICRO_MVP_L1_OVERLAY_HASH')||r.contentHash!==pin(identity,'PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH')
    ||r.releaseHash!==pin(identity,'PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH')||r.releaseHash!==d.releaseHash
    ||ruleset.releaseId!==r.id||ruleset.systemId!==r.systemId||ruleset.contentHash!==r.contentHash||ruleset.errataVersion!==r.errataVersion)throw Error('Historical release/certificate identity differs');
  const releaseHash=contentHash({id:r.id,sourceReleaseHash,overlayHash:r.overlayHash,contentHash:r.contentHash});
  if(releaseHash!==d.releaseHash)throw Error('Historical overlay-release calculation differs');
  const binding=databaseBinding(text('backend/migrations/register_micro_mvp_rules_release.go'),r,c.artifactVersion);
  return {schemaVersion:1,kind:'historical-source-release',releaseHash,releaseId:r.id,contentHash:r.contentHash,
    artifactVersion:c.artifactVersion,certificateContentHash:claimedContent,sourceProjectionHash:c.sourceProjectionHash,
    manifestHash:binding.manifestHash,databaseBinding:binding,systemId:r.systemId,rulesetVersion:r.rulesetVersion,errataVersion:r.errataVersion,
    sourceReleaseId,sourceReleaseHash,sourceContentHash,rulesHash,overlayHash:r.overlayHash,
    descriptorHash:contentHash(d),commit:d.commit,executable:false,
    verification:{certificateContentHash:true,sourceProjectionHash:true,sourceReleaseFormula:true,overlayReleaseFormula:true,databaseManifestHash:true},
    limits:{fullSourceRecompile:false,historicalCommandReplay:false,completeCompilerDependencyClosure:false},
    files:d.files.map(row=>({path:'sources/'+row.path,sha256:row.sha256,bytes:row.bytes}))};
}
async function assertDirectory(directory){
  if((await lstat(directory)).isSymbolicLink()||await realpath(directory)!==path.resolve(directory))throw Error('Historical recovery directory must not traverse links');
}
async function filesUnder(directory,prefix=''){
  const files=[];
  for(const row of await readdir(directory,{withFileTypes:true})){
    if(row.isSymbolicLink())throw Error('Historical recovery forbids symbolic links');
    const relative=prefix+row.name;
    if(row.isDirectory())files.push(...await filesUnder(path.join(directory,row.name),relative+'/'));
    else if(row.isFile())files.push(relative);else throw Error('Historical recovery forbids special files');
  }
  return files.sort();
}
export async function verifyHistoricalSourceCertification(directory){
  directory=path.resolve(directory);await assertDirectory(directory);
  const provenancePath=path.join(directory,'provenance.json');
  if(!(await lstat(provenancePath)).isFile()||(await lstat(provenancePath)).isSymbolicLink())throw Error('Historical provenance must be a regular file');
  const provenanceBytes=await readFile(provenancePath),claimed=JSON.parse(provenanceBytes);
  const d=await descriptor(claimed.releaseHash),expectedFiles=['provenance.json',...d.files.map(row=>'sources/'+row.path)].sort();
  if(!equal(await filesUnder(directory),expectedFiles))throw Error('Historical recovery file set differs');
  const bytes=new Map();for(const row of d.files){const value=await readFile(path.join(directory,'sources',row.path));assertBytes(value,row);bytes.set(row.path,value);}
  const result=certify(d,bytes);if(!equal(claimed,result))throw Error('Historical provenance report differs from exact source');
  return {...result,files:[...result.files,{path:'provenance.json',sha256:sha(provenanceBytes),bytes:provenanceBytes.length}]};
}
export async function recoverHistoricalSourceCertification({repo,commit,releaseHash,outputDirectory}){
  const d=await descriptor(releaseHash);if(commit!==undefined&&commit!==d.commit)throw Error('Historical recovery commit differs from descriptor');
  const git=args=>execFileSync('git',['-C',path.resolve(repo),...args],{stdio:['ignore','pipe','pipe'],maxBuffer:2*1024*1024});
  if(git(['rev-parse','--verify',d.commit+'^{commit}']).toString().trim()!==d.commit)throw Error('Historical source commit is unavailable');
  const bytes=new Map();
  for(const row of d.files){
    if(git(['rev-parse',d.commit+':'+row.path]).toString().trim()!==row.gitBlob)throw Error('Historical source tree/blob differs');
    const value=git(['cat-file','blob',row.gitBlob]);assertBytes(value,row);bytes.set(row.path,value);
  }
  const result=certify(d,bytes),directory=path.resolve(outputDirectory);await assertDirectory(path.dirname(directory));
  await mkdir(directory,{mode:0o700});
  for(const row of d.files){const target=path.join(directory,'sources',row.path);await mkdir(path.dirname(target),{recursive:true,mode:0o700});await writeFile(target,bytes.get(row.path),{flag:'wx',mode:0o600});}
  await writeFile(path.join(directory,'provenance.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  return verifyHistoricalSourceCertification(directory);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const [mode,...args]=process.argv.slice(2);let result;
    if(mode==='recover'&&args.length===3)result=await recoverHistoricalSourceCertification({repo:args[0],releaseHash:args[1],outputDirectory:args[2]});
    else if(mode==='verify'&&args.length===1)result=await verifyHistoricalSourceCertification(args[0]);
    else throw Error('Use recover REPOSITORY RELEASE_HASH NEW_DIRECTORY or verify DIRECTORY');
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch{process.stderr.write('Historical source certification recovery/verification failed; no executable replacement or history rewrite is permitted.\n');process.exitCode=1;}
}
