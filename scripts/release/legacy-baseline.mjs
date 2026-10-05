// A historical deployment observation is not a release manifest. Image IDs and
// runtime claims prove what was running, never how those images were built.
import {evidenceHash} from './validate-manifest.mjs';
import {existsSync} from 'node:fs';
import path from 'node:path';
const hash=value=>typeof value==='string'&&/^sha256:[a-f0-9]{64}$/.test(value);
export const legacyServices={frontend:'frontend',backend:'backend',rulesWorker:'rules-worker'};
export const isLegacyBaseline=value=>value?.kind==='observed-legacy-baseline';
export const baselineDocument=value=>{if(!isLegacyBaseline(value))return value.manifest;const {database,...baseline}=value;return baseline;};
export const baselineArtifact=value=>baselineDocument(value).rulesArtifactHash;
export const componentImage=(value,key)=>isLegacyBaseline(value)?value.components[key].imageId:value.manifest.components[key].imageDigest;
export function deploymentStateFile(config){
  const active=path.join(config.root,'active.json'),legacy=path.join(config.root,'legacy-state.json');
  if(existsSync(active))return active;
  if(existsSync(legacy))return legacy;
  if(config.legacyBaselineDirectory){
    const directory=path.resolve(config.legacyBaselineDirectory);
    if(path.dirname(directory)!==path.resolve(config.root)||!/^legacy-observation-[A-Za-z0-9_-]+$/.test(path.basename(directory)))throw Error('Protected legacy observation directory required');
    return path.join(directory,'baseline.json');
  }
  return active;
}
export function legacyRuntimeFingerprint(container){
  const {Env,Entrypoint,Cmd,User,WorkingDir,ExposedPorts,Healthcheck,StopSignal,Labels}=container.Config??{};
  const host=container.HostConfig??{};
  const {ReadonlyRootfs,Privileged,CapAdd,CapDrop,SecurityOpt,RestartPolicy,PortBindings,Tmpfs,Memory,NanoCpus,Init}=host;
  return evidenceHash({Env:[...(Env??[])].sort(),Entrypoint,Cmd,User,WorkingDir,ExposedPorts,Healthcheck,StopSignal,
    labels:Object.fromEntries(Object.entries(Labels??{}).filter(([key])=>!key.startsWith('com.docker.compose.'))),
    host:{ReadonlyRootfs,Privileged,CapAdd,CapDrop,SecurityOpt,RestartPolicy,PortBindings,Tmpfs,Memory,NanoCpus,Init},
    mounts:(container.Mounts??[]).map(({Type,Source,Destination,RW,Propagation})=>({Type,Source,Destination,RW,Propagation})).sort((a,b)=>a.Destination.localeCompare(b.Destination)),
    networks:Object.keys(container.NetworkSettings?.Networks??{}).sort()});
}
export function validateLegacyBaseline(value){
  if(value?.schemaVersion!==1||value.kind!=='observed-legacy-baseline'||value.status!=='observed'||value.provenance!=='runtime-observation-only'
    ||value.deployable!==false||!/^([a-f0-9]{40})$/.test(value.claimedReleaseCommit??'')||!Number.isFinite(Date.parse(value.observedAt))
    ||!hash(value.rollbackConfigurationHash)||!hash(value.databaseIdentityHash)||!hash(value.schemaFingerprint)||!hash(value.rulesArtifactHash)
    ||!Array.isArray(value.migrationIds)||!value.migrationIds.length||new Set(value.migrationIds).size!==value.migrationIds.length
    ||value.migrationIds.some(id=>typeof id!=='string'||!/^\d{3}_[a-z0-9_]+$/.test(id))
    ||!Array.isArray(value.artifactHashes)||!value.artifactHashes.includes(value.rulesArtifactHash)||value.artifactHashes.some(item=>!hash(item))
    ||value.historicalChecksums!=='unavailable'||value.bakedIdentity!=='unavailable'||!hash(value.observationHash))throw Error('Complete observed legacy baseline required');
  for(const key of Object.keys(legacyServices)){
    const row=value.components?.[key];
    if(!row||!hash(row.imageId)||!/^[a-f0-9]{64}$/.test(row.containerId??'')||row.healthy!==true||row.runtimeClaim!==value.claimedReleaseCommit
      ||!hash(row.configurationHash)||typeof row.imageReference!=='string'||!row.imageReference||/[\s\0]/.test(row.imageReference))throw Error('Legacy component observation is incomplete');
  }
  const {observationHash,database,...body}=value;if(evidenceHash(body)!==observationHash)throw Error('Legacy observation checksum differs');
  return value;
}
export function legacyBinding(value){validateLegacyBaseline(value);return {kind:value.kind,observationHash:value.observationHash,claimedReleaseCommit:value.claimedReleaseCommit};}
export function legacyMigrationBaseline(value){validateLegacyBaseline(value);return {schemaVersion:2,kind:'observed-legacy-baseline',expectedCurrentIds:[...value.migrationIds],baselineObservationHash:value.observationHash};}
export function assertLegacyObservation(expected,actual){
  validateLegacyBaseline(expected);validateLegacyBaseline(actual);
  // A fresh timestamp and replacement container IDs are not image/config/DB
  // identity. Recovery verifies the same configuration and exact image IDs.
  for(const key of ['claimedReleaseCommit','rollbackConfigurationHash','databaseIdentityHash','rulesArtifactHash'])if(expected[key]!==actual[key])throw Error('Legacy deployment changed since observation');
  for(const key of Object.keys(legacyServices))for(const field of ['imageId','configurationHash','runtimeClaim'])if(expected.components[key][field]!==actual.components[key][field])throw Error('Legacy component changed since observation');
  if(evidenceHash(expected.migrationIds)!==evidenceHash(actual.migrationIds)||expected.schemaFingerprint!==actual.schemaFingerprint)throw Error('Legacy database changed since observation');
  return actual;
}
