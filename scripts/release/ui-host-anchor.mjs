import {readFileSync} from 'node:fs';import path from 'node:path';
import {assertProtectedPath} from './ui-host-observation.mjs';import {evidenceHash} from './validate-manifest.mjs';
import {verifyOriginalFullAnchor} from './ui-release-receipt.mjs';import {verifyRecoverabilityBaseline,checksum} from './backup-manifest.mjs';
export async function readProtectedFullAnchor(config){
  const root=path.join(config.root,'full-anchors');
  let selected=config.frontendAnchorFile;
  if(!selected){const pointer=JSON.parse(readFileSync(assertProtectedPath(root,path.join(root,'current.json')),'utf8'));
    if(pointer.schemaVersion!==1||!/^sha256:[a-f0-9]{64}$/.test(pointer.anchorHash??''))throw Error('Protected anchor pointer invalid');
    selected=path.join(root,pointer.anchorHash.slice(7)+'.json');}
  const file=assertProtectedPath(root,selected),doc=JSON.parse(readFileSync(file,'utf8'));
  if(path.basename(file)!==evidenceHash(doc).slice(7)+'.json'||doc.kind!=='protected-full-ui-anchor'||doc.status!=='captured-after-success'
    ||doc.currentDatabaseSnapshot!==false||doc.databaseReferenceInventory!=='not_executed'||doc.currentDatabaseReferenceCoverage!=='not_asserted'
    ||!Number.isFinite(Date.parse(doc.observedAt)))throw Error('Immutable protected original full observation required');
  const recoveryDirectory=assertProtectedPath(config.root,doc.recoveryDirectory??config.backupDirectory,{directory:true});
  const backup=JSON.parse(readFileSync(assertProtectedPath(config.root,path.join(recoveryDirectory,'backup.json')),'utf8'));
  const originalFiles=backup.files.filter(row=>row.category==='release-manifest');if(originalFiles.length!==1)throw Error('Original backup release identity missing');
  const original=JSON.parse(readFileSync(assertProtectedPath(config.root,path.join(recoveryDirectory,originalFiles[0].path)),'utf8'));
  const recovery=await verifyRecoverabilityBaseline(recoveryDirectory,original,{restoreReportHash:doc.binding.restoreReportHash});
  if(evidenceHash(verifyOriginalFullAnchor(doc.anchor,{domain:doc.anchor.domain,recovery}))!==evidenceHash(doc.binding))throw Error('Original protected anchor binding changed');
  const runtimeFile=assertProtectedPath(config.root,doc.runtimeDocument?.file);
  if(await checksum(runtimeFile)!==doc.runtimeDocument.sha256)throw Error('Original resolved runtime composition changed');
  return {document:doc,recovery,runtime:JSON.parse(readFileSync(runtimeFile,'utf8'))};
}
