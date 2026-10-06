// Public planning evidence only. No paths, secrets or database rows; runtime
// settings are restricted by the source-owned execution-profile allowlist.
// Host deployment always reloads the protected original and observes live state.
import {evidenceHash,validateManifest} from './validate-manifest.mjs';
import {assertUIDomain,assertFullAnchorBinding,runtimeCompatibilityHash} from './ui-release-policy.mjs';
import {validateExecutionProfile} from './ui-execution-profile.mjs';
const keys=['schemaVersion','kind','status','manifestHash','sourceCommit','controlCommit','runId','runAttempt','anchorHash','originalAnchor','domain','originalObservedAt','executionProfile'];
export function assertUIProofProjection(value,{manifest,run}) {
  validateManifest(manifest);
  if(!Number.isSafeInteger(run?.id)||run.id<1||!Number.isSafeInteger(run?.runAttempt)||run.runAttempt<1||!/^[a-f0-9]{40}$/.test(run?.controlCommit??''))throw Error('Exact successful deployment workflow attempt required');
  if(!value||evidenceHash(Object.keys(value).sort())!==evidenceHash([...keys].sort())||value.schemaVersion!==1
    ||value.kind!=='frontend-proof-anchor'||value.status!=='post-success-observation'
    ||value.manifestHash!==evidenceHash(manifest)||value.sourceCommit!==manifest.releaseCommit
    ||value.controlCommit!==run.controlCommit||value.runId!==run.id||value.runAttempt!==run.runAttempt
    ||!/^sha256:[a-f0-9]{64}$/.test(value.anchorHash??'')||!Number.isFinite(Date.parse(value.originalObservedAt)))throw Error('Stale or malformed deployed frontend proof projection');
  assertUIDomain(value.domain);
  validateExecutionProfile(value.executionProfile);
  assertFullAnchorBinding(value.originalAnchor,runtimeCompatibilityHash(manifest,value.domain));
  if(Date.parse(value.originalObservedAt)<Date.parse(value.originalAnchor.completedAt))throw Error('Anchor observation predates its original accepted proof');
  return value;
}
export function createUIProofProjection(document,{manifest,run}) {
  if(document?.kind!=='protected-full-ui-anchor'||document.status!=='captured-after-success')throw Error('Actual protected post-success observation required');
  const value={schemaVersion:1,kind:'frontend-proof-anchor',status:'post-success-observation',manifestHash:evidenceHash(manifest),
    sourceCommit:manifest.releaseCommit,controlCommit:run.controlCommit,runId:run.id,runAttempt:run.runAttempt,
    anchorHash:evidenceHash(document),originalAnchor:document.binding,domain:document.anchor.domain,originalObservedAt:document.observedAt,executionProfile:document.executionProfile};
  return assertUIProofProjection(value,{manifest,run});
}
