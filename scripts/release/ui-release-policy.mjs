// Pure eligibility contract. It does not discover GitHub state, inspect Docker,
// execute tests or grant permission to deploy. Callers bind actual observations.
import {evidenceHash, validateManifest, componentInputFingerprint,writerPolicy,writerPolicyFields} from './validate-manifest.mjs';

export const uiPolicyVersion = 'ui-proof-reuse-v1';
const hash = /^sha256:[a-f0-9]{64}$/;
const sha = /^[a-f0-9]{40}$/;
const same = (a,b) => evidenceHash(a) === evidenceHash(b);
const full = reason => ({kind:'full', requiredTier:'extended', reason});
const domainKeys = ['schemaFingerprint','schemaProofHash','databaseBindingHash','backendConfigurationHash','workerConfigurationHash','routingSecurityHash','backendMountsHash','workerMountsHash','immutableRootsHash','frontendBuildContractHash','frontendReadersHash'];
export function assertUIDomain(domain) {
  if (!domain || !same(Object.keys(domain).sort(), [...domainKeys].sort()) || domainKeys.some(key=>!hash.test(domain[key]))) throw Error('Exact protected runtime domain required');
  return domain;
}
export function effectiveWriterPolicy(manifest) {
  return writerPolicy(manifest);
}
export function candidateWriterPolicyFields(previous,config) {
  return writerPolicyFields(previous,config);
}
export function runtimeCompatibilityHash(manifest,domain) {
  validateManifest(manifest);assertUIDomain(domain);
  return evidenceHash({version:uiPolicyVersion, backend:manifest.components.backend, rulesWorker:manifest.components.rulesWorker,
    rulesArtifactHash:manifest.rulesArtifactHash,contentManifestHash:manifest.contentManifestHash,migrationSet:manifest.migrationSet,
    apiProtocolVersion:manifest.apiProtocolVersion,workerProtocolVersion:manifest.workerProtocolVersion,
    workerRuntime:manifest.workerRuntime,supportedWorldSchemaVersions:manifest.supportedWorldSchemaVersions,
    capabilities:manifest.capabilities,writerPolicy:effectiveWriterPolicy(manifest),domain});
}
export function assertBaselineBinding(binding,manifest) {
  const fields=['repository','runId','runAttempt','artifactId','controlCommit','sourceCommit','manifestHash','receiptHash','completedAt'];
  if (!binding || !same(Object.keys(binding).sort(),fields.sort()) || !/^[\w.-]+\/[\w.-]+$/.test(binding.repository)
    || ['runId','runAttempt','artifactId'].some(key=>!Number.isSafeInteger(binding[key])||binding[key]<1)
    || !sha.test(binding.controlCommit) || binding.sourceCommit!==manifest.releaseCommit || binding.manifestHash!==evidenceHash(manifest)
    || !hash.test(binding.receiptHash) || !Number.isFinite(Date.parse(binding.completedAt))) throw Error('Invalid deployed baseline binding');
  return binding;
}
export function assertFullAnchorBinding(anchor,runtimeHash) {
  const fields=['kind','manifestHash','bundleHash','rehearsalHash','backupHash','restoreReportHash','filesystemHash','runtimeCompatibilityHash','completedAt','backupCreatedAt'];
  if (!anchor || !same(Object.keys(anchor).sort(),fields.sort()) || anchor.kind!=='full-proof-anchor'
    || fields.filter(key=>key.endsWith('Hash')).some(key=>!hash.test(anchor[key])) || anchor.runtimeCompatibilityHash!==runtimeHash
    || !Number.isFinite(Date.parse(anchor.completedAt)) || !Number.isFinite(Date.parse(anchor.backupCreatedAt))
    || Date.parse(anchor.backupCreatedAt)>Date.parse(anchor.completedAt)) throw Error('Direct original full proof anchor required');
  return anchor;
}
const pathSafe=file=>typeof file==='string'&&file.length>0&&!file.includes('\\')&&!file.startsWith('/')&&!/[:\0\r\n]/.test(file)&&file.split('/').every(part=>part&&!['.','..'].includes(part));
const hooks=new Set(['useIsMobile','useReducedMotion','useViewportPopoverPosition']);
export function uiPathKind(file) {
  if (!pathSafe(file)) return 'unknown';
  if (/^docs\/.*\.md$/.test(file)||file==='README.md') return 'documentation';
  if (/^frontend\/src\/(?:styles|assets)\/.+\.(?:css|scss|svg|png|jpg|jpeg|webp|woff2)$/.test(file)) return 'presentation';
  if (/^frontend\/src\/hooks\/([^/]+?)(?:\.test)?\.[jt]sx?$/.test(file)) {
    const name=file.split('/').at(-1).replace(/(?:\.test)?\.[jt]sx?$/,'');
    return hooks.has(name)?(file.includes('.test.')?'test':'presentation'):'unknown';
  }
  if (/^frontend\/src\/contexts\/ToastContext(?:\.test)?\.tsx$/.test(file)) return file.includes('.test.')?'test':'presentation';
  // Conservative initial boundary: executable .ts helpers, auth/session and
  // durable command adapters are full-path even when beneath components/pages.
  if (/^frontend\/src\/(?:components|pages)\/.+\.(?:tsx|css|scss)$/.test(file)
    && !/(?:auth|login|register|session|persist|bootstrap|commanddispatch|rulesauthority)/i.test(file)) return file.includes('.test.')?'test':'presentation';
  return 'unknown';
}
export function selectAffectedUITests(changedFiles,testFiles) {
  const eligible=testFiles.filter(file=>uiPathKind(file)==='test');
  const directories=changedFiles.filter(file=>['presentation','test'].includes(uiPathKind(file))).map(file=>file.slice(0,file.lastIndexOf('/')+1));
  // Directory closure is intentionally broad; a missing adjacent corpus forces
  // full verification. No user-supplied subset can silently omit neighbours.
  return [...new Set(eligible.filter(file=>directories.some(directory=>file.startsWith(directory))))].sort();
}
export function classifyReleaseVerification(input={}) {
  const fields=['previousManifest','candidateManifest','selection','matrix','baselineBinding','fullAnchor','previousDomain','candidateDomain','workerInputs','testCatalog'];
  if (Object.keys(input).some(key=>!fields.includes(key))) return full('unknown-eligibility-input');
  const {previousManifest:previous,candidateManifest:candidate,selection,matrix,baselineBinding,fullAnchor,previousDomain,candidateDomain,workerInputs,testCatalog}=input;
  if (!previous || previous.schemaVersion!==1) return full('no-modern-deployed-predecessor');
  validateManifest(previous);
  if (baselineBinding) assertBaselineBinding(baselineBinding,previous);
  if (!candidate || !selection || !matrix || !baselineBinding || !previousDomain || !candidateDomain) return full('missing-proof-input');
  validateManifest(candidate);assertUIDomain(previousDomain);assertUIDomain(candidateDomain);
  const runtimeHash=runtimeCompatibilityHash(previous,previousDomain);
  if(fullAnchor)assertFullAnchorBinding(fullAnchor,runtimeHash);
  if(Object.hasOwn(previous,'writerPolicy')!==Object.hasOwn(candidate,'writerPolicy'))return full('writer-policy-contract-changed');
  if (selection.schema_version!==1 || selection.mode!=='deploy' || selection.full_fallback!==false || selection.baseline?.source!=='deployed-manifest'
    || selection.baseline.sha!==previous.releaseCommit || selection.candidate?.sha!==candidate.releaseCommit || !Array.isArray(selection.changed_files)) return full('not-accumulated-deployed-diff');
  if (candidate.previousReleaseId!==previous.releaseId || !same(previous.components.backend,candidate.components.backend) || !same(previous.components.rulesWorker,candidate.components.rulesWorker)
    || runtimeCompatibilityHash(candidate,candidateDomain)!==runtimeHash) return full('runtime-or-protected-domain-changed');
  if (!Array.isArray(matrix) || matrix.length!==3 || new Set(matrix.map(row=>row.component)).size!==3) throw Error('Invalid component matrix');
  for (const row of matrix) {
    if (row.inputFingerprint!==componentInputFingerprint(row) || !['build','reuse'].includes(row.operation)) throw Error('Invalid component matrix fingerprint');
    if (row.component!=='frontend' && (row.operation!=='reuse' || !same({sourceCommit:row.sourceCommit,inputFingerprint:row.inputFingerprint,imageDigest:row.imageDigest},previous.components[row.component]))) return full('backend-or-worker-not-exact-reuse');
  }
  if (selection.components?.backend || selection.components?.worker || selection.components?.infrastructure) return full('non-ui-component-selected');
  if (selection.changed_files.some(file=>uiPathKind(file)==='unknown')) return full('unsafe-or-worker-input-path');
  const frontend=matrix.find(row=>row.component==='frontend');
  if (!frontend) throw Error('Missing frontend matrix row');
  if(evidenceHash({baseImages:frontend.baseImages,buildArguments:frontend.buildArguments,platform:frontend.platform})!==candidateDomain.frontendBuildContractHash)return full('frontend-build-contract-changed');
  const changed=selection.changed_files.some(file=>!['documentation','test'].includes(uiPathKind(file)));
  // Tests may conservatively select a component even though Docker excludes
  // their bytes. Exact compiler/base-image/arguments fingerprint equality is
  // required too; no new image, backup, deployment receipt or baseline advance.
  if (!changed && matrix.every(row=>row.inputFingerprint===previous.components[row.component].inputFingerprint)) return {kind:'no-deployment-needed',reason:'documentation-or-presentation-tests-only',candidate:candidate.releaseCommit,previousManifestHash:evidenceHash(previous),selectionHash:evidenceHash(selection),matrixHash:evidenceHash(matrix)};
  if(!fullAnchor||!workerInputs||!testCatalog)return full('missing-proof-input');
  if (workerInputs.sourceCommit!==candidate.releaseCommit || workerInputs.artifactHash!==candidate.rulesArtifactHash || !Array.isArray(workerInputs.paths)
    || workerInputs.paths.some(file=>!pathSafe(file)) || new Set(workerInputs.paths).size!==workerInputs.paths.length || !workerInputs.paths.length) return full('missing-current-worker-closure');
  if(selection.changed_files.some(file=>workerInputs.paths.includes(file)))return full('unsafe-or-worker-input-path');
  if (frontend.operation!=='build' || frontend.sourceCommit!==candidate.releaseCommit || candidate.components.frontend.sourceCommit!==candidate.releaseCommit
    || frontend.inputFingerprint!==candidate.components.frontend.inputFingerprint || selection.components.frontend!==true) return full('not-exact-frontend-build');
  if (!Array.isArray(testCatalog) || testCatalog.some(file=>!pathSafe(file))) throw Error('Invalid test catalog');
  const affectedTests=selectAffectedUITests(selection.changed_files,testCatalog);
  if (!affectedTests.length) return full('no-affected-presentation-tests');
  const binding={version:uiPolicyVersion,candidate:candidate.releaseCommit,previousManifestHash:evidenceHash(previous),baseline:baselineBinding,
    runtimeCompatibilityHash:runtimeHash,fullAnchor,selectionHash:evidenceHash(selection),matrixHash:evidenceHash(matrix),
    workerClosureHash:evidenceHash(workerInputs),testCatalogHash:evidenceHash(testCatalog),affectedTests};
  return {kind:'frontend-only',requiredTier:'core',binding,bindingHash:evidenceHash(binding)};
}
export function assertFrontendEligibility(proof,input) {
  const actual=classifyReleaseVerification(input);
  if (actual.kind!=='frontend-only' || !same(proof,actual)) throw Error('Stale or substituted frontend eligibility');
  return actual;
}
