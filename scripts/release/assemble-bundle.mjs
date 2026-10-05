#!/usr/bin/env node
import {readFile,mkdir,writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertReleaseReady,evidenceHash} from './validate-manifest.mjs';
import {rehearsalInput,validateRehearsal} from './candidate-rehearsal.mjs';
export function assembleDeploymentBundle(candidate,input,receipt) {
  const expected=rehearsalInput(candidate,input.active,input.backup);
  if(evidenceHash(input)!==evidenceHash(expected))throw Error('Rehearsal input differs from candidate or predecessor');
  const checks=validateRehearsal(input,receipt),manifest=structuredClone(candidate.manifest);
  const reportBase={status:'passed',compositionFingerprint:input.compositionFingerprint,rehearsalHash:evidenceHash(receipt),completedAt:receipt.completedAt};
  const image=checks['image-contract'];
  const reports={core:candidate.reports.core,'image-contract':{...reportBase,health:checks['full-candidate-health'],images:image.images,identities:image.identities},
    'pinned-artifacts':{...reportBase,workerRuntime:manifest.workerRuntime,artifactHashes:[...new Set([manifest.rulesArtifactHash,...input.historicalArtifactHashes])].sort(),
      pendingDecisionChecked:true,replay:checks['historical-replay'],duplicate:checks['duplicate-command']}};
  manifest.validationEvidence=Object.entries(reports).map(([gate,report])=>({gate,status:'passed',reportHash:evidenceHash(report),inputFingerprint:input.compositionFingerprint,completedAt:receipt.completedAt}));
  const bundle={reports,previousManifest:input.previousManifest,historicalInventoryComplete:true,historicalArtifactHashes:input.historicalArtifactHashes,
    images:image.images,identities:image.identities,rehearsalReceipt:receipt};
  if(input.legacyBaseline)bundle.legacyBaseline=input.active;
  if(receipt.additiveMigrations){
    reports.additiveMigrations=receipt.additiveMigrations.report;
    bundle.migrationApproval=receipt.additiveMigrations.approval;
  }
  assertReleaseReady(manifest,bundle);
  return {manifest,bundle};
}
export async function main(args) {
  if(args.length!==3)throw Error('Usage: assemble-bundle.mjs CANDIDATE_DIRECTORY REHEARSAL_DIRECTORY NEW_FINAL_DIRECTORY');
  const [candidateDirectory,rehearsalDirectory,finalDirectory]=args;
  const read=async file=>JSON.parse(await readFile(file,'utf8'));
  const candidateFile=path.join(candidateDirectory,'candidate.json'),candidate=await read(candidateFile);
  const {manifest,bundle}=assembleDeploymentBundle(candidate,await read(path.join(rehearsalDirectory,'input.json')),await read(path.join(rehearsalDirectory,'rehearsal.json')));
  await mkdir(finalDirectory,{mode:0o700});
  await copyFile(candidateFile,path.join(finalDirectory,'candidate.json'));
  for(const [name,data] of Object.entries({'manifest.json':manifest,'bundle.json':bundle}))await writeFile(path.join(finalDirectory,name),JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});
  process.stdout.write('Verified deployment bundle assembled from exact candidate receipts.\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(()=>{process.stderr.write('Bundle assembly refused: missing or inconsistent candidate evidence.\n');process.exitCode=1;});
