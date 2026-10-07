// Exact archived inputs for explicit revocation tests. Never live certificates.
import assert from 'node:assert/strict';
import {readFile,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {historicalSourceHash} from './historical-catalog-source.mjs';

const directory=fileURLToPath(new URL('./fixtures/historical-revocations/',import.meta.url));
export const archivedRevocationManifestHash='sha256:a2270835660e18d83de5a505bd063f573db5d3e91423378e0583f05bb7f65cfe';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const privateKeys=new Set(['author','userid','groupid','ownerid','createdby','updatedby','reviewedby','password','authorization','apikey','accesstoken','refreshtoken','dsn']);
const versions=['102_revoke_invalid_feather_fall_certification','103_revoke_invalid_mage_hand_certification','119_repair_sleep_spell_class_list_contract'];
function assertPublic(value){
  if(typeof value==='string')assert(!/(?:postgres(?:ql)?:\/\/|https?:\/\/|sk-(?:proj-)?[A-Za-z0-9]{16}|BEGIN [A-Z ]*PRIVATE KEY|[A-Z]:\\|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b)/.test(value),'Private value cannot be an archived public revocation input');
  else if(value&&typeof value==='object')for(const[key,child]of Object.entries(value)){assert(!privateKeys.has(key.replaceAll('_','').toLowerCase()),'Private metadata cannot be an archived public revocation input');assertPublic(child);}
}
export function validateArchivedRevocationInputs(data,manifest){
  assert.equal(data.schemaVersion,1);assert.equal(data.kind,'archived-revocation-inputs');assert.equal(data.currentCertifications,false);assert.equal(data.productionBootstrap,false);
  assert.deepEqual(Object.keys(data).sort(),['currentCertifications','kind','productionBootstrap','rows','schemaVersion']);assertPublic(data);
  assert(Array.isArray(data.rows));assert.equal(data.rows.length,3);assert.deepEqual(data.rows.map(row=>row.migration_version),versions);
  for(const row of data.rows){
    assert.equal(row.entity_type,'spell');assert(uuid.test(row.entity_id));assert.match(row.card_number,/^SPELL-[0-9]+$/);assert.match(row.preimage_hash,/^[a-f0-9]{64}$/);
    assert(row.prior_support&&typeof row.prior_support==='object'&&!Array.isArray(row.prior_support));assert(row.prior_mechanics&&typeof row.prior_mechanics==='object'&&!Array.isArray(row.prior_mechanics));
    assert.equal(historicalSourceHash(row.prior_support.note),manifest.privacy.notesSha256,'Archived notes must be the reviewed public source text');
    const original=manifest.originalPreimages.find(entry=>entry.migration===row.migration_version);assert(original);assert.equal(row.entity_id,original.entityID);assert.equal(row.card_number,original.cardNumber);assert.equal('sha256:'+row.preimage_hash,original.preimageHash);
  }
  assert.equal(historicalSourceHash(JSON.stringify(data)),manifest.dataset.jsonSha256,'Archived source values changed');return data;
}
export function decodeArchivedRevocationInputs(bytes,manifest){
  const entry=manifest.dataset;assert(Number.isSafeInteger(entry.bytes)&&entry.bytes>0&&entry.bytes<=128*1024);assert.equal(bytes.length,entry.bytes);assert.equal(historicalSourceHash(bytes),entry.sha256);
  assert(Number.isSafeInteger(entry.jsonBytes)&&entry.jsonBytes>0&&entry.jsonBytes<=128*1024);const json=gunzipSync(bytes,{maxOutputLength:entry.jsonBytes});assert.equal(json.length,entry.jsonBytes);assert.equal(historicalSourceHash(json),entry.jsonSha256);
  let data;try{data=JSON.parse(json);}catch{throw Error('Archived public revocation JSON is invalid');}return validateArchivedRevocationInputs(data,manifest);
}
export async function loadArchivedRevocationInputs(){
  assert.equal(await realpath(directory),path.resolve(directory));const file=path.join(directory,'manifest.json');assert(!(await lstat(file)).isSymbolicLink());const bytes=await readFile(file);assert.equal(historicalSourceHash(bytes),archivedRevocationManifestHash);
  const manifest=JSON.parse(bytes);assert.equal(manifest.schemaVersion,1);assert.equal(manifest.kind,'archived-revocation-input-provenance');assert.equal(manifest.currentCertifications,false);assert.equal(manifest.productionBootstrap,false);assert.equal(manifest.privacy.privateGameplayRowsIncluded,0);assert.equal(manifest.privacy.privateMetadataKeysIncluded,0);assert.equal(manifest.privacy.notesAlreadyPresentInPublicSources,true);assert.equal(manifest.acceptedOrdinaryChain.registeredMigrations,303);assert.equal(manifest.acceptedOrdinaryChain.unchangedOriginalRevocations,true);
  assert.equal(manifest.dataset.file,'revocations.json.gz');const dataset=path.join(directory,manifest.dataset.file);assert.equal(await realpath(dataset),dataset);assert(!(await lstat(dataset)).isSymbolicLink());const data=decodeArchivedRevocationInputs(await readFile(dataset),manifest);
  return {manifest,manifestHash:archivedRevocationManifestHash,sourceDumpHash:manifest.sourceDumpHash,rows:data.rows};
}
