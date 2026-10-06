// Validate the optional retirement record from the exact trusted deploy
// artifact. A file without its attested receipt marker is never a baseline.
import path from 'node:path';
import {readFileSync,existsSync} from 'node:fs';
import {evidenceHash} from './validate-manifest.mjs';
import {validateRetirementProjection} from './retirement-projection.mjs';
import {backupFile} from './backup-manifest.mjs';
export function verifiedRetirementBaseline(manifest,receipt,run,observation){
  if(receipt?.retirementObservationHash===undefined){
    if(observation!==undefined)throw Error('Unattested retirement observation cannot enter the deployed baseline');
    return null;
  }
  if(!observation||receipt.retirementObservationHash!==evidenceHash(observation))throw Error('Exact retirement artifact required by the baseline receipt');
  validateRetirementProjection(observation,{manifest,request:{repository:run.repository,controlCommit:run.controlCommit,sourceCommit:manifest.releaseCommit,runId:run.id,attempt:run.runAttempt}});
  return structuredClone(observation.active);
}
export function readRetirementBaselineArtifact(directory){
  const file=path.join(directory,'retirement-observation.json');
  return existsSync(file)?JSON.parse(readFileSync(backupFile(directory,'retirement-observation.json'),'utf8')):undefined;
}
