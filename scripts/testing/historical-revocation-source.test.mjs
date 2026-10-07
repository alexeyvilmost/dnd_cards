import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {loadArchivedRevocationInputs,validateArchivedRevocationInputs,decodeArchivedRevocationInputs} from './historical-revocation-source.mjs';
const source=await loadArchivedRevocationInputs(),data={schemaVersion:1,kind:'archived-revocation-inputs',currentCertifications:false,productionBootstrap:false,rows:source.rows};
test('three complete authentic archived inputs are retained for unchanged original revocations only',()=>{
  assert.equal(source.rows.length,3);assert.equal(source.manifest.currentCertifications,false);assert.equal(source.manifest.productionBootstrap,false);assert.equal(source.manifest.dataset.bytes,2381);
  for(const row of source.rows){assert.equal(Object.keys(row.prior_support).length,19);assert.match(row.preimage_hash,/^[a-f0-9]{64}$/);assert.equal(row.entity_type,'spell');}
});
test('archived inputs cannot be declared current certificates or production bootstrap',()=>{
  for(const flag of ['currentCertifications','productionBootstrap']){const changed=structuredClone(data);changed[flag]=true;assert.throws(()=>validateArchivedRevocationInputs(changed,source.manifest));}
});
test('missing, duplicate, reordered or foreign revocations refuse validation',()=>{
  for(const mutate of [rows=>rows.pop(),rows=>rows[1]=structuredClone(rows[0]),rows=>rows.reverse(),rows=>rows[0].entity_id=rows[1].entity_id]){const changed=structuredClone(data);mutate(changed.rows);assert.throws(()=>validateArchivedRevocationInputs(changed,source.manifest));}
});
test('original mechanics and complete support are source values rather than reconstructed guard values',()=>{
  for(const field of ['prior_support','prior_mechanics']){const changed=structuredClone(data);changed.rows[0][field]={...changed.rows[0][field],extra:'tampered source value'};assert.throws(()=>validateArchivedRevocationInputs(changed,source.manifest),/source values changed/);}
});
test('private metadata, credentials and freeform notes cannot enter the public capsule',()=>{
  for(const value of [{reviewed_by:'private-identity'},{reviewedBy:'private-identity'},{formula:'postgresql://user:password@127.0.0.1/db'}]){const changed=structuredClone(data);Object.assign(changed.rows[0].prior_mechanics,value);assert.throws(()=>validateArchivedRevocationInputs(changed,source.manifest),/Private/);}
  const changed=structuredClone(data);changed.rows[0].prior_support.note='Changed freeform note';assert.throws(()=>validateArchivedRevocationInputs(changed,source.manifest),/reviewed public source text/);
});
test('corrupt compressed source and declared oversized/unbounded data refuse decoding',async()=>{
  const bytes=await readFile(new URL('./fixtures/historical-revocations/revocations.json.gz',import.meta.url)),bad=Buffer.from(bytes);bad[bad.length-1]^=1;assert.throws(()=>decodeArchivedRevocationInputs(bad,source.manifest));
  for(const dataset of [{...source.manifest.dataset,bytes:128*1024+1},{...source.manifest.dataset,jsonBytes:128*1024+1},{...source.manifest.dataset,jsonBytes:source.manifest.dataset.jsonBytes-1}])assert.throws(()=>decodeArchivedRevocationInputs(bytes,{...source.manifest,dataset}));
});
