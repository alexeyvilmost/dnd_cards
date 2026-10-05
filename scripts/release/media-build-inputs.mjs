#!/usr/bin/env node
// Local preparation only. This does not mint component identity or enable OCI.
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareMediaVariants} from '../../frontend/scripts/media-variants.mjs';
import {evidenceHash} from './validate-manifest.mjs';

const hash=bytes=>`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const defaultRepo=fileURLToPath(new URL('../../',import.meta.url));
function readRegular(root,relative) {
  let current=path.resolve(root);if(lstatSync(current).isSymbolicLink())throw Error('Media input root cannot be a symlink');
  for(const part of relative.split('/')){if(!part||part==='..'||part==='.'||part.includes('\\'))throw Error('Invalid input path');current=path.join(current,part);if(lstatSync(current).isSymbolicLink())throw Error('Media input symlink rejected');}
  if(!lstatSync(current).isFile())throw Error('Expected media input file');return readFileSync(current);
}
export function mediaBuildInputs({bundleDirectory,browserReport,repo=defaultRepo}) {
  const validated=prepareMediaVariants({enabled:true,bundleDirectory,publicDirectory:path.join(repo,'frontend/public')});
  const manifestBytes=readRegular(bundleDirectory,'manifest.json'),manifest=JSON.parse(manifestBytes),variants=manifest.entries.filter(row=>row.status==='variant');
  const reportBytes=readRegular(path.dirname(path.resolve(browserReport)),path.basename(browserReport)),report=JSON.parse(reportBytes);
  if(report.schemaVersion!==1||report.status!=='passed'||typeof report.browser!=='string'||!report.browser
    ||report.summary?.browserRGBAEqual!==true||report.summary?.failedPairs!==0||!Array.isArray(report.checks)||report.checks.length!==variants.length)throw Error('Complete passing browser pixel report required');
  const reported=new Map();
  for(const row of report.checks) {
    if(reported.has(row.sourceURL)||row.equal!==true||row.differentBytes!==0||row.maxDifference!==0||row.opaqueDifferences!==0||row.alphaDifferences!==0)throw Error('Browser report duplicate or failed media pair');
    reported.set(row.sourceURL,row);
  }
  for(const row of variants) {
    const check=reported.get(row.sourceURL);
    if(!check||check.variantURL!==row.variantURL||check.rgbaBytes!==row.proof.rgbaBytes)throw Error('Browser report does not cover this exact variant URL set');
  }
  const files=[{path:'manifest.json',bytes:manifestBytes.length,sha256:hash(manifestBytes)}];
  const unique=new Set();
  for(const row of variants) {
    const relative=`files/${row.variantSha256}.webp`;if(unique.has(relative))continue;unique.add(relative);
    const bytes=readRegular(bundleDirectory,relative);
    if(hash(bytes)!==`sha256:${row.variantSha256}`||bytes.length!==row.variantBytes)throw Error('Media bundle changed during preparation');
    files.push({path:relative,bytes:bytes.length,sha256:hash(bytes)});
  }
  files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
  return {schemaVersion:1,kind:'media-build-input-proposal',status:'prepared_not_release_authorized',deployable:false,
    bundleFingerprint:evidenceHash({domain:'lossless-media-bundle-v1',files}),manifestHash:hash(manifestBytes),files,
    browserEvidence:{reportHash:hash(reportBytes),browser:report.browser,verifiedPairs:variants.length,binding:'retrospective_exact_URL_set_and_content_hash_match; not signed release attestation'},
    runtimeManifestHash:evidenceHash(validated.runtimeManifest),eligibility:'opaque_or_binary_alpha_only',sourceOriginalsRetained:true,
    futureBuildInputs:{VITE_MEDIA_VARIANTS:'1',MEDIA_VARIANTS_BUNDLE:'/app/media-bundle'},
    requiredBeforeOCI:['versioned release manifest/config extension','named immutable bundle context included in frontend fingerprint','complete originals visible to build adapter','enabled build/HTTP/print and OCI acceptance','explicit authorized publication and production deployment'],
    note:'Current release schema v1 and Dockerfile deliberately reject enabled media; this proposal is not a component fingerprint or OCI digest'};
}
export function stageMediaBuildInputs({outputDirectory,...options}) {
  if(!outputDirectory||existsSync(outputDirectory))throw Error('Staged media input directory must be new');
  const output=path.resolve(outputDirectory),repo=path.resolve(options.repo??defaultRepo),source=path.resolve(options.bundleDirectory);
  if(output===source||output.startsWith(source+path.sep)||output.startsWith(path.join(repo,'frontend')+path.sep))throw Error('Staging must stay outside source bundle and frontend originals');
  const record=mediaBuildInputs(options);mkdirSync(output,{recursive:true});mkdirSync(path.join(output,'bundle'));
  for(const row of record.files) {
    const bytes=readRegular(options.bundleDirectory,row.path);if(hash(bytes)!==row.sha256||bytes.length!==row.bytes)throw Error('Media source changed before staging');
    const destination=path.join(output,'bundle',row.path);mkdirSync(path.dirname(destination),{recursive:true});writeFileSync(destination,bytes,{flag:'wx'});
  }
  const browserBytes=readRegular(path.dirname(path.resolve(options.browserReport)),path.basename(options.browserReport));
  if(hash(browserBytes)!==record.browserEvidence.reportHash)throw Error('Browser report changed before staging');
  writeFileSync(path.join(output,'browser-proof.json'),browserBytes,{flag:'wx'});
  writeFileSync(path.join(output,'media-input.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
  return record;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i+=2){const key={'--bundle':'bundleDirectory','--browser-report':'browserReport','--output':'outputDirectory'}[args[i]];if(!key||!args[i+1])throw Error('Usage: media-build-inputs.mjs --bundle BUNDLE --browser-report REPORT --output NEW_DIRECTORY');options[key]=args[i+1];}
  if(!options.bundleDirectory||!options.browserReport||!options.outputDirectory)throw Error('Explicit bundle, browser report and fresh staging directory required');
  const result=stageMediaBuildInputs(options);console.log(JSON.stringify({status:result.status,deployable:result.deployable,bundleFingerprint:result.bundleFingerprint,manifestHash:result.manifestHash,files:result.files.length,bytes:result.files.reduce((n,row)=>n+row.bytes,0)}));
}
