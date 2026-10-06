// UNIT DATA ONLY. These invented hashes are never actual OCI/recovery evidence.
import {evidenceHash,compositionFingerprint,componentInputFingerprint} from './validate-manifest.mjs';
import {attachUnitRehearsal} from './unit-rehearsal-fixture.mjs';
import {classifyReleaseVerification} from './ui-release-policy.mjs';
import {verifyOriginalFullAnchor,frontendRehearsalChecks} from './ui-release-receipt.mjs';
import {suiteWorkload} from '../testing/workload.mjs';
import {shardPlan} from '../testing/shards.mjs';
export const h=c=>`sha256:${c.repeat(64)}`;
export function uiFixture(){
  const date='2026-01-01T00:00:00.000Z',source='a'.repeat(40),candidate='b'.repeat(40),repository='fixture/project';
  const matrix=['frontend','backend','rulesWorker'].map((component,i)=>{
    const baseImages=Object.fromEntries(({frontend:['NODE_IMAGE','NGINX_IMAGE'],backend:['GO_IMAGE','ALPINE_IMAGE'],rulesWorker:['NODE_IMAGE']}[component]).map(key=>[key,`example.test/base/${key.toLowerCase()}@${h('1')}`]));
    const row={name:component==='rulesWorker'?'worker':component,component,sourceFingerprint:h(String(i+2)),baseImages,platform:'linux/amd64',buildArguments:component==='frontend'?{VITE_API_URL:'',VITE_MEDIA_VARIANTS:'0'}:{}};
    return {...row,inputFingerprint:componentInputFingerprint(row),sourceCommit:source,imageDigest:`example.test/project/${component.toLowerCase()}@${h(String(i+4))}`,operation:'reuse'};
  });
  const previous={schemaVersion:1,releaseId:'full-origin',releaseCommit:source,previousReleaseId:null,createdAt:date,
    components:Object.fromEntries(matrix.map(row=>[row.component,{sourceCommit:row.sourceCommit,inputFingerprint:row.inputFingerprint,imageDigest:row.imageDigest}])),
    rulesArtifactHash:h('7'),contentManifestHash:h('8'),apiProtocolVersion:1,workerProtocolVersion:1,
    workerRuntime:{name:'node',version:'24.21.0'},supportedWorldSchemaVersions:[5],capabilities:['pinned-artifact-routing','pending-decision-pass-through'],
    migrationSet:[],validationEvidence:[]};
  previous.validationEvidence=[{gate:'core',status:'passed',inputFingerprint:h('0'),reportHash:h('0'),completedAt:date}];
  const fingerprint=compositionFingerprint(previous);
  const reports=Object.fromEntries(['core','image-contract','pinned-artifacts'].map(gate=>[gate,{status:'passed',compositionFingerprint:fingerprint,...(gate==='pinned-artifacts'?{workerRuntime:previous.workerRuntime,artifactHashes:[previous.rulesArtifactHash],pendingDecisionChecked:true}:{})}]));
  previous.validationEvidence=Object.entries(reports).map(([gate,report])=>({gate,status:'passed',inputFingerprint:fingerprint,reportHash:evidenceHash(report),completedAt:date}));
  const identities=Object.fromEntries(Object.entries(previous.components).map(([component,row])=>[component,{identitySchemaVersion:1,component,provenance:'baked',sourceCommit:row.sourceCommit,source_commit:row.sourceCommit,inputFingerprint:row.inputFingerprint,releaseId:previous.releaseId,releaseCommit:source,apiProtocolVersion:1}]));
  Object.assign(identities.rulesWorker,{artifactHash:previous.rulesArtifactHash,workerRuntime:previous.workerRuntime,workerProtocolVersion:1,supportedWorldSchemaVersions:[5],capabilities:previous.capabilities});
  const oldBundle={reports,identities,images:Object.fromEntries(matrix.map(row=>[row.component,row.imageDigest])),historicalArtifactHashes:[],historicalInventoryComplete:true};
  attachUnitRehearsal(previous,oldBundle);
  const domain=Object.fromEntries(['schemaFingerprint','schemaProofHash','databaseBindingHash','backendConfigurationHash','workerConfigurationHash','routingSecurityHash','backendMountsHash','workerMountsHash','immutableRootsHash','frontendBuildContractHash','frontendReadersHash'].map(key=>[key,h('d')]));
  domain.frontendBuildContractHash=evidenceHash({baseImages:matrix[0].baseImages,buildArguments:matrix[0].buildArguments,platform:matrix[0].platform});
  const recovery={schemaVersion:1,kind:'recoverability-baseline',status:'verified',currentDatabaseSnapshot:false,originalBackupCreatedAt:date,
    originalReleaseManifestHash:evidenceHash(previous),backupHash:oldBundle.rehearsalReceipt.backupHash,restoreReportHash:h('e'),schemaFingerprint:domain.schemaFingerprint,verifiedAt:'2026-10-05T00:00:00.000Z'};
  const anchorFiles={schemaVersion:1,kind:'immutable-filesystem-closure',observedAt:date,rootsHash:domain.immutableRootsHash,files:[{root:'artifacts',path:'old.cjs',bytes:1,sha256:h('7')}],databaseReferenceInventory:'not_executed',currentDatabaseReferenceCoverage:'not_asserted'};
  const originalAnchor={manifest:structuredClone(previous),bundle:structuredClone(oldBundle),domain:structuredClone(domain),files:anchorFiles};
  const fullAnchor=verifyOriginalFullAnchor(originalAnchor,{domain,recovery});
  matrix[0]={...matrix[0],sourceFingerprint:h('9'),sourceCommit:candidate,imageDigest:null,operation:'build'};
  matrix[0].inputFingerprint=componentInputFingerprint(matrix[0]);
  const next={...structuredClone(previous),releaseId:'ui-new',releaseCommit:candidate,previousReleaseId:previous.releaseId,createdAt:'2026-10-05T00:00:00.000Z',
    components:{...structuredClone(previous.components),frontend:{sourceCommit:candidate,inputFingerprint:matrix[0].inputFingerprint,imageDigest:`example.test/project/frontend@${h('9')}`}}};
  const selection={schema_version:1,mode:'deploy',candidate:{sha:candidate},baseline:{sha:source,source:'deployed-manifest'},full_fallback:false,
    changed_files:['frontend/src/components/Button.tsx'],components:{frontend:true,backend:false,worker:false,infrastructure:false}};
  const testCatalog=['frontend/src/components/Button.test.tsx','frontend/src/components/Dialog.test.tsx','frontend/src/pages/Other.test.tsx'];
  const input={previousManifest:previous,candidateManifest:next,selection,matrix,baselineBinding:{repository,runId:7,runAttempt:2,artifactId:7000,controlCommit:'c'.repeat(40),sourceCommit:source,manifestHash:evidenceHash(previous),receiptHash:h('c'),completedAt:date},
    fullAnchor,previousDomain:domain,candidateDomain:structuredClone(domain),workerInputs:{sourceCommit:candidate,artifactHash:previous.rulesArtifactHash,paths:['frontend/src/rules-core/index.ts']},testCatalog};
  const planning={input,eligibility:classifyReleaseVerification(input)};
  const selectionGroups={selected:[{id:'core-unit',runner:'vitest',files:['frontend/src/components/Button.test.tsx']},
    {id:'local-api-spine',runner:'script',file:'scripts/testing/check-api.mjs'},{id:'local-browser-flows',runner:'playwright',files:['frontend/e2e-local/combat.spec.ts']} ]};
  const catalog=testCatalog.map(file=>({file,runner:'vitest',tier:'extended'}));
  const workload=suiteWorkload({selection:selectionGroups,catalog,manifest:{},suite:'core',frontendPlanning:planning});
  const workloadPlan=shardPlan(workload);
  const ciReport={schema_version:1,status:'passed',suite:'core',candidate:{sha:candidate},ci_source:{clean_checkout:true},source_snapshot:{sha256:'a'.repeat(64),files:9},
    component_plan:{mode:'ci',candidate:{sha:candidate}},frontend_verification:planning.eligibility,frontend_planning:planning,
    checks:['source-hygiene','source-stability','local-api-spine','local-browser-flows'].map(id=>({id,status:'passed',...(id==='source-stability'?{result:{unchanged:true,sha256:'a'.repeat(64),files:9}}:{})})),
    cleanup:{status:'stopped',errors:[]},aggregation:{global_coverage_complete:true,plan_sha256:workloadPlan.sha256,workload:workloadPlan.units.length}};
  const protectedRunning=Object.fromEntries(['backend','rulesWorker'].map((name,i)=>[name,{containerId:String(i+1).repeat(64),identity:identities[name],configurationHash:h('d'),mountsHash:h('d'),databaseBindingHash:h('d')}]));
  const filesBefore={schemaVersion:1,kind:'immutable-filesystem-closure',observedAt:'2026-10-05T00:00:00.000Z',rootsHash:domain.immutableRootsHash,files:[{root:'artifacts',path:'old.cjs',bytes:1,sha256:h('7')}],databaseReferenceInventory:'not_executed',currentDatabaseReferenceCoverage:'not_asserted'};
  const nextIdentities={...identities,frontend:{...identities.frontend,sourceCommit:candidate,source_commit:candidate,inputFingerprint:next.components.frontend.inputFingerprint,releaseId:next.releaseId,releaseCommit:candidate}};
  const images=Object.fromEntries(Object.entries(next.components).map(([name,row])=>[name,row.imageDigest]));
  const receipt={schemaVersion:1,kind:'frontend-selective-rehearsal',execution:'docker',scope:'owned-synthetic',status:'passed',localOnly:false,simulation:false,
    hostObservationScope:'read-only-around-owned-rehearsal',
    runId:'00000000-0000-4000-8000-000000000002',candidateManifestHash:evidenceHash(next),previousManifestHash:evidenceHash(previous),compositionFingerprint:compositionFingerprint(next),eligibilityHash:planning.eligibility.bindingHash,
    coreReportHash:evidenceHash(ciReport),workloadHash:workloadPlan.sha256,anchor:fullAnchor,recovery,
    databaseReferenceInventory:'not_executed',currentDatabaseReferenceCoverage:'not_asserted',currentDatabaseSnapshot:false,completedAt:'2026-10-05T00:01:00.000Z',cleanup:{status:'stopped',errors:[]},
    checks:frontendRehearsalChecks.map(id=>({id,status:'passed',disposition:'executed',evidenceHash:h('a'),...(id==='image-contract'?{images,identities:nextIdentities}:{}),...(id==='frontend-rollback'?{previousDigest:previous.components.frontend.imageDigest,changedComponents:['frontend']}: {})})),
    history:{disposition:'reused',sourceProofHash:evidenceHash(oldBundle.reports['pinned-artifacts']),applicabilityHash:planning.eligibility.bindingHash,originalCompletedAt:fullAnchor.completedAt,originalReport:oldBundle.reports['pinned-artifacts']},
    filesBefore,filesAfter:structuredClone(filesBefore),filesAfterRollback:structuredClone(filesBefore),runtimeBefore:protectedRunning,runtimeAfter:structuredClone(protectedRunning),runtimeAfterRollback:structuredClone(protectedRunning)};
  receipt.rehearsalRuntimeBefore=structuredClone(protectedRunning);receipt.rehearsalRuntimeBefore.backend.containerId='3'.repeat(64);receipt.rehearsalRuntimeBefore.rulesWorker.containerId='4'.repeat(64);
  receipt.rehearsalRuntimeAfter=structuredClone(receipt.rehearsalRuntimeBefore);receipt.rehearsalRuntimeAfterRollback=structuredClone(receipt.rehearsalRuntimeBefore);
  return {planning,originalAnchor,recovery,ciReport,workloadPlan,workload,selectionGroups,catalog,protectedRunning,manifest:next,bundle:{images,identities:nextIdentities,rehearsalReceipt:receipt}};
}
