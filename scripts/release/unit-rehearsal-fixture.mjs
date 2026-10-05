// Unit-test data factory only. No CLI, file writes or actual execution claims.
// Production producers must execute candidate-rehearsal.mjs instead.
import {compositionFingerprint,evidenceHash,candidateRehearsalStages} from './validate-manifest.mjs';
export function attachUnitRehearsal(manifest,bundle) {
  const hash=`sha256:${'d'.repeat(64)}`,health={status:'passed',components:['backend','frontend','rulesWorker'],publishedPorts:0,canonicalCurrentArtifact:true,currentArtifactHash:manifest.rulesArtifactHash};
  const byId={snapshot:{backupHash:hash,schemaFingerprint:hash},migrations:{versions:manifest.migrationSet.map(row=>row.id).sort()},
    'full-candidate-health':health,'image-contract':{images:structuredClone(bundle.images),identities:structuredClone(bundle.identities)},
    'historical-inventory':{complete:true,artifactHashes:[...bundle.historicalArtifactHashes]},'historical-replay':{artifactHashes:[...bundle.historicalArtifactHashes],commands:1},
    'pending-decision':{checked:true,pendingHash:hash},'duplicate-command':{checked:true,acceptedHash:hash,continuedHash:hash,invariantHash:hash}};
  bundle.rehearsalReceipt={schemaVersion:1,kind:'candidate-rehearsal',execution:'docker',status:'passed',runId:'00000000-0000-4000-8000-000000000001',
    releaseId:manifest.releaseId,candidateHash:hash,activeHash:hash,backupHash:hash,compositionFingerprint:compositionFingerprint(manifest),completedAt:manifest.createdAt,
    checks:candidateRehearsalStages.map(id=>({id,status:'passed',...byId[id]})),cleanup:{status:'stopped',errors:[]}};
  for(const gate of ['image-contract','pinned-artifacts'])bundle.reports[gate].rehearsalHash=evidenceHash(bundle.rehearsalReceipt);
  bundle.reports['image-contract'].health=bundle.rehearsalReceipt.checks.find(row=>row.id==='full-candidate-health');
  for(const row of manifest.validationEvidence)row.reportHash=evidenceHash(bundle.reports[row.gate]);
  return bundle;
}
