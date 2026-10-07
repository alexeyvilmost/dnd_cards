import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import {loadHistoricalCatalogSources,projectHistoricalCatalogEntity,validateHistoricalCatalogDataset,decodeHistoricalCatalogDataset,historicalSourceHash} from './historical-catalog-source.mjs';

const source=await loadHistoricalCatalogSources();
test('reviewed public sources preserve original phase membership without private metadata',()=>{
 assert.equal(source.pre278.rows.length,1575);assert.equal(source.pre279.rows.length,2374);assert.equal(source.caster296.rows.length,42);assert.equal(source.cardMembership.rows.length,1011);assert.equal(source.identityUnion.length,2374);
 assert.equal(source.cardMembership.rows.filter(row=>row.deleted_at===null).length,886);assert.equal(source.manifest.productionBootstrap,false);assert.equal(source.manifest.supportOrCertificatesIncluded,false);
 for(const e of source.identityUnion){const key=e.kind==='resource'?'resource_id':e.kind==='monster'?'slug':'card_number';assert.equal(e.reference,e.row[key]);assert(['pre278','pre279'].includes(e.identitySource.dataset));}
 for(const data of [source.pre278,source.pre279])for(const e of data.rows)for(const key of ['author','support','user_id','group_id','owner_id','created_at','updated_at','image_generation_prompt'])assert(!Object.hasOwn(e.row,key));
});
test('1605 original278 and2374 original279 non-insert guards validate actual public source fields',async()=>{
 for(const[dataset,directory,expected]of [[source.pre278,'./../../backend/migrations/data/catalog-audit-20260929/',1605],[source.pre279,'./../../backend/migrations/data/item-completion-279/',2374]]){
  const {readdir}=await import('node:fs/promises'),base=new URL(directory,import.meta.url);let checked=0;
  for(const file of (await readdir(base)).filter(p=>p.endsWith('.json'))){const manifest=JSON.parse(await readFile(new URL(file,base)));for(const list of ['entities','guards'])for(const e of manifest[list]??[])if(e.preimage!=null){const row=dataset.rows.find(r=>r.kind===e.entity_type&&r.id===e.id)?.row;assert(row,'Source preimage absent');for(const[key,value]of Object.entries(e.preimage))assert.deepEqual(row[key],value,'Actual public source field drift');assert.equal(historicalSourceHash(JSON.stringify([row.description??null,row.detailed_description??null])),'sha256:'+e.description_sha256);checked++;}}
  assert.equal(checked,expected);
 }
});
test('source projection drops private metadata without substituting remaining values',()=>{
 const original=structuredClone(source.pre278.rows[0]);Object.assign(original.row,{author:'private-person',support:{status:'verified'},user_id:'private-user',created_at:'private-timestamp',image_generation_prompt:'private-prompt'});
 const projected=projectHistoricalCatalogEntity(original);assert.equal(projected.row.id,original.row.id);assert.deepEqual(projected.row.mechanics,original.row.mechanics);for(const key of ['author','support','user_id','created_at','image_generation_prompt'])assert(!Object.hasOwn(projected.row,key));assert(Object.hasOwn(original.row,'support'));
});
test('nested credentials are rejected instead of silently exported',()=>{
 const original=structuredClone(source.pre278.rows[0]);original.row.mechanics={api_key:'secret'};assert.throws(()=>projectHistoricalCatalogEntity(original),/Private metadata/);
 original.row.mechanics={formula:'postgresql://user:password@127.0.0.1/db'};assert.throws(()=>projectHistoricalCatalogEntity(original),/Credentials/);
});
test('missing rows, duplicate identities and unexpected entity kinds refuse a dataset',()=>{
 const data=structuredClone(source.pre278);data.rows.pop();assert.throws(()=>validateHistoricalCatalogDataset(data,'pre278'));
 data.rows.push(structuredClone(data.rows[0]));assert.throws(()=>validateHistoricalCatalogDataset(data,'pre278'),/Ambiguous source identities/);
 data.rows.at(-1).kind='user';assert.throws(()=>validateHistoricalCatalogDataset(data,'pre278'));
});
test('private support cannot be smuggled into a decoded source fixture',()=>{
 const data=structuredClone(source.pre278);data.rows[0].row.support={status:'verified'};const json=Buffer.from(JSON.stringify(data)),bytes=gzipSync(json);const entry={bytes:bytes.length,sha256:historicalSourceHash(bytes),jsonBytes:json.length,jsonSha256:historicalSourceHash(json)};
 assert.throws(()=>decodeHistoricalCatalogDataset(bytes,entry,'pre278'),/Private metadata/);
});
test('corrupt compressed bytes and altered manifest hashes refuse decoding',async()=>{
 const entry=source.manifest.datasets.pre278,bytes=await readFile(new URL('./fixtures/historical-catalog/'+entry.file,import.meta.url));const changed=Buffer.from(bytes);changed[changed.length-1]^=1;
 assert.throws(()=>decodeHistoricalCatalogDataset(changed,entry,'pre278'));assert.throws(()=>decodeHistoricalCatalogDataset(bytes,{...entry,jsonSha256:'sha256:'+'0'.repeat(64)},'pre278'));
});
test('declared compressed and inflated bounds prevent oversized data',async()=>{
 const entry=source.manifest.datasets.pre278,bytes=await readFile(new URL('./fixtures/historical-catalog/'+entry.file,import.meta.url));
 assert.throws(()=>decodeHistoricalCatalogDataset(bytes,{...entry,bytes:2*1024**2+1},'pre278'));assert.throws(()=>decodeHistoricalCatalogDataset(bytes,{...entry,jsonBytes:entry.jsonBytes-1},'pre278'));assert.throws(()=>decodeHistoricalCatalogDataset(bytes,{...entry,jsonBytes:24*1024**2+1},'pre278'));
});
test('caster evidence and retired-card identities retain canonical source references',()=>{
 for(const e of source.caster296.rows){assert.equal(e.fields.id,e.id);assert.equal(e.fields.card_number,e.reference);assert.match(e.sourceProjectionHash,/^sha256:[a-f0-9]{64}$/);assert.match(e.sourceDumpHash,/^sha256:[a-f0-9]{64}$/);}
 const longsword=source.cardMembership.rows.find(r=>r.reference==='MVP-LONGSWORD');assert.equal(longsword.id,'cb6650a8-489f-4edb-a4f3-77e32f8c2317');assert.equal(longsword.deleted_at,'2026-07-09T17:08:57.914855+00:00');
});
