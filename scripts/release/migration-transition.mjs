import {evidenceHash,compositionFingerprint,validateMigrationSet,assertObservedMigrationBinding} from './validate-manifest.mjs';
import {isLegacyBaseline,validateLegacyBaseline,legacyMigrationBaseline} from './legacy-baseline.mjs';
import {validateRetirementDatabaseState,retirementDatabaseStateFromInspection} from './retirement-state.mjs';
import {retirementInspectionFromExecution} from './retirement-execution-result.mjs';
const equal=(a,b)=>evidenceHash(a)===evidenceHash(b);
const hash=value=>typeof value==='string'&&/^sha256:[a-f0-9]{64}$/.test(value);
const image=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(value);
const allowed=new Set(['298_compact_command_receipts','299_frozen_combat_catalogs','300_image_jobs','301_character_lifecycle']);
export const retiredObservedMigrationIds=Object.freeze(['011_add_detailed_description_formatting','096_register_micro_mvp_rules_release','097_repair_micro_mvp_rules_release_identity','098_repair_magic_initiate_2024']);
export const characterRetirementMigrationId='301_retire_legacy_characters';
// Executable registration and historical ledger retention are separate sets.
// Only exact candidate metadata may attest support for these non-executable IDs.
export function assertExecutableMigrationRegistry(metadata,target,baseline){
  if(metadata?.schemaVersion!==1||!Array.isArray(metadata.versions)||new Set(metadata.versions).size!==metadata.versions.length||metadata.versions.some(id=>typeof id!=='string'))throw Error('Candidate executable migration registry is invalid');
  if(metadata.versions.includes(characterRetirementMigrationId))throw Error('Character retirement must never be a startup migration');
  const registered=new Set(metadata.versions),before=new Set(baseline.map(row=>row.id));
  const retained=target.filter(row=>!registered.has(row.id));
  const retirement=retained.filter(row=>row.id===characterRetirementMigrationId),observed=retained.filter(row=>row.id!==characterRetirementMigrationId);
  if(retirement.length&&(retirement.length!==1||!hash(retirement[0].checksum)||retirement[0].kind!==undefined||retirement[0].observationHash!==undefined
    ||!equal(metadata.supportedRetirementMigrations,retirement)||!baseline.some(row=>equal(row,retirement[0]))))throw Error('Exact previously installed retirement checksum and baked reader support required');
  if(observed.length&&(!equal(metadata.retiredObservedMigrationIds,retiredObservedMigrationIds)||observed.some(row=>!retiredObservedMigrationIds.includes(row.id)||!before.has(row.id)||row.kind!=='observed-id-only'||!hash(row.observationHash)||row.checksum!==undefined)))throw Error('Unsupported, unobserved or invented retired migration identity');
  if(!equal([...metadata.versions,...retained.map(row=>row.id)].sort(),target.map(row=>row.id).sort()))throw Error('Candidate executable would run undeclared migrations');
  return true;
}
export const migrationScenarios=['atomic-ddl-ledger','crash-before-ledger','repeat-after-commit','same-connection-lock','unknown-migration-rejected','schema-proof','old-readers-after-expansion'];
function validSet(rows){try{validateMigrationSet(rows);return true;}catch{return false;}}
export function databaseMigrationSet(active){return active.database?.migrationSet??(isLegacyBaseline(active)?validateLegacyBaseline(active).migrationIds.map(id=>({id})):active.manifest.migrationSet);}
export function migrationRequestBaseline(active){return isLegacyBaseline(active)&&!active.database?legacyMigrationBaseline(active):{schemaVersion:1,expectedCurrent:databaseMigrationSet(active)};}
export function assertLegacyMigrationBinding(active,target){if(isLegacyBaseline(active)&&!active.database)assertObservedMigrationBinding(target,active.migrationIds,active.observationHash);}
export function migrationBaselineMatches(active,target){assertLegacyMigrationBinding(active,target);return isLegacyBaseline(active)&&!active.database?equal(active.migrationIds,[...target.map(row=>row.id)].sort()):equal(databaseMigrationSet(active),target);}
export function validateDatabaseState(active) {
  const data=active.database;if(!data)return;
  if(data.status==='verified-character-retirement'){if(isLegacyBaseline(active))throw Error('Retirement requires an adopted manifest baseline');return validateRetirementDatabaseState(active);}
  if(data.migrationSet?.some(row=>row.id===characterRetirementMigrationId))throw Error('Installed retirement requires its separate recorded observation format');
  if(data.schemaVersion!==1||data.status!=='verified-additive'||!validSet(data.migrationSet)||!hash(data.schemaProofHash)||!hash(data.approvalHash)||!image(data.executorImageDigest)
    ||![1,2].includes(data.request?.schemaVersion)||!equal(data.request.target,data.migrationSet)
    ||!/^([a-f0-9]{40})$/.test(data.request.candidateSourceCommit)||!hash(data.request.candidateInputFingerprint))throw Error('Invalid persisted observed database state');
  const observedLegacy=data.request.schemaVersion===2;
  if(observedLegacy){
    if(data.request.kind!=='observed-legacy-baseline'||!hash(data.request.baselineObservationHash)||!Array.isArray(data.request.expectedCurrentIds)||!data.request.expectedCurrentIds.length
      ||data.request.expectedCurrent!==undefined||new Set(data.request.expectedCurrentIds).size!==data.request.expectedCurrentIds.length)throw Error('Invalid persisted observed legacy request');
    if(isLegacyBaseline(active)&&(data.request.baselineObservationHash!==active.observationHash||!equal(data.request.expectedCurrentIds,active.migrationIds)))throw Error('Expanded database belongs to another legacy observation');
    assertObservedMigrationBinding(data.migrationSet,data.request.expectedCurrentIds,data.request.baselineObservationHash);
  }else if(!validSet(data.request.expectedCurrent))throw Error('Invalid persisted migration baseline');
  for(const row of isLegacyBaseline(active)?active.migrationIds.map(id=>({id})):active.manifest.migrationSet)if(!data.migrationSet.some(item=>isLegacyBaseline(active)?item.id===row.id:equal(item,row)))throw Error('Application expects a migration absent from observed database');
  for(const row of data.migrationSet)if(!(observedLegacy?data.request.expectedCurrentIds.includes(row.id):data.request.expectedCurrent.some(item=>equal(item,row)))&&!allowed.has(row.id))throw Error('Persisted database expansion contains an unapproved migration');
}
export function migrationTransition(candidate,bundle,active) {
  const baseline=databaseMigrationSet(active),target=candidate.migrationSet;
  if(migrationBaselineMatches(active,target))return {mode:'no-schema-change',baseline,target};
  if(active.database?.status==='verified-character-retirement')throw Error('Ordinary releases must retain the complete installed retirement migration set');
  const legacy=isLegacyBaseline(active)&&!active.database;
  const matches=(a,b)=>legacy?a.id===b.id:equal(a,b);
  for(const row of baseline)if(!target.some(item=>matches(item,row)))throw Error('Migration change removes or edits an applied migration');
  const added=target.filter(row=>!baseline.some(item=>matches(item,row)));
  if(!added.length||added.some(row=>!allowed.has(row.id)))throw Error('Migration change requires an explicitly allowed additive executor');
  const approval=bundle.migrationApproval,report=bundle.reports?.additiveMigrations;
  if(approval?.schemaVersion!==1||approval.mode!=='additive-298-300'||!equal(approval.baseline,baseline)||!equal(approval.target,target)
    ||approval.compositionFingerprint!==compositionFingerprint(candidate)||approval.reportHash!==evidenceHash(report)
    ||report?.status!=='passed'||report.candidateSourceCommit!==candidate.components.backend.sourceCommit
    ||report.candidateInputFingerprint!==candidate.components.backend.inputFingerprint||!equal(report.baseline,baseline)||!equal(report.target,target)
    ||report.backwardCompatible!==true||report.rollbackWriters!=='off'||!Array.isArray(report.scenarios)
    ||migrationScenarios.some(scenario=>!report.scenarios.includes(scenario)))throw Error('Matching additive migration rehearsal and backward compatibility approval required');
  if(legacy&&(approval.baselineObservationHash!==active.observationHash||report.baselineObservationHash!==active.observationHash))throw Error('Legacy migration approval belongs to another observation');
  return {mode:'additive-298-300',baseline,target,added,approvalHash:evidenceHash(approval),request:{...migrationRequestBaseline(active),releaseId:candidate.releaseId,
    target,candidateSourceCommit:candidate.components.backend.sourceCommit,candidateInputFingerprint:candidate.components.backend.inputFingerprint}};
}
export function databaseStateFromResult(plan,receipt) {
  const transition=plan.migration;
  if(transition.mode!=='additive-298-300'||receipt?.schemaVersion!==1||receipt.status!=='verified'||receipt.result?.status!=='verified'
    ||receipt.result.releaseId!==plan.desired.manifest.releaseId||!hash(receipt.result.schemaProofHash)
    ||!equal(receipt.result.observedVersions,[...transition.target.map(row=>row.id)].sort())
    ||receipt.build?.sourceCommit!==transition.request.candidateSourceCommit||receipt.build?.inputFingerprint!==transition.request.candidateInputFingerprint||receipt.build?.provenance!=='baked')throw Error('Migration observation is incomplete or belongs to another candidate');
  if(transition.request.schemaVersion===2&&receipt.result.baselineObservationHash!==transition.request.baselineObservationHash)throw Error('Migration observation differs from legacy baseline');
  return {schemaVersion:1,status:'verified-additive',migrationSet:transition.target,schemaProofHash:receipt.result.schemaProofHash,
    approvalHash:transition.approvalHash,request:transition.request,executorImageDigest:plan.desired.manifest.components.backend.imageDigest};
}
export function stateWithDatabase(active,database){const state={...active,database};validateDatabaseState(state);return state;}
export function databaseStateFromRetirementInspection(args,receipt){validateDatabaseState(args.active);if(isLegacyBaseline(args.active))throw Error('Retirement requires an adopted manifest baseline');return retirementDatabaseStateFromInspection(args,receipt);}
export function databaseStateFromRetirementExecution(args,receipt){
  const observed=retirementInspectionFromExecution(args.request,receipt);
  return databaseStateFromRetirementInspection({...args,request:observed.request},observed.inspection);
}
export function requiresOldReaders(active){return isLegacyBaseline(active)?Boolean(active.database):!equal(databaseMigrationSet(active),active.manifest.migrationSet);}
